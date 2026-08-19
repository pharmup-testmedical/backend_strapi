import { updateUserBalance } from '../../../../utils/calculate-user-balance';

export default {
    async afterUpdate(event: any) {
        console.log(JSON.stringify(event))
        const { result } = event;
        const fullRequest = await strapi.documents('api::cashback-request.cashback-request').findOne({
            documentId: result.documentId,
            populate: ['requester']
        });

        if (fullRequest.requester?.documentId) {
            await updateUserBalance(fullRequest.requester.documentId);
        }
    },

    async afterCreate(event: any) {
        strapi.log.debug(JSON.stringify(event))
        const { result } = event;
        const fullRequest = await strapi.documents('api::cashback-request.cashback-request').findOne({
            documentId: result.documentId,
            populate: ['requester']
        });

        // Send admin notification email for new cashback requests
        try {
            // Get the admin notification email from website-setup
            const websiteSetup = await strapi.documents('api::website-setup.website-setup').findFirst();
            const adminEmail = websiteSetup?.adminNotificationEmail;
            const requesterEmail = fullRequest.requester?.email || 'Не указан';

            if (adminEmail) {
                await strapi.plugin('email').service('email').send({
                    to: adminEmail,
                    from: 'pharmup@testmedical.kz',
                    subject: `Новая заявка на кешбэк от ${requesterEmail}: ${fullRequest.documentId}`,
                    text: `Создана новая заявка на кешбэк.\n\nID заявки: ${fullRequest.documentId}\nСумма: ${fullRequest.amount}\nСтатус: ${fullRequest.verificationStatus}\nЗаявитель: ${fullRequest.requester?.username || requesterEmail}\nДата создания: ${new Date().toLocaleString('ru-RU')}`,
                    html: `
                        <h2>Новая заявка на кешбэк</h2>
                        <p><strong>ID заявки:</strong> ${fullRequest.documentId}</p>
                        <p><strong>Статус:</strong> ${fullRequest.verificationStatus}</p>
                        <p><strong>Сумма:</strong> ${fullRequest.amount}</p>
                        <p><strong>Заявитель:</strong> ${fullRequest.requester?.username || requesterEmail}</p>
                        <p><strong>Email заявителя:</strong> ${requesterEmail}</p>
                        <p><strong>Дата создания:</strong> ${new Date().toLocaleString('ru-RU')}</p>
                        <hr>
                        <p>Пожалуйста, проверьте эту заявку в панели администратора.</p>
                    `,
                });

                strapi.log.info(`Уведомление администратора отправлено на ${adminEmail} для новой заявки ${fullRequest.documentId}`);
            }
        } catch (error) {
            strapi.log.error('Ошибка отправки уведомления администратору:', error.message);
        }
    },

    // Запись удаляется до срабатывания afterDelete, поэтому владельца
    // нужно запомнить заранее в beforeDelete через event.state — иначе
    // удаление одобренной заявки в админке не пересчитает баланс.
    async beforeDelete(event: any) {
        const { where } = event.params;
        const record = await strapi.db.query('api::cashback-request.cashback-request').findOne({
            where,
            populate: ['requester']
        });
        event.state = { userDocumentId: record?.requester?.documentId };
    },

    async afterDelete(event: any) {
        const userDocumentId = event.state?.userDocumentId;
        if (userDocumentId) {
            await updateUserBalance(userDocumentId);
        }
    }
};