/**
 * receipt controller
 */
import { factories } from '@strapi/strapi'
import { parseReceiptByOfdType, calculateFinalCashback } from '../utils/receiptHelpers'

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
      return ctx.badRequest(error.message || 'Непредвиденная ошибка при обработке чека');
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
      return ctx.badRequest(error.message || 'Ошибка при обработке чека');
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
    if (!fiscalUrl) return ctx.badRequest('Fiscal URL is required');
    if (!ofdType) return ctx.badRequest('OFD type is required');

    try {
      const receiptData = await parseReceiptByOfdType(fiscalUrl, ofdType, { strapi });
      return ctx.send({ ofdType, receiptData });
    } catch (error: any) {
      strapi.log.error(`[readOFD] Error for ${ofdType}:`, error.message);
      ctx.throw(400, error.message);
    }
  }
}));

// ====================== MAIN SUBMISSION HANDLER ======================
async function handleReceiptSubmission(ctx: any, isForTask: boolean = false) {
  const {
    qrData,
    itemMappings,
    ofdType = 'oofd',
    platform
  } = ctx.request.body;

  // Разрешаем только известные значения — если приложение прислало что-то
  // неожиданное (или ничего не прислало, как старые версии до этого
  // обновления), просто не сохраняем платформу, а не роняем весь чек.
  ctx.request.body.platform = ['ios', 'android'].includes(platform) ? platform : null;

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

  return await processAndCreateReceipt(context, receiptData, items, hasVerified, hasRejected, hasNonVerified, isForTask);
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
      // NTIN present on both sides but they disagree — never auto-reject,
      // always route to manual_review so an admin compares by eye,
      // regardless of whether the name would otherwise auto-match.
      verificationStatus = 'manual_review';
      const alias = await findOrCreateAliasByName(itemName, ntin, product, 'unverified');
      productAlias = { documentId: alias.documentId };
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
    }
  }));

  const finalCashback = calculateFinalCashback(items);

  await strapi.documents('api::receipt.receipt').create({
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
      organizationName: receiptData.organizationName,
      organizationBin: receiptData.organizationBin,
      organizationAddress: receiptData.organizationAddress,
    }
  });
}