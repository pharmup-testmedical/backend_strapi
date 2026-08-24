/**
 * receipt controller
 */
import { factories } from '@strapi/strapi'
import { parseReceiptByOfdType, calculateFinalCashback } from '../utils/receiptHelpers'
import { syncReceiptToSheet, buildReceiptRows, appendRowsToSheet } from '../../../utils/google-sheets-sync'

// ==================== EXPORTED TYPES ====================
export type ReceiptVerificationStatus =
  'auto_verified' |
  'auto_rejected' |
  'manual_review' |
  'auto_rejected_late_submission' |
  'auto_partially_verified' |
  'manually_verified' |
  'manually_rejected' |
  'manually_partially_verified';

export interface CashbackItem {
  __component: 'receipt-item.item';
  name: string;
  claimedProduct: { documentId: string };
  verificationStatus: string;
  props: any;
  productAlias?: { documentId: string };
  cashback: number;
}

export type ReceiptItem = any;

// Сообщения из парсеров ОФД (receiptHelpers.ts) технические и на английском —
// пользователю нужен понятный русский текст, а не "WOFD parsing failed:
// Receipt not found in WOFD system". Не трогаем сами throw в парсерах (это
// диагностические сообщения для логов), а переводим только известные
// паттерны на выходе из API; всё остальное (включая уже русские сообщения
// вроде "Чек уже был отправлен") возвращаем как есть.
const translateOfdError = (message: string): string | null => {
  if (/not found in \w+ system/i.test(message)) {
    return 'Чек не найден. Проверьте правильность введённых данных.'
  }
  if (/missing required parameters/i.test(message)) {
    return 'Не хватает данных для поиска чека. Проверьте правильность введённых данных.'
  }
  if (/invalid receipt data/i.test(message)) {
    return 'Не удалось распознать данные чека. Попробуйте отсканировать заново или ввести данные вручную.'
  }
  if (/could not extract/i.test(message)) {
    return 'Не удалось прочитать данные чека из ответа ОФД. Попробуйте позже.'
  }
  if (/unsupported ofd type/i.test(message)) {
    return 'Неподдерживаемый тип ОФД.'
  }
  if (/(ofd|oofd|kofd|wofd) (request failed|parsing failed)/i.test(message)) {
    return 'Не удалось получить данные чека от ОФД. Попробуйте позже.'
  }
  return null
}

// ==================== CONTROLLER ====================
export default factories.createCoreController('api::receipt.receipt', ({ strapi }) => ({

  async submit(ctx: any) {
    try {
      const { receipt } = await handleReceiptSubmission(ctx, false);
      return ctx.created({
        message: 'Чек успешно отправлен и будет обработан',
        receipt
      });
    } catch (error: any) {
      strapi.log.error(`Error processing receipt for user ${ctx.state.user?.id}: ${error.message}`);
      return ctx.badRequest(
        translateOfdError(error.message || '') || error.message || 'Непредвиденная ошибка при обработке чека'
      );
    }
  },

  async submitForTask(ctx: any) {
    try {
      const userId = ctx.state.user.id;
      const userDocumentId = ctx.state.user.documentId;

      strapi.log.info(`[submitForTask] Processing for user ${userId} (${userDocumentId})`);

      const existingCompletion = await strapi.documents('api::completed-task.completed-task').findFirst({
        filters: {
          user: userId,
          task: 'scanFirstReceipts',
          cashback: { $gt: 0 }
        }
      });

      if (existingCompletion) {
        return ctx.badRequest('Вы уже выполнили это задание');
      }

      const tasksPage = await strapi.documents('api::tasks-page.tasks-page').findFirst({
        populate: { scanFirstReceipts: true }
      });

      const scanTask = tasksPage?.scanFirstReceipts;
      if (!scanTask?.active) {
        return ctx.badRequest('Задание недоступно');
      }

      const { receipt, verificationStatus } = await handleReceiptSubmission(ctx, true);

      strapi.log.info(`[submitForTask] Created receipt ${receipt.documentId} with status ${verificationStatus}`);

      return ctx.created({
        message: 'Чек успешно отправлен и засчитан для задания',
        receipt
      });
    } catch (error: any) {
      strapi.log.error(`Error in submitForTask for user ${ctx.state.user?.id}: ${error.message}`);
      return ctx.badRequest(
        translateOfdError(error.message || '') || error.message || 'Ошибка при обработке чека'
      );
    }
  },

  // Альтернативный способ добавления чека — без ручного ввода данных, для
  // точечно выбранных пользователей (user.receiptSubmissionMode ===
  // 'photo'). Мобильное приложение само находит QR на сфотографированном
  // чеке (тем же способом, что и при выборе QR-фото из галереи в обычном
  // сканере) и присылает сюда уже сам qrData/ofdType — здесь этот QR
  // проходит РЕАЛЬНУЮ проверку через ОФД (parseReceiptByOfdType), как и в
  // обычном флоу submit/submitForTask: реальные сумма/дата/ФП/ККМ и
  // бесплатная защита от повторной отправки того же чека
  // (checkForDuplicateReceipt). Единственное отличие от обычного флоу —
  // позиции для кешбэка выбирает сам пользователь вручную (а не берутся
  // из ОФД, где расшифровки товаров часто нет — в этом и есть причина
  // существования этого способа), и админ вручную подтверждает чек в
  // Strapi admin, глядя на приложенное фото.
  async submitPhoto(ctx: any) {
    try {
      // Не доверяем только мобильному UI — даже если кто-то соберёт
      // запрос вручную, без включённого флага на пользователе это должно
      // быть запрещено.
      if (ctx.state.user?.receiptSubmissionMode !== 'photo') {
        return ctx.forbidden('Этот способ добавления чека для вас не включён');
      }

      const userId = ctx.state.user.id;
      const { qrData, ofdType, claims: claimsRaw, platform, appVersion } = ctx.request.body;

      const files = ctx.request.files || {};
      const photoFile = Array.isArray(files.photo) ? files.photo[0] : files.photo;

      if (!photoFile) {
        return ctx.badRequest('Приложите фото чека');
      }
      if (!qrData || !ofdType) {
        return ctx.badRequest('Не удалось определить QR-код чека');
      }

      let claims: { productId: string; quantity: number; unitPrice: number; itemizedPosition?: number }[];
      try {
        claims = JSON.parse(claimsRaw);
      } catch {
        return ctx.badRequest('Некорректный формат позиций');
      }
      if (!Array.isArray(claims) || claims.length === 0) {
        return ctx.badRequest('Добавьте хотя бы одну позицию');
      }
      for (const claim of claims) {
        if (!claim.productId || !claim.quantity || !claim.unitPrice) {
          return ctx.badRequest('У каждой позиции должны быть товар, количество и цена');
        }
      }

      // Валидируем productId по реальному каталогу — не доверяем
      // произвольным id вслепую (тот же принцип, что и в broadcast
      // уведомлений).
      const products = await strapi.documents('api::product.product').findMany({
        filters: { documentId: { $in: claims.map((c) => c.productId) } },
      });
      if (products.length !== new Set(claims.map((c) => c.productId)).size) {
        return ctx.badRequest('Один или несколько товаров не найдены в каталоге');
      }

      const receiptData = await parseReceiptByOfdType(qrData, ofdType, { strapi });

      await checkForDuplicateReceipt({ qrData }, receiptData);

      const receiptValidDays = await getReceiptValidDays();
      if (!checkTimeLimit(receiptData.date, receiptValidDays)) {
        return ctx.badRequest(`Чек превысил срок годности в ${receiptValidDays} дней.`);
      }

      const uploadService = strapi.plugin('upload').service('upload');
      const [photoUpload] = await uploadService.upload({ data: {}, files: photoFile });

      const items: ReceiptItem[] = claims.map((claim) => {
        const product = products.find((p: any) => p.documentId === claim.productId);
        return {
          __component: 'receipt-item.item',
          name: product.canonicalName,
          claimedProduct: { documentId: claim.productId },
          verificationStatus: 'manual_review',
          cashback: 0,
          props: {
            unitPrice: claim.unitPrice,
            quantity: claim.quantity,
            totalPrice: claim.unitPrice * claim.quantity,
            measureUnit: 'шт',
            department: '-',
            itemizedPosition: claim.itemizedPosition || null,
          },
        };
      });

      const receipt = await strapi.documents('api::receipt.receipt').create({
        data: {
          qrData,
          fiscalId: receiptData.fiscalId,
          verificationStatus: 'manual_review',
          submissionMethod: 'photo',
          date: receiptData.date instanceof Date ? receiptData.date.toISOString() : receiptData.date,
          totalAmount: receiptData.totalAmount,
          taxAmount: receiptData.taxAmount,
          taxRate: receiptData.taxRate,
          kktCode: receiptData.kktCode,
          kktSerialNumber: receiptData.kktSerialNumber,
          paymentMethod: receiptData.paymentMethod,
          ofdType,
          finalCashback: 0,
          user: userId,
          items,
          receiptPhoto: photoUpload.id,
          organizationName: receiptData.organizationName,
          organizationBin: receiptData.organizationBin,
          organizationAddress: receiptData.organizationAddress,
          platform: ['ios', 'android'].includes(platform) ? platform : null,
          appVersion: typeof appVersion === 'string' && /^\d+\.\d+\.\d+$/.test(appVersion) ? appVersion : null,
          publishedAt: new Date(),
        },
      });

      strapi.log.info(`[submitPhoto] Created photo-submitted receipt ${receipt.documentId} for user ${userId}`);

      return ctx.created({
        message: 'Чек отправлен на проверку администратору',
        receipt,
      });
    } catch (error: any) {
      strapi.log.error(`[submitPhoto] Error for user ${ctx.state.user?.id}: ${error.message}`);
      return ctx.badRequest(
        translateOfdError(error.message || '') || error.message || 'Не удалось отправить чек'
      );
    }
  },

  async me(ctx: any) {
    try {
      const userId = ctx.state.user.id;
      if (!userId) {
        return ctx.unauthorized('Вы должны быть авторизованы для просмотра своих чеков');
      }

      const { startDate, endDate } = ctx.query;
      const filters: any = { user: userId };

      if (startDate || endDate) {
        filters.date = {};
        if (startDate) filters.date.$gte = startDate;
        if (endDate) filters.date.$lte = endDate;
      }

      const receipts = await strapi.documents('api::receipt.receipt').findMany({
        filters,
        populate: ctx.query.populate || { items: true },
        sort: { date: 'desc' }
      });

      return ctx.send({
        data: receipts,
        meta: { total: receipts.length }
      });
    } catch (error: any) {
      strapi.log.error(`Error fetching receipts for user ${ctx.state.user?.id || 'unknown'}: ${error.message}`);
      return ctx.badRequest('Не удалось загрузить ваши чеки');
    }
  },

  async update(ctx: any) {
    try {
      const result = await super.update(ctx);
      return result;
    } catch (error: any) {
      strapi.log.error(`Error updating receipt ${ctx.params.documentId}: ${error.message}`);
      return ctx.badRequest(`Не удалось обновить чек: ${error.message || 'Ошибка при обновлении'}`);
    }
  },

  async readOFD(ctx: any) {
    const { fiscalUrl, ofdType = 'oofd' } = ctx.request.body;
    if (!fiscalUrl) return ctx.badRequest('Укажите ссылку или данные чека');
    if (!ofdType) return ctx.badRequest('Укажите тип ОФД');

    try {
      const receiptData = await parseReceiptByOfdType(fiscalUrl, ofdType, { strapi });
      return ctx.send({ ofdType, receiptData });
    } catch (error: any) {
      strapi.log.error(`[readOFD] Error for ${ofdType}:`, error.message);
      ctx.throw(
        400,
        translateOfdError(error.message || '') ||
          'Не удалось получить данные чека. Проверьте правильность введённых данных или попробуйте позже.'
      );
    }
  },

  // Одноразовый ручной бэкфилл уже существующих чеков в Google Таблицу.
  // Не обращается к ОФД (NTIN/GTIN/НДС/Скидка останутся пустыми для старых
  // чеков — этих полей нет в самой базе, только в ответе ОФД в момент
  // отправки чека), поэтому не может как-либо повлиять на верификацию или
  // кешбэк — только читает уже сохранённые данные и дописывает строки в
  // таблицу. Защищён отдельным секретом (не JWT-авторизацией конечного
  // пользователя), маршрут публичный (auth: false).
  async backfillSheet(ctx: any) {
    const providedSecret = (ctx.request.headers['x-backfill-secret'] || '').trim();
    const expectedSecret = (process.env.SHEET_BACKFILL_SECRET || '').trim();
    if (!expectedSecret || providedSecret !== expectedSecret) {
      // Не логируем сами значения секрета — только длины, этого достаточно,
      // чтобы отличить "переменная не задана на сервере" от "не совпадает".
      strapi.log.warn(`[Backfill] Секрет не совпал: env задан=${!!expectedSecret} (длина ${expectedSecret.length}), в заголовке длина ${providedSecret.length}`);
      return ctx.forbidden('Неверный или не заданный секрет');
    }

    // ?start=N — чтобы продолжить с места обрыва, не задваивая уже
    // записанные строки, если бэкфилл прервался на середине.
    const pageSize = 100;
    let start = Number(ctx.query.start) || 0;

    try {
      const products = await strapi.documents('api::product.product').findMany({
        fields: ['canonicalName'],
      });

      let totalReceipts = 0;
      let totalRows = 0;

      while (true) {
        const receipts = await strapi.documents('api::receipt.receipt').findMany({
          start,
          limit: pageSize,
          sort: ['date:asc'],
          populate: {
            user: { fields: ['email'] },
            items: {
              on: {
                'receipt-item.item': { populate: { claimedProduct: true, props: true } },
                'receipt-item.product-claim': { populate: { props: true } },
              },
            },
          },
        });

        if (receipts.length === 0) break;

        const rows = receipts.flatMap((receipt: any) =>
          buildReceiptRows({
            receipt,
            receiptData: {
              organizationName: receipt.organizationName,
              organizationBin: receipt.organizationBin,
              organizationAddress: receipt.organizationAddress,
              items: [], // старых сырых данных ОФД нет — NTIN/GTIN/НДС/Скидка останутся пустыми
            },
            finalItems: receipt.items || [],
            products,
            platform: receipt.platform,
            appVersion: receipt.appVersion,
            consumerUrl: receipt.qrData,
            userEmail: receipt.user?.email,
          })
        );

        const result = await appendRowsToSheet(rows, strapi);
        if (!result.ok) {
          strapi.log.error(`[Backfill] Ошибка записи на start=${start}: ${result.error}`);
          return ctx.badRequest(`${result.error} (для продолжения запросите с ?start=${start})`);
        }

        totalReceipts += receipts.length;
        totalRows += rows.length;
        start += pageSize;

        strapi.log.info(`[Backfill] Обработано ${totalReceipts} чек(ов), записано ${totalRows} строк(и)`);

        // Небольшая пауза между пачками, чтобы не упереться в квоту Sheets API.
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      return ctx.send({ message: `Бэкфилл завершён: ${totalReceipts} чеков, ${totalRows} строк(и)` });
    } catch (error: any) {
      strapi.log.error(`[Backfill] Ошибка на start=${start}: ${error.message}`);
      return ctx.badRequest(`${error.message || 'Ошибка бэкфилла'} (для продолжения запросите с ?start=${start})`);
    }
  }
}));

// ====================== MAIN SUBMISSION HANDLER ======================
async function handleReceiptSubmission(ctx: any, isForTask: boolean = false) {
  const {
    qrData,
    itemMappings,
    ofdType = 'oofd',
    platform,
    appVersion
  } = ctx.request.body;

  // Разрешаем только известные значения — если приложение прислало что-то
  // неожиданное (или ничего не прислало, как старые версии до этого
  // обновления), просто не сохраняем платформу, а не роняем весь чек.
  ctx.request.body.platform = ['ios', 'android'].includes(platform) ? platform : null;

  // Версия — просто строка вида "1.9.0" из DeviceInfo.getVersion() на
  // мобильном; проверяем только формат и разумную длину, не привязываемся
  // к конкретным значениям (иначе пришлось бы обновлять бэкенд под каждый
  // релиз приложения).
  ctx.request.body.appVersion = typeof appVersion === 'string' && /^\d+\.\d+\.\d+$/.test(appVersion)
    ? appVersion
    : null;

  if (!qrData || typeof qrData !== 'string') throw new Error('QR-код обязателен');
  if (!itemMappings || typeof itemMappings !== 'object' || Object.keys(itemMappings).length === 0) {
    throw new Error('Требуется хотя бы одно сопоставление имени товара');
  }
  if (!ofdType) throw new Error('Тип ОФД обязателен (oofd, kofd, или wofd)');

  const userId = ctx.state.user.id;
  const context: any = { ctx, qrData, itemMappings, userId, ofdType };

  const rawReceiptData = await parseReceiptByOfdType(qrData, ofdType, { strapi });

  const receiptData = {
    ...rawReceiptData,
    date: rawReceiptData.date instanceof Date ? rawReceiptData.date.toISOString() : rawReceiptData.date,
    ofdType
  };

  await checkForDuplicateReceipt(context, receiptData);

  const receiptValidDays = await getReceiptValidDays();
  const isWithinTimeLimit = checkTimeLimit(receiptData.date, receiptValidDays);

  if (!isWithinTimeLimit) {
    await createLateSubmissionReceipt(context, receiptData);
    throw new Error(`Чек превысил срок годности в ${receiptValidDays} дней.`);
  }

  await validateItemNames(context, receiptData);
  const products = await validateAndFetchProducts(itemMappings);
  const { items, hasVerified, hasRejected, hasNonVerified } = await processReceiptItems(
    receiptData,
    itemMappings,
    products
  );

  const result = await processAndCreateReceipt(context, receiptData, items, hasVerified, hasRejected, hasNonVerified, isForTask);

  await syncReceiptToSheet({
    receipt: result.receipt,
    receiptData,
    finalItems: items,
    products,
    platform: ctx.request.body.platform,
    appVersion: ctx.request.body.appVersion,
    consumerUrl: qrData,
    userEmail: ctx.state.user?.email,
    strapi,
  });

  return result;
}

// ====================== RECEIPT CREATION ======================
async function processAndCreateReceipt(
  context: any,
  receiptData: any,
  items: any[],
  hasVerified: boolean,
  hasRejected: boolean,
  hasNonVerified: boolean,
  isForTask: boolean
) {
  let verificationStatus: ReceiptVerificationStatus = 'manual_review';

  if (hasNonVerified) {
    verificationStatus = 'manual_review';
  } else if (hasVerified) {
    verificationStatus = hasRejected ? 'auto_partially_verified' : 'auto_verified';
  } else if (hasRejected) {
    verificationStatus = 'auto_rejected';
  }

  const finalCashback = calculateFinalCashback(items);

  const receipt = await strapi.documents('api::receipt.receipt').create({
    data: {
      oofd_uid: receiptData.oofd_uid,
      qrData: context.ctx.request.body.qrData,
      fiscalId: receiptData.fiscalId,
      verificationStatus,
      user: context.userId,
      date: receiptData.date,
      totalAmount: receiptData.totalAmount,
      taxAmount: receiptData.taxAmount,
      taxRate: receiptData.taxRate,
      kktCode: receiptData.kktCode,
      kktSerialNumber: receiptData.kktSerialNumber,
      paymentMethod: receiptData.paymentMethod,
      ofdType: receiptData.ofdType,
      items: JSON.parse(JSON.stringify(items)),
      finalCashback,
      countsForScanTask: isForTask,
      platform: context.ctx.request.body.platform,
      appVersion: context.ctx.request.body.appVersion,
      organizationName: receiptData.organizationName,
      organizationBin: receiptData.organizationBin,
      organizationAddress: receiptData.organizationAddress,
      publishedAt: new Date()
    }
  });

  strapi.log.info(`Created receipt ${receipt.documentId} (forTask: ${isForTask}) with status ${verificationStatus}`);

  return { receipt, verificationStatus };
}

// ====================== YOUR ORIGINAL HELPER FUNCTIONS ======================

async function checkForDuplicateReceipt({ qrData }: any, receiptData: any) {
  const existingReceipts = await strapi.documents('api::receipt.receipt').findMany({
    filters: { qrData },
  });
  if (existingReceipts.length > 0) throw new Error('Чек уже был отправлен');

  const duplicateFiscal = await strapi.documents('api::receipt.receipt').findMany({
    filters: { fiscalId: receiptData.fiscalId },
  });
  if (duplicateFiscal.length > 0) throw new Error('Чек уже был отправлен');
}

async function getReceiptValidDays(): Promise<number> {
  const websiteSetup = await strapi.documents('api::website-setup.website-setup').findFirst({
    populate: 'promo',
  });
  const receiptValidDays = websiteSetup?.promo?.receiptValidDays || 5;
  if (!Number.isInteger(receiptValidDays) || receiptValidDays <= 0) {
    return 5;
  }
  return receiptValidDays;
}

function checkTimeLimit(receiptDate: string, receiptValidDays: number): boolean {
  const timeDiff = (new Date().getTime() - new Date(receiptDate).getTime()) / (1000 * 3600 * 24);
  return timeDiff <= receiptValidDays;
}

function validateItemProps(itemName: string, props: any): void {
  if (
    typeof props.unitPrice !== 'number' || isNaN(props.unitPrice) ||
    typeof props.quantity !== 'number' || props.quantity <= 0 ||
    typeof props.totalPrice !== 'number' || isNaN(props.totalPrice) ||
    !props.measureUnit || !props.department
  ) {
    throw new Error(`Недопустимые свойства для товара ${itemName}`);
  }
}

async function validateItemNames({ itemMappings }: any, receiptData: any) {
  const receiptItemNames = receiptData.items.map((item: any) => item.name.toLowerCase());
  const invalidItemNames = Object.keys(itemMappings).filter(
    (itemName) => !receiptItemNames.includes(itemName.toLowerCase())
  );

  if (invalidItemNames.length > 0) {
    throw new Error(`Недопустимые имена товаров: ${invalidItemNames.join(', ')}`);
  }
}

async function validateAndFetchProducts(itemMappings: { [itemName: string]: string }): Promise<any[]> {
  const productIds = Object.values(itemMappings);
  const productPromises = productIds.map(async (productId) => {
    const product = await strapi.documents('api::product.product').findOne({
      documentId: productId,
      status: 'published',
      filters: { cashbackEligible: true },
      populate: { productAliases: true },
    });
    return { productId, product };
  });

  const productResults = await Promise.all(productPromises);
  const invalidProducts = productResults.filter(({ product }) => !product);

  if (invalidProducts.length > 0) {
    throw new Error('Не все отправленные продукты являются действительными и подходят для кешбэка');
  }

  return productResults.map(({ product }) => product);
}

async function processReceiptItems(
  receiptData: any,
  itemMappings: { [itemName: string]: string },
  products: any[]
) {
  let hasVerified = false;
  let hasRejected = false;
  let hasNonVerified = false;

  const items = await Promise.all(
    receiptData.items.map(async (itemData: any) => {
      const itemName = itemData.name;
      const props = {
        unitPrice: itemData.unitPrice,
        quantity: itemData.quantity,
        measureUnit: itemData.measureUnit,
        totalPrice: itemData.totalPrice,
        department: itemData.department,
        ntin: itemData.ntin || null,
      };

      const matchedKey = Object.keys(itemMappings).find(
        (key) => key.toLowerCase() === itemName.toLowerCase()
      );
      const productId = matchedKey ? itemMappings[matchedKey] : null;

      if (!productId) {
        return {
          __component: 'receipt-item.product-claim',
          name: itemName,
          props,
        };
      }

      validateItemProps(itemName, props);

      const product = products.find((p: any) => p.documentId === productId);
      if (!product) {
        throw new Error(`Продукт с documentId ${productId} не найден`);
      }

      const cashbackItem = await processClaimedItem(itemName, props, product, itemData.ntin);

      if (['auto_verified_canon', 'auto_verified_alias', 'auto_verified_ntin', 'manually_verified_alias'].includes(cashbackItem.verificationStatus)) {
        hasVerified = true;
      } else if (cashbackItem.verificationStatus === 'auto_rejected_alias') {
        hasRejected = true;
      } else if (cashbackItem.verificationStatus === 'manual_review') {
        hasNonVerified = true;
      }

      return cashbackItem;
    })
  );

  return { items, hasVerified, hasRejected, hasNonVerified };
}

async function findOrCreateAliasByName(
  itemName: string,
  ntin: string | null | undefined,
  product: any,
  defaultStatusForNew: 'unverified' | 'verified'
) {
  const productAliases = product.productAliases || [];
  const existing = productAliases.find(
    (alias: any) => alias.alternativeName.toLowerCase() === itemName.toLowerCase()
  );

  if (existing) {
    // Keep the ntin on record up to date so an admin reviewing this alias
    // can compare it against the product's own ntin/ntinAlternative.
    if (ntin && existing.ntin !== ntin) {
      await strapi.documents('api::product-alias.product-alias').update({
        documentId: existing.documentId,
        data: { ntin },
      });
    }
    return existing;
  }

  return strapi.documents('api::product-alias.product-alias').create({
    data: {
      alternativeName: itemName,
      ntin: ntin || null,
      verificationStatus: defaultStatusForNew,
      product: { documentId: product.documentId },
    },
  });
}

async function processClaimedItem(itemName: string, props: any, product: any, ntin?: string | null) {
  let verificationStatus = 'manual_review';
  let productAlias = null;

  // NTIN is compared against the catalog product's own ntin/ntinAlternative
  // fields (deliberately entered by an admin), not against a
  // previously-approved alias — a careless click approving one alias would
  // otherwise silently auto-trust every future receipt carrying that NTIN.
  const catalogNtins = [product.ntin, product.ntinAlternative].filter(Boolean);

  if (catalogNtins.length > 0 && ntin) {
    if (catalogNtins.includes(ntin)) {
      // Confident match — record it for audit, but no admin review needed.
      verificationStatus = 'auto_verified_ntin';
      const alias = await findOrCreateAliasByName(itemName, ntin, product, 'verified');
      productAlias = { documentId: alias.documentId };
    } else {
      // NTIN present on both sides but they disagree. If an admin has
      // already manually verified this exact item name as an alias for
      // this product, trust that human judgement over the NTIN mismatch
      // (e.g. the manufacturer prints multiple NTIN variants for the same
      // product) instead of forcing every future receipt with this name
      // back into manual review forever.
      const existingAlias = (product.productAliases || []).find(
        (alias: any) => alias.alternativeName.toLowerCase() === itemName.toLowerCase()
      );

      if (existingAlias?.verificationStatus === 'verified') {
        verificationStatus = 'auto_verified_alias';
        productAlias = { documentId: existingAlias.documentId };
      } else {
        verificationStatus = 'manual_review';
        const alias = await findOrCreateAliasByName(itemName, ntin, product, 'unverified');
        productAlias = { documentId: alias.documentId };
      }
    }
  } else if (product.canonicalName.toLowerCase() === itemName.toLowerCase()) {
    verificationStatus = 'auto_verified_canon';
  } else {
    const productAliases = product.productAliases || [];
    const matchingAlias = productAliases.find(
      (alias: any) => alias.alternativeName.toLowerCase() === itemName.toLowerCase()
    );

    if (matchingAlias) {
      if (matchingAlias.verificationStatus === 'verified') {
        verificationStatus = 'auto_verified_alias';
      } else if (matchingAlias.verificationStatus === 'rejected') {
        verificationStatus = 'auto_rejected_alias';
      } else {
        verificationStatus = 'manual_review';
      }
      productAlias = { documentId: matchingAlias.documentId };
    } else {
      verificationStatus = 'manual_review';
      const newAlias = await strapi.documents('api::product-alias.product-alias').create({
        data: {
          alternativeName: itemName,
          ntin: ntin || null,
          verificationStatus: 'unverified',
          product: { documentId: product.documentId },
        },
      });
      productAlias = { documentId: newAlias.documentId };
    }
  }

  return {
    __component: 'receipt-item.item',
    name: itemName,
    claimedProduct: { documentId: product.documentId },
    verificationStatus,
    props,
    productAlias,
    cashback: product.cashbackAmount || 0,
  };
}

async function createLateSubmissionReceipt({ ctx, userId }: any, receiptData: any) {
  const items = receiptData.items.map((itemData: any) => ({
    __component: 'receipt-item.product-claim',
    name: itemData.name,
    props: {
      unitPrice: itemData.unitPrice,
      quantity: itemData.quantity,
      measureUnit: itemData.measureUnit,
      totalPrice: itemData.totalPrice,
      department: itemData.department,
      ntin: itemData.ntin || null,
    }
  }));

  const finalCashback = calculateFinalCashback(items);

  const receipt = await strapi.documents('api::receipt.receipt').create({
    data: {
      oofd_uid: receiptData.oofd_uid,
      qrData: ctx.request.body.qrData,
      fiscalId: receiptData.fiscalId,
      verificationStatus: 'auto_rejected_late_submission',
      user: userId,
      date: receiptData.date,
      totalAmount: receiptData.totalAmount,
      taxAmount: receiptData.taxAmount,
      taxRate: receiptData.taxRate,
      kktCode: receiptData.kktCode,
      kktSerialNumber: receiptData.kktSerialNumber,
      paymentMethod: receiptData.paymentMethod,
      ofdType: receiptData.ofdType,
      items,
      finalCashback,
      platform: ctx.request.body.platform,
      appVersion: ctx.request.body.appVersion,
      organizationName: receiptData.organizationName,
      organizationBin: receiptData.organizationBin,
      organizationAddress: receiptData.organizationAddress,
    }
  });

  await syncReceiptToSheet({
    receipt,
    receiptData,
    finalItems: items,
    products: [],
    platform: ctx.request.body.platform,
    appVersion: ctx.request.body.appVersion,
    consumerUrl: ctx.request.body.qrData,
    userEmail: ctx.state.user?.email,
    strapi,
  });
}