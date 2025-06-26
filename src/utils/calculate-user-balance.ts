interface ReceiptItem {
    id: number;
    cashback?: number;
    claimedProduct?: any;
    productAlias?: any;
    __component: string;
}

interface Receipt {
    id: number;
    documentId: string;
    user?: { documentId: string };
    verificationStatus: string;
    items?: ReceiptItem[];
}

interface CashbackRequest {
    id: number;
    documentId: string;
    requester?: { documentId: string };
    verificationStatus: string;
    amount: number; // New field instead of receipts
}

export async function calculateUserBalance(userDocumentId: string): Promise<number> {
    strapi.log.info(`[Balance] Starting balance calculation for user ${userDocumentId}`);

    // Get verified receipts
    const verifiedReceipts = await strapi.documents('api::receipt.receipt').findMany({
        filters: {
            user: { documentId: { $eq: userDocumentId } },
            verificationStatus: { $in: ['auto_verified', 'manually_verified'] }
        },
        populate: ['items']
    }) as Receipt[];

    const totalVerifiedCashback = verifiedReceipts.reduce((userSum, receipt) => {
        const receiptSum = receipt.items?.reduce((itemsSum, item) => {
            const itemCashback = item.cashback || 0;
            strapi.log.debug(`[Balance] Receipt ${receipt.documentId} item ${item.id} cashback: ${itemCashback}`);
            return itemsSum + itemCashback;
        }, 0) || 0;

        strapi.log.debug(`[Balance] Receipt ${receipt.documentId} total: ${receiptSum}`);
        return userSum + receiptSum;
    }, 0);

    // Get approved cashback requests (simpler now with direct amount field)
    const approvedCashbackRequests = await strapi.documents('api::cashback-request.cashback-request').findMany({
        filters: {
            requester: { documentId: { $eq: userDocumentId } },
            verificationStatus: { $eq: 'approved' }
        }
    }) as CashbackRequest[];

    const totalApprovedCashback = approvedCashbackRequests.reduce((sum, request) => {
        strapi.log.debug(`[Balance] Request ${request.documentId} amount: ${request.amount}`);
        return sum + (request.amount || 0);
    }, 0);

    const balance = totalVerifiedCashback - totalApprovedCashback;
    strapi.log.info(`[Balance] Final balance for user ${userDocumentId}: ${balance}`);

    return balance;
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