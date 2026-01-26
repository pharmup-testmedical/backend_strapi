/**
 * custom-cashback-request router
 */

export default {
    routes: [
        {
            method: 'POST',
            path: '/cashback-requests/me',
            handler: 'cashback-request.me',
        },
        {
            method: 'POST',
            path: '/cashback-requests/request',
            handler: 'cashback-request.request',
        },
    ],
};