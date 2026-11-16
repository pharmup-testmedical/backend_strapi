/**
 * external-task controller
 */
import { factories } from '@strapi/strapi'

type WindowState = 'upcoming' | 'open' | 'closed'

const resolveWindowState = (startAt?: string | null, endAt?: string | null): WindowState => {
    const now = Date.now()
    if (startAt && now < new Date(startAt).getTime()) return 'upcoming'
    if (endAt && now > new Date(endAt).getTime()) return 'closed'
    return 'open'
}

export default factories.createCoreController(
    'api::external-task.external-task',
    ({ strapi }) => ({
        // Отдельный эндпоинт, а не стандартный find() с публичными правами —
        // нужны персональные для текущего пользователя поля (myStatus,
        // completedViaLegacy), которых в сырой модели нет и которые не
        // должны быть видны для чужих пользователей.
        async active(ctx: any) {
            try {
                const userDocumentId = ctx.state.user.documentId

                const tasks = await strapi.documents('api::external-task.external-task').findMany({
                    filters: { active: true },
                    sort: ['createdAt:desc'],
                    populate: ['image'],
                })

                const completions = await strapi.documents('api::completed-external-task.completed-external-task').findMany({
                    filters: { user: { documentId: { $eq: userDocumentId } } },
                    populate: ['externalTask'],
                })

                const legacyCompletedTasks = await strapi.documents('api::completed-task.completed-task').findMany({
                    filters: { user: { documentId: { $eq: userDocumentId } } },
                    fields: ['task'],
                })
                const legacyTaskTypes = new Set(legacyCompletedTasks.map((t: any) => t.task))

                const data = tasks.map((task: any) => {
                    const completion = completions.find((c: any) => c.externalTask?.documentId === task.documentId)
                    const completedViaLegacy = !!task.legacyCompletedTaskEquivalent && legacyTaskTypes.has(task.legacyCompletedTaskEquivalent)

                    return {
                        documentId: task.documentId,
                        title: task.title,
                        description: task.description,
                        image: task.image,
                        externalUrl: task.externalUrl,
                        rewardAmount: task.rewardAmount,
                        startAt: task.startAt,
                        endAt: task.endAt,
                        windowState: resolveWindowState(task.startAt, task.endAt),
                        myStatus: completedViaLegacy ? 'approved' : (completion?.status || null),
                        rejectionReason: completion?.status === 'rejected' ? completion.rejectionReason : null,
                        completedViaLegacy,
                    }
                })

                return ctx.send({ data })
            } catch (error: any) {
                strapi.log.error(`[external-task.active] ${error.message}`)
                return ctx.badRequest('Не удалось загрузить задания')
            }
        },
    })
)
