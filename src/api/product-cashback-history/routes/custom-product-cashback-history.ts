/**
 * custom-product-cashback-history router
 */

export default {
    routes: [
        {
            method: 'POST',
            path: '/product-cashback-histories/backfill',
            handler: 'product-cashback-history.backfill',
            config: { auth: false },
        },
    ],
};
