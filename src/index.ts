import type { Core } from '@strapi/strapi';
import { generateUniqueReferralCode } from './utils/generate-referral-code';
import { calculateUserBalance } from './utils/calculate-user-balance';
import { registerAnalytics } from './analytics';
// import {
//   registerProductAliasMiddleware,
//   registerAliasVerifierMiddleware
// } from './middlewares/document-service-middlewares';

export default {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   *
   * This gives you an opportunity to extend code.
   */
  async register({ strapi }: { strapi: Core.Strapi }) {
    await registerAnalytics({ strapi });

    // Register Alias Verifier middleware first
    // registerAliasVerifierMiddleware({ strapi });

    // Register existing product alias middleware second
    // registerProductAliasMiddleware({ strapi });

    strapi.log.info('Registering user lifecycles...');

    // Get the user model
    const userModel = strapi.getModel('plugin::users-permissions.user');

    if (!userModel) {
      strapi.log.error('User model not found!');
      return;
    }

    strapi.log.info('User model found, registering lifecycles...');

    // Register beforeCreate lifecycle
    strapi.db.lifecycles.subscribe({
      models: ['plugin::users-permissions.user'],

      async beforeCreate(event) {
        const { data } = event.params;

        strapi.log.debug('[beforeCreate] Processing user creation');

        // Store inviterCode if present (will be processed in afterCreate)
        if (data.inviterCode) {
          strapi.log.debug(`Inviter code provided: ${data.inviterCode}`);
          // Move to temporary field that won't be saved to DB
          data._tempInviterCode = data.inviterCode;
          // Delete original so it doesn't try to save to database
          delete data.inviterCode;
        }
      },

      async afterCreate(event) {
        const { result, params } = event;

        strapi.log.debug(`[afterCreate] User ${result.id} created, processing referral data...`);

        try {
          // Generate referral code for the new user
          const userReferralCode = await generateUniqueReferralCode(result.email, result.id);
          const updateData: any = { referralCode: userReferralCode };

          // Check if this user was referred by someone
          if (params.data._tempInviterCode) {
            const inviterCode = params.data._tempInviterCode;
            strapi.log.debug(`Looking for inviter with code: ${inviterCode}`);

            // Find the inviter by their referral code
            const inviter = await strapi.db.query('plugin::users-permissions.user').findOne({
              where: { referralCode: inviterCode }
            });

            if (inviter) {
              updateData.referredBy = inviter.id;
              strapi.log.info(`User ${result.id} was referred by user ${inviter.id} (code: ${inviterCode})`);
            } else {
              strapi.log.warn(`Invalid inviter code used during registration: ${inviterCode}`);
            }
          }

          // Update the user with referral code and inviter relation
          await strapi.db.query('plugin::users-permissions.user').update({
            where: { id: result.id },
            data: updateData
          });

          strapi.log.info(`Referral code ${userReferralCode} set for user ${result.id}`);

        } catch (error) {
          strapi.log.error(`Failed to set referral data for user ${result.id}:`, error);

          // Fallback - ensure user at least has a referral code
          const fallbackCode = `USER${result.id}${Date.now().toString().slice(-4)}`.toUpperCase();

          await strapi.db.query('plugin::users-permissions.user').update({
            where: { id: result.id },
            data: { referralCode: fallbackCode }
          });

          strapi.log.warn(`Used fallback code ${fallbackCode} for user ${result.id}`);
        }
      },

      // "account" не свободно редактируемое поле, а сумма кэшбэка по
      // чекам + заданиям + тестам минус одобренные выводы (см.
      // calculateUserBalance). Раньше его можно было просто вписать
      // руками в админке (или задать багом/скриптом) в обход этой
      // логики — теперь при любом сохранении пользователя значение
      // принудительно пересчитывается из реальных данных, что бы ни
      // было передано в запросе.
      async beforeUpdate(event) {
        const { data, where } = event.params;

        if (data.account === undefined) return;

        const currentUser = await strapi.db.query('plugin::users-permissions.user').findOne({
          where: { id: where.id },
          select: ['id', 'documentId'],
        });

        if (!currentUser?.documentId) return;

        const correctBalance = await calculateUserBalance(currentUser.documentId);

        if (Number(data.account) !== correctBalance) {
          strapi.log.warn(
            `[Balance Guard] Попытка записать account=${data.account} для пользователя ${currentUser.documentId} (id=${currentUser.id}) — заменено на рассчитанное значение ${correctBalance}`
          );
        }

        data.account = correctBalance;
      },
    });

    strapi.log.info('User lifecycles registered successfully');
  },

  /**
   * An asynchronous bootstrap function that runs before
   * your application gets started.
   *
   * This gives you an opportunity to set up your data model,
   * run jobs, or perform some special logic.
   */
  bootstrap(/* { strapi }: { strapi: Core.Strapi } */) { },

  // bootstrap: async ({ strapi }: { strapi: Core.Strapi }) => {
  //   try {
  //     console.log('Strapi has launched. Sending test email...');

  //     await strapi.plugin('email').service('email').send({
  //       to: 'a.baidusenov1@gmail.com',
  //       from: 'pharmup@testmedical.kz',
  //       subject: 'Strapi Startup Email',
  //       text: 'This is a startup test email.',
  //       html: '<h2>Hello from Strapi startup hook</h2>',
  //     });

  //     console.log('Test email sent!');
  //   } catch (error) {
  //     console.error('Failed to send test email on startup:', error.message);
  //   }
  // },
};
