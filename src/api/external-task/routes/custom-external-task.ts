/**
 * custom-external-task router
 */

export default {
    routes: [
        {
            method: 'GET',
            path: '/external-tasks/active',
            handler: 'external-task.active',
        },
    ],
}
