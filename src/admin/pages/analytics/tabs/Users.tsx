import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, Flex, IconButton, Loader, Table, Tbody, Td, Th, Thead, Tr, Typography } from '@strapi/design-system';
import { ArrowLeft, ArrowRight } from '@strapi/icons';
import { AnalyticsFilters, SortOrder, UserRow, useAnalyticsApi } from '../api';

const numberFormat = new Intl.NumberFormat('ru-RU');
const money = (v: number) => `${numberFormat.format(Math.round(v))} ₸`;

type SortField =
  | 'receiptsCount'
  | 'totalAmount'
  | 'avgAmount'
  | 'totalCashback'
  | 'activeDays'
  | 'firstReceiptDate'
  | 'lastReceiptDate';

const COLUMNS: { field: SortField; label: string }[] = [
  { field: 'receiptsCount', label: 'Чеков' },
  { field: 'totalAmount', label: 'Сумма' },
  { field: 'avgAmount', label: 'Средний чек' },
  { field: 'totalCashback', label: 'Кешбэк' },
  { field: 'activeDays', label: 'Активных дней' },
  { field: 'firstReceiptDate', label: 'Первый чек' },
  { field: 'lastReceiptDate', label: 'Последний чек' },
];

const PAGE_SIZE = 20;

interface Props {
  filters: AnalyticsFilters;
}

export default function Users({ filters }: Props) {
  const api = useAnalyticsApi();
  const navigate = useNavigate();
  const [rows, setRows] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [sortBy, setSortBy] = useState<SortField>('totalAmount');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setOffset(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.from, filters.to, filters.status, filters.ofdType, filters.cityId, sortBy, sortOrder]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getUsersList(filters, sortBy, sortOrder, PAGE_SIZE, offset)
      .then(({ rows: r, pagination }) => {
        if (cancelled) return;
        setRows(r);
        setTotal(pagination.total);
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message ?? 'Не удалось загрузить пользователей');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.from, filters.to, filters.status, filters.ofdType, filters.cityId, sortBy, sortOrder, offset]);

  const toggleSort = (field: SortField) => {
    if (field === sortBy) {
      setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc');
    } else {
      setSortBy(field);
      setSortOrder('desc');
    }
  };

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (error) {
    return (
      <Box padding={4}>
        <Typography textColor="danger600">{error}</Typography>
      </Box>
    );
  }

  return (
    <Flex direction="column" gap={4} alignItems="stretch">
      <Box background="neutral0" borderColor="neutral150" hasRadius shadow="tableShadow" style={{ overflowX: 'auto' }}>
        <Table colCount={COLUMNS.length + 3} rowCount={rows.length + 1}>
          <Thead>
            <Tr>
              <Th>
                <Typography variant="sigma">Имя</Typography>
              </Th>
              <Th>
                <Typography variant="sigma">Телефон</Typography>
              </Th>
              <Th>
                <Typography variant="sigma">Город (профиль)</Typography>
              </Th>
              {COLUMNS.map((c) => (
                <Th key={c.field} onClick={() => toggleSort(c.field)} style={{ cursor: 'pointer' }}>
                  <Typography variant="sigma">
                    {c.label}
                    {sortBy === c.field ? (sortOrder === 'desc' ? ' ↓' : ' ↑') : ''}
                  </Typography>
                </Th>
              ))}
            </Tr>
          </Thead>
          <Tbody>
            {rows.map((row) => (
              <Tr
                key={row.userId}
                onClick={() => navigate(`/analytics/users/${row.userId}`)}
                style={{ cursor: 'pointer' }}
              >
                <Td>
                  <Typography>{row.name ?? '—'}</Typography>
                </Td>
                <Td>
                  <Typography>{row.phone ?? '—'}</Typography>
                </Td>
                <Td>
                  <Typography>{row.userCity ?? '—'}</Typography>
                </Td>
                <Td>
                  <Typography>{numberFormat.format(row.receiptsCount)}</Typography>
                </Td>
                <Td>
                  <Typography>{money(row.totalAmount)}</Typography>
                </Td>
                <Td>
                  <Typography>{money(row.avgAmount)}</Typography>
                </Td>
                <Td>
                  <Typography>{money(row.totalCashback)}</Typography>
                </Td>
                <Td>
                  <Typography>{numberFormat.format(row.activeDays)}</Typography>
                </Td>
                <Td>
                  <Typography>{row.firstReceiptDate ?? '—'}</Typography>
                </Td>
                <Td>
                  <Typography>{row.lastReceiptDate ?? '—'}</Typography>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
        {loading && (
          <Flex justifyContent="center" padding={4}>
            <Loader small>Загрузка…</Loader>
          </Flex>
        )}
      </Box>

      <Flex justifyContent="space-between" alignItems="center">
        <Typography variant="pi" textColor="neutral600">
          Всего пользователей: {numberFormat.format(total)}
        </Typography>
        <Flex gap={2} alignItems="center">
          <IconButton
            label="Предыдущая страница"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          >
            <ArrowLeft />
          </IconButton>
          <Typography variant="pi">
            {page} / {pageCount}
          </Typography>
          <IconButton
            label="Следующая страница"
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => setOffset(offset + PAGE_SIZE)}
          >
            <ArrowRight />
          </IconButton>
        </Flex>
      </Flex>
    </Flex>
  );
}
