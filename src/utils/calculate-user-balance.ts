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

interface CompletedTest {
    id: number
    documentId: string
    user?: { documentId: string }
    test?: any
    cashback: number
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

    // 1. Get all receipts that might contribute to balance
    const receipts = await strapi.documents('api::receipt.receipt').findMany({
        filters: {
            user: { documentId: { $eq: userDocumentId } },
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

    // 2. Calculate cashback from receipts
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

    // 3. Get approved cashback requests
    const approvedCashbackRequests = await strapi.documents('api::cashback-request.cashback-request').findMany({
        filters: {
            requester: { documentId: { $eq: userDocumentId } },
            verificationStatus: { $in: APPROVED_REQUEST_STATUSES }
        }
    }) as CashbackRequest[];

    const totalApprovedCashback = approvedCashbackRequests.reduce((sum, request) => {
        strapi.log.debug(`[Balance] Request ${request.documentId} amount: ${request.amount}`)
        return sum + (request.amount || 0)
    }, 0)

    // 4. Task bonuses
    const completedTasks = await strapi.documents('api::completed-task.completed-task').findMany({
        filters: {
            user: { documentId: { $eq: userDocumentId } }
        }
    });
    const totalTaskCashback = completedTasks.reduce((sum, task) => {
        return sum + (task.cashback || 0);
    }, 0);

    // 5. Test bonuses (NEW)
    const completedTests = await strapi.documents('api::completed-test.completed-test').findMany({
        filters: {
            user: { documentId: { $eq: userDocumentId } }
        }
    }) as CompletedTest[];

    const totalTestCashback = completedTests.reduce((sum, test) => {
        return sum + (test.cashback || 0);
    }, 0);

    const balance = totalVerifiedCashback + totalTaskCashback + totalTestCashback - totalApprovedCashback
    strapi.log.info(`[Balance] Final balance for user ${userDocumentId}: ${balance} (receipts: ${totalVerifiedCashback}, tasks: ${totalTaskCashback}, tests: ${totalTestCashback}, requests: ${totalApprovedCashback})`)
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

// export async function checkAndCompleteTasks(userDocumentId: string): Promise<void> {
//     // Check scanFirstReceipts task
//     const scanTaskCompleted = await strapi.documents('api::completed-task.completed-task').findFirst({
//         filters: {
//             user: { documentId: { $eq: userDocumentId } },
//             task: 'scanFirstReceipts'
//         }
//     });

//     if (!scanTaskCompleted) {
//         const tasksPage = await strapi.documents('api::tasks-page.tasks-page').findFirst({
//             populate: ['scanFirstReceipts']
//         });

//         const scanTask = tasksPage?.scanFirstReceipts;
//         if (scanTask?.active) {
//             const numRequired = scanTask.numReceiptsRequired;
//             const taskCashback = scanTask.cashback;

//             // Fast count
//             const verifiedCount = await strapi.documents('api::receipt.receipt').count({
//                 filters: {
//                     user: { documentId: { $eq: userDocumentId } },
//                     verificationStatus: { $in: VERIFIED_RECEIPT_STATUSES }
//                 }
//             });

//             if (verifiedCount >= numRequired) {
//                 // Get the FIRST N earliest receipts (exactly what the task name implies)
//                 const firstNReceipts = await strapi.documents('api::receipt.receipt').findMany({
//                     filters: {
//                         user: { documentId: { $eq: userDocumentId } },
//                         verificationStatus: { $in: VERIFIED_RECEIPT_STATUSES }
//                     },
//                     sort: { date: 'asc' },   // earliest receipt date first
//                     limit: numRequired,
//                     fields: ['id']
//                 });

//                 // Create completion record
//                 await strapi.documents('api::completed-task.completed-task').create({
//                     data: {
//                         user: userDocumentId,
//                         task: 'scanFirstReceipts',
//                         cashback: taskCashback,
//                         details: [{
//                             __component: 'completed-tasks.otskanirujte-pervye-cheki',
//                             firstReceipts: firstNReceipts.map(r => ({ documentId: r.documentId }))
//                         }]
//                     }
//                 });

//                 strapi.log.info(`[Task] scanFirstReceipts completed for user ${userDocumentId} → +${taskCashback} cashback`);

//                 // Recalculate balance so the new task cashback appears immediately
//                 await updateUserBalance(userDocumentId);
//             }
//         }
//     }
// }