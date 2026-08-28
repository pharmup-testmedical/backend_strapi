import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Box,
  Flex,
  Grid,
  IconButton,
  Loader,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Typography,
} from '@strapi/design-system';
import { ArrowLeft, ArrowRight } from '@strapi/icons';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AnalyticsFilters, UserCityRow, UserDailyPoint, UserDetail as UserDetailData, UserReceiptRow, useAnalyticsApi } from './api';

const numberFormat = new Intl.NumberFormat('ru-RU');
const money = (v: number) => `${numberFormat.format(Math.round(v))} ₸`;

const STATUS_LABELS: Record<string, string> = {
  auto_verified: 'Авто-подтверждён',
  manually_verified: 'Подтверждён вручную',
  auto_partially_verified: 'Авто, частично',
  manually_partially_verified: 'Вручную, частично',
  auto_rejected: 'Авто-отклонён',
  manually_rejected: 'Отклонён вручную',
  auto_rejected_late_submission: 'Отклонён (поздняя подача)',
  manual_review: 'На проверке',
};

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <Box background="neutral0" padding={4} borderColor="neutral150" hasRadius shadow="tableShadow">
      <Typography variant="sigma" textColor="neutral600">
        {label}
      </Typography>
      <Box marginTop={1}>
        <Typography variant="beta" fontWeight="bold">
          {value}
        </Typography>
      </Box>
    </Box>
  );
}

const PAGE_SIZE = 20;

interface Props {
  filters: AnalyticsFilters;
}

/**
 * /analytics/users/:id — вложенный роут внутри analytics/* (wildcard,
 * зарегистрирован через addMenuLink в app.tsx). :id — numeric id
 * пользователя, не documentId (так его отдаёт /analytics/users).
 */
export default function UserDetail({ filters }: Props) {
  const { id } = useParams<{ id: string }>();
  const userId = Number(id);
  const navigate = useNavigate();
  const api = useAnalyticsApi();

  const [detail, setDetail] = useState<UserDetailData | null>(null);
  const [daily, setDaily] = useState<UserDailyPoint[]>([]);
  const [cities, setCities] = useState<UserCityRow[]>([]);
  const [receipts, setReceipts] = useState<UserReceiptRow[]>([]);
  const [receiptsTotal, setReceiptsTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setNotFound(false);

    Promise.all([
      api.getUserDetail(userId, filters),
      api.getUserDaily(userId, filters),
      api.getUserCities(userId, filters),
    ])
      .then(([d, dl, c]) => {
        if (cancelled) return;
        setDetail(d);
        setDaily(dl);
        setCities(c);
      })
      .catch((e) => {
        if (cancelled) return;
        if (e?.status === 404) setNotFound(true);
        else setError(e?.message ?? 'Не удалось загрузить пользователя');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, filters.from, filters.to, filters.status, filters.ofdType, filters.cityId]);

  useEffect(() => {
    let cancelled = false;
    api
      .getUserReceipts(userId, filters, 'date', 'desc', page, PAGE_SIZE)
      .then(({ rows, pagination }) => {
        if (cancelled) return;
        setReceipts(rows);
        setReceiptsTotal(pagination.total);
      })
      .catch(() => {
        if (!cancelled) setReceipts([]);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, filters.from, filters.to, filters.status, filters.ofdType, filters.cityId, page]);

  const pageCount = Math.max(1, Math.ceil(receiptsTotal / PAGE_SIZE));

  if (loading) {
    return (
      <Flex justifyContent="center" padding={8}>
        <Loader>Загрузка…</Loader>
      </Flex>
    );
  }

  if (notFound) {
    return (
      <Box padding={8}>
        <Typography>Пользователь не найден.</Typography>
      </Box>
    );
  }

  if (error || !detail) {
    return (
      <Box padding={8}>
        <Typography textColor="danger600">{error ?? 'Не удалось загрузить пользователя'}</Typography>
      </Box>
    );
  }

  return (
    <Box padding={8}>
      <Flex gap={3} alignItems="center" marginBottom={4}>
        <IconButton label="Назад к списку" onClick={() => navigate('/analytics')}>
          <ArrowLeft />
        </IconButton>
        <Box>
          <Typography variant="alpha" tag="h1">
            {detail.name ?? `Пользователь #${detail.userId}`}
          </Typography>
          <Typography variant="pi" textColor="neutral600">
            {detail.phone ?? '—'} · город в профиле: {detail.userCity ?? 'не указан'}
          </Typography>
        </Box>
      </Flex>

      <Flex direction="column" gap={4} alignItems="stretch">
        <Grid.Root gridCols={5} gap={4}>
          <Grid.Item col={1}>
            <KpiCard label="Чеков" value={numberFormat.format(detail.receiptsCount)} />
          </Grid.Item>
          <Grid.Item col={1}>
            <KpiCard label="Сумма" value={money(detail.totalAmount)} />
          </Grid.Item>
          <Grid.Item col={1}>
            <KpiCard label="Средний чек" value={money(detail.avgAmount)} />
          </Grid.Item>
          <Grid.Item col={1}>
            <KpiCard label="Кешбэк" value={money(detail.totalCashback)} />
          </Grid.Item>
          <Grid.Item col={1}>
            <KpiCard label="Активных дней" value={numberFormat.format(detail.activeDays)} />
          </Grid.Item>
        </Grid.Root>

        <Box background="neutral0" padding={4} borderColor="neutral150" hasRadius shadow="tableShadow">
          <Typography variant="pi" textColor="neutral600">
            Первый чек {detail.firstReceiptDate ?? '—'} · последний {detail.lastReceiptDate ?? '—'}
          </Typography>
        </Box>

        <Box background="neutral0" padding={4} borderColor="neutral150" hasRadius shadow="tableShadow">
          <Typography variant="delta" fontWeight="bold">
            Чеки по дням
          </Typography>
          <Box marginTop={4} style={{ width: '100%', height: 260 }}>
            <ResponsiveContainer>
              <BarChart data={daily}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" fontSize={12} />
                <YAxis fontSize={12} />
                <Tooltip formatter={(v: number) => numberFormat.format(v)} />
                <Bar dataKey="count" fill="#4945ff" />
              </BarChart>
            </ResponsiveContainer>
          </Box>
        </Box>

        <Box background="neutral0" padding={4} borderColor="neutral150" hasRadius shadow="tableShadow">
          <Typography variant="delta" fontWeight="bold">
            Статусы
          </Typography>
          <Flex marginTop={4} gap={4} wrap="wrap">
            {Object.entries(detail.statuses)
              .filter(([, count]) => count > 0)
              .map(([status, count]) => (
                <Box key={status} padding={3} background="neutral100" hasRadius minWidth="12rem">
                  <Typography variant="pi" textColor="neutral600">
                    {STATUS_LABELS[status] ?? status}
                  </Typography>
                  <Box marginTop={1}>
                    <Typography variant="beta" fontWeight="bold">
                      {numberFormat.format(count)}
                    </Typography>
                  </Box>
                </Box>
              ))}
          </Flex>
        </Box>

        <Box background="neutral0" padding={4} borderColor="neutral150" hasRadius shadow="tableShadow">
          <Typography variant="delta" fontWeight="bold">
            Города покупок
          </Typography>
          <Typography variant="pi" textColor="neutral500">
            По адресу точки продажи, не по городу пользователя
          </Typography>
          <Flex marginTop={4} gap={4} wrap="wrap">
            {cities.map((c) => (
              <Box key={c.cityId ?? 'null'} padding={3} background="neutral100" hasRadius minWidth="12rem">
                <Typography variant="pi" textColor="neutral600">
                  {c.cityName}
                </Typography>
                <Box marginTop={1}>
                  <Typography variant="beta" fontWeight="bold">
                    {numberFormat.format(c.receiptsCount)} чеков
                  </Typography>
                </Box>
                <Typography variant="pi" textColor="neutral500">
                  {money(c.totalAmount)}
                </Typography>
              </Box>
            ))}
          </Flex>
        </Box>

        <Box background="neutral0" borderColor="neutral150" hasRadius shadow="tableShadow" style={{ overflowX: 'auto' }}>
          <Table colCount={7} rowCount={receipts.length + 1}>
            <Thead>
              <Tr>
                <Th>
                  <Typography variant="sigma">Дата</Typography>
                </Th>
                <Th>
                  <Typography variant="sigma">Сумма</Typography>
                </Th>
                <Th>
                  <Typography variant="sigma">Кешбэк</Typography>
                </Th>
                <Th>
                  <Typography variant="sigma">Статус</Typography>
                </Th>
                <Th>
                  <Typography variant="sigma">ОФД</Typography>
                </Th>
                <Th>
                  <Typography variant="sigma">Организация</Typography>
                </Th>
                <Th>
                  <Typography variant="sigma">Позиций</Typography>
                </Th>
              </Tr>
            </Thead>
            <Tbody>
              {receipts.map((r) => (
                <Tr key={r.receiptId}>
                  <Td>
                    <Typography>{r.date?.slice(0, 10)}</Typography>
                  </Td>
                  <Td>
                    <Typography>{money(r.totalAmount)}</Typography>
                  </Td>
                  <Td>
                    <Typography>{money(r.cashback)}</Typography>
                  </Td>
                  <Td>
                    <Typography>{STATUS_LABELS[r.verificationStatus] ?? r.verificationStatus}</Typography>
                  </Td>
                  <Td>
                    <Typography>{r.ofdType.toUpperCase()}</Typography>
                  </Td>
                  <Td>
                    <Typography>{r.organizationName ?? '—'}</Typography>
                  </Td>
                  <Td>
                    <Typography>{numberFormat.format(r.itemsCount)}</Typography>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </Box>

        <Flex justifyContent="space-between" alignItems="center">
          <Typography variant="pi" textColor="neutral600">
            Всего чеков: {numberFormat.format(receiptsTotal)}
          </Typography>
          <Flex gap={2} alignItems="center">
            <IconButton label="Предыдущая страница" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              <ArrowLeft />
            </IconButton>
            <Typography variant="pi">
              {page} / {pageCount}
            </Typography>
            <IconButton
              label="Следующая страница"
              disabled={page >= pageCount}
              onClick={() => setPage(page + 1)}
            >
              <ArrowRight />
            </IconButton>
          </Flex>
        </Flex>
      </Flex>
    </Box>
  );
}
