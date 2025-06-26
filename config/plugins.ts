export default ({ env }) => ({
    email: {
        config: {
            provider: '@strapi/provider-email-nodemailer',
            providerOptions: {
                // SMTP-only configuration
                host: env('EMAIL_HOST'),
                port: env('EMAIL_PORT'),
                auth: {
                    user: env('EMAIL_USER'),
                    pass: env('EMAIL_PASS'),
                },
                secure: false, // Use false for STARTTLS
                requireTLS: true, // Enforce STARTTLS
                // logger: true,
            },
            settings: {
                defaultFrom: env('EMAIL_USER'),
                defaultReplyTo: env('EMAIL_USER'),
            },
            hooks: {
                logger: './src/extensions/email/hooks/logger.ts',
            },
        },
    },

    'users-permissions': {
        config: {
            register: {
                allowedFields: ['name', 'surname', 'city'], // custom fields
            },
            email_confirmation: true, // require email verification
            email_confirmation_redirection: env('FRONTEND_CONFIRMATION_REDIRECT'),
            reset_password: {
                redirection: env('FRONTEND_RESET_PASSWORD_REDIRECT'),
            },
            providers: {
                google: {
                    clientId: env('GOOGLE_CLIENT_ID'),
                    clientSecret: env('GOOGLE_CLIENT_SECRET'),
                },
            },
        },
    },
});
