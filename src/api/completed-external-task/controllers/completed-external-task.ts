/**
 * completed-external-task controller
 */
import { factories } from '@strapi/strapi'

// Тот же паттерн, что в cashback-request/controllers — сериализация по
// ключу в рамках одного Node-процесса достаточна, т.к. backend на Plesk
// задеплоен одним процессом. Защищает от двойного тапа/повторного запроса
// на отправку заявки по одному и тому же заданию.
const locks = new Map<string, Promise<unknown>>()
const runExclusive = <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    const previous = locks.get(key) ?? Promise.resolve()
    const run = previous.then(fn, fn)
    locks.set(key, run.catch(() => {}))
    return run
}

export default factories.createCoreController(
    'api::completed-external-task.completed-external-task',
    ({ strapi }) => ({
        async submit(ctx: any) {
            try {
                const userId = ctx.state.user.id
                const userDocumentId = ctx.state.user.documentId
                const { externalTaskDocumentId } = ctx.request.body || {}

                if (!externalTaskDocumentId) {
                    return ctx.badRequest('Не указано задание')
                }

                const files = ctx.request.files || {}
                const screenshotFile = Array.isArray(files.screenshot) ? files.screenshot[0] : files.screenshot
                if (!screenshotFile) {
                    return ctx.badRequest('Приложите скриншот подтверждения')
                }

                const task = await strapi.documents('api::external-task.external-task').findOne({
                    documentId: externalTaskDocumentId,
                })
                if (!task) {
                    return ctx.badRequest('Задание не найдено')
                }
                if (!task.active) {
                    return ctx.badRequest('Это задание сейчас недоступно')
                }

                const now = Date.now()
                if (task.startAt && now < new Date(task.startAt).getTime()) {
                    return ctx.badRequest('Это задание ещё не началось')
                }
                if (task.endAt && now > new Date(task.endAt).getTime()) {
                    return ctx.badRequest('Приём заявок по этому заданию завершён')
                }

                // Бонус уже начислен вручную через старый механизм
                // (completed-task) до выхода этого задания в сборке —
                // повторно через новое задание не начисляем.
                if (task.legacyCompletedTaskEquivalent) {
                    const legacyCompletion = await strapi.documents('api::completed-task.completed-task').findFirst({
                        filters: {
                            user: { documentId: { $eq: userDocumentId } },
                            // Поле на external-task — свободная строка (не enum),
                            // чтобы новые задания не требовали правки enum
                            // completed-task.task под каждый случай.
                            task: task.legacyCompletedTaskEquivalent as any,
                        },
                    })
                    if (legacyCompletion) {
                        return ctx.badRequest('Бонус за это задание вам уже начислен')
                    }
                }

                const lockKey = `${userDocumentId}:${task.documentId}`
                const result = await runExclusive(lockKey, async () => {
                    const existing = await strapi.documents('api::completed-external-task.completed-external-task').findFirst({
                        filters: {
                            user: { documentId: { $eq: userDocumentId } },
                            externalTask: { documentId: { $eq: task.documentId } },
                        },
                    })
                    if (existing) {
                        if (existing.status === 'rejected') {
                            throw new Error(
                                `Ваша предыдущая заявка по этому заданию отклонена${existing.rejectionReason ? `: ${existing.rejectionReason}` : ''}. Повторная отправка недоступна — обратитесь в поддержку.`
                            )
                        }
                        throw new Error('Вы уже отправляли заявку по этому заданию')
                    }

                    const uploadService = strapi.plugin('upload').service('upload')
                    const [screenshotUpload] = await uploadService.upload({ data: {}, files: screenshotFile })

                    return strapi.documents('api::completed-external-task.completed-external-task').create({
                        data: {
                            user: userId,
                            externalTask: task.documentId,
                            screenshot: screenshotUpload.id,
                            status: 'pending',
                            // Заморозка суммы на момент отправки — та же логика, что
                            // у item.cashback на чеке (см. задание Трека 2).
                            rewardAmountAtSubmission: task.rewardAmount,
                        },
                    })
                })

                return ctx.created({
                    message: 'Заявка отправлена и ожидает проверки',
                    completedExternalTask: result,
                })
            } catch (error: any) {
                strapi.log.error(`[completed-external-task.submit] ${error.message}`)
                return ctx.badRequest(error.message || 'Не удалось отправить заявку')
            }
        },

        async me(ctx: any) {
            try {
                const userDocumentId = ctx.state.user.documentId
                const completions = await strapi.documents('api::completed-external-task.completed-external-task').findMany({
                    filters: { user: { documentId: { $eq: userDocumentId } } },
                    sort: ['createdAt:desc'],
                    populate: ['externalTask'],
                })
                return ctx.send({ data: completions })
            } catch (error: any) {
                strapi.log.error(`[completed-external-task.me] ${error.message}`)
                return ctx.badRequest('Не удалось загрузить историю заявок')
            }
        },
    })
)
