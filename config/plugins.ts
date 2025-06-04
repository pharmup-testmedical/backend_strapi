export default ({ env }) => ({
    'users-permissions': {
        config: {
            register: {
                allowedFields: ['name', 'surname']
            }
        }
    }
});
