import { updateReceiptStatus } from '../../../../utils/determine-receipt-status';
import { normalizeAliasName } from '../../../../utils/normalize-alias-name';

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

// Численные id строк product из raw data.product ({ set: [{id}, ...] }) —
// Content Manager/Document Service присылает связь именно в этой форме, не
// плоским полем. Из-за draftAndPublish на Product один и тот же товар может
// быть представлен ДВУМЯ id (черновик + опубликованный), поэтому набор
// нормализуется в document_id, а не сравнивается по голому id напрямую.
function extractProductIds(data: any): number[] {
    const set = data?.product?.set;
    if (!Array.isArray(set)) return [];
    return set.map((entry: any) => entry?.id).filter((id: any): id is number => typeof id === 'number');
}

// Возвращает document_id товара по любому из его численных id (черновик или
// опубликованный — не важно, обе строки делят один document_id).
async function resolveProductDocumentId(productIds: number[]): Promise<string | null> {
    if (productIds.length === 0) return null;
    const product = await strapi.db.query('api::product.product').findOne({
        where: { id: { $in: productIds } },
        select: ['documentId'],
    });
    return product?.documentId ?? null;
}

// Все численные id строк товара (черновик + опубликованный) с данным
// document_id — нужно, чтобы сравнение алиасов не зависело от того, к какой
// из двух строк товара оказался привязан тот или иной алиас.
async function allRowIdsForProductDocument(productDocumentId: string): Promise<number[]> {
    const rows = await strapi.db.query('api::product.product').findMany({
        where: { documentId: productDocumentId },
        select: ['id'],
    });
    return rows.map((r: any) => r.id);
}

interface DuplicateCheckParams {
    alternativeName: string;
    productDocumentId: string;
    excludeAliasId?: number;
}

// Бросает понятную ошибку, если у того же товара уже есть ДРУГОЙ
// (опубликованный) псевдоним с тем же normalizeAliasName() текстом.
// excludeAliasId — сам редактируемый алиас, чтобы не сравнивать сам с собой.
async function assertNoDuplicateAlias({ alternativeName, productDocumentId, excludeAliasId }: DuplicateCheckParams) {
    const productRowIds = await allRowIdsForProductDocument(productDocumentId);
    if (productRowIds.length === 0) return;

    const targetNormalized = normalizeAliasName(alternativeName);

    const candidates = await strapi.db.query('api::product-alias.product-alias').findMany({
        where: {
            product: { id: { $in: productRowIds } },
            publishedAt: { $notNull: true },
            ...(excludeAliasId ? { id: { $ne: excludeAliasId } } : {}),
        },
        populate: ['product'],
    });

    const duplicate = candidates.find(
        (c: any) => normalizeAliasName(c.alternativeName) === targetNormalized
    );

    if (duplicate) {
        const productName = duplicate.product?.canonicalName ?? productDocumentId;
        throw new Error(
            `У товара "${productName}" уже есть псевдоним с таким названием (ID ${duplicate.id}: "${duplicate.alternativeName}"). Используйте существующий вместо создания дубля.`
        );
    }
}

export default {
    async beforeCreate(event: any) {
        const { data } = event.params || {};
        if (!data?.alternativeName) return;

        const productIds = extractProductIds(data);
        const productDocumentId = await resolveProductDocumentId(productIds);
        if (!productDocumentId) return; // без товара сравнивать не с чем

        await assertNoDuplicateAlias({
            alternativeName: data.alternativeName,
            productDocumentId,
        });
    },

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
            populate: ['product'],
        }) as (ProductAlias & { product?: { id: number; documentId: string } | null }) | null;

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

        // Дубль-проверка — ТОЛЬКО если реально меняется alternativeName или
        // product. Если сохраняются только другие поля (например, верификатор
        // просто подтверждает verificationStatus) — текст/товар этой записи
        // не меняются, значит и её отношение к другим псевдонимам не
        // меняется, перепроверять нечего. Без этого условия хук блокировал бы
        // ЛЮБУЮ правку уже существующей (например, найденной сканированием,
        // но ещё не схлопнутой) дублирующей пары — подтверждено тестом на
        // предсуществующем дубле, вставленном в обход хука.
        if (data?.alternativeName !== undefined || data?.product !== undefined) {
            const effectiveAlternativeName = data?.alternativeName ?? currentAlias.alternativeName;
            const effectiveProductIds = data?.product
                ? extractProductIds(data)
                : currentAlias.product
                    ? [currentAlias.product.id]
                    : [];
            const effectiveProductDocumentId = data?.product
                ? await resolveProductDocumentId(effectiveProductIds)
                : currentAlias.product?.documentId ?? null;

            if (effectiveAlternativeName && effectiveProductDocumentId) {
                await assertNoDuplicateAlias({
                    alternativeName: effectiveAlternativeName,
                    productDocumentId: effectiveProductDocumentId,
                    excludeAliasId: id,
                });
            }
        }

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