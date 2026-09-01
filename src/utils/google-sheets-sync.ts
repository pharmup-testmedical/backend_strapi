import fs from 'fs'
import { google } from 'googleapis'
import { deriveCityAndAddress } from './kz-city-clusters'

const SPREADSHEET_ID = process.env.RECEIPTS_SHEET_ID
const SHEET_NAME = process.env.RECEIPTS_SHEET_NAME || 'Лист1'

// Plesk's custom environment variable UI caps values at 255 characters,
// while an RSA private key is ~1700+ — so the primary path is a JSON key
// file on disk (GOOGLE_SHEETS_CREDENTIALS_PATH); the separate CLIENT_EMAIL/
// PRIVATE_KEY vars remain as a fallback for hosts without that limit.
const resolveCredentials = (): { email?: string; key?: string; error?: string } => {
    const credentialsPath = process.env.GOOGLE_SHEETS_CREDENTIALS_PATH
    if (credentialsPath) {
        try {
            const file = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'))
            if (!file.client_email || !file.private_key) {
                return { error: `Файл ${credentialsPath} не содержит client_email/private_key` }
            }
            return { email: file.client_email, key: file.private_key }
        } catch (error: any) {
            return { error: `Не удалось прочитать GOOGLE_SHEETS_CREDENTIALS_PATH (${credentialsPath}): ${error.message}` }
        }
    }
    const email = process.env.GOOGLE_SHEETS_CLIENT_EMAIL
    const key = process.env.GOOGLE_SHEETS_PRIVATE_KEY?.replace(/\\n/g, '\n')
    if (!email || !key) {
        return { error: 'Не заданы ни GOOGLE_SHEETS_CREDENTIALS_PATH, ни пара GOOGLE_SHEETS_CLIENT_EMAIL/GOOGLE_SHEETS_PRIVATE_KEY' }
    }
    return { email, key }
}

let sheetsClient: ReturnType<typeof google.sheets> | null = null
const getSheetsClient = () => {
    if (!sheetsClient) {
        const { email, key } = resolveCredentials()
        const auth = new google.auth.JWT({
            email,
            key,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        })
        sheetsClient = google.sheets({ version: 'v4', auth })
    }
    return sheetsClient
}

const pad2 = (n: number) => String(n).padStart(2, '0')
const formatDate = (date: Date) => `${pad2(date.getDate())}.${pad2(date.getMonth() + 1)}.${date.getFullYear()}`
const formatTime = (date: Date) => `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
const formatScannedAt = (date: Date) =>
    `${formatDate(date)} г. ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
const formatMonthYear = (date: Date) => `${pad2(date.getMonth() + 1)}.${date.getFullYear()}`

// НДС в источнике хранится как доля (0.05 = 5%) — в таблице нужен процент.
const formatPercent = (rate: number | null): string => (rate === null || rate === undefined ? '' : String(Math.round(rate * 10000) / 100))

// Google Sheets при valueInputOption: USER_ENTERED сам определяет тип
// значения — строка из одних цифр (РНМ, БИН/ИИН, NTIN, GTIN) молча
// превращается в число и теряет ведущие нули. Ведущий апостроф — тот же
// приём, что и при ручном вводе в таблицу, — принудительно фиксирует
// текстовый формат именно для этой ячейки, не трогая остальные
// (числовые) колонки строки.
const asText = (value: string | null | undefined): string => (value ? `'${value}` : '')

interface ReceiptRowArgs {
    receipt: any
    receiptData: {
        organizationName?: string | null
        organizationBin?: string | null
        organizationAddress?: string | null
        items: any[]
    }
    // Позиции чека, ОБЯЗАТЕЛЬНО заполненные заранее (populate) —
    // claimedProduct (+ вложенная category), productAlias, props. Просто
    // {documentId}-заглушка вместо полноценной связи (как приходит в
    // памяти прямо из обработки чека до сохранения) сюда не годится —
    // значения "Категория"/"Псевдоним" молча окажутся пустыми.
    finalItems: any[]
    platform: string | null
    appVersion: string | null
    consumerUrl: string
    userEmail?: string | null
}

// Собирает строки таблицы для одного чека — по одной строке на позицию.
// Не делает сетевых вызовов, поэтому используется и для мгновенной
// синхронизации нового чека, и для пакетного бэкфилла старых.
export const buildReceiptRows = ({
    receipt,
    receiptData,
    finalItems,
    platform,
    appVersion,
    consumerUrl,
    userEmail,
}: ReceiptRowArgs): any[][] => {
    const date = receipt.date instanceof Date ? receipt.date : new Date(receipt.date)
    // Момент, когда чек реально попал в систему (сканирование в приложении)
    // — отдельная величина от даты самой покупки на чеке (`date` выше).
    const scannedAt = receipt.createdAt ? new Date(receipt.createdAt) : null
    const { city, address } = deriveCityAndAddress(receiptData.organizationAddress)
    const rawItems = receiptData.items || []

    return finalItems.map((item: any, index: number) => {
        const raw = rawItems[index] || {}
        const isCashbackItem = item.__component === 'receipt-item.item'
        const claimedProduct = isCashbackItem ? item.claimedProduct : null

        return [
            receipt.id,
            scannedAt ? formatScannedAt(scannedAt) : '',
            formatDate(date),
            formatTime(date),
            receipt.verificationStatus,
            isCashbackItem ? item.verificationStatus : 'Сторонняя позиция',
            receipt.fiscalId,
            asText(receipt.kktCode),
            receipt.kktSerialNumber,
            userEmail || '',
            receipt.ofdType,
            receiptData.organizationName || '',
            asText(receiptData.organizationBin),
            city,
            address,
            asText(raw.ntin),
            asText(raw.gtin),
            claimedProduct?.category?.name || '',
            item.name,
            claimedProduct?.canonicalName || '',
            item.productAlias?.alternativeName || '',
            item.props?.quantity ?? '',
            item.props?.measureUnit ?? '',
            item.props?.unitPrice ?? '',
            raw.itemTaxAmount ?? '',
            formatPercent(raw.itemTaxRate),
            raw.discount || '',
            receipt.totalAmount,
            isCashbackItem ? 'TRUE' : 'FALSE',
            isCashbackItem ? item.cashback : '',
            isCashbackItem ? (item.cashback || 0) * (item.props?.quantity ?? 1) : '',
            // Итоговый кешбэк — сумма ПО ВСЕМУ ЧЕКУ (finalCashback), а не по
            // позиции — повторяется на каждой строке чека, включая строки
            // сторонних позиций (не привязано к isCashbackItem, в отличие
            // от двух колонок выше).
            receipt.finalCashback ?? '',
            receipt.paymentMethod,
            platform || '',
            asText(appVersion),
            consumerUrl,
            formatMonthYear(date),
        ]
    })
}

// Пишет уже готовые строки одним (или несколькими, если строк много) запросом
// к Sheets API. Общая точка выхода в сеть для одиночной синхронизации и бэкфилла.
export const appendRowsToSheet = async (rows: any[][], strapi: any): Promise<{ ok: boolean; error?: string }> => {
    const { email, key, error: credentialsError } = resolveCredentials()
    if (!SPREADSHEET_ID) {
        return { ok: false, error: 'Не задан RECEIPTS_SHEET_ID' }
    }
    if (!email || !key) {
        return { ok: false, error: credentialsError }
    }
    if (rows.length === 0) return { ok: true }

    const sheets = getSheetsClient()
    await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A:A`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: rows },
    })
    return { ok: true }
}

// Populate для позиций чека, общий для мгновенной синхронизации и
// бэкфилла — держим в одном месте, чтобы оба пути отдавали в таблицу
// одинаково полные данные (category/productAlias), а не расходились.
export const RECEIPT_ITEMS_POPULATE = {
    on: {
        'receipt-item.item': {
            populate: {
                claimedProduct: { populate: { category: true } },
                productAlias: true,
                props: true,
            },
        },
        'receipt-item.product-claim': { populate: { props: true } },
    },
}

// Записывает по одной строке в Google Таблицу на каждую позицию чека —
// не блокирует отправку чека, если недоступны учётные данные Google Sheets
// или сама запись не удалась (аналогично письму администратору).
//
// Позиции чека (claimedProduct/category, productAlias) в момент отправки
// в памяти ещё не populate'ны (`item.productAlias` — это `{documentId}`,
// без alternativeName) — перезапрашиваем чек из БД тем же populate'ом,
// что и бэкфилл, вместо того чтобы полагаться на форму, в которой чек
// пришёл сюда из контроллера.
export const syncReceiptToSheet = async (
    args: Omit<ReceiptRowArgs, 'finalItems'> & { strapi: any }
) => {
    const { receipt, strapi } = args
    try {
        const fullReceipt = await strapi.documents('api::receipt.receipt').findOne({
            documentId: receipt.documentId,
            populate: { items: RECEIPT_ITEMS_POPULATE },
        })
        const rows = buildReceiptRows({ ...args, receipt: fullReceipt, finalItems: fullReceipt.items || [] })
        const result = await appendRowsToSheet(rows, strapi)
        if (!result.ok) {
            strapi.log.debug(`[GoogleSheets] Синхронизация пропущена: ${result.error}`)
            return
        }
        strapi.log.info(`[GoogleSheets] Записано ${rows.length} строк(и) для чека ${receipt.fiscalId}`)
    } catch (error: any) {
        strapi.log.error(`[GoogleSheets] Ошибка синхронизации чека ${receipt.fiscalId}: ${error.message}`)
    }
}
