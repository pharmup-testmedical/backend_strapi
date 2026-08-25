async function syncSupplierName(event: any) {
    const { data } = event.params;
    const supplierId = data?.supplier?.set?.[0]?.id;
    if (!supplierId) return;

    const supplier = await strapi.db.query('api::supplier.supplier').findOne({
        where: { id: supplierId },
        select: ['name'],
    });

    if (supplier?.name) {
        data.supplierName = supplier.name;
    }
}

export default {
    async beforeCreate(event: any) {
        await syncSupplierName(event);
    },
    async beforeUpdate(event: any) {
        await syncSupplierName(event);
    },
};
