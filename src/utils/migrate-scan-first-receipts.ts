import { checkAndCompleteTasks } from './calculate-user-balance';

export async function migrateScanFirstReceiptsTask() {
    strapi.log.info('[Migration] Starting scanFirstReceipts backfill...');

    const allUsers = await strapi.documents('plugin::users-permissions.user').findMany({
        fields: ['id'],
        limit: 10000
    });

    let processed = 0;
    for (const user of allUsers) {
        await checkAndCompleteTasks(user.documentId);
        processed++;
        if (processed % 100 === 0) strapi.log.info(`[Migration] Processed ${processed} users`);
    }

    strapi.log.info(`[Migration] Finished. Processed ${processed} users.`);
}