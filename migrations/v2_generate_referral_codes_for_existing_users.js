const crypto = require('crypto')

/**
 * Migration to generate unique referral codes for all existing users
 * Uses user ID in the code to guarantee uniqueness
 */
module.exports = async () => {
    strapi.log.info('🚀 Starting migration: Generate referral codes for existing users')

    try {
        // Find all users without a referral code
        const usersWithoutCode = await strapi.db.query('plugin::users-permissions.user').findMany({
            where: {
                referralCode: {
                    $null: true
                }
            },
            select: ['id', 'email', 'username'],
            orderBy: { id: 'asc' }
        })

        strapi.log.info(`📊 Found ${usersWithoutCode.length} users without referral codes`)

        if (usersWithoutCode.length === 0) {
            strapi.log.info('✅ No users need referral codes, migration complete')
            return
        }

        let successCount = 0
        let errorCount = 0
        const errors = []

        // Process in batches
        const batchSize = 100
        for (let i = 0; i < usersWithoutCode.length; i += batchSize) {
            const batch = usersWithoutCode.slice(i, i + batchSize)

            strapi.log.info(`🔄 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(usersWithoutCode.length / batchSize)}`)

            // Process each user in the batch
            for (const user of batch) {
                try {
                    // Generate code based on email hash + user ID (guarantees uniqueness)
                    const emailHash = crypto
                        .createHash('sha256')
                        .update(user.email)
                        .digest('hex')
                        .substring(0, 10)
                        .toUpperCase()

                    // Pad user ID to 6 digits
                    const userIdPadded = user.id.toString().padStart(6, '0')

                    // Format: HASH(10 chars) + ID(6 digits) = 16 chars total
                    const referralCode = `${emailHash}${userIdPadded}`

                    // Update the user
                    await strapi.db.query('plugin::users-permissions.user').update({
                        where: { id: user.id },
                        data: { referralCode }
                    })

                    successCount++

                    // Log every 50th user to show progress
                    if (successCount % 50 === 0) {
                        strapi.log.info(`   Progress: ${successCount}/${usersWithoutCode.length} users updated`)
                    }

                } catch (error) {
                    errorCount++
                    errors.push({
                        id: user.id,
                        email: user.email,
                        error: error.message || 'Unknown error'
                    })

                    strapi.log.error(`❌ Failed for user ${user.id} (${user.email}):`, error.message)

                    // Try fallback for this user
                    try {
                        const fallbackCode = `FALLBACK${user.id}${Date.now().toString().slice(-4)}`.toUpperCase()

                        await strapi.db.query('plugin::users-permissions.user').update({
                            where: { id: user.id },
                            data: { referralCode: fallbackCode }
                        })

                        strapi.log.warn(`   Used fallback code for user ${user.id}`)
                        successCount++ // Count as success after fallback
                        errorCount-- // Adjust counts

                    } catch (fallbackError) {
                        strapi.log.error(`   Even fallback failed for user ${user.id}:`, fallbackError)
                    }
                }
            }

            // Small delay between batches to avoid overwhelming the database
            if (i + batchSize < usersWithoutCode.length) {
                await new Promise(resolve => setTimeout(resolve, 100))
            }
        }

        // Final report
        strapi.log.info('\n📋 Migration Summary:')
        strapi.log.info(`   ✅ Successfully updated: ${successCount} users`)
        strapi.log.info(`   ❌ Failed: ${errorCount} users`)

        if (errors.length > 0) {
            strapi.log.info('\n❌ Errors details:')
            errors.forEach(err => {
                strapi.log.info(`   - User ${err.id} (${err.email}): ${err.error}`)
            })
        }

        // Verify all users now have codes
        const remainingUsers = await strapi.db.query('plugin::users-permissions.user').count({
            where: {
                referralCode: {
                    $null: true
                }
            }
        })

        if (remainingUsers > 0) {
            strapi.log.warn(`\n⚠️  After migration, ${remainingUsers} users still don't have referral codes`)
        } else {
            strapi.log.info('\n✅ All users now have unique referral codes!')
        }

    } catch (error) {
        strapi.log.error('💥 Migration failed:', error)
        throw error
    }
}