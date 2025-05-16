import { factories } from '@strapi/strapi';
import { parseReceiptData } from '../utils/receiptHelpers';

// Define interfaces for type safety
interface Product {
  id: string;
  canonicalName: string;
}

interface ProductAlias {
  documentId: string;
  alternativeName: string;
  verificationStatus: 'unverified' | 'verified' | 'rejected';
  product?: Product;
}

interface ReceiptProductData {
  department: string;
  unitPrice: number;
  quantity: number;
  measureUnit: string;
  totalPrice: number;
  product?: string | null;
  product_alias?: string | null;
  name: string;
}

export default factories.createCoreController('api::receipt.receipt', ({ strapi }) => ({
  async submit(ctx) {
    try {
      // Validate input
      const { qrData, cashbackProductIds }: { qrData: string; cashbackProductIds: string[] } = ctx.request.body;
      const userId = ctx.state.user.id;

      // Manual validation for qrData
      if (!qrData || typeof qrData !== 'string') {
        strapi.log.warn(`Invalid QR data for user ${userId}`);
        return ctx.badRequest('QR link is required and must be a valid string');
      }

      // Validate cashbackProductIds
      if (!Array.isArray(cashbackProductIds) || cashbackProductIds.length === 0) {
        strapi.log.warn(`Empty or invalid cashbackProductIds for user ${userId}`);
        return ctx.badRequest('At least one cashback product ID is required.');
      }

      // Check for duplicate receipt
      const existingReceipt = await strapi.documents('api::receipt.receipt').findMany({
        filters: { qrData },
      });
      if (existingReceipt.length > 0) {
        strapi.log.warn(`Duplicate receipt submission attempted: ${qrData}`);
        return ctx.badRequest('Receipt has already been submitted.');
      }

      // Parse receipt data
      const receiptData = await parseReceiptData(qrData, { strapi });

      // Check for duplicate fiscal ID
      const duplicateCheck = await strapi.documents('api::receipt.receipt').findMany({
        filters: { fiscalId: receiptData.fiscalId },
      });
      if (duplicateCheck.length > 0) {
        strapi.log.warn(`Duplicate fiscal ID submission: ${receiptData.fiscalId}`);
        return ctx.badRequest('Receipt has already been submitted.');
      }

      // Validate cashbackProductIds
      const products = await strapi.documents('api::product.product').findMany({
        filters: {
          id: { $in: cashbackProductIds },
          cashbackEligible: true,
        },
        fields: ['id', 'canonicalName'],
      }) as Product[];

      if (products.length !== cashbackProductIds.length) {
        const invalidIds = cashbackProductIds.filter(
          (id) => !products.some((p) => p.id === id)
        );
        strapi.log.warn(`Invalid cashback product IDs: ${invalidIds.join(', ')}`);
        return ctx.badRequest(`Invalid or non-eligible product IDs: ${invalidIds.join(', ')}`);
      }

      // Track remaining products
      const remainingProducts = products.map((p) => ({
        id: p.id,
        canonicalName: p.canonicalName,
      }));
      const directMatches: ReceiptProductData[] = [];
      const aliasMatches: ReceiptProductData[] = [];
      const receiptProductData: ReceiptProductData[] = [];
      const rejectedAliasNames: string[] = [];

      // Iterate over receipt products
      for (const item of receiptData.products) {
        const receiptProduct: ReceiptProductData = {
          department: item.department,
          unitPrice: item.unitPrice,
          quantity: item.quantity,
          measureUnit: item.measureUnit,
          totalPrice: item.totalPrice,
          name: item.name,
        };

        // Direct name match
        const directMatch = remainingProducts.find(
          (p) => p.canonicalName.toLowerCase() === item.name.toLowerCase()
        );
        if (directMatch) {
          directMatches.push({
            ...receiptProduct,
            product: directMatch.id,
            product_alias: null,
          });
          remainingProducts.splice(remainingProducts.indexOf(directMatch), 1);
          continue;
        }

        // Alias match
        const aliases = await strapi.documents('api::product-alias.product-alias').findMany({
          filters: { alternativeName: item.name },
          populate: { product: true },
        }) as ProductAlias[];

        if (aliases.length > 0) {
          const aliasRecord = aliases[0];
          if (aliasRecord.verificationStatus === 'rejected') {
            rejectedAliasNames.push(item.name);
            continue;
          }
          if (
            aliasRecord.verificationStatus === 'verified' &&
            aliasRecord.product &&
            remainingProducts.some((p) => p.id === aliasRecord.product.id)
          ) {
            const matchedProduct = remainingProducts.find((p) => p.id === aliasRecord.product.id);
            aliasMatches.push({
              ...receiptProduct,
              product: aliasRecord.product.id,
              product_alias: aliasRecord.documentId,
            });
            remainingProducts.splice(remainingProducts.indexOf(matchedProduct!), 1);
            continue;
          }
        }

        // Non-match: Check if claimed in cashbackProductIds
        const claimedProduct = products.find((p) => cashbackProductIds.includes(p.id));
        receiptProductData.push({
          ...receiptProduct,
          product: claimedProduct ? claimedProduct.id : null,
          product_alias: null,
        });
      }

      // Check for rejected aliases
      if (rejectedAliasNames.length > 0) {
        strapi.log.warn(`Rejected alias names found: ${rejectedAliasNames.join(', ')}`);
        return ctx.badRequest(
          `Receipt contains rejected product names: ${rejectedAliasNames.join(', ')}`
        );
      }

      // Create receipt
      const receipt = await strapi.documents('api::receipt.receipt').create({
        data: {
          oofd_uid: receiptData.oofd_uid,
          qrData,
          fiscalId: receiptData.fiscalId,
          verificationStatus: remainingProducts.length === 0 ? 'auto_verified' : 'manual_review',
          user: userId,
          date: receiptData.date,
          totalAmount: receiptData.totalAmount,
          taxAmount: receiptData.taxAmount,
          taxRate: receiptData.taxRate,
          kktCode: receiptData.kktCode,
          kktSerialNumber: receiptData.kktSerialNumber,
          paymentMethod: receiptData.paymentMethod,
        },
      });
      strapi.log.info(`Created receipt ID ${receipt.documentId} for user ${userId}`);

      // Create ReceiptProducts
      const allReceiptProducts = [...directMatches, ...aliasMatches, ...receiptProductData];

      // Ensure all cashbackProductIds are included
      for (const claimedProduct of products) {
        if (!allReceiptProducts.some((rp) => rp.product === claimedProduct.id)) {
          allReceiptProducts.push({
            product: claimedProduct.id,
            product_alias: null,
            name: claimedProduct.canonicalName,
            department: 'Unknown',
            unitPrice: 0.00,
            quantity: 1,
            measureUnit: 'unit',
            totalPrice: 0.00,
          });
        }
      }

      // Create/reuse aliases for non-matches and set productId
      for (const rp of allReceiptProducts) {
        let aliasId = rp.product_alias;
        let productId = rp.product;

        if (!aliasId) {
          // Skip alias creation if name matches a canonicalName
          const isCanonical = await strapi.documents('api::product.product').findMany({
            filters: { canonicalName: rp.name },
          });
          if (isCanonical.length > 0) {
            productId = isCanonical[0].id.toString(); // Convert ID to string
            aliasId = null;
          } else {
            // Create or reuse unverified alias
            const aliases = await strapi.documents('api::product-alias.product-alias').findMany({
              filters: { alternativeName: rp.name },
              populate: { product: true },
            }) as ProductAlias[];
            let alias: ProductAlias;
            if (aliases.length === 0) {
              alias = await strapi.documents('api::product-alias.product-alias').create({
                data: {
                  alternativeName: rp.name,
                  product: productId || products.find((p) => cashbackProductIds.includes(p.id))?.id,
                  verificationStatus: 'unverified',
                },
              }) as ProductAlias;
              strapi.log.info(`Created unverified alias: ${rp.name}`);
            } else {
              alias = aliases[0];
              if (productId && !alias.product?.id) {
                await strapi.documents('api::product-alias.product-alias').update({
                  documentId: alias.documentId,
                  data: { product: productId },
                });
              }
            }
            aliasId = alias.documentId;
            if (!productId && alias.product?.id) {
              productId = alias.product.id;
            }
          }
        }

        await strapi.documents('api::receipt-product.receipt-product').create({
          data: {
            receipt: receipt.documentId,
            product: productId,
            product_alias: aliasId,
            department: rp.department,
            unitPrice: rp.unitPrice,
            quantity: rp.quantity,
            measureUnit: rp.measureUnit,
            totalPrice: rp.totalPrice,
          },
        });
        strapi.log.info(`Added receipt product: ${rp.name} to receipt ID ${receipt.documentId}`);
      }

      return ctx.created({
        message: 'Receipt submitted successfully and will be processed.',
        receipt,
      });
    } catch (error: any) {
      strapi.log.error(`Error processing receipt for user ${ctx.state.user.id}: ${error.message}`);
      return ctx.badRequest(error.message);
    }
  },
}));