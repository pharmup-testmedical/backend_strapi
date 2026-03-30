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
            method: 'POST',
            path: '/receipts/submit-for-task',
            handler: 'receipt.submitForTask',
        },
        {
            method: 'GET',
            path: '/receipts/me',
            handler: 'receipt.me',
        },
        {
            method: 'POST',
            path: '/receipts/read-ofd-ticket',
            handler: 'receipt.readOFD',
        },
    ],
};