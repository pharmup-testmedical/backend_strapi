import { Context } from 'koa';

export default (plugin) => {
    // Define the custom controller
    plugin.controllers = plugin.controllers || {};
    plugin.controllers.custom = {
        async resetPasswordRedirect(ctx: Context) {
            console.log('resetPasswordRedirect called'); // Debug log
            const { code } = ctx.query as { code?: string };

            if (!code) {
                return ctx.badRequest('Reset password code is missing');
            }

            try {
                const user = await strapi
                    .query('plugin::users-permissions.user')
                    .findOne({ where: { resetPasswordToken: code } });

                if (!user) {
                    return ctx.badRequest('Invalid reset password code');
                }

                const redirectUrl = `pharmup://auth/reset-password?code=${encodeURIComponent(code)}`;
                console.log('Redirecting to:', redirectUrl); // Debug log
                return ctx.redirect(redirectUrl);
            } catch (error) {
                console.error('Error in resetPasswordRedirect:', error); // Debug log
                return ctx.badRequest('Error processing reset password request', { error });
            }
        },
    };

    // Add the custom route to users-permissions content-api routes
    plugin.routes = plugin.routes || {};
    plugin.routes['content-api'] = plugin.routes['content-api'] || { routes: [] };
    plugin.routes['content-api'].routes.push({
        method: 'GET',
        path: '/reset-password-redirect',
        handler: 'custom.resetPasswordRedirect',
        config: {
            auth: false,
        },
    });

    console.log('Custom routes added:', plugin.routes['content-api'].routes);

    return plugin;
};