/**
 * cashback-request controller
 */

import { factories } from '@strapi/strapi'
import { updateUserBalance } from '../../../utils/calculate-user-balance'

export default factories.createCoreController(
    'api::cashback-request.cashback-request',
    ({ strapi }) => ({
        async request(ctx: any) {
            try {
                const requesterId = ctx.state.user.id
                const requesterDocumentId = ctx.state.user.documentId
                strapi.log.info(`User ${requesterId} is requesting a cashback withdrawal`)

                let { amount } = ctx.request.body as { amount: number | string }
                amount = typeof amount === 'string' ? Number(amount) : amount
                if (!amount || isNaN(amount)) {
                    throw new Error('Необходимо указать сумму кешбэка')
                }
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

                const updatedBalance = await updateUserBalance(requesterDocumentId)
                strapi.log.info(`Updated user balance: ${updatedBalance}`)

                const pendingRequests = await strapi
                    .documents('api::cashback-request.cashback-request')
                    .findMany({
                        filters: {
                            requester: requesterId,
                            verificationStatus: 'pending'
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

                const newRequest = await strapi
                    .documents('api::cashback-request.cashback-request')
                    .create({
                        data: {
                            requester: requesterId,
                            amount,
                            verificationStatus: 'pending'
                        }
                    })
                return ctx.created({
                    message:
                        'Запрос на кешбэк успешно создан и ожидает проверки',
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

        async me(ctx: any) {
            try {
                const userId = ctx.state.user.id
                strapi.log.info(`Fetching cashback requests for user ${userId}`)

                const requests = await strapi
                    .documents('api::cashback-request.cashback-request')
                    .findMany({
                        filters: {
                            requester: userId,
                        },
                        sort: ['createdAt:desc'],
                        // populate: ['requester'],
                    })

                strapi.log.info(`Found ${requests.length} requests for user ${userId}`)
                return ctx.send({ data: requests })
            } catch (error: any) {
                strapi.log.error(
                    `Error fetching cashback requests for user ${ctx.state.user.id}: ${error.message}`
                )
                return ctx.badRequest(
                    'Не удалось загрузить историю запросов на вывод'
                )
            }
        },
    })
)
