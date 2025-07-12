/**
 * receipt controller
 */
import { factories } from '@strapi/strapi'
import { parseReceiptData, calculateFinalCashback } from '../utils/receiptHelpers'
import https from 'https'
import axios from 'axios'

// Interfaces for type safety
interface Product {
  documentId: string
  canonicalName: string
  cashbackAmount: number
  productAliases: ProductAlias[]
}

interface ProductAlias {
  documentId: string
  alternativeName: string
  verificationStatus: 'unverified' | 'verified' | 'rejected'
  product: Product
}

export type ReceiptVerificationStatus = 'auto_verified' | 'auto_rejected' | 'manual_review' | 'auto_rejected_late_submission' | 'auto_partially_verified' | 'manually_verified' | 'manually_rejected' | 'manually_partially_verified'
type ItemVerificationStatus = 'auto_verified_canon' | 'auto_verified_alias' | 'auto_rejected_alias' | 'manual_review' | 'manually_verified_alias' | 'manually_rejected_alias'

interface ItemProps {
  unitPrice: number
  quantity: number
  measureUnit: string
  totalPrice: number
  department: string
}

interface BaseItem {
  __component: string
  name: string
  props: ItemProps
}

interface ProductClaimItem extends BaseItem {
  __component: 'receipt-item.product-claim'
}

export interface CashbackItem extends BaseItem {
  __component: 'receipt-item.item'
  claimedProduct: { documentId: string }
  verificationStatus: ItemVerificationStatus
  productAlias?: { documentId: string }
  cashback: number
}

export type ReceiptItem = ProductClaimItem | CashbackItem

interface SubmitContext {
  ctx: any
  qrData: string
  itemMappings: { [itemName: string]: string } // key: CashbackItem -> value: documentId of Product
  userId: string
}

interface ReceiptData {
  oofd_uid: string
  fiscalId: string
  date: string
  totalAmount: number
  taxAmount?: number
  taxRate?: number
  kktCode: string
  kktSerialNumber: string
  paymentMethod?: string
  items: any[]
}

export default factories.createCoreController('api::receipt.receipt', ({ strapi }) => ({
  async submit(ctx: any) {
    try {
      const { qrData, itemMappings }: { qrData: string; itemMappings: { [itemName: string]: string } } = ctx.request.body
      const userId = ctx.state.user.id
      strapi.log.info(`Received receipt submission from user with id: ${userId}`)

      const context: SubmitContext = { ctx, qrData, itemMappings, userId }
      await validateInput(context)

      const rawReceiptData = await parseReceiptData(qrData, { strapi })
      // Convert Date to string if necessary
      const receiptData: ReceiptData = {
        ...rawReceiptData,
        date: rawReceiptData.date instanceof Date ? rawReceiptData.date.toISOString() : rawReceiptData.date,
      }

      await checkForDuplicateReceipt(context, receiptData)

      const receiptValidDays = await getReceiptValidDays()
      const isWithinTimeLimit = checkTimeLimit(receiptData.date, receiptValidDays)

      if (!isWithinTimeLimit) {
        return handleLateSubmission(context, receiptData, receiptValidDays)
      }

      await validateItemNames(context, receiptData)
      const products = await validateAndFetchProducts(itemMappings)
      const { items, hasVerified, hasRejected, hasNonVerified } = await processReceiptItems(receiptData, itemMappings, products)

      return await createReceipt(context, receiptData, items, hasVerified, hasRejected, hasNonVerified)
    } catch (error: any) {
      strapi.log.error(`Error processing receipt for user ${ctx.state.user.id}: ${error.message}`)
      return ctx.badRequest(error.message || 'Непредвиденная ошибка при обработке чека')
    }
  },

  async me(ctx: any) {
    try {
      const userId = ctx.state.user.id
      if (!userId) {
        strapi.log.warn('No authenticated user found')
        return ctx.unauthorized('Вы должны быть авторизованы для просмотра своих чеков')
      }

      const receipts = await strapi.documents('api::receipt.receipt').findMany({
        filters: { user: userId },
        populate: ctx.query.populate || { items: true },
      })

      strapi.log.info(`Fetched ${receipts.length} receipts for user ${userId}`)
      return ctx.send({
        data: receipts,
        meta: { total: receipts.length },
      })
    } catch (error: any) {
      strapi.log.error(`Error fetching receipts for user ${ctx.state.user?.id || 'unknown'}: ${error.message}`)
      return ctx.badRequest('Не удалось загрузить ваши чеки')
    }
  },

  async update(ctx: any) {
    try {
      const { documentId } = ctx.params // Extract documentId from route params
      const params = ctx.request.body // Extract update parameters from request body
      strapi.log.info(`Updating receipt with documentId: ${documentId} and params: ${JSON.stringify(params)}`)
      const result = await super.update({ params: { documentId }, ...params })
      return result
    } catch (error: any) {
      strapi.log.error(`Error updating receipt for documentId ${ctx.params.documentId}: ${error.message}`)
      return ctx.badRequest(`Не удалось обновить чек: ${error.message || 'Ошибка при обновлении'}`)
    }
  },

  async readOFD(ctx) {
    const { fiscalUrl } = ctx.request.body;

    if (!fiscalUrl) {
      return ctx.badRequest('Fiscal URL is required');
    }

    // Declare apiUrl at the function scope
    let apiUrl = '';

    try {
      // Step 1: Normalize the URL format
      apiUrl = fiscalUrl.trim();

      // Fix common malformed URL cases
      // Case 1: Missing protocol
      if (/^consumer\.oofd\.kz/i.test(apiUrl)) {
        apiUrl = `https://${apiUrl}`;
      }
      // Case 2: Just parameters without URL
      else if (/^(i=|f=|s=|t=)/i.test(apiUrl)) {
        apiUrl = `https://consumer.oofd.kz/api/tickets/get-by-url?${apiUrl}`;
      }

      // Step 2: Extract and validate parameters
      let params;
      try {
        const urlObj = new URL(apiUrl);
        params = Object.fromEntries(urlObj.searchParams.entries());

        // Validate we have i/f/s/t
        if (!params.i || !params.f || !params.s || !params.t) {
          throw new Error('Missing required parameters');
        }

        // Reconstruct properly formatted URL
        apiUrl = `https://consumer.oofd.kz/api/tickets/get-by-url?${new URLSearchParams(params).toString()}`;
      } catch (e) {
        throw new Error(`Invalid URL format: ${fiscalUrl}`);
      }

      strapi.log.info(`Processing receipt URL: ${apiUrl}`);

      // Step 3: Call parseReceiptData to handle the API request and parsing
      const receiptData = await parseReceiptData(apiUrl, { strapi });

      // Step 4: Return formatted data
      ctx.send({
        url: apiUrl,
        receiptData
      });

    } catch (error) {
      strapi.log.error('[resolveFiscalUrl] Error:', {
        message: error.message,
        inputUrl: fiscalUrl,
        normalizedUrl: apiUrl
      });
      ctx.throw(400, error.message);
    }
  }
}))

// Validation Functions
async function validateInput({ ctx, qrData, itemMappings, userId }: SubmitContext) {
  if (!qrData || typeof qrData !== 'string') {
    strapi.log.warn(`Invalid QR data for user ${userId}`)
    throw new Error('QR-код обязателен и должен быть действительной строкой')
  }

  if (!itemMappings || typeof itemMappings !== 'object' || Object.keys(itemMappings).length === 0) {
    strapi.log.warn(`Empty or invalid itemMappings for user ${userId}`)
    throw new Error('Требуется хотя бы одно сопоставление имени товара и documentId продукта')
  }
}

async function checkForDuplicateReceipt({ qrData }: SubmitContext, receiptData: ReceiptData) {
  const existingReceipts = await strapi.documents('api::receipt.receipt').findMany({
    filters: { qrData },
  })

  if (existingReceipts.length > 0) {
    strapi.log.warn(`Duplicate receipt submission attempted: ${qrData}`)
    throw new Error('Чек уже был отправлен')
  }

  const duplicateFiscal = await strapi.documents('api::receipt.receipt').findMany({
    filters: { fiscalId: receiptData.fiscalId },
  })

  if (duplicateFiscal.length > 0) {
    strapi.log.warn(`Duplicate fiscal ID submission: ${receiptData.fiscalId}`)
    throw new Error('Чек уже был отправлен')
  }
}

async function getReceiptValidDays(): Promise<number> {
  const websiteSetup = await strapi.documents('api::website-setup.website-setup').findFirst({
    populate: 'promo',
  })
  const receiptValidDays = websiteSetup?.promo.receiptValidDays || 5
  if (!Number.isInteger(receiptValidDays) || receiptValidDays <= 0) {
    strapi.log.warn(`Invalid receiptValidDays value: ${receiptValidDays}. Using default of 5 days.`)
    return 5
  }
  strapi.log.info(`Using receiptValidDays: ${receiptValidDays}`)
  return receiptValidDays
}

function checkTimeLimit(receiptDate: string, receiptValidDays: number): boolean {
  const currentDate = new Date()
  const timeDiff = (currentDate.getTime() - new Date(receiptDate).getTime()) / (1000 * 3600 * 24)
  return timeDiff <= receiptValidDays
}

// Item Processing Functions
function validateItemProps(itemName: string, props: ItemProps): void {
  if (
    typeof props.unitPrice !== 'number' ||
    isNaN(props.unitPrice) ||
    typeof props.quantity !== 'number' ||
    !Number.isInteger(props.quantity) ||
    !props.measureUnit ||
    typeof props.totalPrice !== 'number' ||
    isNaN(props.totalPrice) ||
    !props.department
  ) {
    strapi.log.warn(`Invalid props for item ${itemName}: ${JSON.stringify(props)}`)
    throw new Error(`Недопустимые свойства для товара ${itemName}: убедитесь, что все обязательные поля заполнены корректно`)
  }
}

async function validateItemNames({ itemMappings }: SubmitContext, receiptData: ReceiptData) {
  const receiptItemNames = receiptData.items.map((item: any) => item.name.toLowerCase())
  const invalidItemNames = Object.keys(itemMappings).filter(
    (itemName) => !receiptItemNames.includes(itemName.toLowerCase())
  )

  if (invalidItemNames.length > 0) {
    strapi.log.warn(`Invalid item names submitted: ${invalidItemNames.join(', ')}`)
    throw new Error(`Недопустимые имена товаров: ${invalidItemNames.join(', ')}`)
  }
}

async function validateAndFetchProducts(itemMappings: { [itemName: string]: string }): Promise<Product[]> {
  const productIds = Object.values(itemMappings)
  const productPromises = productIds.map(async (productId) => {
    const product = await strapi.documents('api::product.product').findOne({
      documentId: productId,
      status: 'published',
      filters: { cashbackEligible: true },
      populate: { productAliases: true },
    })
    return { productId, product }
  })

  const productResults = await Promise.all(productPromises)
  const invalidProducts = productResults.filter(({ product }) => !product)

  if (invalidProducts.length > 0) {
    const invalidIds = invalidProducts.map(({ productId }) => productId)
    strapi.log.warn(`Invalid or non-eligible product documentIds: ${invalidIds.join(', ')}`)
    throw new Error('Не все отправленные продукты являются действительными, подходящими для кешбэка и опубликованными')
  }

  return productResults.map(({ product }) => product as Product)
}

async function processReceiptItems(
  receiptData: ReceiptData,
  itemMappings: { [itemName: string]: string },
  products: Product[]
): Promise<{ items: ReceiptItem[]; hasVerified: boolean; hasRejected: boolean; hasNonVerified: boolean }> {
  let hasVerified = false
  let hasRejected = false
  let hasNonVerified = false

  const items = await Promise.all(
    receiptData.items.map(async (itemData: any): Promise<ReceiptItem> => {
      const itemName = itemData.name
      const props: ItemProps = {
        unitPrice: itemData.unitPrice,
        quantity: itemData.quantity,
        measureUnit: itemData.measureUnit,
        totalPrice: itemData.totalPrice,
        department: itemData.department,
      }

      validateItemProps(itemName, props)

      const matchedKey = Object.keys(itemMappings).find(
        (key) => key.toLowerCase() === itemName.toLowerCase()
      )
      const productId = matchedKey ? itemMappings[matchedKey] : null

      if (!productId) {
        strapi.log.info(`Item ${itemName} is not claimed, creating product claim.`)
        return {
          __component: 'receipt-item.product-claim',
          name: itemName,
          props,
        }
      }

      const product = products.find((p) => p.documentId === productId)
      if (!product) {
        strapi.log.warn(`Product with documentId ${productId} not found for item ${itemName}`)
        throw new Error(`Продукт с documentId ${productId} не существует или не подходит для кешбэка`)
      }

      const cashbackItem = await processClaimedItem(itemName, props, product)
      if (['auto_verified_canon', 'auto_verified_alias', 'manually_verified_alias'].includes(cashbackItem.verificationStatus)) {
        hasVerified = true
      } else if (cashbackItem.verificationStatus === 'auto_rejected_alias') {
        hasRejected = true
      } else if (cashbackItem.verificationStatus === 'manual_review') {
        hasNonVerified = true
      }

      return cashbackItem
    })
  )

  return { items, hasVerified, hasRejected, hasNonVerified }
}

async function processClaimedItem(itemName: string, props: ItemProps, product: Product): Promise<CashbackItem> {
  let verificationStatus: ItemVerificationStatus = 'manual_review'
  let productAlias: { documentId: string } | null = null

  if (product.canonicalName.toLowerCase() === itemName.toLowerCase()) {
    verificationStatus = 'auto_verified_canon'
  } else {
    const productAliases = (product.productAliases || []) as ProductAlias[]
    const matchingAlias = productAliases.find(
      (alias) => alias.alternativeName.toLowerCase() === itemName.toLowerCase()
    )

    if (matchingAlias) {
      if (matchingAlias.verificationStatus === 'verified') {
        verificationStatus = 'auto_verified_alias'
      } else if (matchingAlias.verificationStatus === 'rejected') {
        verificationStatus = 'auto_rejected_alias'
      } else {
        verificationStatus = 'manual_review'
      }
      productAlias = { documentId: matchingAlias.documentId }
    } else {
      verificationStatus = 'manual_review'
      try {
        const newAlias = await strapi.documents('api::product-alias.product-alias').create({
          data: {
            alternativeName: itemName,
            verificationStatus: 'unverified',
            product: { documentId: product.documentId },
          },
        })
        productAlias = { documentId: newAlias.documentId }
        strapi.log.debug(`Created product alias for item ${itemName}: ${newAlias.documentId}`)
      } catch (error: any) {
        strapi.log.error(`Failed to create product alias for item ${itemName}: ${error.message}`)
        throw new Error(`Не удалось создать псевдоним продукта для ${itemName}: ${error.message}`)
      }
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
  }
}

async function handleLateSubmission({ ctx, userId }: SubmitContext, receiptData: ReceiptData, receiptValidDays: number) {
  const items: ReceiptItem[] = receiptData.items.map((itemData: any) => {
    const props: ItemProps = {
      unitPrice: itemData.unitPrice,
      quantity: itemData.quantity,
      measureUnit: itemData.measureUnit,
      totalPrice: itemData.totalPrice,
      department: itemData.department,
    }

    validateItemProps(itemData.name, props)

    return {
      __component: 'receipt-item.product-claim',
      name: itemData.name,
      props,
    }
  })

  const finalCashback = calculateFinalCashback(items)

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
      items,
      finalCashback,
    },
  })

  strapi.log.info(`Created receipt documentId ${receipt.documentId} for user ${userId} with status auto_rejected due to time limit`)
  return ctx.created({
    message: `Чек успешно отправлен, но отклонен, так как превышен срок подачи (${receiptValidDays} дней).`,
    receipt,
  })
}

async function createReceipt(
  { ctx, userId }: SubmitContext,
  receiptData: ReceiptData,
  items: ReceiptItem[],
  hasVerified: boolean,
  hasRejected: boolean,
  hasNonVerified: boolean
) {
  let receiptVerificationStatus: ReceiptVerificationStatus

  if (hasNonVerified) {
    receiptVerificationStatus = 'manual_review'
  } else if (hasVerified) {
    if (hasRejected)
      receiptVerificationStatus = 'auto_partially_verified'
    else
      receiptVerificationStatus = 'auto_verified'
  } else if (!hasVerified && hasRejected) {
    receiptVerificationStatus = 'auto_rejected'
  }

  const finalCashback = calculateFinalCashback(items)

  const receipt = await strapi.documents('api::receipt.receipt').create({
    data: {
      oofd_uid: receiptData.oofd_uid,
      qrData: ctx.request.body.qrData,
      fiscalId: receiptData.fiscalId,
      verificationStatus: receiptVerificationStatus,
      user: userId,
      date: receiptData.date,
      totalAmount: receiptData.totalAmount,
      taxAmount: receiptData.taxAmount,
      taxRate: receiptData.taxRate,
      kktCode: receiptData.kktCode,
      kktSerialNumber: receiptData.kktSerialNumber,
      paymentMethod: receiptData.paymentMethod,
      items,
      finalCashback,
    },
  })

  strapi.log.info(`Created receipt documentId ${receipt.documentId} for user ${userId} with status ${receiptVerificationStatus}`)
  return ctx.created({
    message: 'Чек успешно отправлен и будет обработан.',
    receipt,
  })
}