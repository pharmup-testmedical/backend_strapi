interface ReceiptItem {
    id: number
    cashback?: number
    claimedProduct?: any
    productAlias?: any
    __component: string
    verificationStatus?: string
}

interface Receipt {
    id: number
    documentId: string
    user?: { documentId: string }
    verificationStatus: string
    items?: ReceiptItem[]
    finalCashback?: number
}

interface CashbackRequest {
    id: number
    documentId: string
    requester?: { documentId: string }
    verificationStatus: string
    amount: number
}

// Define your status types first
type ReceiptVerificationStatus =
    'manual_review' |
    'auto_verified' |
    'auto_rejected' |
    'manually_verified' |
    'manually_rejected' |
    'auto_rejected_late_submission' |
    'auto_partially_verified' |
    'manually_partially_verified';

type CashbackRequestStatus =
    'pending' |
    'approved' |
    'rejected' |
    'manual_review';

type ItemVerificationStatus =
    'manual_review' |
    'auto_verified_canon' |
    'auto_verified_alias' |
    'manually_verified_alias' |
    'auto_rejected_alias' |
    'manually_rejected_alias';

// Update your constants with proper typing
const VERIFIED_RECEIPT_STATUSES: ReceiptVerificationStatus[] = [
    'auto_verified',
    'manually_verified',
    'auto_partially_verified',
    'manually_partially_verified'
];

const APPROVED_REQUEST_STATUSES: CashbackRequestStatus[] = ['approved'];

const QUALIFYING_ITEM_STATUSES: ItemVerificationStatus[] = [
    'auto_verified_canon',
    'auto_verified_alias',
    'manually_verified_alias'
];

// Update your interfaces to match Strapi's expected types
interface UserFilter {
    id?: { $eq?: number };
    // For users-permissions plugin, use 'id' instead of 'documentId'
}

interface ReceiptFilter {
    user?: { id?: { $eq?: string } };
    verificationStatus?: { $in?: ReceiptVerificationStatus[] };
}

interface CashbackRequestFilter {
    requester?: { id?: { $eq?: string } };
    verificationStatus?: { $in?: CashbackRequestStatus[] };
}

export async function calculateUserBalance(userDocumentId: string): Promise<number> {
    strapi.log.info(`[Balance] Starting balance calculation for user ${userDocumentId}`);

    // Get all receipts that might contribute to balance
    const receipts = await strapi.documents('api::receipt.receipt').findMany({
        filters: {
            user: { documentId: { $eq: userDocumentId } }, // Fixed: Removed nested filters
            verificationStatus: { $in: VERIFIED_RECEIPT_STATUSES }
        },
        populate: {
            items: {
                on: {
                    'receipt-item.item': {
                        fields: ['cashback', 'verificationStatus']
                    },
                    'receipt-item.product-claim': true
                }
            }
        }
    }) as Receipt[];

    // Calculate cashback from receipts (same as before)
    const totalVerifiedCashback = receipts.reduce((userSum, receipt) => {
        // For fully verified receipts, we can use the finalCashback if available
        if (receipt.verificationStatus === 'auto_verified' || receipt.verificationStatus === 'manually_verified') {
            const receiptCashback = receipt.finalCashback || 0
            strapi.log.debug(`[Balance] Fully verified receipt ${receipt.documentId} cashback: ${receiptCashback}`)
            return userSum + receiptCashback
        }

        // For partially verified receipts, we need to sum only verified items
        const receiptSum = receipt.items?.reduce((itemsSum, item) => {
            if (item.__component === 'receipt-item.item' &&
                item.verificationStatus &&
                QUALIFYING_ITEM_STATUSES.includes(item.verificationStatus as ItemVerificationStatus)) {
                const itemCashback = item.cashback || 0;
                strapi.log.debug(`[Balance] Partially verified receipt ${receipt.documentId} item ${item.id} cashback: ${itemCashback}`);
                return itemsSum + itemCashback;
            }
            return itemsSum
        }, 0) || 0

        strapi.log.debug(`[Balance] Receipt ${receipt.documentId} (${receipt.verificationStatus}) total: ${receiptSum}`)
        return userSum + receiptSum
    }, 0)

    // Get approved cashback requests
    const approvedCashbackRequests = await strapi.documents('api::cashback-request.cashback-request').findMany({
        filters: {
            requester: { documentId: { $eq: userDocumentId } }, // Fixed: Removed nested filters
            verificationStatus: { $in: APPROVED_REQUEST_STATUSES }
        }
    }) as CashbackRequest[];

    const totalApprovedCashback = approvedCashbackRequests.reduce((sum, request) => {
        strapi.log.debug(`[Balance] Request ${request.documentId} amount: ${request.amount}`)
        return sum + (request.amount || 0)
    }, 0)

    const balance = totalVerifiedCashback - totalApprovedCashback
    strapi.log.info(`[Balance] Final balance for user ${userDocumentId}: ${balance}`)

    return balance
}

export async function updateUserBalance(userDocumentId: string): Promise<number> {
    const newBalance = await calculateUserBalance(userDocumentId);

    await strapi.documents('plugin::users-permissions.user').update({
        documentId: userDocumentId,
        data: {
            account: newBalance
        }
    });

    return newBalance;
}