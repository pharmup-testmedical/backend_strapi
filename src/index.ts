import type { Core } from '@strapi/strapi';
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
  register({ strapi }: { strapi: Core.Strapi }) {
    // Register Alias Verifier middleware first
    // registerAliasVerifierMiddleware({ strapi });
    
    // Register existing product alias middleware second
    // registerProductAliasMiddleware({ strapi });
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
  //     console.log('🚀 Strapi has launched. Sending test email...');

  //     await strapi.plugin('email').service('email').send({
  //       to: 'a.baidusenov1@gmail.com',
  //       from: 'pharmup@testmedical.kz',
  //       subject: 'Strapi Startup Email',
  //       text: 'This is a startup test email.',
  //       html: '<h2>🚀 Hello from Strapi startup hook</h2>',
  //     });

  //     console.log('✅ Test email sent!');
  //   } catch (error) {
  //     console.error('❌ Failed to send test email on startup:', error.message);
  //   }
  // },
};
