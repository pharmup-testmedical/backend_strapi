module.exports = async () => {
    const entries = await strapi.db.query('api::receipt.receipt').findMany({
        where: { ofdType: null },
    })

    for (const entry of entries) {
        await strapi.db.query('api::receipt.receipt').update({
            where: { id: entry.id },
            data: { ofdType: 'oofd' },
        })
    }

    console.log(`Set "oofd" for ${entries.length} existing receipts`)
}
