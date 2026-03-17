import { createHash } from 'crypto'

/**
 * Generates a guaranteed unique referral code based on email
 * Format: [6 chars from email hash][user ID padded to 6 digits]
 * Example: A1B2C3D4E5F6000042
 * 
 * For new users (without ID yet), we use a temporary approach
 */
export async function generateUniqueReferralCode(email: string, existingUserId?: number): Promise<string> {

    // For existing users with ID, we can use the ID to guarantee uniqueness
    if (existingUserId) {
        // Create hash from email (first 10 chars of SHA-256)
        const emailHash = createHash('sha256')
            .update(email)
            .digest('hex')
            .substring(0, 10)
            .toUpperCase()

        // Pad user ID to 6 digits
        const userIdPadded = existingUserId.toString().padStart(6, '0')

        // Combine: HASH + ID (guarantees uniqueness because ID is unique)
        return `${emailHash}${userIdPadded}`
    }

    // For new users (no ID yet), we need a different approach
    // We'll use email hash + timestamp + random, and rely on DB unique constraint
    const emailHash = createHash('sha256')
        .update(email)
        .digest('hex')
        .substring(0, 8)
        .toUpperCase()

    const timestamp = Date.now().toString(36).substring(0, 4).toUpperCase()
    const random = Math.floor(1000 + Math.random() * 9000).toString()

    return `${emailHash}${timestamp}${random}`
}

/**
 * For new user creation - will retry if unique constraint fails
 */
export async function createUserWithReferralCode(userData: any): Promise<any> {
    let attempts = 0
    const maxAttempts = 5

    while (attempts < maxAttempts) {
        try {
            // Generate code without user ID
            const referralCode = await generateUniqueReferralCode(userData.email)

            // Try to create user with this code
            const user = await strapi.db.query('plugin::users-permissions.user').create({
                data: {
                    ...userData,
                    referralCode
                }
            })

            strapi.log.debug(`Created user ${user.id} with referral code ${referralCode}`)
            return user

        } catch (error: any) {
            // Check if it's a unique constraint violation
            if (error.code === 'ER_DUP_ENTRY' ||
                error.message?.includes('unique constraint') ||
                error.message?.includes('duplicate key')) {

                attempts++
                strapi.log.debug(`Referral code collision on attempt ${attempts}, retrying...`)

                if (attempts >= maxAttempts) {
                    // Final attempt with ultra-low-collision approach
                    const finalCode = `REF${Date.now()}${Math.random().toString(36).substring(2, 8)}`.toUpperCase()

                    return await strapi.db.query('plugin::users-permissions.user').create({
                        data: {
                            ...userData,
                            referralCode: finalCode
                        }
                    })
                }
            } else {
                // Some other error, rethrow
                throw error
            }
        }
    }

    throw new Error(`Failed to generate unique referral code after ${maxAttempts} attempts`)
}