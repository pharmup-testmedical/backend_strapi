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
    ],
};