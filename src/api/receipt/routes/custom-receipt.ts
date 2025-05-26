/**
 * custom-receipt router
 */

export default {
    routes: [
        {
            method: 'POST',
            path: '/receipts/submit',
            handler: 'receipt.submit',
        },
        {
            method: 'GET',
            path: '/receipts/me',
            handler: 'receipt.me',
        }
    ],
};