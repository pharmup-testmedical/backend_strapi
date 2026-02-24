import axios from 'axios'
import https from 'https'

export const isValidDate = (dateString: string): boolean => {
    return !isNaN(Date.parse(dateString))
}

export const parseReceiptByOfdType = async (
    qrData: string,
    ofdType: 'oofd' | 'kofd' | 'wofd',
    { strapi }: { strapi: any }
) => {
    switch (ofdType) {
        case 'oofd':
            return await parseOofdReceipt(qrData, { strapi })
        case 'kofd':
            return await parseKofdReceipt(qrData, { strapi })
        case 'wofd':
            return await parseWofdReceipt(qrData, { strapi })
        default:
            throw new Error(`Unsupported OFD type: ${ofdType}`)
    }
}

const parseOofdReceipt = async (qrLink: string, { strapi }: { strapi: any }) => {
    let apiUrl = qrLink

    if (!qrLink.startsWith('http')) {
        const params = qrLink.startsWith('?') ? qrLink : `?${qrLink}`
        apiUrl = `https://consumer.oofd.kz/api/consumer-proxy/api/tickets/get-by-url${params}`
    } else if (qrLink.includes('consumer.oofd.kz') && !qrLink.includes('/api/tickets/get-by-url')) {
        const urlObj = new URL(qrLink)
        const params = urlObj.search
        apiUrl = `https://consumer.oofd.kz/api/consumer-proxy/api/tickets/get-by-url${params}`
    }

    strapi.log.info(`[OOFD] Making request to: ${apiUrl}`)

    const httpsAgent = new https.Agent({
        rejectUnauthorized: false
    })

    try {
        const response = await axios.get(apiUrl, {
            httpsAgent,
            timeout: 10000,
            headers: {
                'Accept': 'application/json',
            }
        })

        let data
        try {
            data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data
        } catch (parseError: any) {
            strapi.log.error('[OOFD] JSON parse error:', parseError)
            throw new Error(`Invalid JSON response: ${parseError.message}`)
        }

        if (!data.ticket || !data.ticket.fiscalId) {
            strapi.log.warn(`Invalid API response: missing ticket or fiscalId for ${apiUrl}`)
            throw new Error('Invalid receipt data: fiscal ID not found')
        }

        const ticket = data.ticket

        const oofd_uid = ticket.transactionId
        if (!oofd_uid) {
            strapi.log.warn(`Invalid API response: missing transactionId for ${apiUrl}`)
            throw new Error('Invalid receipt data: transaction ID not found')
        }

        const fiscalId = ticket.fiscalId

        const date = new Date(ticket.transactionDate)
        if (isNaN(date.getTime())) {
            strapi.log.warn(`Invalid date format in API response: ${ticket.transactionDate}`)
            throw new Error('Invalid receipt data: date not found')
        }

        const totalAmount = ticket.totalSum
        if (typeof totalAmount !== 'number' || isNaN(totalAmount)) {
            strapi.log.warn(`Invalid total amount in API response: ${ticket.totalSum}`)
            throw new Error('Invalid receipt data: total amount not found')
        }

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
        }

        const kktCode = data.kkmFnsId
        const kktSerialNumber = data.kkmSerialNumber
        if (!kktCode || !kktSerialNumber) {
            strapi.log.warn(`Missing kktCode or kktSerialNumber in API response: ${JSON.stringify(data)}`)
            throw new Error('Invalid receipt data: kktCode or kktSerialNumber not found')
        }

        const paymentMethod = ticket.payments?.[0]?.paymentType || null

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

        if (items.length > 0) {
            const itemsTotal = items.reduce((sum: number, item: any) => sum + item.totalPrice, 0)
            if (itemsTotal !== totalAmount) {
                strapi.log.warn(`Total amount mismatch: items total (${itemsTotal}) does not match ticket total (${totalAmount})`)
                throw new Error('Invalid receipt data: sum of items totals does not match total amount')
            }
        }

        strapi.log.info(`Successfully parsed OOFD receipt data from ${apiUrl}`)

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
        strapi.log.error('[OOFD] Request error:', {
            message: error.message,
            url: apiUrl,
            response: error.response ? {
                status: error.response.status,
                data: error.response.data
            } : undefined
        })
        throw new Error(`OOFD request failed: ${error.message}`)
    }
}

const parseKofdReceipt = async (qrLink: string, { strapi }: { strapi: any }) => {
    try {
        let apiUrl = qrLink

        if (!qrLink.startsWith('http')) {
            const params = new URLSearchParams(qrLink.startsWith('?') ? qrLink.slice(1) : qrLink)
            const registrationNumber = params.get('f') || params.get('registrationNumber')
            const ticketNumber = params.get('i') || params.get('ticketNumber')

            if (registrationNumber && ticketNumber) {
                apiUrl = `https://cabinet.kofd.kz/api/tickets?registrationNumber=${registrationNumber}&ticketNumber=${ticketNumber}`
            } else {
                throw new Error('Missing required parameters: registrationNumber and ticketNumber')
            }
        } else if (qrLink.includes('consumer.kofd.kz')) {
            // Handle consumer.kofd.kz URLs
            const urlObj = new URL(qrLink)
            const i = urlObj.searchParams.get('i')
            const f = urlObj.searchParams.get('f')

            if (i && f) {
                apiUrl = `https://cabinet.kofd.kz/api/tickets?registrationNumber=${f}&ticketNumber=${i}`
            } else {
                throw new Error('Missing required parameters in consumer URL')
            }
        } else if (qrLink.includes('cabinet.kofd.kz/consumer')) {
            // Handle old format cabinet.kofd.kz/consumer URLs
            const urlObj = new URL(qrLink)
            const i = urlObj.searchParams.get('i')
            const f = urlObj.searchParams.get('f')

            if (i && f) {
                apiUrl = `https://cabinet.kofd.kz/api/tickets?registrationNumber=${f}&ticketNumber=${i}`
            } else {
                throw new Error('Missing required parameters in consumer URL')
            }
        }
        // If it's already a cabinet API URL, use it as-is

        strapi.log.info(`[KOFD] Making request to: ${apiUrl}`)

        const httpsAgent = new https.Agent({ rejectUnauthorized: false })
        const response = await axios.get(apiUrl, {
            httpsAgent,
            timeout: 10000,
            headers: { 'Accept': 'application/json' }
        })

        const data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data

        const receiptData = data.data || data

        if (!receiptData.found || receiptData.found === 0) {
            strapi.log.warn(`KOFD receipt not found: ${JSON.stringify(data).substring(0, 200)}`)
            throw new Error('Receipt not found in KOFD system')
        }

        return await parseKofdTextData(receiptData, apiUrl, strapi)
    } catch (error: any) {
        strapi.log.error('[KOFD] Error:', error)
        throw new Error(`KOFD parsing failed: ${error.message}`)
    }
}

const parseKofdTextData = async (data: any, apiUrl: string, strapi: any) => {
    const textLines = data.ticket.map((line: any) =>
        Buffer.from(line.text, 'utf8').toString()
    )

    const extractedData = extractDataFromKofdTextLines(textLines, strapi)

    let taxRate = extractedData.taxRate
    if (extractedData.taxAmount > 0 && extractedData.totalAmount > 0 && taxRate === 0) {
        taxRate = Math.round((extractedData.taxAmount / extractedData.totalAmount) * 10000) / 10000
    }

    return {
        fiscalId: extractedData.fiscalId,
        date: extractedData.date,
        totalAmount: extractedData.totalAmount,
        taxAmount: extractedData.taxAmount,
        taxRate: taxRate,
        kktCode: extractedData.kktCode,
        kktSerialNumber: extractedData.kktSerialNumber,
        paymentMethod: extractedData.paymentMethod,
        items: extractedData.items,
    }
}

const parseWofdReceipt = async (qrLink: string, { strapi }: { strapi: any }) => {
    try {
        let apiUrl = qrLink

        if (!qrLink.startsWith('http')) {
            const params = new URLSearchParams(qrLink.startsWith('?') ? qrLink.slice(1) : qrLink)
            const registrationNumber = params.get('f') || params.get('registrationNumber')
            const ticketNumber = params.get('i') || params.get('ticketNumber')

            if (registrationNumber && ticketNumber) {
                apiUrl = `https://cabinet.wofd.kz/api/tickets?registrationNumber=${registrationNumber}&ticketNumber=${ticketNumber}`
            } else {
                throw new Error('Missing required parameters: registrationNumber and ticketNumber')
            }
        } else if (qrLink.includes('consumer.wofd.kz')) {
            // Handle consumer.wofd.kz URLs
            const urlObj = new URL(qrLink)
            const i = urlObj.searchParams.get('i')
            const f = urlObj.searchParams.get('f')

            if (i && f) {
                apiUrl = `https://cabinet.wofd.kz/api/tickets?registrationNumber=${f}&ticketNumber=${i}`
            } else {
                throw new Error('Missing required parameters in consumer URL')
            }
        } else if (qrLink.includes('cabinet.wofd.kz/consumer')) {
            // Handle old format cabinet.wofd.kz/consumer URLs
            const urlObj = new URL(qrLink)
            const i = urlObj.searchParams.get('i')
            const f = urlObj.searchParams.get('f')

            if (i && f) {
                apiUrl = `https://cabinet.wofd.kz/api/tickets?registrationNumber=${f}&ticketNumber=${i}`
            } else {
                throw new Error('Missing required parameters in consumer URL')
            }
        }
        // If it's already a cabinet API URL, use it as-is

        strapi.log.info(`[WOFD] Making request to: ${apiUrl}`)

        const httpsAgent = new https.Agent({ rejectUnauthorized: false })
        const response = await axios.get(apiUrl, {
            httpsAgent,
            timeout: 10000,
            headers: { 'Accept': 'application/json' }
        })

        const data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data

        if (!data.found || data.found === 0) {
            throw new Error('Receipt not found in WOFD system')
        }

        return await parseWofdTextData(data, apiUrl, strapi)
    } catch (error: any) {
        strapi.log.error('[WOFD] Error:', error)
        throw new Error(`WOFD parsing failed: ${error.message}`)
    }
}

const parseWofdTextData = async (data: any, apiUrl: string, strapi: any) => {
    const textLines = data.ticket.map((line: any) =>
        Buffer.from(line.text, 'utf8').toString()
    )

    const extractedData = extractDataFromWofdTextLines(textLines, strapi)

    let taxRate = extractedData.taxRate
    if (extractedData.taxAmount > 0 && extractedData.totalAmount > 0 && taxRate === 0) {
        taxRate = Math.round((extractedData.taxAmount / extractedData.totalAmount) * 10000) / 10000
    }

    return {
        fiscalId: extractedData.fiscalId,
        date: extractedData.date,
        totalAmount: extractedData.totalAmount,
        taxAmount: extractedData.taxAmount,
        taxRate: taxRate,
        kktCode: extractedData.kktCode,
        kktSerialNumber: extractedData.kktSerialNumber,
        paymentMethod: extractedData.paymentMethod,
        items: extractedData.items,
    }
}

const extractDataFromKofdTextLines = (textLines: string[], strapi: any) => {
    const result: any = {
        fiscalId: '',
        date: null,
        totalAmount: 0,
        items: [],
        kktCode: '',
        kktSerialNumber: '',
        taxAmount: 0,
        taxRate: 0,
        paymentMethod: ''
    }

    let currentProductName = ''
    let collectingProductName = false

    for (let i = 0; i < textLines.length; i++) {
        const text = textLines[i].trim()

        if ((text.includes('ФИСКАЛДЫҚ БЕЛГІ') || text.includes('ФИСКАЛЬНЫЙ ПРИЗНАК')) && !result.fiscalId) {
            const fiscalMatch = text.match(/(\d{12})/)
            if (fiscalMatch) {
                result.fiscalId = fiscalMatch[1]
            }
        }

        if ((text.includes('УАҚЫТЫ') || text.includes('ВРЕМЯ')) && !result.date) {
            const dateMatch = text.match(/(\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}:\d{2})/)
            if (dateMatch) {
                const [day, month, year] = dateMatch[1].split(' ')[0].split('.')
                const time = dateMatch[1].split(' ')[1]
                result.date = new Date(`${year}-${month}-${day}T${time}`)
            }
        }

        if ((text.includes('БАРЛЫҒЫ') || text.includes('ИТОГО')) && result.totalAmount === 0) {
            let amountMatch = text.match(/([\d\s,]+)₸/)

            if (!amountMatch && i + 1 < textLines.length) {
                const nextLine = textLines[i + 1].trim()
                amountMatch = nextLine.match(/([\d\s,]+)₸/)
            }

            if (amountMatch) {
                const rawAmount = amountMatch[1].trim()
                const amount = parseKazakhNumber(rawAmount)
                if (!isNaN(amount)) {
                    result.totalAmount = Math.round(amount)
                }
            }
        }

        if ((text.includes('КЗН') || text.includes('ЗНМ')) && !result.kktSerialNumber) {
            const kkmMatch = text.match(/([A-Z0-9]{8,12})/)
            if (kkmMatch) {
                result.kktSerialNumber = kkmMatch[1]
            }
        }

        if ((text.includes('КТН') || text.includes('РНМ')) && !result.kktCode) {
            const kktMatch = text.match(/(\d{12})/)
            if (kktMatch) {
                result.kktCode = kktMatch[1]
            }
        }

        if (text.includes('Банковская карта') && !result.paymentMethod) {
            result.paymentMethod = 'CARD'
        } else if ((text.includes('Қолма-қол') || text.includes('Наличные')) && !result.paymentMethod) {
            result.paymentMethod = 'CASH'
        }

        // Detect product name lines - KOFD specific pattern
        const isProductStart = text.match(/^\d+\s+[A-ZА-Я]/) &&
            !text.includes('₸') &&
            !text.includes('(Штука)')

        if (isProductStart) {
            // Start new product name
            currentProductName = text
            collectingProductName = true
        }
        // Check if this is a continuation line (comes after a product name line but before price line)
        else if (collectingProductName &&
            !text.includes('₸') &&
            !text.includes('(Штука)') &&
            text.length > 0 &&
            !text.includes('ИТОГО') &&
            !text.includes('БАРЛЫҒЫ') &&
            !text.includes('ФИСКАЛДЫҚ') &&
            !text.includes('УАҚЫТЫ') &&
            !text.includes('Чектің') &&
            !text.includes('Ауысым') &&
            !text.includes('КАССИР') &&
            !text.includes('КЗН') &&
            !text.includes('КТН')) {

            // This is a continuation of the product name
            // Remove trailing spaces from current name and add the continuation
            currentProductName = currentProductName.replace(/\s+$/, '') + ' ' + text
        }

        // When we find a price line, finalize the current product
        if (text.includes('(Штука)') && text.includes('₸') && text.includes('=')) {
            const itemMatch = text.match(/(\d+)\s+\(Штука\)\s+x\s+([\d ,.]+)₸\s+=\s+([\d ,.]+)₸/)
            if (itemMatch && currentProductName) {
                const quantity = parseInt(itemMatch[1])
                const unitPrice = parseFloat(itemMatch[2].replace(',', '.'))
                const totalPrice = parseFloat(itemMatch[3].replace(',', '.'))

                if (!isNaN(quantity) && !isNaN(unitPrice) && !isNaN(totalPrice)) {
                    result.items.push({
                        name: currentProductName,
                        department: '1',
                        unitPrice: Math.round(unitPrice),
                        quantity: quantity,
                        measureUnit: 'штука',
                        totalPrice: Math.round(totalPrice)
                    })

                    currentProductName = ''
                    collectingProductName = false
                }
            }
        }
    }

    if (!result.date) throw new Error('Could not extract date from KOFD receipt')
    if (!result.fiscalId) throw new Error('Could not extract fiscal ID from KOFD receipt')
    if (result.totalAmount === 0) throw new Error('Could not extract total amount from KOFD receipt')
    if (result.items.length === 0) throw new Error('Could not extract items from KOFD receipt')


    strapi.log.info(`[KOFD] Extracted: ${result.items.length} items, total: ${result.totalAmount}`)

    return result
}

const extractDataFromWofdTextLines = (textLines: string[], strapi: any) => {
    const result: any = {
        fiscalId: '',
        date: null,
        totalAmount: 0,
        items: [],
        kktCode: '',
        kktSerialNumber: '',
        taxAmount: 0,
        taxRate: 0,
        paymentMethod: ''
    }

    let currentProductName = ''
    let collectingProductName = false

    for (let i = 0; i < textLines.length; i++) {
        const text = textLines[i].trim()

        if ((text.includes('Фискалдық белгі') || text.includes('Фискальный признак')) && !result.fiscalId) {
            const fiscalMatch = text.match(/(\d{12})/)
            if (fiscalMatch) {
                result.fiscalId = fiscalMatch[1]
            }
        }

        if ((text.includes('УАҚЫТЫ') || text.includes('ВРЕМЯ')) && !result.date) {
            const dateMatch = text.match(/(\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}:\d{2})/)
            if (dateMatch) {
                const [day, month, year] = dateMatch[1].split(' ')[0].split('.')
                const time = dateMatch[1].split(' ')[1]
                result.date = new Date(`${year}-${month}-${day}T${time}`)
            }
        }

        if ((text.includes('БАРЛЫҒЫ') || text.includes('ИТОГО')) && result.totalAmount === 0) {
            let amountMatch = text.match(/([\d\s,]+)₸/)

            if (!amountMatch && i + 1 < textLines.length) {
                const nextLine = textLines[i + 1].trim()
                amountMatch = nextLine.match(/([\d\s,]+)₸/)
            }

            if (amountMatch) {
                const rawAmount = amountMatch[1].trim()
                const amount = parseKazakhNumber(rawAmount)
                if (!isNaN(amount)) {
                    result.totalAmount = Math.round(amount)
                }
            }
        }

        if ((text.includes('КЗН') || text.includes('ЗНМ')) && !result.kktSerialNumber) {
            const kkmMatch = text.match(/([A-Z0-9]{8,12})/)
            if (kkmMatch) {
                result.kktSerialNumber = kkmMatch[1]
            }
        }

        if ((text.includes('КТН') || text.includes('РНМ')) && !result.kktCode) {
            const kktMatch = text.match(/(\d{12})/)
            if (kktMatch) {
                result.kktCode = kktMatch[1]
            }
        }

        if ((text.includes('ҚҚС жалпы сомасы') || text.includes('Общая сумма НДС')) && result.taxAmount === 0) {
            const taxMatch = text.match(/([\d\s,]+)\s*₸/)
            if (taxMatch) {
                const taxAmount = parseKazakhNumber(taxMatch[1].trim())
                if (!isNaN(taxAmount)) {
                    result.taxAmount = Math.round(taxAmount)
                }
            }
        }

        if (text.includes('Банковская карта') && !result.paymentMethod) {
            result.paymentMethod = 'CARD'
        } else if ((text.includes('Қолма-қол') || text.includes('Наличные')) && !result.paymentMethod) {
            result.paymentMethod = 'CASH'
        }

        // WOFD product name detection with multi-line support
        if (!text.includes('(Дана/Штука)') &&
            !text.includes('₸') &&
            !text.includes('ИТОГО') &&
            !text.includes('БАРЛЫҒЫ') &&
            !text.includes('Фискалдық') &&
            !text.includes('Фискальный') &&
            !text.includes('УАҚЫТЫ') &&
            !text.includes('ВРЕМЯ') &&
            !text.includes('Чектің') &&
            !text.includes('Ауысым') &&
            !text.includes('КАССИР') &&
            !text.includes('КЗН') &&
            !text.includes('КТН') &&
            !text.includes('Төленген') &&
            !text.includes('Қайтарым') &&
            !text.includes('Жеңілдік') &&
            !text.includes('үстеме') &&
            !text.includes('ҚҚС') &&
            text.length > 0) {
            
            // Check if next line is a price line
            if (i + 1 < textLines.length && textLines[i + 1].trim().includes('(Дана/Штука)')) {
                // This line starts a product name
                currentProductName = text
                collectingProductName = true
            } 
            // Check if we're currently collecting a product name and this line continues it
            else if (collectingProductName && 
                     i + 1 < textLines.length && 
                     !textLines[i + 1].trim().includes('(Дана/Штука)')) {
                // Continue the product name
                currentProductName = currentProductName.replace(/\s+$/, '') + ' ' + text
            }
        }

        if (text.includes('(Дана/Штука)') && text.includes('x') && text.includes('=')) {
            let itemMatch = text.match(/(\d+)\s+\([^)]+\)\s+x\s+([\d\s,]+)₸\s+=\s+([\d\s,]+)₸/)

            if (!itemMatch) {
                itemMatch = text.match(/(\d+)\s+\(.*?\)\s+x\s+([\d\s,]+)₸\s+=\s+([\d\s,]+)₸/)
            }

            if (itemMatch) {
                const quantity = parseInt(itemMatch[1])
                const unitPrice = parseKazakhNumber(itemMatch[2].trim())
                const totalPrice = parseKazakhNumber(itemMatch[3].trim())

                if (!isNaN(quantity) && !isNaN(unitPrice) && !isNaN(totalPrice)) {
                    if (!currentProductName) {
                        // If no product name was extracted, throw an error
                        throw new Error('Could not extract product name from WOFD receipt')
                    }
                    
                    result.items.push({
                        name: currentProductName,
                        department: '1',
                        unitPrice: Math.round(unitPrice),
                        quantity: quantity,
                        measureUnit: 'штука',
                        totalPrice: Math.round(totalPrice)
                    })
                    
                    currentProductName = ''
                    collectingProductName = false
                }
            }
        }
    }

    if (!result.date) throw new Error('Could not extract date from WOFD receipt')
    if (!result.fiscalId) throw new Error('Could not extract fiscal ID from WOFD receipt')
    if (result.totalAmount === 0) throw new Error('Could not extract total amount from WOFD receipt')
    if (result.items.length === 0) throw new Error('Could not extract items from WOFD receipt')

    strapi.log.info(`[WOFD] Extracted: ${result.items.length} items, total: ${result.totalAmount}`)

    return result
}

export const calculateFinalCashback = (items: any[]): number => {
    return items.reduce((total, item) => {
        if (
            item.__component === 'receipt-item.item' &&
            ['auto_verified_canon', 'auto_verified_alias', 'manually_verified_alias'].includes(item.verificationStatus)
        ) {
            const quantity = item.props?.quantity || 1
            return total + ((item.cashback || 0) * quantity)
        }
        return total
    }, 0)
}

const parseKazakhNumber = (numStr: string): number => {
    const cleaned = numStr.replace(/\s+/g, '').replace(',', '.')
    return parseFloat(cleaned)
}