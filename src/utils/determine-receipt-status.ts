import { ReceiptItem, CashbackItem, ReceiptVerificationStatus } from '../api/receipt/controllers/receipt';
import { calculateFinalCashback } from '../api/receipt/utils/receiptHelpers';

interface Receipt {
  items: any[];
  documentId: string;
  verificationStatus: ReceiptVerificationStatus
}

export async function updateReceiptStatus(receipt: Receipt, strapi: any): Promise<void> {
    try {
        console.log('Receipt: ', receipt)

        if (!receipt) {
            strapi.log.error(`Receipt with documentId ${receipt.documentId} not found`);
            throw new Error('Receipt not found');
        }

        // Verify receipt is in manual_review status
        if (receipt.verificationStatus !== 'manual_review') {
            strapi.log.error(
                `Receipt ${receipt.documentId} is in status ${receipt.verificationStatus}, expected manual_review`
            );
            throw new Error('Receipt must be in manual_review status to update based on alias changes');
        }

        let hasVerified = false;
        let hasRejected = false;
        let hasNonVerified = false;

        // Process each item to update its verificationStatus
        const updatedItems = await Promise.all(
            receipt.items.map(async (item: ReceiptItem): Promise<ReceiptItem> => {
                // Only process CashbackItem (receipt-item.item)
                if (item.__component !== 'receipt-item.item') {
                    return item;
                }

                const cashbackItem = item as CashbackItem;

                // Skip items that don't need alias-based updates
                if (
                    cashbackItem.verificationStatus === 'auto_verified_canon' ||
                    !cashbackItem.productAlias
                ) {
                    if (cashbackItem.verificationStatus === 'auto_verified_canon') {
                        hasVerified = true;
                    }
                    return cashbackItem;
                }

                // Fetch the latest product alias
                const productAlias = await strapi
                    .documents('api::product-alias.product-alias')
                    .findOne({
                        documentId: cashbackItem.productAlias.documentId,
                        populate: { product: true },
                    });

                if (!productAlias) {
                    strapi.log.warn(
                        `Product alias ${cashbackItem.productAlias.documentId} not found for item ${cashbackItem.name}`
                    );
                    return cashbackItem;
                }

                let newVerificationStatus = cashbackItem.verificationStatus;

                // Update item verification status based on alias verification status
                if (productAlias.verificationStatus === 'verified') {
                    newVerificationStatus = 'manually_verified_alias';
                    hasVerified = true;
                } else if (productAlias.verificationStatus === 'rejected') {
                    newVerificationStatus = 'manually_rejected_alias';
                    hasRejected = true;
                } else if (productAlias.verificationStatus === 'unverified') {
                    newVerificationStatus = 'manual_review';
                    hasNonVerified = true;
                }

                return {
                    ...cashbackItem,
                    verificationStatus: newVerificationStatus,
                };
            })
        );

        // Determine new receipt verification status
        let newReceiptVerificationStatus: ReceiptVerificationStatus;

        if (hasNonVerified) {
            newReceiptVerificationStatus = 'manual_review';
        } else if (hasVerified) {
            newReceiptVerificationStatus = hasRejected
                ? 'manually_partially_verified'
                : 'manually_verified';
        } else if (hasRejected) {
            newReceiptVerificationStatus = 'manually_rejected';
        } else {
            // Fallback in case no items are processed (shouldn't happen)
            newReceiptVerificationStatus = 'manual_review';
            strapi.log.warn(`No items processed for receipt ${receipt.documentId}, defaulting to manual_review`);
        }

        // Recalculate final cashback based on updated items
        const finalCashback = calculateFinalCashback(updatedItems);

        // Update the receipt with new items and status
        await strapi.documents('api::receipt.receipt').update({
            documentId: receipt.documentId,
            data: {
                items: updatedItems,
                verificationStatus: newReceiptVerificationStatus,
                finalCashback,
            },
        });

        strapi.log.info(
            `Updated receipt ${receipt.documentId} to status ${newReceiptVerificationStatus} with final cashback ${finalCashback}`
        );
    } catch (error: any) {
        strapi.log.error(`Error updating receipt ${receipt.documentId}: ${error.message}`);
        throw error;
    }
}