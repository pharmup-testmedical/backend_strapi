import axios from 'axios';

// Utility to validate date strings
export const isValidDate = (dateString: string): boolean => {
    return !isNaN(Date.parse(dateString));
};

// Parse receipt data from QR link
export const parseReceiptData = async (qrLink: string, { strapi }: { strapi: any }) => {
    try {
        // Transform the URL if it's in the ticket format
        let apiUrl = qrLink;
        if (apiUrl.includes('/ticket/')) {
            apiUrl = apiUrl.replace('/ticket/', '/api/tickets/ticket/');
            strapi.log.debug(`Transformed API URL: ${apiUrl}`);
        }

        strapi.log.debug(`Calling API: ${apiUrl}`);
        const response = await axios.get(apiUrl);
        const data = response.data;
        strapi.log.debug(`API response: ${JSON.stringify(data, null, 2).slice(0, 50)}...`);

        // Validate response
        if (!data.ticket || !data.ticket.fiscalId) {
            strapi.log.warn(`Invalid API response: missing ticket or fiscalId for ${qrLink}`);
            throw new Error('Invalid receipt data: fiscal ID not found');
        }

        const ticket = data.ticket;

        // Extract oofd_uid
        const oofd_uid = ticket.transactionId;
        if (!oofd_uid) {
            strapi.log.warn(`Invalid API response: missing transactionId for ${qrLink}`);
            throw new Error('Invalid receipt data: transaction ID not found');
        }

        // Extract fiscal ID
        const fiscalId = ticket.fiscalId;

        // Extract date
        const date = new Date(ticket.transactionDate);
        if (isNaN(date.getTime())) {
            strapi.log.warn(`Invalid date format in API response: ${ticket.transactionDate}`);
            throw new Error('Invalid receipt data: date not found');
        }

        // Extract total amount
        const totalAmount = ticket.totalSum;
        if (typeof totalAmount !== 'number' || isNaN(totalAmount)) {
            strapi.log.warn(`Invalid total amount in API response: ${ticket.totalSum}`);
            throw new Error('Invalid receipt data: total amount not found');
        }

        // Extract tax amount and tax rate from data.taxes
        const taxes = data.taxes || [];
        if (taxes.length === 0) {
            strapi.log.warn(`No taxes found in API response for ${qrLink}`);
            throw new Error('Invalid receipt data: taxes not found');
        }
        const taxAmount = taxes.reduce((sum: number, tax: any) => sum + (tax.sum || 0), 0);
        const taxRate = taxes[0]?.rate || 0;
        if (typeof taxAmount !== 'number' || isNaN(taxAmount)) {
            strapi.log.warn(`Invalid tax amount in API response: ${JSON.stringify(taxes)}`);
            throw new Error('Invalid receipt data: tax amount not found');
        }
        if (typeof taxRate !== 'number' || isNaN(taxRate)) {
            strapi.log.warn(`Invalid tax rate in API response: ${JSON.stringify(taxes)}`);
            throw new Error('Invalid receipt data: tax rate not found');
        }

        // Extract kktCode and kktSerialNumber
        const kktCode = data.kkmFnsId;
        const kktSerialNumber = data.kkmSerialNumber;
        if (!kktCode || !kktSerialNumber) {
            strapi.log.warn(`Missing kktCode or kktSerialNumber in API response: ${JSON.stringify(data)}`);
            throw new Error('Invalid receipt data: kktCode or kktSerialNumber not found');
        }

        // Extract paymentMethod
        const paymentMethod = ticket.payments?.[0]?.paymentType;
        if (!paymentMethod) {
            strapi.log.warn(`Missing paymentMethod in API response: ${JSON.stringify(ticket.payments)}`);
            throw new Error('Invalid receipt data: payment method not found');
        }

        // Extract products
        const products = ticket.items
            .map((item: any, index: number) => {
                const commodity = item.commodity || {};
                const productData = {
                    name: commodity.name || `Unknown_${index + 1}`,
                    department: commodity.sectionCode || 'Unknown',
                    unitPrice: (commodity.price || 0) / 100,
                    quantity: commodity.quantity || 1,
                    measureUnit: commodity.measureUnitCode
                        ? data.measureUnits?.[commodity.measureUnitCode] || 'unit'
                        : 'unit',
                    totalPrice: (commodity.sum || 0) / 100,
                };
                if (
                    !productData.name ||
                    isNaN(productData.unitPrice) ||
                    isNaN(productData.quantity) ||
                    isNaN(productData.totalPrice)
                ) {
                    strapi.log.warn(`Invalid product at index ${index}: ${JSON.stringify(productData)}`);
                    return null;
                }
                return productData;
            })
            .filter((item: any) => item);

        if (products.length === 0) {
            strapi.log.warn(`No valid products found in API response for ${qrLink}`);
            throw new Error('Invalid receipt data: no products found');
        }
        strapi.log.debug(`Parsed products: ${JSON.stringify(products)}`);

        strapi.log.info(`Parsed receipt data from ${qrLink}`);
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
        strapi.log.error(`Failed to parse receipt from ${qrLink}: ${error.message}`);
        throw error;
    }
};