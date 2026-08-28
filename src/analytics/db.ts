import type { Core } from '@strapi/strapi';

export type SqlClient = 'mysql' | 'sqlite';

/**
 * Прод — MySQL, локальная разработка — SQLite (см. config/database.ts).
 * Postgres в проекте не используется нигде — сознательно не поддерживаем,
 * чтобы не тащить недостижимый в реальности код.
 */
export function getSqlClient(strapi: Core.Strapi): SqlClient {
  const client = strapi.db.config.connection.client;
  if (client === 'mysql' || client === 'sqlite') return client;
  throw new Error(
    `[analytics] Неподдерживаемый DATABASE_CLIENT="${client}" — ожидается mysql или sqlite`
  );
}

/**
 * ВАЖНО: knex/sqlite3-драйвер, которым пользуется Strapi, хранит datetime-
 * колонки в SQLite как epoch-миллисекунды (integer), а не как текстовую
 * дату — в отличие от MySQL, где это настоящий DATETIME. Поэтому
 * DATE()/strftime() в SQLite нужно кормить через модификатор 'unixepoch'
 * (который сам ожидает секунды, отсюда /1000). Без этого DATE(column)
 * тихо возвращает NULL на реальных данных, записанных через
 * strapi.documents().create() — воспроизвёл и проверил на живой БД.
 */
const sqliteEpoch = (column: string) => `${column} / 1000, 'unixepoch'`;

/** Группировка по календарному дню. */
export function dayExpr(client: SqlClient, column: string): string {
  if (client === 'mysql') {
    return `DATE(${column})`;
  }
  return `DATE(${sqliteEpoch(column)})`;
}

/** ISO-день недели: 1=понедельник … 7=воскресенье. */
export function weekdayExpr(client: SqlClient, column: string): string {
  if (client === 'mysql') {
    // DAYOFWEEK: 1=воскресенье..7=суббота → сдвигаем в ISO (1=пн..7=вс)
    return `((DAYOFWEEK(${column}) + 5) % 7) + 1`;
  }
  // SQLite strftime('%w'): 0=воскресенье..6=суббота → сдвигаем в ISO
  return `((CAST(strftime('%w', ${sqliteEpoch(column)}) AS INTEGER) + 6) % 7) + 1`;
}

/** Час покупки, 0-23. */
export function hourExpr(client: SqlClient, column: string): string {
  if (client === 'mysql') {
    return `HOUR(${column})`;
  }
  return `CAST(strftime('%H', ${sqliteEpoch(column)}) AS INTEGER)`;
}

/** Группировка по календарной неделе — возвращает дату понедельника этой недели (ISO, неделя начинается с пн). */
export function weekExpr(client: SqlClient, column: string): string {
  if (client === 'mysql') {
    // WEEKDAY(): 0=понедельник..6=воскресенье — вычитаем это число дней, получаем понедельник недели
    return `DATE(DATE_SUB(${column}, INTERVAL WEEKDAY(${column}) DAY))`;
  }
  // strftime('%w'): 0=воскресенье..6=суббота → дней с понедельника = (weekday+6)%7
  return `DATE(${sqliteEpoch(column)}, '-' || ((CAST(strftime('%w', ${sqliteEpoch(column)}) AS INTEGER) + 6) % 7) || ' days')`;
}
