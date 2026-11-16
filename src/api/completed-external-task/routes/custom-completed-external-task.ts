/**
 * custom-completed-external-task router
 */

export default {
    routes: [
        {
            method: 'POST',
            path: '/completed-external-tasks/submit',
            handler: 'completed-external-task.submit',
        },
        {
            method: 'GET',
            path: '/completed-external-tasks/me',
            handler: 'completed-external-task.me',
        },
    ],
}
