import axios from 'axios'
import https from 'https'

export const isValidDate = (dateString: string): boolean => {
    return !isNaN(Date.parse(dateString))
}

// OFD APIs (oofd/kofd/wofd) are external government-adjacent services that
// occasionally respond slowly under load; a single timeout shouldn't fail
// the whole scan, so one retry is attempted before giving up.
const REQUEST_TIMEOUT_MS = 15000
const requestWithRetry = async (apiUrl: string, httpsAgent: https.Agent, strapi: any, logPrefix: string) => {
    try {
        return await axios.get(apiUrl, {
            httpsAgent,
            timeout: REQUEST_TIMEOUT_MS,
            headers: { 'Accept': 'application/json' },
        })
    } catch (error: any) {
        strapi.log.warn(`[${logPrefix}] Request failed, retrying once: ${error.message}`)
        return await axios.get(apiUrl, {
            httpsAgent,
            timeout: REQUEST_TIMEOUT_MS,
            headers: { 'Accept': 'application/json' },
        })
    }
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
        const response = await requestWithRetry(apiUrl, httpsAgent, strapi, 'OOFD')

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

        // OOFD represents a per-item discount as a separate synthetic entry
        // (commodity: null, its own `discount` object keyed by product name)
        // rather than as a field on the product entry itself. These aren't
        // real products and must not be treated as items; instead, their sum
        // needs to be netted against the matching product's total, since the
        // product entry's own `commodity.sum` is the pre-discount amount.
        const discountByName: Record<string, number> = {}
        for (const raw of ticket.items || []) {
            if (!raw.commodity && raw.discount?.name) {
                const key = raw.discount.name
                discountByName[key] = (discountByName[key] || 0) + (raw.discount.sum || 0)
            }
        }

        const items = ticket.items?.length
            ? ticket.items
                .filter((item: any) => item.commodity)
                .map((item: any, index: number) => {
                    const commodity = item.commodity || {}
                    const discount = discountByName[commodity.name] || 0
                    const itemData = {
                        name: commodity.name || `Unknown_${index + 1}`,
                        department: commodity.sectionCode || 'Unknown',
                        unitPrice: commodity.price || 0,
                        quantity: commodity.quantity || 1,
                        measureUnit: commodity.measureUnitCode
                            ? data.measureUnits?.[commodity.measureUnitCode] || 'unit'
                            : 'unit',
                        totalPrice: (commodity.sum || 0) - discount,
                        ntin: commodity.ntin || null,
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
            // TODO: OOFD присылает структурированный JSON, а не строки чека —
            // нужен реальный пример ответа, чтобы найти поле с названием и
            // адресом организации (в отличие от KOFD, где это первая строка
            // текста чека).
            organizationName: null,
            organizationBin: null,
            organizationAddress: null,
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
        const response = await requestWithRetry(apiUrl, httpsAgent, strapi, 'KOFD')

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
        organizationName: extractedData.organizationName,
        organizationBin: extractedData.organizationBin,
        organizationAddress: extractedData.organizationAddress,
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
        const response = await requestWithRetry(apiUrl, httpsAgent, strapi, 'WOFD')

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
        // WOFD пока без реального примера — поля не заполняются, чтобы не
        // угадывать формат.
        organizationName: null,
        organizationBin: null,
        organizationAddress: null,
    }
}

// Receipt printers wrap each line to a fixed character width and just cut
// text off wherever it runs out of room — there's no hyphen or other marker
// for a word broken mid-way (e.g. "...уровня глю" / "козы в крови" is really
// "...уровня глюкозы в крови"). Two signals distinguish a hard mid-word cut
// from a genuine word boundary:
//   1. If the continuation line has a leading space in its raw (untrimmed)
//      form, a space genuinely existed at the break — e.g. "...В ИНД УП  "
//      then " 100МЛ(Уп)" (note the leading space) really is "...УП 100МЛ".
//      This is the more reliable signal where it's available.
//   2. Otherwise, fall back to how much unused width the previous line had:
//      a line that used up (almost) its full width was cut off with no
//      room for a trailing space, so it's glued directly to the next line;
//      a line with more than a couple of characters to spare ended there
//      naturally (the next whole word just didn't fit) and keeps its space.
const MAX_TRAILING_SLACK_FOR_WRAP = 2

const wasLineFull = (rawLine: string): boolean =>
    rawLine.length - rawLine.trimEnd().length <= MAX_TRAILING_SLACK_FOR_WRAP

const hasLeadingSpace = (rawLine: string): boolean =>
    rawLine.length !== rawLine.trimStart().length

const joinWrappedNameLines = (
    lines: { text: string; wasFull: boolean; hasLeadingSpace: boolean }[]
): string =>
    lines
        .reduce((acc, line, idx) => {
            if (idx === 0) return line.text
            const glue = line.hasLeadingSpace
                ? ' '
                : lines[idx - 1].wasFull
                ? ''
                : ' '
            return acc + glue + line.text
        }, '')
        .trim()

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
        paymentMethod: '',
        // Название организации всегда печатается первой строкой чека
        // (например `ТОО "ALIP PHARM"`), БИН — следующей. Адрес точки
        // продажи в фискальные данные KOFD не попадает вообще — печатается
        // локально кассой, поэтому здесь его взять неоткуда.
        organizationName: null,
        organizationBin: null,
        organizationAddress: null,
    }

    // Lines that are not part of a product name (receipt metadata, separators,
    // price lines) reset this buffer; everything else accumulates into it until
    // a price line is reached, so multi-line product names are captured in full.
    let pendingNameLines: { text: string; wasFull: boolean; hasLeadingSpace: boolean }[] = []

    // "Маркировка" (product track-and-trace) codes print as a "M:[...]"
    // block that can span multiple lines of base64-like garbage before
    // closing with "]" — sometimes the closing "]" shares a line with the
    // tail end of the product name (e.g. "...hhvO2SYQ=]LIFE"). Everything
    // between "M:[" and "]" is stripped out of the name buffer entirely.
    let inMarkingBlock = false

    for (let i = 0; i < textLines.length; i++) {
        const rawLine = textLines[i]
        let text = rawLine.trim()
        const lineWasFull = wasLineFull(rawLine)
        const lineHasLeadingSpace = hasLeadingSpace(rawLine)

        if (inMarkingBlock) {
            const closeIdx = text.indexOf(']')
            if (closeIdx === -1) {
                continue
            }
            text = text.slice(closeIdx + 1).trim()
            inMarkingBlock = false
        } else if (text.startsWith('M:[')) {
            const closeIdx = text.indexOf(']')
            if (closeIdx === -1) {
                inMarkingBlock = true
                continue
            }
            text = text.slice(closeIdx + 1).trim()
        }

        if (!text) continue

        // Название организации — самая первая непустая строка чека, до
        // всех остальных полей (БИН, дата и т.д.).
        if (result.organizationName === null) {
            result.organizationName = text
        }

        if ((text.includes('БСН') || text.includes('БИН')) && !result.organizationBin) {
            const binMatch = text.match(/(\d{10,12})/)
            if (binMatch) {
                result.organizationBin = binMatch[1]
            }
        }

        if ((text.includes('ФИСКАЛДЫҚ БЕЛГІ') || text.includes('ФИСКАЛЬНЫЙ ПРИЗНАК')) && !result.fiscalId) {
            const fiscalMatch = text.match(/(\d{12,})/)
            if (fiscalMatch) {
                result.fiscalId = fiscalMatch[1]
            }
        }

        if ((text.includes('УАҚЫТЫ') || text.includes('ВРЕМЯ')) && !result.date) {
            // Day/month/hour are sometimes printed without a leading zero
            // (e.g. "16.07.2026 8:37:21"), so each component is 1-2 digits.
            // Date's constructor requires zero-padded ISO components, so
            // pad each piece back out before building the string, rather
            // than relying on the (unreliable/engine-dependent) parsing of
            // a non-padded "T8:37:21" time.
            const dateMatch = text.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{1,2}):(\d{1,2}):(\d{1,2})/)
            if (dateMatch) {
                const [, day, month, year, hour, minute, second] = dateMatch
                const pad = (n: string) => n.padStart(2, '0')
                result.date = new Date(
                    `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}`
                )
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

        // When we find a price line, finalize the product using everything
        // accumulated in the buffer since the previous item/boundary line.
        // Unit wording (Штука, Упаковка, etc.) varies by product/KKM, so the
        // check below only requires the surrounding "qty (unit) x ... = ..."
        // structure, not a specific unit word. Amounts of 1000+ are printed
        // with a non-breaking space (U+00A0) as the thousands separator, so
        // the digit/separator class uses \s (which matches NBSP), not a
        // literal space — otherwise any item priced >= 1000 silently fails
        // to match and gets dropped instead of parsed.
        if (/\(\S[^)]*\)\s*x\s*[\d\s,.]+₸\s*=\s*[\d\s,.]+₸/.test(text)) {
            const itemMatch = text.match(/(\d+)\s+\([^)]+\)\s+x\s+([\d\s,.]+)₸\s+=\s+([\d\s,.]+)₸/)
            const productName = joinWrappedNameLines(pendingNameLines)
            if (itemMatch && productName) {
                const quantity = parseInt(itemMatch[1])
                const unitPrice = parseKazakhNumber(itemMatch[2])
                const totalPrice = parseKazakhNumber(itemMatch[3])

                if (!isNaN(quantity) && !isNaN(unitPrice) && !isNaN(totalPrice)) {
                    result.items.push({
                        name: productName,
                        department: '1',
                        unitPrice: Math.round(unitPrice),
                        quantity: quantity,
                        measureUnit: 'штука',
                        totalPrice: Math.round(totalPrice),
                        ntin: null,
                    })
                }
            }
            pendingNameLines = []
            continue
        }

        // NTIN is printed on its own line *after* the item's price line (so
        // the item is already in result.items by the time we see it) — it
        // belongs to whichever item was most recently pushed.
        if (text.includes('NTIN')) {
            const ntinMatch = text.match(/NTIN:\s*(\d+)/)
            if (ntinMatch && result.items.length > 0) {
                result.items[result.items.length - 1].ntin = ntinMatch[1]
            }
        }

        // Any receipt metadata/separator line ends the current product name buffer.
        const isBoundaryLine =
            text.length === 0 ||
            text.includes('₸') ||
            text.includes('ИТОГО') ||
            text.includes('БАРЛЫҒЫ') ||
            text.includes('ФИСКАЛДЫҚ') ||
            text.includes('УАҚЫТЫ') ||
            text.includes('Чектің') ||
            text.includes('Ауысым') ||
            text.includes('КАССИР') ||
            text.includes('КЗН') ||
            text.includes('КТН') ||
            text.includes('GTIN') ||
            text.includes('NTIN') ||
            /^[*\-=_~]+$/.test(text)

        if (isBoundaryLine) {
            pendingNameLines = []
        } else {
            pendingNameLines.push({ text, wasFull: lineWasFull, hasLeadingSpace: lineHasLeadingSpace })
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

    // Lines that are not part of a product name (receipt metadata, separators,
    // price lines) reset this buffer; everything else accumulates into it until
    // a price line is reached, so multi-line product names are captured in full.
    let pendingNameLines: { text: string; wasFull: boolean; hasLeadingSpace: boolean }[] = []

    for (let i = 0; i < textLines.length; i++) {
        const rawLine = textLines[i]
        const text = rawLine.trim()
        const lineWasFull = wasLineFull(rawLine)
        const lineHasLeadingSpace = hasLeadingSpace(rawLine)

        if ((text.includes('Фискалдық белгі') || text.includes('Фискальный признак')) && !result.fiscalId) {
            const fiscalMatch = text.match(/(\d{12,})/)
            if (fiscalMatch) {
                result.fiscalId = fiscalMatch[1]
            }
        }

        if ((text.includes('УАҚЫТЫ') || text.includes('ВРЕМЯ')) && !result.date) {
            // Day/month/hour are sometimes printed without a leading zero
            // (e.g. "16.07.2026 8:37:21"), so each component is 1-2 digits.
            // Date's constructor requires zero-padded ISO components, so
            // pad each piece back out before building the string, rather
            // than relying on the (unreliable/engine-dependent) parsing of
            // a non-padded "T8:37:21" time.
            const dateMatch = text.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{1,2}):(\d{1,2}):(\d{1,2})/)
            if (dateMatch) {
                const [, day, month, year, hour, minute, second] = dateMatch
                const pad = (n: string) => n.padStart(2, '0')
                result.date = new Date(
                    `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}`
                )
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

        // Price line: quantity + any parenthesized unit (Штука, Дана/Штука,
        // Орама/Упаковка, etc. — the unit wording varies by product/KKM and
        // must not be hardcoded) + unit price + total price.
        const priceLineMatch = text.match(/(\d+)\s+\([^)]+\)\s+x\s+([\d\s,]+)₸\s+=\s+([\d\s,]+)₸/)

        if (priceLineMatch) {
            const productName = joinWrappedNameLines(pendingNameLines)
            if (productName) {
                const quantity = parseInt(priceLineMatch[1])
                const unitPrice = parseKazakhNumber(priceLineMatch[2].trim())
                const totalPrice = parseKazakhNumber(priceLineMatch[3].trim())

                if (!isNaN(quantity) && !isNaN(unitPrice) && !isNaN(totalPrice)) {
                    result.items.push({
                        name: productName,
                        department: '1',
                        unitPrice: Math.round(unitPrice),
                        quantity: quantity,
                        measureUnit: 'штука',
                        totalPrice: Math.round(totalPrice),
                        ntin: null,
                    })
                }
            }
            pendingNameLines = []
            continue
        }

        // NTIN is printed on its own line *after* the item's price line (so
        // the item is already in result.items by the time we see it) — it
        // belongs to whichever item was most recently pushed.
        if (text.includes('NTIN')) {
            const ntinMatch = text.match(/NTIN:\s*(\d+)/)
            if (ntinMatch && result.items.length > 0) {
                result.items[result.items.length - 1].ntin = ntinMatch[1]
            }
        }

        // Any receipt metadata/separator line ends the current product name buffer.
        const isBoundaryLine =
            text.length === 0 ||
            text.includes('₸') ||
            text.includes('ИТОГО') ||
            text.includes('БАРЛЫҒЫ') ||
            text.includes('Фискалдық') ||
            text.includes('Фискальный') ||
            text.includes('УАҚЫТЫ') ||
            text.includes('ВРЕМЯ') ||
            text.includes('Чектің') ||
            text.includes('Ауысым') ||
            text.includes('КАССИР') ||
            text.includes('КЗН') ||
            text.includes('КТН') ||
            text.includes('Төленген') ||
            text.includes('Қайтарым') ||
            text.includes('Жеңілдік') ||
            text.includes('үстеме') ||
            text.includes('ҚҚС') ||
            text.includes('GTIN') ||
            text.includes('NTIN') ||
            /^[*\-=_~]+$/.test(text)

        if (isBoundaryLine) {
            pendingNameLines = []
        } else {
            pendingNameLines.push({ text, wasFull: lineWasFull, hasLeadingSpace: lineHasLeadingSpace })
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
            ['auto_verified_canon', 'auto_verified_alias', 'auto_verified_ntin', 'manually_verified_alias'].includes(item.verificationStatus)
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

export const getRemainingDeclension = (count: number): string => {
    if (count % 10 === 1 && count % 100 !== 11) return 'а';
    if ([2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100)) return 'а';
    return 'ов';
}