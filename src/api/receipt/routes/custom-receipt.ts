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
            method: 'POST',
            path: '/receipts/submit-photo',
            handler: 'receipt.submitPhoto',
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
        {
            method: 'POST',
            path: '/receipts/backfill-sheet',
            handler: 'receipt.backfillSheet',
            config: { auth: false },
        },
    ],
};