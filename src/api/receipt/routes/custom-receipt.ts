/**
 * custom-receipt router
 */

export default {
    routes: [
        {
            method: 'POST',
            path: '/receipts/submit',
            handler: 'receipt.submit',
            config: {
                auth: { scope: ['authenticated'] }, // change accordingly
                policies: [], // change accordingly. for now we have no policies at all
            },
        }
    ],
};