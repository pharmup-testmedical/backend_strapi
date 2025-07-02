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
                fields: ['id', 'canonicalName', 'cashbackEligible', 'cashbackAmount', 'unpublishDate'],
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
}));