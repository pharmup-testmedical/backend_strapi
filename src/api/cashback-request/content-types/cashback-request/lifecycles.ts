import { updateUserBalance } from '../../../../utils/calculate-user-balance';

const STATUS_LABELS: Record<string, string> = {
    pending: 'в ожидании',
    approved: 'одобрена',
    rejected: 'отклонена',
    manual_review: 'на проверке',
};

const PAYOUT_METHOD_LABELS: Record<string, string> = {
    kaspi: 'Kaspi',
    card: 'Карта',
};

// Kaspi-перевод обычно делают по имени (получатель ищет по имени в приложении
// банка), карточный — по фамилии на карте, поэтому какая часть ФИО пишется
// полностью, а какая — инициалом, зависит от способа вывода.
const formatUserForPayout = (name: string, surname: string, payoutMethod: string): string => {
    const initial = (part: string) => (part ? `${part.charAt(0)}.` : '')
    if (payoutMethod === 'card') {
        return `${surname || ''} ${initial(name)}`.trim()
    }
    return `${name || ''} ${initial(surname)}`.trim()
}

export default {
    // Если заявку в админке переносят на другого пользователя (requester),
    // одного пересчёта баланса НОВОГО заявителя недостаточно — у ПРЕЖНЕГО
    // заявителя баланс останется искажённым на сумму этой заявки. Запоминаем
    // прежнего заявителя до обновления, чтобы пересчитать и его тоже.
    async beforeUpdate(event: any) {
        const { where } = event.params;
        const record = await strapi.db.query('api::cashback-request.cashback-request').findOne({
            where,
            populate: ['requester']
        });
        event.state = { previousRequesterDocumentId: record?.requester?.documentId };
    },

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

        const previousRequesterDocumentId = event.state?.previousRequesterDocumentId;
        if (previousRequesterDocumentId && previousRequesterDocumentId !== fullRequest.requester?.documentId) {
            await updateUserBalance(previousRequesterDocumentId);
        }
    },

    async afterCreate(event: any) {
        strapi.log.debug(JSON.stringify(event))
        const { result } = event;
        const fullRequest = await strapi.documents('api::cashback-request.cashback-request').findOne({
            documentId: result.documentId,
            populate: { requester: { populate: ['city'] } }
        });

        // Send admin notification email for new cashback requests
        try {
            // Get the admin notification email from website-setup
            const websiteSetup = await strapi.documents('api::website-setup.website-setup').findFirst();
            const adminEmail = websiteSetup?.adminNotificationEmail;
            const requesterEmail = fullRequest.requester?.email || 'Не указан';
            const city = fullRequest.requester?.city?.name || fullRequest.requester?.otherCity || 'Не указан';
            const adminUrl = `https://strapi.testmedical.kz/admin/content-manager/collection-types/api::cashback-request.cashback-request/${fullRequest.documentId}`;
            const createdAt = new Date(fullRequest.createdAt).toLocaleString('ru-RU')
            const status = STATUS_LABELS[fullRequest.verificationStatus] || fullRequest.verificationStatus
            const payoutMethod = PAYOUT_METHOD_LABELS[fullRequest.payoutMethod] || fullRequest.payoutMethod || 'Не указан'
            const payoutDestination = fullRequest.payoutDestination || 'Не указаны'
            const userLabel = formatUserForPayout(
                fullRequest.requester?.name,
                fullRequest.requester?.surname,
                fullRequest.payoutMethod
            )

            // Организация/адрес не хранятся у пользователя — берём с его
            // самого свежего чека (для kofd-чеков сейчас есть только
            // название и БИН, адрес в фискальных данных kofd отсутствует).
            const [latestReceipt] = await strapi.documents('api::receipt.receipt').findMany({
                filters: { user: { id: fullRequest.requester?.id } },
                sort: ['date:desc'],
                limit: 1,
                fields: ['organizationName', 'organizationBin', 'organizationAddress'],
            })
            const organizationLine = latestReceipt?.organizationName
                ? `${latestReceipt.organizationName}${latestReceipt.organizationBin ? ` (БИН ${latestReceipt.organizationBin})` : ''}`
                : null
            const organizationAddress = latestReceipt?.organizationAddress || null

            if (adminEmail) {
                await strapi.plugin('email').service('email').send({
                    to: adminEmail,
                    from: 'pharmup@testmedical.kz',
                    subject: `Новая заявка на кешбэк от ${requesterEmail}: ${fullRequest.documentId}`,
                    text: `Новая заявка на кешбэк\n\nДата создания: ${createdAt}\nСтатус: ${status}\nСумма: ${fullRequest.amount}тг\nЗаявитель: ${requesterEmail}\nСпособ вывода: ${payoutMethod}\nПользователь: ${userLabel}\nРеквизиты: ${payoutDestination}\nГород: ${city}${organizationLine ? `\n${organizationLine}` : ''}${organizationAddress ? `\n${organizationAddress}` : ''}\n\n${adminUrl}`,
                    html: `
                        <h2>Новая заявка на кешбэк</h2>
                        <p><strong>Дата создания:</strong> ${createdAt}</p>
                        <p><strong>Статус:</strong> ${status}</p>
                        <p><strong>Сумма:</strong> ${fullRequest.amount}тг</p>
                        <p><strong>Заявитель:</strong> ${requesterEmail}</p>
                        <p><strong>Способ вывода:</strong> ${payoutMethod}</p>
                        <p><strong>Пользователь:</strong> ${userLabel}</p>
                        <p><strong>Реквизиты:</strong> ${payoutDestination}</p>
                        <p><strong>Город:</strong> ${city}</p>
                        ${organizationLine ? `<p>${organizationLine}</p>` : ''}
                        ${organizationAddress ? `<p>${organizationAddress}</p>` : ''}
                        <hr>
                        <p><a href="${adminUrl}">Открыть заявку в панели администратора</a></p>
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