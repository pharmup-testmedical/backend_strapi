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

            // Fetch cashback-eligible and published products
            const products = await strapi.entityService.findMany('api::product.product', {
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
                fields: ['id', 'canonicalName', 'cashbackEligible', 'cashbackAmount'],
                status: 'published', // vs 'draft
            });

            if (!products || products.length === 0) {
                strapi.log.info(`No cashback-eligible products found for user ${ctx.state.user.id}`);
                return ctx.notFound('Нет доступных продуктов с кэшбэком');
            }

            strapi.log.info(`Retrieved ${products.length} cashback-eligible products for user ${ctx.state.user.id}`);
            return ctx.send({
                message: 'Продукты с кэшбэком успешно получены',
                data: products,
            });
        } catch (error) {
            strapi.log.error(`Error retrieving cashback-eligible products for user ${ctx.state.user?.id || 'unknown'}: ${error.message}`);
            return ctx.internalServerError('Произошла ошибка при получении продуктов');
        }
    },
}));
