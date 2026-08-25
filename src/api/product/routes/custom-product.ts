/**
 * custom-product router
 */

export default {
    routes: [
        {
            method: 'GET',
            path: '/products/available',
            handler: 'product.available',
        },
        {
            method: 'GET',
            path: '/products/catalog',
            handler: 'product.catalog',
        },
    ],
};