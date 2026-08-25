/**
 * product controller
 */

import { factories } from '@strapi/strapi';

export default factories.createCoreController('api::product.product', ({ strapi }) => ({
    async available(ctx) {
        try {
            // Ensure user is authenticated
            if (!ctx.state.user) {
                strapi.log.warn('Unauthorized access attempt to available products endpoint');
                return ctx.unauthorized('Пользователь должен быть аутентифицирован');
            }

            const nowInGMT5 = new Date();
            nowInGMT5.setHours(nowInGMT5.getUTCHours() + 5);

            const products = await strapi.service('api::product.product').find({
                filters: {
                    cashbackEligible: true,
                },
                // Strapi caps results at config/api.ts defaultLimit (25) unless
                // told otherwise — this endpoint must return the full catalog,
                // not just the first page.
                pagination: {
                    limit: -1,
                },
                populate: {
                    productAliases: {
                        fields: ['id', 'alternativeName', 'verificationStatus'],
                    },
                    category: {
                        fields: ['id', 'name'],
                    },
                    brand: {
                        fields: ['id', 'name'],
                    },
                    image: {
                        fields: ['url', 'name', 'alternativeText'],
                    },
                },
                fields: ['id', 'canonicalName', 'barcode', 'ntin', 'ntinAlternative', 'cashbackEligible', 'cashbackAmount', 'unpublishDate'],
                publicationState: 'live',
            });

            const availableProducts = products.results.filter(product => {
                if (!product.unpublishDate) return true;
                const unpublishDate = new Date(product.unpublishDate);
                unpublishDate.setHours(23, 59, 59, 999); // Set to end of day
                return unpublishDate >= nowInGMT5;
            });

            if (availableProducts.length === 0) {
                strapi.log.info(`No cashback-eligible products found for user ${ctx.state.user.id}`);
                return ctx.notFound('Нет доступных продуктов с кешбэком');
            }

            strapi.log.info(`Retrieved ${availableProducts.length} cashback-eligible products for user ${ctx.state.user.id}`);
            return ctx.send({
                message: 'Продукты с кешбэком успешно получены',
                data: availableProducts,
            });
        } catch (error: any) {
            strapi.log.error(`Error retrieving cashback-eligible products for user ${ctx.state.user?.id || 'unknown'}: ${error.message}`);
            return ctx.internalServerError('Произошла ошибка при получении продуктов');
        }
    },

    // Полноценный каталог (не только участвующие в кешбэке) — для будущего
    // раздела "Заказ" и для сортировки/фильтров на существующих экранах.
    // Намеренно отдельный от available: тот завязан на текущий кешбэк-флоу
    // и его нельзя менять, не рискуя сломать сканирование чеков.
    async catalog(ctx: any) {
        try {
            if (!ctx.state.user) {
                return ctx.unauthorized('Пользователь должен быть аутентифицирован');
            }

            const {
                page: pageRaw,
                pageSize: pageSizeRaw,
                sort: sortField = 'article',
                order = 'asc',
                search,
                group_ids: groupIdsRaw,
                category_ids: categoryIdsRaw,
                supplier_ids: supplierIdsRaw,
                brand_ids: brandIdsRaw,
                cashback_min: cashbackMinRaw,
                cashback_max: cashbackMaxRaw,
            } = ctx.query;

            const page = Math.max(Number(pageRaw) || 1, 1);
            const pageSize = Math.min(Math.max(Number(pageSizeRaw) || 20, 1), 100);

            const sortFieldMap: Record<string, string> = {
                article: 'article',
                name: 'canonicalName',
                cashback: 'cashbackAmount',
                promotionEnd: 'unpublishDate',
            };
            const resolvedSortField = sortFieldMap[sortField as string] || 'article';
            const resolvedOrder = order === 'desc' ? 'desc' : 'asc';

            const filters: any = {};

            if (search) {
                filters.canonicalName = { $containsi: search };
            }

            const parseIds = (raw: any): string[] | null => {
                if (!raw) return null;
                const ids = String(raw).split(',').map((id) => id.trim()).filter(Boolean);
                return ids.length > 0 ? ids : null;
            };

            const groupIds = parseIds(groupIdsRaw);
            if (groupIds) {
                filters.category = { ...(filters.category || {}), group: { documentId: { $in: groupIds } } };
            }

            const categoryIds = parseIds(categoryIdsRaw);
            if (categoryIds) {
                filters.category = { ...(filters.category || {}), documentId: { $in: categoryIds } };
            }

            const supplierIds = parseIds(supplierIdsRaw);
            if (supplierIds) {
                filters.productSuppliers = { supplier: { documentId: { $in: supplierIds } } };
            }

            const brandIds = parseIds(brandIdsRaw);
            if (brandIds) {
                filters.brand = { documentId: { $in: brandIds } };
            }

            const cashbackMin = cashbackMinRaw !== undefined ? Number(cashbackMinRaw) : null;
            const cashbackMax = cashbackMaxRaw !== undefined ? Number(cashbackMaxRaw) : null;
            if (cashbackMin !== null || cashbackMax !== null) {
                filters.cashbackAmount = {};
                if (cashbackMin !== null && !isNaN(cashbackMin)) filters.cashbackAmount.$gte = cashbackMin;
                if (cashbackMax !== null && !isNaN(cashbackMax)) filters.cashbackAmount.$lte = cashbackMax;
            }

            const result = await strapi.service('api::product.product').find({
                filters,
                sort: { [resolvedSortField]: resolvedOrder },
                pagination: { page, pageSize },
                populate: {
                    category: { fields: ['id', 'name'], populate: { group: { fields: ['id', 'name'] } } },
                    brand: { fields: ['id', 'name'] },
                    productSuppliers: { populate: { supplier: { fields: ['id', 'name'] } } },
                    image: { fields: ['url', 'name', 'alternativeText'] },
                },
                publicationState: 'live',
            });

            return ctx.send({
                data: result.results,
                meta: {
                    page,
                    pageSize,
                    total: result.pagination.total,
                    pageCount: result.pagination.pageCount,
                },
            });
        } catch (error: any) {
            strapi.log.error(`[catalog] Error for user ${ctx.state.user?.id || 'unknown'}: ${error.message}`);
            return ctx.badRequest('Не удалось загрузить каталог товаров');
        }
    },
}));