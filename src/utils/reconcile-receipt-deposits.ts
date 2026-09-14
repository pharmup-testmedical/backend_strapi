import type { Core } from '@strapi/strapi';

/**
 * Единая идемпотентная сверка кешбэк-депозитов поставщиков по одному чеку.
 * Депозит.balance — счётчик обязательств (не физические деньги, см. план
 * депозита) — списывается/возвращается ТОЛЬКО через эту функцию, всегда
 * приводя receipt-item.item.depositDeductedAmount к тому, что должно быть
 * списано ПРЯМО СЕЙЧАС для этой позиции:
 *
 *   target  = должна ли позиция сейчас удерживать резерв? cashback×quantity : 0
 *   current = item.depositDeductedAmount (что реально удержано сейчас)
 *   delta   = target − current
 *
 * delta>0 — пытаемся довзять delta с депозита (атомарно, могла не хватить).
 * delta<0 — возвращаем |delta| на депозит (всегда проходит).
 * delta=0 — ничего не делаем. Это и даёт идемпотентность: повторный вызов
 * на том же чеке без реальных изменений — no-op.
 *
 * depositExhausted — липкое: если позиция уже была помечена (не хватило
 * депозита на каком-то предыдущем проходе), target для неё всегда 0,
 * НАВСЕГДА, даже если депозит потом пополнили (бизнес-решение — см. план
 * этапа 2, п.2). Разморозить может только прямая правка админом в Content
 * Manager, не эта функция.
 *
 * ВАЖНО (по итогам расследования 2026-09-14, несколько неверных гипотез по
 * пути — см. git-историю этого файла, если интересны детали): вызов ИЗНУТРИ
 * afterCreate ЭТОГО ЖЕ чека происходит, пока create() ещё держит открытую
 * ТРАНЗАКЦИЮ (не просто соединение из пула — саму транзакцию, до commit).
 *   • Чтение — через strapi.db.query(), не через голый strapi.db.connection:
 *     db.query() участвует в текущей транзакции автоматически (через
 *     AsyncLocalStorage у @strapi/database, transaction-context.js), поэтому
 *     корректно видит ещё не закоммиченные строки. Голый knex-инстанс без
 *     этого не в курсе транзакции — берёт независимое соединение и просто
 *     не находит только что созданные строки (молча, без ошибки).
 *   • Запись — по-прежнему сырой knex (нужна атомарная условная запись
 *     `WHERE balance >= delta` в одном UPDATE, которую db.query() не даёт:
 *     он строго валидирует data как число, сырое SQL-выражение отклоняет),
 *     но теперь ЯВНО присоединена к той же транзакции через
 *     strapi.db.transaction() — он сам обнаруживает уже открытую внешнюю
 *     транзакцию (той же AsyncLocalStorage-магией) и отдаёт её же, не
 *     создавая новую. Без этого сырой knex пытался открыть НЕЗАВИСИМУЮ
 *     запись — SQLite же допускает только одного писателя одновременно,
 *     отсюда "database is locked" (это уже настоящая блокировка движка,
 *     не путать с более ранним KnexTimeoutError про пул соединений — тот
 *     был устранён отдельно, увеличением pool.max для sqlite в
 *     config/database.ts).
 * Это НЕ триггерит рекурсивный afterUpdate и не запускает O(N²) пересчёт
 * баланса на каждую позицию (тот же принцип, что уже спас прод в
 * v3_backfill_organization_city.js) — сырой knex остаётся именно поэтому,
 * не из-за проблем с видимостью/блокировкой, которые решены выше. Пересчёт
 * баланса пользователя делает вызывающий код ОТДЕЛЬНО, один раз, ПОСЛЕ этой
 * функции — см. receipt/content-types/receipt/lifecycles.ts.
 */

const EPSILON = 0.01;

const DEPOSIT_ELIGIBLE_ITEM_STATUSES = [
  'auto_verified_canon',
  'auto_verified_alias',
  'auto_verified_ntin',
  'manually_verified_alias',
  'manual_review',
];

const REJECTED_RECEIPT_STATUSES = ['auto_rejected', 'manually_rejected', 'auto_rejected_late_submission'];

// Те же два набора, что уже использует calculateFinalCashback() в
// receiptHelpers.ts и calculateUserBalance() — переиспользую их значения
// (не импортирую сами функции, чтобы не тащить сюда лишние зависимости и
// сигнатуры под "сырые" объекты БД, а не Document Service).
const FULLY_VERIFIED_RECEIPT_STATUSES = ['auto_verified', 'manually_verified'];
const CONFIRMED_ITEM_STATUSES_FOR_FINAL_CASHBACK = [
  'auto_verified_canon',
  'auto_verified_alias',
  'auto_verified_ntin',
  'manually_verified_alias',
];

interface RawItemRow {
  item_id: number;
  cashback: number | null;
  verification_status: string | null;
  deposit_exhausted: boolean | null;
  deposit_deducted_amount: number | null;
  quantity: number | null;
  funding_supplier_id: number | null;
}

export async function reconcileReceiptDeposits(strapi: Core.Strapi, receiptId: number): Promise<void> {
  // db.query() — сам подхватывает текущую (возможно, ещё не закоммиченную)
  // транзакцию через AsyncLocalStorage, см. комментарий выше.
  const receiptRowRaw = await strapi.db.query('api::receipt.receipt').findOne({
    where: { id: receiptId },
    select: ['id', 'verificationStatus', 'finalCashback'],
    populate: {
      items: {
        on: {
          'receipt-item.item': {
            populate: { props: true, fundingSupplier: { fields: ['id'] } },
          },
        },
      },
    },
  });
  if (!receiptRowRaw) return;

  const itemRows: RawItemRow[] = (receiptRowRaw.items ?? [])
    .filter((it: any) => it.__component === 'receipt-item.item')
    .map((it: any) => ({
      item_id: it.id,
      cashback: it.cashback,
      verification_status: it.verificationStatus,
      deposit_exhausted: !!it.depositExhausted,
      deposit_deducted_amount: it.depositDeductedAmount,
      quantity: it.props?.quantity ?? null,
      funding_supplier_id: it.fundingSupplier?.id ?? null,
    }));

  // Эффективный cashback каждой позиции по ходу сверки — нужен, чтобы в
  // конце пересчитать receipt.finalCashback (см. ниже), если он есть на
  // проверяемом чеке. Стартуем с уже сохранённых значений; исчерпание
  // позиции ниже обновляет соответствующую запись на 0.
  const effectiveCashbackByItemId = new Map<number, number>(itemRows.map((it) => [it.item_id, Number(it.cashback) || 0]));

  const items = itemRows.filter((it) => it.funding_supplier_id != null);
  if (items.length === 0) return; // ни одной позиции с привязкой к поставщику — сверять нечего

  const supplierIds = Array.from(new Set(items.map((it) => it.funding_supplier_id as number)));
  const depositDocs = await strapi.db.query('api::supplier-cashback-deposit.supplier-cashback-deposit').findMany({
    where: { supplier: { id: { $in: supplierIds } } },
    select: ['id'],
    populate: { supplier: { select: ['id'] } },
  });

  const depositIdBySupplierId = new Map<number, number>();
  for (const d of depositDocs as any[]) {
    const supplierId = d.supplier?.id;
    if (supplierId != null) depositIdBySupplierId.set(supplierId, d.id);
  }

  const receiptRejected = REJECTED_RECEIPT_STATUSES.includes(receiptRowRaw.verificationStatus);

  // strapi.db.transaction() обнаруживает уже открытую внешнюю транзакцию
  // (той же AsyncLocalStorage-магией, что и db.query() выше) и отдаёт ЕЁ ЖЕ,
  // не открывая новую — см. комментарий в начале файла. Сырой knex-запрос,
  // явно присоединённый через .transacting(trx), становится частью той же
  // транзакции и не конфликтует с ней за блокировку записи SQLite.
  await strapi.db.transaction(async ({ trx }: { trx: any }) => {
    const knex = strapi.db.connection;
    const depositTable = () => knex('supplier_cashback_deposits').transacting(trx);
    const itemTable = () => knex('components_receipt_item_items').transacting(trx);

    for (const item of items) {
      // Товар помечен поставщиком, но у поставщика ещё нет записи депозита
      // (админ не завершил настройку) — ведём себя так же, как при полном
      // отсутствии привязки: не трогаем cashback, ничего не резервируем.
      const depositId = depositIdBySupplierId.get(item.funding_supplier_id as number);
      if (depositId == null) continue;

      const quantity = item.quantity ?? 1;
      const cashbackPerUnit = Number(item.cashback) || 0;
      const current = Number(item.deposit_deducted_amount) || 0;
      const alreadyExhausted = !!item.deposit_exhausted;

      const isEligible =
        !alreadyExhausted && !receiptRejected && DEPOSIT_ELIGIBLE_ITEM_STATUSES.includes(item.verification_status ?? '');
      const target = isEligible ? cashbackPerUnit * quantity : 0;
      const delta = target - current;

      if (Math.abs(delta) <= EPSILON) continue; // идемпотентность: уже сверено

      if (delta < 0) {
        // Возврат — событие отклонения/пересчёта, всегда проходит.
        await depositTable().where('id', depositId).increment('balance', -delta);
        await itemTable().where('id', item.item_id).update({ deposit_deducted_amount: target });
        continue;
      }

      // delta > 0 — пробуем довзять ровно delta. Атомарно: WHERE balance>=delta
      // в одном UPDATE — гарантия от гонки при параллельных чеках одного
      // поставщика (см. план этапа 2, п.2).
      const affected = await depositTable().where('id', depositId).where('balance', '>=', delta).decrement('balance', delta);

      if (affected > 0) {
        await itemTable().where('id', item.item_id).update({ deposit_deducted_amount: target });
      } else {
        // Не хватило — позиция целиком уходит в исчерпание (не частично):
        // возвращаем то, что уже могло быть зарезервировано на предыдущем
        // проходе (обычно 0 — но должно быть симметрично на случай, если
        // target вырос, например из-за ручной правки cashback админом).
        if (current > EPSILON) {
          await depositTable().where('id', depositId).increment('balance', current);
        }
        await itemTable().where('id', item.item_id).update({
          deposit_deducted_amount: 0,
          deposit_exhausted: true,
          cashback: 0,
        });
        effectiveCashbackByItemId.set(item.item_id, 0);
      }
    }

    // Для ПОЛНОСТЬЮ подтверждённых чеков calculateUserBalance()/
    // calculateFinalCashback() берут готовое receipt.finalCashback, а не
    // сумму по позициям (в отличие от частично подтверждённых, где сумма
    // считается из позиций каждый раз заново) — если сверка выше обнулила
    // позицию из-за исчерпания депозита, finalCashback, посчитанный ДО этого
    // (в момент подачи чека), стал бы завышенным без этого пересчёта здесь.
    if (FULLY_VERIFIED_RECEIPT_STATUSES.includes(receiptRowRaw.verificationStatus)) {
      const recomputedFinalCashback = itemRows.reduce((sum, it) => {
        if (!CONFIRMED_ITEM_STATUSES_FOR_FINAL_CASHBACK.includes(it.verification_status ?? '')) return sum;
        const quantity = it.quantity ?? 1;
        const cashback = effectiveCashbackByItemId.get(it.item_id) ?? (Number(it.cashback) || 0);
        return sum + cashback * quantity;
      }, 0);

      if (Math.abs(recomputedFinalCashback - (Number(receiptRowRaw.finalCashback) || 0)) > EPSILON) {
        await knex('receipts').transacting(trx).where('id', receiptRowRaw.id).update({ final_cashback: recomputedFinalCashback });
      }
    }
  });
}
