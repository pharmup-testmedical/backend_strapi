import type { Core } from '@strapi/strapi';

const INDEXES: Array<{ table: string; column: string; name: string }> = [
  { table: 'receipts', column: 'date', name: 'receipts_date_idx' },
  { table: 'receipts', column: 'verification_status', name: 'receipts_verification_status_idx' },
  { table: 'receipts', column: 'ofd_type', name: 'receipts_ofd_type_idx' },
];

/**
 * date/verification_status/ofd_type не unique, поэтому Strapi их не
 * индексирует сама — а именно по ним идут WHERE/GROUP BY в аналитике.
 * Идемпотентно: при повторном запуске просто ловим "уже существует" и
 * идём дальше. Не критично для старта приложения — ошибка только логируется.
 */
export async function ensureAnalyticsIndexes(strapi: Core.Strapi) {
  const knex = strapi.db.connection;

  for (const { table, column, name } of INDEXES) {
    try {
      await knex.schema.alterTable(table, (t) => t.index([column], name));
      strapi.log.info(`[analytics] Индекс ${name} создан`);
    } catch (error: any) {
      const message = String(error?.message ?? '').toLowerCase();
      if (message.includes('duplicate') || message.includes('already exists')) {
        continue;
      }
      strapi.log.error(`[analytics] Не удалось создать индекс ${name}:`, error);
    }
  }
}
