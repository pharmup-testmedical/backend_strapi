/**
 * notification router
 *
 * Намеренно без factories.createCoreRouter — стандартный CRUD (в т.ч.
 * /notifications/:id без проверки владельца) здесь не регистрируется
 * вообще, только эти явно скоупленные по пользователю маршруты.
 */
export default {
    routes: [
        {
            method: 'GET',
            path: '/notifications/me',
            handler: 'notification.me',
        },
        {
            method: 'GET',
            path: '/notifications/me/summary',
            handler: 'notification.summary',
        },
        {
            method: 'GET',
            path: '/notifications/me/unread-count',
            handler: 'notification.unreadCount',
        },
        {
            method: 'POST',
            path: '/notifications/me/read-all',
            handler: 'notification.markAllRead',
        },
        {
            method: 'POST',
            path: '/notifications/:documentId/read',
            handler: 'notification.markRead',
        },
        {
            method: 'POST',
            path: '/notifications/broadcast',
            handler: 'notification.broadcast',
            config: { auth: false },
        },
    ],
}
