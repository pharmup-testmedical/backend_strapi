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

        // URL transformation debug
        if (!apiUrl.includes('https://consumer.oofd.kz/api/tickets/get-by-url?')) {
            strapi.log.warn(`Invalid QR link format: ${qrLink}`);
            throw new Error('Ошибка в формате QR-кода');
        }

        strapi.log.info(`[Receipt] Making request to: ${apiUrl}`);

        // Add debug for SSL config
        const httpsAgent = new https.Agent({
            rejectUnauthorized: false
        });
        strapi.log.info('[Receipt] SSL agent configured');

        const response = await axios.get(apiUrl, {
            httpsAgent,
            timeout: 10000,
            headers: {
                'Accept': 'application/json',
            }
        });

        strapi.log.info(`[Receipt] Response status: ${response.status}`);
        strapi.log.info('[Receipt] Response headers:', JSON.stringify(response.headers));

        // Debug raw response before parsing
        strapi.log.info('[Receipt] Raw response data type:', typeof response.data);
        strapi.log.info('[Receipt] First 200 chars of response:',
            typeof response.data === 'string'
                ? response.data.substring(0, 200)
                : JSON.stringify(response.data).substring(0, 200));

        let data;
        try {
            // Handle case where response.data might already be parsed
            data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
            strapi.log.info('[Receipt] Successfully parsed JSON data');
        } catch (parseError) {
            strapi.log.error('[Receipt] JSON parse error:', parseError);
            strapi.log.error('[Receipt] Failed to parse:', response.data);
            throw new Error(`Invalid JSON response: ${parseError.message}`);
        }

        // Debug parsed data structure
        strapi.log.info('[Receipt] Parsed data keys:', Object.keys(data));
        if (data.ticket) {
            strapi.log.info('[Receipt] Ticket ID:', data.ticket.fiscalId || 'Not found');
        }

        // Validate response (rest of your existing validation logic remains the same)
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

        // Extract tax amount and tax rate from data.taxes (keep tax sum in kopecks)
        const taxes = data.taxes || []
        if (taxes.length === 0) {
            strapi.log.warn(`No taxes found in API response for ${apiUrl}`)
            throw new Error('Invalid receipt data: taxes not found')
        }
        const taxAmount = taxes.reduce((sum: number, tax: any) => sum + (tax.sum || 0), 0)
        const taxRate = taxes[0]?.rate || 0
        if (typeof taxAmount !== 'number' || isNaN(taxAmount)) {
            strapi.log.warn(`Invalid tax amount in API response: ${JSON.stringify(taxes)}`)
            throw new Error('Invalid receipt data: tax amount not found')
        }
        if (typeof taxRate !== 'number' || isNaN(taxRate)) {
            strapi.log.warn(`Invalid tax rate in API response: ${JSON.stringify(taxes)}`)
            throw new Error('Invalid receipt data: tax rate not found')
        }

        // Extract kktCode and kktSerialNumber
        const kktCode = data.kkmFnsId
        const kktSerialNumber = data.kkmSerialNumber
        if (!kktCode || !kktSerialNumber) {
            strapi.log.warn(`Missing kktCode or kktSerialNumber in API response: ${JSON.stringify(data)}`)
            throw new Error('Invalid receipt data: kktCode or kktSerialNumber not found')
        }

        // Extract paymentMethod
        const paymentMethod = ticket.payments?.[0]?.paymentType
        if (!paymentMethod) {
            strapi.log.warn(`Missing paymentMethod in API response: ${JSON.stringify(ticket.payments)}`)
            throw new Error('Invalid receipt data: payment method not found')
        }

        // Extract products
        const products = ticket.items
            .map((item: any, index: number) => {
                const commodity = item.commodity || {}
                const productData = {
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
                    !productData.name ||
                    isNaN(productData.unitPrice) ||
                    isNaN(productData.quantity) ||
                    isNaN(productData.totalPrice) ||
                    !productData.measureUnit ||
                    !productData.department
                ) {
                    strapi.log.warn(`Invalid product at index ${index}: ${JSON.stringify(productData)}`)
                    return null
                }
                return productData
            })
            .filter((item: any) => item)

        if (products.length === 0) {
            strapi.log.warn(`No valid products found in API response for ${apiUrl}`)
            throw new Error('Invalid receipt data: no products found')
        }

        // Validate totalAmount against sum of products' totalPrice
        const productsTotal = products.reduce((sum: number, product: any) => sum + product.totalPrice, 0)
        if (productsTotal !== totalAmount) {
            strapi.log.warn(`Total amount mismatch: products total (${productsTotal}) does not match ticket total (${totalAmount})`)
            throw new Error('Invalid receipt data: sum of product totals does not match total amount')
        }

        // Log raw financial values for debugging
        strapi.log.info(`Raw financial values: totalSum=${ticket.totalSum}, taxSum=${taxes[0]?.sum}, productPrice=${products[0]?.unitPrice}, productSum=${products[0]?.totalPrice}`)
        strapi.log.info(`Parsed products: ${JSON.stringify(products, null, 2)}`)
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
            products,
        };

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
        });
        throw error;
    }
};