/**
 * cashback-request controller
 */
import { factories } from '@strapi/strapi'
import { updateUserBalance } from '../../../utils/calculate-user-balance'

const WITHDRAWAL_COOLDOWN_MS = 60 * 1000

// Сериализует создание заявок на вывод по одному requesterDocumentId, чтобы
// проверка баланса и запись заявки не выполнялись параллельно для одного и
// того же пользователя (иначе два почти одновременных запроса могут оба
// пройти проверку доступного остатка ещё до того, как первый успеет
// сохраниться — гонка). Работает только в рамках одного Node-процесса,
// но бэкенд задеплоен как один процесс на Plesk, так что этого достаточно.
const userLocks = new Map<string, Promise<unknown>>()
const runExclusive = <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    const previous = userLocks.get(key) ?? Promise.resolve()
    const run = previous.then(fn, fn)
    userLocks.set(key, run.catch(() => {}))
    return run
}

export default factories.createCoreController(
    'api::cashback-request.cashback-request',
    ({ strapi }) => ({
        async request(ctx: any) {
            try {
                const requesterId = ctx.state.user.id
                const requesterDocumentId = ctx.state.user.documentId

                strapi.log.info(`User ${requesterId} is requesting a cashback withdrawal`)

                // === CITY CHECK ===
                const userCityCheck = await strapi
                    .documents('plugin::users-permissions.user')
                    .findOne({
                        documentId: requesterDocumentId,
                        populate: ['city'],
                        fields: ['otherCity'],
                    });

                const hasCityInfo = !!(userCityCheck?.city || userCityCheck?.otherCity?.trim());

                if (!hasCityInfo) {
                    return ctx.badRequest(
                        'Для вывода кешбэка необходимо указать город. Пожалуйста, заполните поле «Город» или «Другой город» в вашем профиле.'
                    );
                }

                // === IIN CHECK ===
                const userIinCheck = await strapi
                    .documents('plugin::users-permissions.user')
                    .findOne({
                        documentId: requesterDocumentId,
                        fields: ['iin'],
                    });

                const hasIin = !!(userIinCheck?.iin && userIinCheck.iin.trim() !== '');

                if (!hasIin) {
                    return ctx.badRequest(
                        'Для вывода кешбэка необходимо указать ИИН. Пожалуйста, заполните поле «ИИН» в вашем профиле.'
                    );
                }

                // ===================================================

                let { amount, payoutMethod, payoutDestination, comment } = ctx.request.body as {
                    amount: number | string
                    payoutMethod?: string
                    payoutDestination?: string
                    comment?: string
                }
                amount = typeof amount === 'string' ? Number(amount) : amount

                if (!amount || isNaN(amount)) {
                    throw new Error('Необходимо указать сумму кешбэка')
                }

                // === PAYOUT DESTINATION CHECK ===
                if (!['kaspi', 'card'].includes(payoutMethod)) {
                    throw new Error('Необходимо выбрать способ вывода средств')
                }

                const trimmedDestination = (payoutDestination || '').trim()
                const destinationDigits = trimmedDestination.replace(/\D/g, '')

                if (payoutMethod === 'kaspi' && destinationDigits.length < 10) {
                    throw new Error('Укажите корректный номер телефона Kaspi')
                }
                if (payoutMethod === 'card' && (destinationDigits.length < 13 || destinationDigits.length > 19)) {
                    throw new Error('Укажите корректный номер карты')
                }

                const trimmedComment = (comment || '').trim().slice(0, 500)

                strapi.log.info(`Requested cashback amount: ${amount}`)

                const websiteSetup = await strapi
                    .documents('api::website-setup.website-setup')
                    .findFirst({ populate: 'banking' })
                const minWithdrawAmount = websiteSetup?.banking?.minWithdrawAmount ?? 0
                strapi.log.info(`minWithdrawAmount loaded: ${minWithdrawAmount}`)
                if (amount < minWithdrawAmount) {
                    strapi.log.warn(
                        `Amount ${amount} < minWithdrawAmount ${minWithdrawAmount}`
                    )
                    throw new Error(
                        `Минимальная сумма для вывода кешбэка — ${minWithdrawAmount}₸`
                    )
                }

                // Проверка баланса и создание заявки выполняются в рамках одной
                // "блокировки" на requesterDocumentId, чтобы два почти
                // одновременных запроса от одного пользователя не прошли проверку
                // остатка параллельно (гонка).
                const newRequest = await runExclusive(requesterDocumentId, async () => {
                    const lastRequest = await strapi
                        .documents('api::cashback-request.cashback-request')
                        .findFirst({
                            filters: { requester: requesterId },
                            sort: ['createdAt:desc'],
                            fields: ['createdAt']
                        })
                    if (lastRequest && Date.now() - new Date(lastRequest.createdAt).getTime() < WITHDRAWAL_COOLDOWN_MS) {
                        strapi.log.warn(`User ${requesterId} tried to create a withdrawal request too soon after the previous one`)
                        throw new Error('Вы уже отправили заявку на вывод. Попробуйте отправить новую заявку позже.')
                    }

                    const updatedBalance = await updateUserBalance(requesterDocumentId)
                    strapi.log.info(`Updated user balance: ${updatedBalance}`)

                    // 'awaiting_payout' — админ уже проверил заявку и дал добро на
                    // начисление, но бухгалтер ещё не перевёл деньги (перейдёт в
                    // 'approved' только после фактической выплаты). Деньги должны
                    // оставаться зарезервированными весь этот период — иначе
                    // пользователь сможет запросить те же деньги повторно, пока
                    // первая заявка ждёт оплаты.
                    const pendingRequests = await strapi
                        .documents('api::cashback-request.cashback-request')
                        .findMany({
                            filters: {
                                requester: requesterId,
                                verificationStatus: { $in: ['pending', 'awaiting_payout'] }
                            },
                            fields: ['amount']
                        })
                    const pendingTotal = pendingRequests.reduce(
                        (sum: number, r: any) => sum + (r.amount || 0),
                        0
                    )
                    strapi.log.info(
                        `User has pending cashback amount total: ${pendingTotal}`
                    )

                    const availableForWithdrawal = updatedBalance - pendingTotal
                    if (amount > availableForWithdrawal) {
                        strapi.log.warn(
                            `Insufficient balance. Requested: ${amount}, available: ${availableForWithdrawal}`
                        )
                        throw new Error(
                            `Недостаточно средств: доступно только ${availableForWithdrawal}₸ с учетом ожидающих запросов`
                        )
                    }

                    return strapi
                        .documents('api::cashback-request.cashback-request')
                        .create({
                            data: {
                                requester: requesterId,
                                amount,
                                verificationStatus: 'pending',
                                payoutMethod: payoutMethod as 'kaspi' | 'card',
                                payoutDestination: trimmedDestination,
                                comment: trimmedComment || undefined
                            }
                        })
                })

                return ctx.created({
                    message: 'Запрос на кешбэк успешно создан и ожидает проверки',
                    cashbackRequest: newRequest
                })
            } catch (error: any) {
                strapi.log.error(
                    `Error requesting cashback for user ${ctx.state.user.id}: ${error.message}`
                )
                return ctx.badRequest(
                    error.message || 'Непредвиденная ошибка при запросе кешбэка'
                )
            }
        },

        // me method remains unchanged
        async me(ctx: any) {
            try {
                const userId = ctx.state.user.id

                const requests = await strapi
                    .documents('api::cashback-request.cashback-request')
                    .findMany({
                        filters: { requester: userId },
                        sort: ['createdAt:desc'],
                    })

                return ctx.send({ data: requests })
            } catch (error: any) {
                strapi.log.error(
                    `Error fetching cashback requests for user ${ctx.state.user.id}: ${error.message}`
                )
                return ctx.badRequest('Не удалось загрузить историю запросов на вывод')
            }
        },
    })
)