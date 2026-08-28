/**
 * Единственный источник правды для сворачивания 8 реальных значений
 * Receipt.verificationStatus в смысловые группы. Используется и в
 * /analytics/ofd, и в /analytics/statuses — если раскладку когда-нибудь
 * понадобится поменять, менять нужно только здесь.
 *
 * Частично подтверждённые (auto/manually_partially_verified) — ОТДЕЛЬНАЯ
 * группа, не сливается с verified. Отклонённые из-за поздней подачи
 * (auto_rejected_late_submission) — тоже отдельная группа, не сливается
 * с rejected. Это касается только подсчёта ПО СТАТУСАМ — денежные суммы
 * (totalAmount/totalCashback) считаются по всем чекам независимо от
 * статуса и группы, группировка на них не влияет.
 */
export const STATUS_GROUPS = {
  verified: ['auto_verified', 'manually_verified'],
  partiallyVerified: ['auto_partially_verified', 'manually_partially_verified'],
  rejected: ['auto_rejected', 'manually_rejected'],
  rejectedLate: ['auto_rejected_late_submission'],
  pending: ['manual_review'],
} as const;

export type StatusGroup = keyof typeof STATUS_GROUPS;

export const STATUS_GROUP_NAMES = Object.keys(STATUS_GROUPS) as StatusGroup[];

const STATUS_TO_GROUP: Record<string, StatusGroup> = Object.fromEntries(
  (Object.entries(STATUS_GROUPS) as [StatusGroup, readonly string[]][]).flatMap(([group, statuses]) =>
    statuses.map((status) => [status, group])
  )
);

/** Бросает исключение на неизвестном статусе — сознательно, чтобы не проглатывать молча появление нового значения enum'а. */
export function classifyStatus(status: string): StatusGroup {
  const group = STATUS_TO_GROUP[status];
  if (!group) {
    throw new Error(`[status-groups] Неизвестный verificationStatus: "${status}" — добавьте его в STATUS_GROUPS`);
  }
  return group;
}

/** SQL-выражение SUM(CASE WHEN <column> IN (...) THEN 1 ELSE 0 END) для одной группы — для агрегирующих запросов типа /analytics/ofd. */
export function statusGroupCountExpr(column: string, group: StatusGroup): string {
  const statuses = STATUS_GROUPS[group];
  return `SUM(CASE WHEN ${column} IN ('${statuses.join("','")}') THEN 1 ELSE 0 END)`;
}
