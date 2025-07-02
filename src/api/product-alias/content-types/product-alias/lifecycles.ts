import { updateReceiptStatus } from '../../../../utils/determine-receipt-status';

// Define interfaces for type safety
interface ProductAlias {
    id: number;
    documentId: string;
    verificationStatus: 'unverified' | 'verified' | 'rejected';
    alternativeName: string;
}

interface Receipt {
    id: number;
    documentId: string;
    verificationStatus: 'manual_review' | 'auto_verified' | 'auto_rejected' | 'manually_verified' | 'manually_rejected' | 'auto_rejected_late_submission' | 'auto_partially_verified' | 'manually_partially_verified';
    items: Array<{
        __component: 'receipt-item.item' | 'receipt-item.product-claim';
        id: number;
        verificationStatus?: 'manual_review' | 'auto_verified_canon' | 'auto_verified_alias' | 'manually_verified_alias' | 'auto_rejected_alias' | 'manually_rejected_alias';
        productAlias?: { id: number; documentId: string }; // Use id for schema, documentId for runtime
    }>;
}

export default {
    async beforeUpdate(event: any) {
        const { params, state } = event;
        const { data, where } = params || {};

        // Log the event for debugging
        strapi.log.debug(`beforeUpdate event: ${JSON.stringify(event, null, 2)}`);

        // Get the id from the where clause
        const id = where?.id;
        if (!id) {
            strapi.log.error('No id provided in beforeUpdate for product-alias');
            throw new Error('Record ID is required for updating product alias');
        }

        // Fetch the product alias using strapi.db.query
        const currentAlias = await strapi.db.query('api::product-alias.product-alias').findOne({
            where: { id },
        }) as ProductAlias | null;

        if (!currentAlias) {
            strapi.log.error(`Product alias with id ${id} not found`);
            throw new Error('Product alias not found');
        }

        const documentId = currentAlias.documentId;
        if (!documentId) {
            strapi.log.error(`Product alias with id ${id} has no documentId`);
            throw new Error('Document ID is missing for product alias');
        }

        // Store the current verificationStatus in event.state for afterUpdate
        state.previousVerificationStatus = currentAlias.verificationStatus;

        // Only validate if verificationStatus is being updated
        if (data?.verificationStatus) {
            // Check if current verificationStatus is unverified
            if (currentAlias.verificationStatus !== 'unverified') {
                strapi.log.warn(
                    `Attempted to change verificationStatus of product alias ${documentId} (id: ${id}) from ${currentAlias.verificationStatus} to ${data.verificationStatus}. Only changes from unverified are allowed.`
                );
                throw new Error('Изменение статуса подтверждения допускается только с "unverified" на другой статус');
            }

            // Verify the new status is valid
            if (!['verified', 'rejected'].includes(data.verificationStatus)) {
                strapi.log.warn(
                    `Invalid verificationStatus ${data.verificationStatus} for product alias ${documentId} (id: ${id}). Must be 'verified' or 'rejected'.`
                );
                throw new Error('Новый статус подтверждения должен быть "verified" или "rejected"');
            }
        }
    },

    async afterUpdate(event: any) {
        const { result, state } = event;

        // Get the previous verificationStatus from state
        const previousVerificationStatus = state?.previousVerificationStatus;

        // Only proceed if verificationStatus changed from unverified
        if (
            previousVerificationStatus === 'unverified' &&
            ['verified', 'rejected'].includes(result?.verificationStatus)
        ) {
            try {
                // Find all receipts with manual_review status
                const receipts = await strapi.entityService.findMany('api::receipt.receipt', {
                    filters: { verificationStatus: 'manual_review' },
                    populate: {
                        items: {
                            on: {
                                'receipt-item.item': {
                                    populate: {
                                        productAlias: true
                                    }
                                },
                                'receipt-item.product-claim': {
                                    // No populate needed for product-claim
                                }
                            }
                        }
                    }
                }) as Receipt[];

                // Filter receipts with matching productAlias
                const matchingReceipts = receipts.filter((receipt) =>
                    receipt.items.some(
                        (item) =>
                            item.__component === 'receipt-item.item' &&
                            item.productAlias?.documentId === result.documentId
                    )
                );

                strapi.log.info(
                    `Found ${matchingReceipts.length} manual_review receipts for alias ${result.documentId}`
                );

                // Update each matching receipt
                for (const receipt of matchingReceipts) {
                    await updateReceiptStatus(receipt, strapi);
                }

                strapi.log.info(
                    `Processed ${matchingReceipts.length} receipts for product alias ${result.documentId} after verificationStatus changed to ${result.verificationStatus}`
                );
            } catch (error: any) {
                strapi.log.error(
                    `Error processing receipts for product alias ${result.documentId}: ${error.message}`,
                    { stack: error.stack }
                );
            }
        } else {
            strapi.log.debug(
                `No action taken for product alias ${result?.documentId || 'unknown'}: verificationStatus change from ${previousVerificationStatus || 'unknown'} to ${result?.verificationStatus || 'unknown'} not processed`
            );
        }
    }
};