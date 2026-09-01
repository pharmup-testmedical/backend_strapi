import type { Core } from '@strapi/strapi';
import { registerUserVerificationPermissions } from './permissions';
import { registerUserVerificationRoutes } from './routes';

export async function registerUserVerification({ strapi }: { strapi: Core.Strapi }) {
  await registerUserVerificationPermissions(strapi);
  registerUserVerificationRoutes(strapi);
  strapi.log.info('[user-verification] Раздел «Проверка пользователя» зарегистрирован');
}
