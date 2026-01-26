import { Context } from 'koa';

export default (plugin) => {
    plugin.controllers = plugin.controllers || {};
    plugin.controllers.custom = {
        async resetPasswordRedirect(ctx: Context) {
            console.log('resetPasswordRedirect called'); // Debug log
            const { code } = ctx.query as { code?: string };

            if (!code) {
                // Instead of returning JSON, redirect to error page
                const errorUrl = `pharmup://auth/reset-error?message=${encodeURIComponent('Reset password code is missing')}&type=missing_code`;
                return ctx.redirect(errorUrl);
            }

            try {
                const user = await strapi
                    .query('plugin::users-permissions.user')
                    .findOne({ where: { resetPasswordToken: code } });

                if (!user) {
                    const errorUrl = `pharmup://auth/reset-error?message=${encodeURIComponent('Invalid or expired reset password code')}&type=invalid_token`;
                    return ctx.redirect(errorUrl);
                }

                // Check if token is expired (24 hours validity)
                const tokenCreatedAt = new Date(user.resetPasswordTokenCreatedAt);
                const now = new Date();
                const hoursDiff = (now.getTime() - tokenCreatedAt.getTime()) / (1000 * 60 * 60);

                if (hoursDiff > 24) {
                    const errorUrl = `pharmup://auth/reset-error?message=${encodeURIComponent('Reset password link has expired')}&type=expired_token`;
                    return ctx.redirect(errorUrl);
                }

                const redirectUrl = `pharmup://auth/reset-password?code=${encodeURIComponent(code)}`;
                console.log('Redirecting to:', redirectUrl); // Debug log
                return ctx.redirect(redirectUrl);
            } catch (error) {
                console.error('Error in resetPasswordRedirect:', error); // Debug log
                const errorUrl = `pharmup://auth/reset-error?message=${encodeURIComponent('Error processing reset password request')}&type=server_error`;
                return ctx.redirect(errorUrl);
            }
        },

        async emailConfirmationRedirect(ctx: Context) {
            console.log('emailConfirmationRedirect called'); // Debug log
            const { confirmation } = ctx.query as { confirmation?: string };

            if (!confirmation) {
                const errorUrl = `pharmup://auth/confirmation-error?message=${encodeURIComponent('Confirmation code is missing')}&type=missing_code`;
                return ctx.redirect(errorUrl);
            }

            try {
                const user = await strapi
                    .query('plugin::users-permissions.user')
                    .findOne({
                        where: {
                            confirmationToken: confirmation,
                            confirmed: false // Only allow confirmation for unconfirmed users
                        }
                    });

                if (!user) {
                    const errorUrl = `pharmup://auth/confirmation-error?message=${encodeURIComponent('Invalid or already used confirmation code')}&type=invalid_token`;
                    return ctx.redirect(errorUrl);
                }

                // Check if token is expired (24 hours validity)
                const tokenCreatedAt = new Date(user.confirmationTokenCreatedAt);
                const now = new Date();
                const hoursDiff = (now.getTime() - tokenCreatedAt.getTime()) / (1000 * 60 * 60);

                if (hoursDiff > 24) {
                    const errorUrl = `pharmup://auth/confirmation-error?message=${encodeURIComponent('Confirmation link has expired')}&type=expired_token`;
                    return ctx.redirect(errorUrl);
                }

                // Actually confirm the user
                await strapi.entityService.update(
                    'plugin::users-permissions.user',
                    user.id,
                    {
                        data: {
                            confirmed: true,
                            confirmationToken: null,
                            confirmationTokenCreatedAt: null
                        }
                    }
                );

                // Redirect to success page
                const redirectUrl = `pharmup://auth/confirmation`;
                console.log('Redirecting to success:', redirectUrl); // Debug log
                return ctx.redirect(redirectUrl);
            } catch (error) {
                console.error('Error in emailConfirmationRedirect:', error); // Debug log
                const errorUrl = `pharmup://auth/confirmation-error?message=${encodeURIComponent('Error processing confirmation request')}&type=server_error`;
                return ctx.redirect(errorUrl);
            }
        },
    };

    // Add the custom routes to users-permissions content-api routes
    plugin.routes = plugin.routes || {};
    plugin.routes['content-api'] = plugin.routes['content-api'] || { routes: [] };

    // Add reset password redirect route
    plugin.routes['content-api'].routes.push({
        method: 'GET',
        path: '/reset-password-redirect',
        handler: 'custom.resetPasswordRedirect',
        config: {
            auth: false,
        },
    });

    // Add email confirmation redirect route
    plugin.routes['content-api'].routes.push({
        method: 'GET',
        path: '/email-confirmation-redirect',
        handler: 'custom.emailConfirmationRedirect',
        config: {
            auth: false,
        },
    });

    console.log('Custom routes added:', plugin.routes['content-api'].routes);

    return plugin;
};