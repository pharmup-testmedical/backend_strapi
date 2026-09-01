import type { Core } from '@strapi/strapi';
import * as queries from './queries';

type Handler = (ctx: any) => Promise<void>;

const safeHandler = (strapi: Core.Strapi, fn: (ctx: any) => Promise<void>): Handler => {
  return async (ctx) => {
    try {
      await fn(ctx);
    } catch (error: any) {
      strapi.log.error('[user-verification] Ошибка:', error);
      ctx.badRequest(error.message || 'Не удалось выполнить запрос');
    }
  };
};

function parseUserIdParam(ctx: any): number {
  const raw = ctx.params?.userId;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`Некорректный id пользователя: "${raw}"`);
  }
  return id;
}

async function resolveUser(strapi: Core.Strapi, userId: number) {
  return queries.getUserByNumericId(strapi, userId);
}

function serializeUser(user: NonNullable<Awaited<ReturnType<typeof queries.getUserByNumericId>>>) {
  return {
    id: user.id,
    name: user.name,
    surname: user.surname,
    phone: user.phone,
    email: user.email,
  };
}

export const createControllers = (strapi: Core.Strapi) => ({
  search: safeHandler(strapi, async (ctx) => {
    const q = String(ctx.query?.q ?? '').trim();
    if (q.length < 2) {
      ctx.body = { data: [] };
      return;
    }
    ctx.body = { data: await queries.searchUsers(strapi, q) };
  }),

  summary: safeHandler(strapi, async (ctx) => {
    const userId = parseUserIdParam(ctx);
    const user = await resolveUser(strapi, userId);
    if (!user) return ctx.notFound('Пользователь не найден');

    const summary = await queries.computeBalanceSummary(strapi, user.documentId, Number(user.account) || 0);
    ctx.body = { data: { user: serializeUser(user), ...summary } };
  }),

  receipts: safeHandler(strapi, async (ctx) => {
    const userId = parseUserIdParam(ctx);
    const user = await resolveUser(strapi, userId);
    if (!user) return ctx.notFound('Пользователь не найден');

    const page = Math.max(1, Number(ctx.query?.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(ctx.query?.pageSize) || 20));
    const status = ctx.query?.status ? String(ctx.query.status) : undefined;

    const { rows, pagination } = await queries.getReceiptsPage(strapi, user.documentId, page, pageSize, status);
    ctx.body = { data: rows, pagination };
  }),

  receiptDetail: safeHandler(strapi, async (ctx) => {
    const userId = parseUserIdParam(ctx);
    const user = await resolveUser(strapi, userId);
    if (!user) return ctx.notFound('Пользователь не найден');

    const receipt = await queries.getReceiptDetail(strapi, user.documentId, String(ctx.params.receiptId));
    if (!receipt) return ctx.notFound('Чек не найден');
    ctx.body = { data: receipt };
  }),

  transactions: safeHandler(strapi, async (ctx) => {
    const userId = parseUserIdParam(ctx);
    const user = await resolveUser(strapi, userId);
    if (!user) return ctx.notFound('Пользователь не найден');

    const page = Math.max(1, Number(ctx.query?.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(ctx.query?.pageSize) || 50));
    const kind = ctx.query?.kind ? String(ctx.query.kind) : undefined;

    const all = await queries.getTransactionsFeed(strapi, user.documentId);
    const filtered = kind ? all.filter((t) => t.kind === kind) : all;
    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const rows = filtered.slice(start, start + pageSize);

    ctx.body = { data: rows, pagination: { page, pageSize, total } };
  }),
});
