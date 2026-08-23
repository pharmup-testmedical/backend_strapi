import { updateUserBalance } from '../../../../utils/calculate-user-balance';
import { createNotification } from '../../../../utils/create-notification';
import { formatCurrency } from '../../../../utils/format-currency';

const syncBalance = async (documentId: string) => {
    const fullCompletedTest = await strapi.documents('api::completed-test.completed-test').findOne({
        documentId,
        populate: ['user']
    });

    if (fullCompletedTest?.user?.documentId) {
        strapi.log.info(`[CompletedTest] Updating balance for user ${fullCompletedTest.user.documentId} after test completion with cashback ${fullCompletedTest.cashback}`);
        await updateUserBalance(fullCompletedTest.user.documentId);
    }
};

export default {
    // Уведомление только здесь, в afterCreate — прохождение теста
    // создаёт новую запись каждый раз заново, но дублей на afterUpdate не
    // ожидается (эта запись обычно не редактируется вручную с изменением
    // cashback), поэтому отдельная дедупликация здесь избыточна.
    async afterCreate(event) {
        await syncBalance(event.result.documentId);

        const fullCompletedTest = await strapi.documents('api::completed-test.completed-test').findOne({
            documentId: event.result.documentId,
            populate: ['user', 'test'],
        });
        if (fullCompletedTest?.user?.documentId && fullCompletedTest.cashback > 0) {
            const testTitle = fullCompletedTest.test?.title
            await createNotification({
                userDocumentId: fullCompletedTest.user.documentId,
                type: 'cashback',
                title: 'Начислен бонус',
                body: `Начислен бонус ${formatCurrency(fullCompletedTest.cashback)} за пройденный тест${testTitle ? ` «${testTitle}»` : ''}`,
                action: 'cashback_history',
                entityId: fullCompletedTest.documentId,
            })
        }
    },

    // Если тест в админке переносят на другого пользователя (user),
    // пересчёта баланса нового владельца недостаточно — у прежнего баланс
    // останется завышенным на кэшбэк этого теста. Запоминаем прежнего
    // владельца заранее, чтобы пересчитать и его тоже.
    async beforeUpdate(event: any) {
        const { where } = event.params;
        const record = await strapi.db.query('api::completed-test.completed-test').findOne({
            where,
            populate: ['user']
        });
        event.state = { previousUserDocumentId: record?.user?.documentId };
    },

    async afterUpdate(event) {
        await syncBalance(event.result.documentId);

        const previousUserDocumentId = event.state?.previousUserDocumentId;
        const fullRecord = await strapi.documents('api::completed-test.completed-test').findOne({
            documentId: event.result.documentId,
            populate: ['user']
        });
        if (previousUserDocumentId && previousUserDocumentId !== fullRecord?.user?.documentId) {
            await updateUserBalance(previousUserDocumentId);
        }
    },

    // Запись удаляется до срабатывания afterDelete, поэтому владельца
    // нужно запомнить заранее в beforeDelete через event.state — иначе
    // ручное удаление теста в админке не пересчитает баланс.
    async beforeDelete(event: any) {
        const { where } = event.params;
        const record = await strapi.db.query('api::completed-test.completed-test').findOne({
            where,
            populate: ['user']
        });
        event.state = { userDocumentId: record?.user?.documentId };
    },

    async afterDelete(event: any) {
        const userDocumentId = event.state?.userDocumentId;
        if (userDocumentId) {
            await updateUserBalance(userDocumentId);
        }
    }
};