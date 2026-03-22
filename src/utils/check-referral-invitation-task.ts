import { updateUserBalance } from './calculate-user-balance'

interface UserWithReferrals {
    id: number
    documentId: string
    referredBy?: {
        id: number
        documentId: string
        email: string
    }
}

const VERIFIED_RECEIPT_STATUSES = [
    'auto_verified',
    'manually_verified',
    'auto_partially_verified',
    'manually_partially_verified'
]

/**
 * Check if a referred user has their first verified receipt and reward the inviter
 */
export async function checkReferralInvitationTask(userDocumentId: string): Promise<void> {
    strapi.log.info(`[ReferralTask] Checking invitation task for user ${userDocumentId}`)

    try {
        // Get the user with their inviter info
        const user = await strapi.db.query('plugin::users-permissions.user').findOne({
            where: { documentId: userDocumentId },
            populate: ['referredBy']
        }) as UserWithReferrals | null

        if (!user) {
            strapi.log.warn(`[ReferralTask] User ${userDocumentId} not found`)
            return
        }

        // Check if this user was referred by someone
        if (!user.referredBy) {
            strapi.log.debug(`[ReferralTask] User ${userDocumentId} was not referred by anyone`)
            return
        }

        const inviterDocumentId = user.referredBy.documentId
        strapi.log.debug(`[ReferralTask] User ${userDocumentId} was referred by ${inviterDocumentId}`)

        // Check if the inviter already completed this task
        const existingCompletion = await strapi.documents('api::completed-task.completed-task').findFirst({
            filters: {
                user: { documentId: { $eq: inviterDocumentId } },
                task: 'sendInvitations'
            }
        })

        if (existingCompletion) {
            strapi.log.debug(`[ReferralTask] Inviter ${inviterDocumentId} already completed invitation task`)
            return
        }

        // Get the tasks page configuration
        const tasksPage = await strapi.documents('api::tasks-page.tasks-page').findFirst({
            populate: ['sendInvitations']
        })

        const invitationTask = tasksPage?.sendInvitations

        if (!invitationTask?.active) {
            strapi.log.debug(`[ReferralTask] Invitation task is not active`)
            return
        }

        // Count how many active referrals the inviter has
        // An active referral = referred user with at least one verified receipt
        const referrals = await strapi.db.query('plugin::users-permissions.user').findMany({
            where: {
                referredBy: { id: user.referredBy.id }
            },
            populate: {
                receipts: {
                    where: {
                        verificationStatus: { $in: VERIFIED_RECEIPT_STATUSES }
                    },
                    limit: 1
                }
            }
        })

        const activeReferrals = referrals.filter(r => r.receipts && r.receipts.length > 0)

        strapi.log.debug(`[ReferralTask] Inviter ${inviterDocumentId} has ${activeReferrals.length} active referrals`)

        // Need at least one active referral to complete the task
        if (activeReferrals.length === 0) {
            strapi.log.debug(`[ReferralTask] Inviter ${inviterDocumentId} has no active referrals yet`)
            return
        }

        // Get the first active referral to store in details
        const qualifyingReferral = activeReferrals[0]

        // Create the completed task record
        await strapi.documents('api::completed-task.completed-task').create({
            data: {
                user: inviterDocumentId,
                task: 'sendInvitations',
                cashback: invitationTask.cashback,
                details: [{
                    __component: 'completed-tasks.priglashenie-kolleg',
                    invitedUser: qualifyingReferral.documentId
                }]
            }
        })

        strapi.log.info(`[ReferralTask] Inviter ${inviterDocumentId} completed invitation task → +${invitationTask.cashback} cashback`)

        // Recalculate inviter's balance
        await updateUserBalance(inviterDocumentId)

    } catch (error) {
        strapi.log.error(`[ReferralTask] Error checking invitation task for user ${userDocumentId}:`, error)
    }
}