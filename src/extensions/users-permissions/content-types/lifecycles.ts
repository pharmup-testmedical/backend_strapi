import { generateUniqueReferralCode } from '../../../utils/generate-referral-code'

export default {
    async afterCreate(event) {
        const { result } = event

        // Generate referral code for the new user
        try {
            // Now we have both email AND user ID - perfect for guaranteed uniqueness
            const referralCode = await generateUniqueReferralCode(result.email, result.id)

            // Update the user with the generated code
            await strapi.db.query('plugin::users-permissions.user').update({
                where: { id: result.id },
                data: { referralCode }
            })

            strapi.log.debug(`Set referral code ${referralCode} for new user ${result.id}`)

            // Update the result object so it's returned in the API response
            result.referralCode = referralCode

        } catch (error) {
            strapi.log.error(`Failed to set referral code for user ${result.id}:`, error)

            // Ultimate fallback - user ID guarantees uniqueness here too
            const fallbackCode = `USER${result.id}${Date.now().toString().slice(-4)}`.toUpperCase()

            await strapi.db.query('plugin::users-permissions.user').update({
                where: { id: result.id },
                data: { referralCode: fallbackCode }
            })

            result.referralCode = fallbackCode
        }
    },

    async beforeUpdate(event) {
        const { data, where } = event.params

        // If email is being updated, regenerate referral code
        if (data.email) {
            const currentUser = await strapi.db.query('plugin::users-permissions.user').findOne({
                where: { id: where.id }
            })

            if (currentUser && currentUser.email !== data.email) {
                const newCode = await generateUniqueReferralCode(data.email, currentUser.id)
                data.referralCode = newCode
                strapi.log.debug(`Regenerated referral code for user ${currentUser.id} due to email change`)
            }
        }
    }
}
