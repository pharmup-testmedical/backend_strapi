/**
 * custom-test router
 */

export default {
    routes: [
        {
            method: 'POST',
            path: '/tests/submit',
            handler: 'test.submit',
        },
    ],
};