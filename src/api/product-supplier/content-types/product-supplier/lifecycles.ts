function extractSupplierId(supplierInput: any): number | null {
    if (!supplierInput) return null;
    if (typeof supplierInput === 'number') return supplierInput;
    return supplierInput.connect?.[0]?.id ?? supplierInput.set?.[0]?.id ?? null;
}

async function syncSupplierName(event: any) {
    const { data } = event.params;
    const supplierId = extractSupplierId(data?.supplier);
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
