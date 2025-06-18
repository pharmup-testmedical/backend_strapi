/**
 * receipt controller
 */

import { factories } from '@strapi/strapi';
import { parseReceiptData } from '../utils/receiptHelpers';

// Define interfaces for type safety
interface Product {
  documentId: string;
  canonicalName: string;
  productAliases?: ProductAlias[];
}

interface ProductAlias {
  documentId: string;
  alternativeName: string;
  verificationStatus: 'unverified' | 'verified' | 'rejected';
  product: Product;
}

type ReceiptVerificationStatus = 'auto_verified' | 'auto_rejected' | 'manual_review' | 'manually_verified' | 'manually_rejected';
type ItemVerificationStatus = 'auto_verified_canon' | 'auto_verified_alias' | 'auto_rejected_alias' | 'manual_review' | 'manually_verified_alias' | 'manually_rejected_alias';

interface ItemProps {
  unitPrice: number;
  quantity: number;
  measureUnit: string;
  totalPrice: number;
  department: string;
}

export default factories.createCoreController('api::receipt.receipt', ({ strapi }) => ({
  async submit(ctx) {
    try {
      // Validate input
      const { qrData, itemMappings }: { qrData: string; itemMappings: { [itemName: string]: string } } = ctx.request.body;
      strapi.log.info(`Received receipt submission from user ${ctx.state.user.id} with qrData: ${qrData} and itemMappings: ${JSON.stringify(itemMappings)}`);
      const userId = ctx.state.user.id;

      // Validate qrData
      if (!qrData || typeof qrData !== 'string') {
        strapi.log.warn(`Invalid QR data for user ${userId}`);
        return ctx.badRequest('QR-код обязателен и должен быть действительной строкой');
      }

      // Validate itemMappings
      if (!itemMappings || typeof itemMappings !== 'object' || Object.keys(itemMappings).length === 0) {
        strapi.log.warn(`Empty or invalid itemMappings for user ${userId}`);
        return ctx.badRequest('Требуется хотя бы одно сопоставление имени товара и documentId продукта');
      }

      // Check for duplicate receipt
      const existingReceipt = await strapi.documents('api::receipt.receipt').findMany({
        filters: { qrData },
      });
      if (existingReceipt.length > 0) {
        strapi.log.warn(`Duplicate receipt submission attempted: ${qrData}`);
        return ctx.badRequest('Чек уже был отправлен');
      }

      // Parse receipt data
      const receiptData = await parseReceiptData(qrData, { strapi });

      // Check for duplicate fiscal ID
      const duplicateCheck = await strapi.documents('api::receipt.receipt').findMany({
        filters: { fiscalId: receiptData.fiscalId },
      });
      if (duplicateCheck.length > 0) {
        strapi.log.warn(`Duplicate fiscal ID submission: ${receiptData.fiscalId}`);
        return ctx.badRequest('Чек уже был отправлен');
      }

      // Validate that all submitted item names exist in receiptData.products
      const receiptItemNames = receiptData.products.map((item: any) => item.name.toLowerCase());
      const invalidItemNames = Object.keys(itemMappings).filter(
        (itemName) => !receiptItemNames.includes(itemName.toLowerCase())
      );
      if (invalidItemNames.length > 0) {
        strapi.log.warn(`Invalid item names submitted: ${invalidItemNames.join(', ')}`);
        return ctx.badRequest(`Недопустимые имена товаров: ${invalidItemNames.join(', ')}`);
      }

      // Validate product documentIds and fetch products with aliases
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

      // Check for invalid products
      const invalidProducts = productResults.filter(({ product }) => !product);
      if (invalidProducts.length > 0) {
        const invalidIds = invalidProducts.map(({ productId }) => productId);
        strapi.log.warn(`Invalid or non-eligible product documentIds: ${invalidIds.join(', ')}`);
        return ctx.badRequest('Не все отправленные продукты являются действительными, подходящими для кэшбэка и опубликованными');
      }

      // Map products for easy lookup
      const products = productResults.map(({ product }) => product) as Product[];
      strapi.log.debug(`Fetched products: ${JSON.stringify(products.map(p => ({ documentId: p.documentId, canonicalName: p.canonicalName })), null, 2)}`);

      // Process receipt items
      let hasRejected = false;
      let hasNonVerified = false;
      const receiptItems: any[] = await Promise.all(
        receiptData.products.map(async (itemData: any) => {
          const itemName = itemData.name;
          const props: ItemProps = {
            unitPrice: itemData.unitPrice,
            quantity: itemData.quantity,
            measureUnit: itemData.measureUnit,
            totalPrice: itemData.totalPrice,
            department: itemData.department,
          };

          // Validate props
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
            strapi.log.warn(`Invalid props for item ${itemName}: ${JSON.stringify(props)}`);
            return ctx.badRequest(`Недопустимые свойства для товара ${itemName}: убедитесь, что все обязательные поля заполнены корректно`);
          }

          // Check if item is claimed
          const matchedKey = Object.keys(itemMappings).find(
            (key) => {
              strapi.log.info(`Checking itemMappings for ${key.toLowerCase()} against ${itemName.toLowerCase()}`);
              return key.toLowerCase() === itemName.toLowerCase()
            }
          );
          const productId = matchedKey ? itemMappings[matchedKey] : null;

          if (!productId) {
            // Unclaimed item
            strapi.log.info(`Item ${itemName} is not claimed, creating product claim.`);
            return {
              __component: 'receipt-item.product-claim',
              name: itemName,
              props,
            };
          }

          // Claimed item
          const product = products.find((p) => p.documentId === productId);
          if (!product) {
            strapi.log.warn(`Product with documentId ${productId} not found for item ${itemName}`);
            return ctx.badRequest(`Продукт с documentId ${productId} не существует или не подходит для кэшбэка`);
          }

          let verificationStatus: ItemVerificationStatus = 'manual_review';
          let claimedProductId = product.documentId;
          let productAlias: { documentId: string } | null = null;

          // Check canonicalName match
          if (product.canonicalName.toLowerCase() === itemName.toLowerCase()) {
            verificationStatus = 'auto_verified_canon';
            // productAlias remains null
          } else {
            // Check aliases
            const aliases = (product.productAliases || []) as ProductAlias[];
            const matchingAlias = aliases.find(
              (alias) => alias.alternativeName.toLowerCase() === itemName.toLowerCase()
            );

            if (matchingAlias) {
              if (matchingAlias.verificationStatus === 'verified') {
                verificationStatus = 'auto_verified_alias';
                productAlias = { documentId: matchingAlias.documentId };
              } else if (matchingAlias.verificationStatus === 'rejected') {
                verificationStatus = 'auto_rejected_alias';
                productAlias = { documentId: matchingAlias.documentId };
                hasRejected = true;
              } else {
                verificationStatus = 'manual_review';
                productAlias = { documentId: matchingAlias.documentId };
                hasNonVerified = true;
              }
            } else {
              // No matching alias, create a new one for manual_review
              verificationStatus = 'manual_review';
              hasNonVerified = true;
              try {
                const newAlias = await strapi.documents('api::product-alias.product-alias').create({
                  data: {
                    alternativeName: itemName,
                    verificationStatus: 'unverified',
                    product: { documentId: claimedProductId },
                  },
                });
                productAlias = { documentId: newAlias.documentId };
                strapi.log.debug(`Created product alias for item ${itemName}: ${newAlias.documentId}`);
              } catch (error: any) {
                strapi.log.error(`Failed to create product alias for item ${itemName}: ${JSON.stringify(error, null, 2)}`);
                return ctx.badRequest(`Не удалось создать псевдоним продукта для ${itemName}: ${error.message || 'Ошибка создания псевдонима'}`);
              }
            }
          }

          return {
            __component: 'receipt-item.item',
            name: itemName,
            claimedProduct: { documentId: claimedProductId },
            verificationStatus,
            props,
            productAlias,
          };
        })
      );

      // Log receiptItems for debugging
      strapi.log.debug(`Receipt items: ${JSON.stringify(receiptItems, null, 2)}`);

      // Determine receipt verification status
      let receiptVerificationStatus: ReceiptVerificationStatus;
      if (hasRejected) {
        receiptVerificationStatus = 'auto_rejected';
      } else if (hasNonVerified) {
        receiptVerificationStatus = 'manual_review';
      } else {
        receiptVerificationStatus = 'auto_verified';
      }

      // Create receipt
      try {
        const receipt = await strapi.documents('api::receipt.receipt').create({
          data: {
            oofd_uid: receiptData.oofd_uid,
            qrData,
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
            items: receiptItems,
          },
        });
        strapi.log.info(`Created receipt documentId ${receipt.documentId} for user ${userId} with status ${receiptVerificationStatus}`);
        return ctx.created({
          message: 'Чек успешно отправлен и будет обработан.',
          receipt,
        });
      } catch (error: any) {
        strapi.log.error(`Failed to create receipt for user ${userId}: ${JSON.stringify(error, null, 2)}`);
        return ctx.badRequest(`Не удалось создать чек: ${error.message || 'Ошибка валидации или связи'}`);
      }
    } catch (error: any) {
      strapi.log.error(`Error processing receipt for user ${ctx.state.user.id}: ${JSON.stringify(error, null, 2)}`);
      return ctx.badRequest(error.message || 'Непредвиденная ошибка при обработке чека');
    }
  },
  async me(ctx) {
    try {
      const userId = ctx.state.user.id;
      if (!userId) {
        strapi.log.warn('No authenticated user found');
        return ctx.unauthorized('Вы должны быть авторизованы для просмотра своих чеков');
      }

      const receipts = await strapi.documents('api::receipt.receipt').findMany({
        filters: { user: userId },
        populate: ctx.query.populate || { items: true },
      });

      strapi.log.info(`Fetched ${receipts.length} receipts for user ${userId}`);
      return ctx.send({
        data: receipts,
        meta: {
          total: receipts.length,
        },
      });
    } catch (error) {
      strapi.log.error(`Error fetching receipts for user ${ctx.state.user?.id || 'unknown'}: ${error.message}`);
      return ctx.badRequest('Не удалось загрузить ваши чеки');
    }
  },
  async update(documentId, params) {
    strapi.log.info(`Updating receipt with documentId: ${documentId} and params: ${JSON.stringify(params)}`);
    // some logic here
    const result = await super.update(documentId, params);
    // some more logic

    return result;
  }
}));