import { verifiedStatuses } from './verified-statuses';

export async function updateScanFirstReceiptsTaskProgress(
    userDocumentId: string,
    receiptId: number | string
) {
    const normalizedReceiptId = Number(receiptId);
    if (Number.isNaN(normalizedReceiptId)) {
        strapi.log.debug(`[Task][scanFirstReceipts] Invalid receiptId (NaN): ${receiptId}`);
        return;
    }

    strapi.log.debug(
        `[Task][scanFirstReceipts] Start userDocumentId=${userDocumentId}, receiptId=${normalizedReceiptId}`
    );

    const user = await strapi
        .documents('plugin::users-permissions.user')
        .findOne({
            documentId: userDocumentId,
            fields: ['id'],
        });

    if (!user) {
        strapi.log.debug(`[Task][scanFirstReceipts] User not found documentId=${userDocumentId}`);
        return;
    }

    const userId = user.id;

    // Check if already fully completed
    const completed = await strapi
        .documents('api::completed-task.completed-task')
        .findFirst({
            filters: {
                user: { id: userId },
                task: 'scanFirstReceipts',
                cashback: { $gt: 0 },
            },
        });

    if (completed) {
        strapi.log.debug(`[Task][scanFirstReceipts] Already completed for userId=${userId}`);
        return;
    }

    // Load task config
    const tasksPage = await strapi
        .documents('api::tasks-page.tasks-page')
        .findFirst({
            populate: { scanFirstReceipts: true },
        });

    const scanTask = tasksPage?.scanFirstReceipts;
    if (!scanTask?.active) {
        strapi.log.debug(`[Task][scanFirstReceipts] Task inactive or missing config`);
        return;
    }

    const numRequired = scanTask.numReceiptsRequired || 3;

    // Fixed: Correct type assertion for Strapi filter
    const verifiedCount = await strapi.documents('api::receipt.receipt').count({
        filters: {
            user: { documentId: userDocumentId },
            countsForScanTask: true,
            verificationStatus: {
                $in: verifiedStatuses as unknown as any[],
            },
        },
    });

    strapi.log.debug(`[Task][scanFirstReceipts] Verified count: ${verifiedCount}/${numRequired}`);

    // Get or create in-progress task
    const inProgressTask = await strapi
        .documents('api::completed-task.completed-task')
        .findFirst({
            filters: {
                user: { id: userId },
                task: 'scanFirstReceipts',
                cashback: 0,
            },
            populate: {
                details: {
                    on: {
                        'completed-tasks.otskanirujte-pervye-cheki': {
                            populate: '*',
                        },
                    },
                },
            },
        }) as any;

    const componentKey = 'completed-tasks.otskanirujte-pervye-cheki' as const;

    // Extract current receipt IDs
    let currentIds: number[] = [];
    if (inProgressTask?.details) {
        const detailsRaw = inProgressTask.details;
        const detailsArray = Array.isArray(detailsRaw)
            ? detailsRaw
            : Array.isArray((detailsRaw as any)?.data)
                ? (detailsRaw as any).data
                : [];

        const block = detailsArray.find((d: any) => d?.__component === componentKey);
        const receiptsRaw = block?.firstReceipts;

        currentIds = Array.isArray(receiptsRaw?.data)
            ? receiptsRaw.data.map((r: any) => r?.id).filter(Boolean)
            : Array.isArray(receiptsRaw)
                ? receiptsRaw.map((r: any) => r?.id).filter(Boolean)
                : [];
    }

    if (currentIds.includes(normalizedReceiptId)) {
        strapi.log.debug(`[Task][scanFirstReceipts] Receipt already tracked, skipping add`);
    }

    const updatedIds = [...new Set([...currentIds, normalizedReceiptId])];

    // COMPLETE THE TASK
    if (verifiedCount >= numRequired) {
        strapi.log.debug(`[Task][scanFirstReceipts] COMPLETING task (verified ${verifiedCount}/${numRequired})`);

        if (inProgressTask?.documentId) {
            await strapi.documents('api::completed-task.completed-task').delete({
                documentId: inProgressTask.documentId,
            });
        }

        await strapi.documents('api::completed-task.completed-task').create({
            data: {
                user: userId,
                task: 'scanFirstReceipts',
                cashback: scanTask.cashback,
                details: [
                    {
                        __component: componentKey,
                        firstReceipts: updatedIds.slice(0, numRequired),
                        numReceiptsRequired: numRequired,
                        verifiedCount,
                    },
                ] as any,
                publishedAt: new Date(),
            } as any,
        });

        strapi.log.info(
            `[Task][scanFirstReceipts] COMPLETED userId=${userId}, verified=${verifiedCount}, cashback=${scanTask.cashback}`
        );

        // Fixed: Use dynamic import with correct relative path
        const { updateUserBalance } = await import('../calculate-user-balance');
        await updateUserBalance(userDocumentId);
        return;
    }

    // Update or create progress
    const detailsData = [
        {
            __component: componentKey,
            firstReceipts: updatedIds,
            numReceiptsRequired: numRequired,
        },
    ];

    if (inProgressTask?.documentId) {
        await strapi.documents('api::completed-task.completed-task').update({
            documentId: inProgressTask.documentId,
            data: { details: detailsData as any } as any,
        });
        strapi.log.info(`[Task][scanFirstReceipts] Progress updated ${updatedIds.length} receipts (verified: ${verifiedCount}/${numRequired})`);
    } else {
        await strapi.documents('api::completed-task.completed-task').create({
            data: {
                user: userId,
                task: 'scanFirstReceipts',
                cashback: 0,
                details: detailsData as any,
            } as any,
        });
        strapi.log.info(`[Task][scanFirstReceipts] Progress started ${updatedIds.length} receipts (verified: ${verifiedCount}/${numRequired})`);
    }
}