import type { Core } from '@strapi/strapi';
import {
  registerProductAliasMiddleware,
  // registerAliasVerifierMiddleware
} from './utils/document-service-middlewares';

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
    registerProductAliasMiddleware({ strapi });
  },

  /**
   * An asynchronous bootstrap function that runs before
   * your application gets started.
   *
   * This gives you an opportunity to set up your data model,
   * run jobs, or perform some special logic.
   */
  bootstrap(/* { strapi }: { strapi: Core.Strapi } */) { },
};
