// Единственная точка создания уведомления во всём проекте — lifecycle-хуки
// и broadcast-эндпоинт вызывают только эту функцию. Сейчас она просто
// пишет запись в БД; когда понадобится push, внутрь этой же функции
// добавится вызов push-сервиса — ни модель, ни вызывающий код (хуки,
// мобильное приложение) переделывать не придётся.
export type NotificationType = 'cashback' | 'promotion' | 'order' | 'service'

export interface CreateNotificationParams {
    userDocumentId: string
    type: NotificationType
    title: string
    body: string
    action?: string
    entityId?: string
    deepLink?: string
}

export const createNotification = async ({
    userDocumentId,
    type,
    title,
    body,
    action,
    entityId,
    deepLink,
}: CreateNotificationParams) => {
    try {
        return await strapi.documents('api::notification.notification').create({
            data: {
                user: { documentId: userDocumentId },
                type,
                title,
                body,
                action: action || null,
                entityId: entityId || null,
                deepLink: deepLink || null,
                isRead: false,
                pushSent: false,
                publishedAt: new Date(),
            },
        })
    } catch (error: any) {
        // Уведомление — вспомогательная функциональность, ошибка здесь не
        // должна ронять основной lifecycle (начисление баланса и т.п.).
        strapi.log.error(`[createNotification] Failed for user ${userDocumentId}: ${error.message}`)
        return null
    }
}
