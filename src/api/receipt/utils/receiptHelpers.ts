import axios from 'axios'
import https from 'https'

// Utility to validate date strings
export const isValidDate = (dateString: string): boolean => {
    return !isNaN(Date.parse(dateString))
}

// Parse receipt data from QR link (Strapi backend version)
export const parseReceiptData = async (qrLink: string, { strapi }: { strapi: any }) => {
    try {
        let apiUrl = qrLink;

        // If the input doesn't start with http, assume it's just parameters and construct full URL
        if (!qrLink.startsWith('http')) {
            // Ensure parameters start with ?
            const params = qrLink.startsWith('?') ? qrLink : `?${qrLink}`;
            apiUrl = `https://consumer.oofd.kz/api/tickets/get-by-url${params}`;
        }

        // Rest of your existing code...
        if (!apiUrl.includes('https://consumer.oofd.kz/api/tickets/get-by-url?')) {
            strapi.log.warn(`Invalid QR link format: ${qrLink}`);
            throw new Error('Ошибка в формате QR-кода');
        }

        strapi.log.info(`[Receipt] Making request to: ${apiUrl}`)

        // Add debug for SSL config
        const httpsAgent = new https.Agent({
            rejectUnauthorized: false
        })
        strapi.log.info('[Receipt] SSL agent configured')

        const response = await axios.get(apiUrl, {
            httpsAgent,
            timeout: 10000,
            headers: {
                'Accept': 'application/json',
            }
        })

        strapi.log.info(`[Receipt] Response status: ${response.status}`)
        strapi.log.info('[Receipt] Response headers:', JSON.stringify(response.headers))

        // Debug raw response before parsing
        strapi.log.info('[Receipt] Raw response data type:', typeof response.data)
        strapi.log.info('[Receipt] First 200 chars of response:',
            typeof response.data === 'string'
                ? response.data.substring(0, 200)
                : JSON.stringify(response.data).substring(0, 200))

        let data
        try {
            // Handle case where response.data might already be parsed
            data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data
            strapi.log.info('[Receipt] Successfully parsed JSON data')
        } catch (parseError) {
            strapi.log.error('[Receipt] JSON parse error:', parseError)
            strapi.log.error('[Receipt] Failed to parse:', response.data)
            throw new Error(`Invalid JSON response: ${parseError.message}`)
        }

        // Debug parsed data structure
        strapi.log.info('[Receipt] Parsed data keys:', Object.keys(data))
        if (data.ticket) {
            strapi.log.info('[Receipt] Ticket ID:', data.ticket.fiscalId || 'Not found')
        }

        // Validate response
        if (!data.ticket || !data.ticket.fiscalId) {
            strapi.log.warn(`Invalid API response: missing ticket or fiscalId for ${apiUrl}`)
            throw new Error('Invalid receipt data: fiscal ID not found')
        }

        const ticket = data.ticket

        // Extract oofd_uid
        const oofd_uid = ticket.transactionId
        if (!oofd_uid) {
            strapi.log.warn(`Invalid API response: missing transactionId for ${apiUrl}`)
            throw new Error('Invalid receipt data: transaction ID not found')
        }

        // Extract fiscal ID
        const fiscalId = ticket.fiscalId

        // Extract date
        const date = new Date(ticket.transactionDate)
        if (isNaN(date.getTime())) {
            strapi.log.warn(`Invalid date format in API response: ${ticket.transactionDate}`)
            throw new Error('Invalid receipt data: date not found')
        }

        // Extract total amount (keep in kopecks)
        const totalAmount = ticket.totalSum
        if (typeof totalAmount !== 'number' || isNaN(totalAmount)) {
            strapi.log.warn(`Invalid total amount in API response: ${ticket.totalSum}`)
            throw new Error('Invalid receipt data: total amount not found')
        }

        // Extract tax amount and tax rate from data.taxes (optional, keep in kopecks)
        const taxes = data.taxes || []
        let taxAmount = 0
        let taxRate = 0
        if (taxes.length > 0) {
            taxAmount = taxes.reduce((sum: number, tax: any) => sum + (tax.sum || 0), 0)
            taxRate = taxes[0]?.rate || 0
            if (typeof taxAmount !== 'number' || isNaN(taxAmount)) {
                strapi.log.warn(`Invalid tax amount in API response: ${JSON.stringify(taxes)}`)
                throw new Error('Invalid receipt data: tax amount not found')
            }
            if (typeof taxRate !== 'number' || isNaN(taxRate)) {
                strapi.log.warn(`Invalid tax rate in API response: ${JSON.stringify(taxes)}`)
                throw new Error('Invalid receipt data: tax rate not found')
            }
        } else {
            strapi.log.info(`[Receipt] No taxes found in API response for ${apiUrl}, proceeding with defaults`)
        }

        // Extract kktCode and kktSerialNumber
        const kktCode = data.kkmFnsId
        const kktSerialNumber = data.kkmSerialNumber
        if (!kktCode || !kktSerialNumber) {
            strapi.log.warn(`Missing kktCode or kktSerialNumber in API response: ${JSON.stringify(data)}`)
            throw new Error('Invalid receipt data: kktCode or kktSerialNumber not found')
        }

        // Extract paymentMethod (optional)
        const paymentMethod = ticket.payments?.[0]?.paymentType || null
        if (!ticket.payments?.[0]?.paymentType) {
            strapi.log.info(`[Receipt] No payment method found in API response for ${apiUrl}, setting to null`)
        }

        // Extract items (optional)
        const items = ticket.items?.length
            ? ticket.items
                .map((item: any, index: number) => {
                    const commodity = item.commodity || {}
                    const itemData = {
                        name: commodity.name || `Unknown_${index + 1}`,
                        department: commodity.sectionCode || 'Unknown',
                        unitPrice: commodity.price || 0,
                        quantity: commodity.quantity || 1,
                        measureUnit: commodity.measureUnitCode
                            ? data.measureUnits?.[commodity.measureUnitCode] || 'unit'
                            : 'unit',
                        totalPrice: commodity.sum || 0,
                    }
                    if (
                        !itemData.name ||
                        isNaN(itemData.unitPrice) ||
                        isNaN(itemData.quantity) ||
                        isNaN(itemData.totalPrice) ||
                        !itemData.measureUnit ||
                        !itemData.department
                    ) {
                        strapi.log.warn(`Invalid item at index ${index}: ${JSON.stringify(itemData)}`)
                        return null
                    }
                    return itemData
                })
                .filter((item: any) => item)
            : []

        if (items.length === 0) {
            strapi.log.info(`[Receipt] No valid items found in API response for ${apiUrl}, proceeding with empty items`)
        }

        // Validate totalAmount against sum of items.totalPrice (only if items exist)
        if (items.length > 0) {
            const itemsTotal = items.reduce((sum: number, item: any) => sum + item.totalPrice, 0)
            if (itemsTotal !== totalAmount) {
                strapi.log.warn(`Total amount mismatch: items total (${itemsTotal}) does not match ticket total (${totalAmount})`)
                throw new Error('Invalid receipt data: sum of items totals does not match total amount')
            }
        }

        // Log raw financial values for debugging
        strapi.log.info(`Raw financial values: totalSum=${ticket.totalSum}, taxSum=${taxes[0]?.sum || 0}, itemPrice=${items[0]?.unitPrice || 0}, itemSum=${items[0]?.totalPrice || 0}`)
        strapi.log.info(`Parsed items: ${JSON.stringify(items, null, 2)}`)
        strapi.log.info(`Successfully parsed receipt data from ${apiUrl}`)

        return {
            oofd_uid,
            fiscalId,
            date,
            totalAmount,
            taxAmount,
            taxRate,
            kktCode,
            kktSerialNumber,
            paymentMethod,
            items,
        }
    } catch (error: any) {
        strapi.log.error('[Receipt] Full error details:', {
            message: error.message,
            stack: error.stack,
            response: error.response ? {
                status: error.response.status,
                headers: error.response.headers,
                data: typeof error.response.data === 'object'
                    ? JSON.stringify(error.response.data)
                    : error.response.data
            } : undefined
        })
        throw error
    }
}

// Utility to calculate final cashback for a receipt
export const calculateFinalCashback = (items: any[]): number => {
    return items.reduce((total, item) => {
        if (
            item.__component === 'receipt-item.item' &&
            ['auto_verified_canon', 'auto_verified_alias', 'manually_verified_alias'].includes(item.verificationStatus)
        ) {
            return total + (item.cashback || 0)
        }
        return total
    }, 0)
}