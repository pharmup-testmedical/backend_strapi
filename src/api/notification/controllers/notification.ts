/**
 * notification controller
 *
 * Только кастомные роуты, без стандартного core-роутера (см. routes/) —
 * чтобы по /notifications/:id нельзя было случайно получить чужую запись,
 * даже если кто-то по ошибке включит права в админке. Каждый метод сам
 * фильтрует строго по текущему ctx.state.user.
 */
import { createNotification, NotificationType } from '../../../utils/create-notification'

const NOTIFICATION_TYPES: NotificationType[] = ['cashback', 'promotion', 'order', 'service']

export default {
    async me(ctx: any) {
        try {
            const userId = ctx.state.user.id
            const { type } = ctx.query
            const page = Math.max(Number(ctx.query.page) || 1, 1)
            const pageSize = Math.min(Math.max(Number(ctx.query.pageSize) || 20, 1), 50)

            const filters: any = { user: userId }
            if (type) {
                if (!NOTIFICATION_TYPES.includes(type)) {
                    return ctx.badRequest('Недопустимый type')
                }
                filters.type = type
            }

            const notifications = await strapi.documents('api::notification.notification').findMany({
                filters,
                sort: ['createdAt:desc'],
                start: (page - 1) * pageSize,
                limit: pageSize,
                populate: ['image'],
            })

            return ctx.send({
                data: notifications,
                meta: { page, pageSize, hasMore: notifications.length === pageSize },
            })
        } catch (error: any) {
            strapi.log.error(`[notification.me] ${error.message}`)
            return ctx.badRequest('Не удалось загрузить уведомления')
        }
    },

    // По одной строке на каждый тип, у которого есть хотя бы одно
    // уведомление (пустые категории не показываем — см. ТЗ), с последним
    // уведомлением для превью и количеством непрочитанных в этой категории.
    // Используется главным экраном "Уведомления" (список категорий).
    async summary(ctx: any) {
        try {
            const userId = ctx.state.user.id

            const results = await Promise.all(
                NOTIFICATION_TYPES.map(async (type) => {
                    const [latest] = await strapi.documents('api::notification.notification').findMany({
                        filters: { user: userId, type },
                        sort: ['createdAt:desc'],
                        limit: 1,
                    })
                    if (!latest) return null

                    const unreadCount = await strapi.documents('api::notification.notification').count({
                        filters: { user: userId, type, isRead: false },
                    })

                    return {
                        type,
                        latest: {
                            title: latest.title,
                            body: latest.body,
                            createdAt: latest.createdAt,
                        },
                        unreadCount,
                    }
                })
            )

            return ctx.send({ data: results.filter(Boolean) })
        } catch (error: any) {
            strapi.log.error(`[notification.summary] ${error.message}`)
            return ctx.badRequest('Не удалось загрузить сводку по уведомлениям')
        }
    },

    async unreadCount(ctx: any) {
        try {
            const userId = ctx.state.user.id
            const count = await strapi.documents('api::notification.notification').count({
                filters: { user: userId, isRead: false },
            })
            return ctx.send({ count })
        } catch (error: any) {
            strapi.log.error(`[notification.unreadCount] ${error.message}`)
            return ctx.badRequest('Не удалось получить количество непрочитанных')
        }
    },

    async markRead(ctx: any) {
        try {
            const userId = ctx.state.user.id
            const { documentId } = ctx.params

            const notification = await strapi.documents('api::notification.notification').findOne({
                documentId,
                populate: ['user'],
            })

            if (!notification || notification.user?.id !== userId) {
                return ctx.notFound('Уведомление не найдено')
            }

            const updated = await strapi.documents('api::notification.notification').update({
                documentId,
                data: { isRead: true },
            })

            return ctx.send({ data: updated })
        } catch (error: any) {
            strapi.log.error(`[notification.markRead] ${error.message}`)
            return ctx.badRequest('Не удалось отметить уведомление прочитанным')
        }
    },

    async markAllRead(ctx: any) {
        try {
            const userId = ctx.state.user.id
            const { type } = ctx.query
            if (type && !NOTIFICATION_TYPES.includes(type)) {
                return ctx.badRequest('Недопустимый type')
            }

            const filters: any = { user: userId, isRead: false }
            if (type) filters.type = type

            const unread = await strapi.documents('api::notification.notification').findMany({
                filters,
            })

            await Promise.all(
                unread.map((notification: any) =>
                    strapi.documents('api::notification.notification').update({
                        documentId: notification.documentId,
                        data: { isRead: true },
                    })
                )
            )

            return ctx.send({ updated: unread.length })
        } catch (error: any) {
            strapi.log.error(`[notification.markAllRead] ${error.message}`)
            return ctx.badRequest('Не удалось отметить уведомления прочитанными')
        }
    },

    // Технический способ рассылки на время, пока нет Admin Panel UI —
    // защищён отдельным секретом (тот же паттерн, что уже используется в
    // проекте для бэкфилла Google Sheets). Когда появится полноценная
    // админка, она станет вторым вызывающим кодом createNotification() —
    // ни модель, ни мобильное приложение переделывать не придётся.
    async broadcast(ctx: any) {
        const providedSecret = (ctx.request.headers['x-broadcast-secret'] || '').trim()
        const expectedSecret = (process.env.NOTIFICATION_BROADCAST_SECRET || '').trim()
        if (!expectedSecret || providedSecret !== expectedSecret) {
            return ctx.forbidden('Неверный или не заданный секрет')
        }

        const { audience, type, title, body, action, entityId, deepLink } = ctx.request.body as {
            audience?: 'all' | string[]
            type?: string
            title?: string
            body?: string
            action?: string
            entityId?: string
            deepLink?: string
        }

        if (!type || !NOTIFICATION_TYPES.includes(type as NotificationType)) {
            return ctx.badRequest('Укажите допустимый type (cashback, promotion, order, service)')
        }
        if (!title || !body) {
            return ctx.badRequest('Укажите title и body')
        }

        try {
            let targetDocumentIds: string[] = []
            let skipped = 0

            // documentId возвращается всегда независимо от fields — выбираем
            // самое лёгкое реальное поле, чтобы не тянуть лишние данные.
            if (audience === 'all') {
                const users = await strapi.documents('plugin::users-permissions.user').findMany({
                    fields: ['username'],
                })
                targetDocumentIds = users.map((u: any) => u.documentId)
            } else if (Array.isArray(audience) && audience.length > 0) {
                // Валидация против реальной таблицы пользователей — нельзя
                // просто передать произвольный id и получить запись без
                // существующего адресата.
                const users = await strapi.documents('plugin::users-permissions.user').findMany({
                    filters: { documentId: { $in: audience } },
                    fields: ['username'],
                })
                targetDocumentIds = users.map((u: any) => u.documentId)
                skipped = audience.length - targetDocumentIds.length
            } else {
                return ctx.badRequest('Укажите audience: "all" или непустой массив documentId пользователей')
            }

            await Promise.all(
                targetDocumentIds.map((userDocumentId) =>
                    createNotification({
                        userDocumentId,
                        type: type as NotificationType,
                        title,
                        body,
                        action,
                        entityId,
                        deepLink,
                    })
                )
            )

            return ctx.send({ created: targetDocumentIds.length, skipped })
        } catch (error: any) {
            strapi.log.error(`[notification.broadcast] ${error.message}`)
            return ctx.badRequest('Не удалось разослать уведомления')
        }
    },
}
