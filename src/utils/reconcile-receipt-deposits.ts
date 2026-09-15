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
 * пути — см. git-историю этого файла, если интересны детали): изначально
 * эта функция вызывалась ИЗНУТРИ afterCreate этого же чека, пока create()
 * ещё держал открытую ТРАНЗАКЦИЮ (не просто соединение из пула — саму
 * транзакцию, до commit).
 *   • Чтение — через strapi.db.query(), не через голый strapi.db.connection:
 *     db.query() участвует в текущей транзакции автоматически (через
 *     AsyncLocalStorage у @strapi/database, transaction-context.js), поэтому
 *     корректно видит ещё не закоммиченные строки. Голый knex-инстанс без
 *     этого не в курсе транзакции — берёт независимое соединение и просто
 *     не находит только что созданные строки (молча, без ошибки).
 *   • Запись — сырой knex (нужна атомарная условная запись
 *     `WHERE balance >= delta` в одном UPDATE, которую db.query() не даёт:
 *     он строго валидирует data как число, сырое SQL-выражение отклоняет).
 *
 * ВАЖНО (расследование 2026-09-21, MySQL, реальная конкурентность): пока
 * сверка была вложена в транзакцию create() чека, два ОДНОВРЕМЕННЫХ чека
 * одного поставщика на MySQL (InnoDB, настоящие построчные блокировки — не
 * путать с SQLite, где запись физически сериализована самим движком и
 * гонки как таковой не бывает) иногда ловили настоящий ER_LOCK_DEADLOCK.
 * Так как сверка была частью транзакции создания чека, дедлок откатывал
 * ВЕСЬ чек целиком — пользователю пришлось бы пересканировать чек заново
 * (включая поход в ОФД), хотя сам факт покупки тут ни при чём. По
 * решению (2026-09-21): создание чека (факт покупки) и списание депозита
 * (учёт обязательства перед поставщиком) — разные по смыслу события,
 * поэтому сверка ВЫНЕСЕНА из транзакции create() в отдельный вызов СРАЗУ
 * ПОСЛЕ того, как чек уже создан и закоммичен — см. reconcileReceiptDepositsSafely
 * ниже и её вызовы в receipt/controllers/receipt.ts (НЕ в lifecycles.ts —
 * там сверки больше нет).
 *   • Раз сверка больше не выполняется внутри чужой открытой транзакции,
 *     strapi.db.query() для чтения и strapi.db.transaction()+.transacting(trx)
 *     для записи здесь используются уже не для "присоединения к внешней
 *     транзакции", а просто как собственная короткая атомарная транзакция
 *     этой функции (тот же API, другая роль) — гарантия атомарности
 *     WHERE balance >= delta остаётся ровно той же.
 *   • Дедлок на MySQL по-прежнему возможен (это нормальное поведение
 *     InnoDB под конкурентной нагрузкой на одну и ту же строку депозита,
 *     не баг) — но теперь он ловится и гасится ретраем в
 *     reconcileReceiptDepositsSafely, не долетая до пользователя и не
 *     трогая уже созданный чек.
 * Это НЕ триггерит рекурсивный afterUpdate и не запускает O(N²) пересчёт
 * баланса на каждую позицию (тот же принцип, что уже спас прод в
 * v3_backfill_organization_city.js) — сырой knex остаётся именно поэтому,
 * не из-за проблем с видимостью/блокировкой. Пересчёт баланса пользователя
 * делает вызывающий код ОТДЕЛЬНО, один раз, ПОСЛЕ reconcileReceiptDepositsSafely
 * — см. вызовы в receipt/controllers/receipt.ts.
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
        await itemTable()
          .where('id', item.item_id)
          .update({ deposit_deducted_amount: target, deposit_reconciliation_failed_at: null });
        continue;
      }

      // delta > 0 — пробуем довзять ровно delta. Атомарно: WHERE balance>=delta
      // в одном UPDATE — гарантия от гонки при параллельных чеках одного
      // поставщика (см. план этапа 2, п.2).
      const affected = await depositTable().where('id', depositId).where('balance', '>=', delta).decrement('balance', delta);

      if (affected > 0) {
        await itemTable()
          .where('id', item.item_id)
          .update({ deposit_deducted_amount: target, deposit_reconciliation_failed_at: null });
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
          deposit_reconciliation_failed_at: null,
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

const DEADLOCK_RETRY_ATTEMPTS = 3;
const DEADLOCK_RETRY_BASE_DELAY_MS = 75;

function isDeadlockError(error: any): boolean {
  return error?.code === 'ER_LOCK_DEADLOCK' || /deadlock/i.test(error?.message ?? '');
}

/**
 * Обёртка над reconcileReceiptDeposits с ретраем на MySQL-дедлок — это
 * единственная точка входа, которую должен вызывать остальной код (контроллер
 * receipt.ts, СРАЗУ ПОСЛЕ того, как чек уже создан и закоммичен, не раньше —
 * см. разбор архитектуры в шапке файла).
 *
 * Дедлок здесь — не признак недостатка депозита, а временная накладка
 * движка БД под конкурентной нагрузкой (несколько чеков одного поставщика
 * одновременно). Ретраим с небольшим нарастающим бэкоффом (75/150/225мс —
 * этого достаточно, чтобы конкурирующая транзакция успела закоммититься и
 * отпустить блокировку строки депозита, но не настолько много, чтобы
 * заметно задержать ответ пользователю).
 *
 * Худший случай — дедлок не разрешился за все попытки: чек уже существует
 * (это НЕ откатывается, он был закоммичен ДО этого вызова), но депозит по
 * нему ещё не сверен. НЕ используем depositExhausted для этого случая — тот
 * означает "депозита ГЕНУИННО не хватило", липкий навсегда даже после
 * пополнения; здесь же денег могло быть вполне достаточно, просто сверку
 * не удалось провести технически. Вместо этого — отдельное поле
 * depositReconciliationFailedAt (receipt-item/item.json): позиция и её
 * cashback остаются как были ДО сверки (обычно как посчитано при парсинге
 * чека), ничего не обнуляем и ничего не депозитируем — самоисцеляется:
 * следующий ЛЮБОЙ успешный вызов reconcileReceiptDeposits (например, при
 * сверке следующего чека того же поставщика, или ручной повторный вызов
 * из админки) пересчитает delta с нуля и корректно спишет/спишет-обратно
 * то, что нужно, и сам сотрёт deposit_reconciliation_failed_at — никакой
 * специальной логики "разморозки" не требуется, это тот же идемпотентный
 * путь, что уже используется для depositExhausted... с одной разницей:
 * depositReconciliationFailedAt НЕ блокирует target (в отличие от
 * alreadyExhausted в reconcileReceiptDeposits) — позиция остаётся
 * полноценным кандидатом на списание при следующем проходе, ровно потому
 * что мы не знаем, было бы списание успешным или нет.
 */
export async function reconcileReceiptDepositsSafely(strapi: Core.Strapi, receiptId: number): Promise<void> {
  for (let attempt = 1; attempt <= DEADLOCK_RETRY_ATTEMPTS; attempt++) {
    try {
      await reconcileReceiptDeposits(strapi, receiptId);
      return;
    } catch (error: any) {
      if (!isDeadlockError(error) || attempt === DEADLOCK_RETRY_ATTEMPTS) {
        strapi.log.error(
          `[reconcileReceiptDepositsSafely] Чек ${receiptId}: сверка депозита не удалась после ${attempt} попыт(ки/ок) — ${error?.message}. Чек НЕ трогаю, помечаю позиции как отложенные.`
        );
        await markReconciliationFailed(strapi, receiptId);
        return;
      }
      strapi.log.warn(
        `[reconcileReceiptDepositsSafely] Чек ${receiptId}: дедлок на попытке ${attempt}/${DEADLOCK_RETRY_ATTEMPTS}, повтор через ${DEADLOCK_RETRY_BASE_DELAY_MS * attempt}мс`
      );
      await new Promise((resolve) => setTimeout(resolve, DEADLOCK_RETRY_BASE_DELAY_MS * attempt));
    }
  }
}

/**
 * Худший случай: все ретраи исчерпаны. Помечаем только те позиции этого
 * чека, у которых есть fundingSupplier (остальные сверке не подлежат в
 * принципе) — простановкой deposit_reconciliation_failed_at. Идём напрямую
 * через knex по служебным таблицам dynamiczone-компонента (receipts_cmps —
 * связка чек↔компонент, components_receipt_item_items_funding_supplier_lnk
 * — связка позиция↔поставщик), а не через strapi.db.query()/Document
 * Service: на этом этапе мы уже вне транзакции reconcileReceiptDeposits
 * (та откатилась целиком при дедлоке), и это финальная запись, которой
 * не нужна атомарность с чем-либо ещё — только простой UPDATE.
 */
async function markReconciliationFailed(strapi: Core.Strapi, receiptId: number): Promise<void> {
  try {
    const knex = strapi.db.connection;
    const itemIds: { id: number }[] = await knex('receipts_cmps as rc')
      .join('components_receipt_item_items as cri', 'cri.id', 'rc.cmp_id')
      .join('components_receipt_item_items_funding_supplier_lnk as fsl', 'fsl.item_id', 'cri.id')
      .where('rc.entity_id', receiptId)
      .where('rc.field', 'items')
      .where('rc.component_type', 'receipt-item.item')
      .select('cri.id as id');
    if (itemIds.length === 0) return;
    await knex('components_receipt_item_items')
      .whereIn(
        'id',
        itemIds.map((r) => r.id)
      )
      .update({ deposit_reconciliation_failed_at: new Date() });
  } catch (e: any) {
    strapi.log.error(`[reconcileReceiptDepositsSafely] Не удалось даже пометить чек ${receiptId} как отложенный: ${e.message}`);
  }
}

export interface DepositRelease {
  supplierId: number;
  amount: number;
}

/**
 * Удаление чека (этап 2, подэтап 4, сценарий «удалили чек») — ОТДЕЛЬНЫЙ путь
 * от reconcileReceiptDeposits: та читает строку чека по id, чтобы посчитать
 * target/current/delta, а после DELETE строки уже нет — она бы тихо
 * ничего не сделала (if (!receiptRowRaw) return), и списанное зависло бы в
 * депозите навсегда. Поэтому вызывающий код (lifecycles.ts, beforeDelete)
 * обязан захватить fundingSupplier+depositDeductedAmount ПОКА строка ещё
 * жива, и передать сюда — эта функция только БЕЗУСЛОВНО возвращает ровно
 * захваченные суммы (симметрично ветке delta<0 в reconcileReceiptDeposits —
 * там тоже возврат ничем не обусловлен).
 *
 * Важно: releases должны нести именно ФАКТИЧЕСКИ списанное
 * (item.depositDeductedAmount — единственный источник истины, как и везде
 * в этом файле), а не «сколько должно было списаться». Если у позиции
 * стоит depositReconciliationFailedAt (сверка не удалась и не была
 * доведена до конца — см. reconcileReceiptDepositsSafely) — deposit_deducted_amount
 * для неё и так 0 (списания не произошло), значит и возвращать нечего;
 * никакой отдельной обработки этого поля здесь не нужно, оно просто не
 * влияет — сумма возврата берётся из того же поля, что было бы источником
 * истины в любом случае.
 *
 * Идемпотентность: свойство этой функции, а не гарантия — она ДОБАВЛЯЕТ
 * ровно то, что ей передали, без каких-либо проверок текущего состояния
 * (проверять больше нечего, строки чека уже нет). Двойной вызов с ОДНИМ и
 * тем же набором releases задвоит возврат. Безопасность от задвоения
 * обеспечивается на уровне вызывающего кода (lifecycles.ts вызывает это
 * ровно один раз на одно реальное DELETE — см. там) и на уровне того, что
 * beforeDelete физически не может дважды прочитать одну и ту же строку с
 * ненулевым depositDeductedAmount, если её кто-то уже удалил между двумя
 * конкурентными delete() одного documentId — второй delete() просто не
 * найдёт строку и получит пустой список releases (проверено тестом).
 */
export async function releaseReceiptItemDeposits(strapi: Core.Strapi, releases: DepositRelease[]): Promise<void> {
  const meaningful = releases.filter((r) => r.amount > EPSILON);
  if (meaningful.length === 0) return;

  const supplierIds = Array.from(new Set(meaningful.map((r) => r.supplierId)));
  const depositDocs = await strapi.db.query('api::supplier-cashback-deposit.supplier-cashback-deposit').findMany({
    where: { supplier: { id: { $in: supplierIds } } },
    select: ['id'],
    populate: { supplier: { select: ['id'] } },
  });
  const depositIdBySupplierId = new Map<number, number>();
  for (const d of depositDocs as any[]) {
    if (d.supplier?.id != null) depositIdBySupplierId.set(d.supplier.id, d.id);
  }

  await strapi.db.transaction(async ({ trx }: { trx: any }) => {
    const knex = strapi.db.connection;
    for (const release of meaningful) {
      const depositId = depositIdBySupplierId.get(release.supplierId);
      // Поставщик (и его депозит) мог быть удалён вместе с чеком в рамках
      // той же операции очистки данных — возвращать некуда, не ошибка.
      if (depositId == null) continue;
      await knex('supplier_cashback_deposits').transacting(trx).where('id', depositId).increment('balance', release.amount);
    }
  });
}

/**
 * Обёртка с ретраем на дедлок — тот же принцип, что и reconcileReceiptDepositsSafely.
 * В отличие от неё, здесь нет «худшего случая» с отдельным полем-меткой:
 * если все попытки исчерпаны, просто логируем и пробрасываем ошибку дальше
 * — вызывающий код (lifecycles.ts, afterDelete) решает, что делать (сам чек
 * уже удалён и это не откатить; невозвращённая сумма — сама по себе
 * заметный лог для последующего ручного разбора, не более).
 */
export async function releaseReceiptItemDepositsSafely(strapi: Core.Strapi, releases: DepositRelease[]): Promise<void> {
  for (let attempt = 1; attempt <= DEADLOCK_RETRY_ATTEMPTS; attempt++) {
    try {
      await releaseReceiptItemDeposits(strapi, releases);
      return;
    } catch (error: any) {
      if (!isDeadlockError(error) || attempt === DEADLOCK_RETRY_ATTEMPTS) {
        strapi.log.error(
          `[releaseReceiptItemDepositsSafely] Возврат депозита не удался после ${attempt} попыт(ки/ок) — ${error?.message}. releases=${JSON.stringify(releases)}`
        );
        throw error;
      }
      strapi.log.warn(
        `[releaseReceiptItemDepositsSafely] Дедлок на попытке ${attempt}/${DEADLOCK_RETRY_ATTEMPTS}, повтор через ${DEADLOCK_RETRY_BASE_DELAY_MS * attempt}мс`
      );
      await new Promise((resolve) => setTimeout(resolve, DEADLOCK_RETRY_BASE_DELAY_MS * attempt));
    }
  }
}
