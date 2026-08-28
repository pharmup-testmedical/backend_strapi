import React, { useEffect, useState } from 'react';
import { Box, Flex, Loader, Table, Tbody, Td, Th, Thead, Tr, Typography } from '@strapi/design-system';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AnalyticsFilters, CityRow, SortOrder, useAnalyticsApi } from '../api';

const numberFormat = new Intl.NumberFormat('ru-RU');
const money = (v: number) => `${numberFormat.format(Math.round(v))} ₸`;

type SortField = 'receiptsCount' | 'totalAmount' | 'uniqueUsers' | 'totalCashback';

const COLUMNS: { field: SortField; label: string }[] = [
  { field: 'receiptsCount', label: 'Чеков' },
  { field: 'totalAmount', label: 'Сумма' },
  { field: 'uniqueUsers', label: 'Пользователей' },
  { field: 'totalCashback', label: 'Кешбэк' },
];

interface Props {
  filters: AnalyticsFilters;
}

/**
 * Группировка по Receipt.organizationCity (город точки продажи, откуда
 * реально куплен чек) — НЕ по текущему городу пользователя. cityId=null
 * ("Город не определён") — чеки без адреса/KOFD/нераспознанный адрес,
 * см. src/analytics/queries.ts getCities.
 */
export default function Cities({ filters }: Props) {
  const api = useAnalyticsApi();
  const [rows, setRows] = useState<CityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortField>('receiptsCount');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getCities(filters, sortBy, sortOrder)
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message ?? 'Не удалось загрузить города');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.from, filters.to, filters.status, filters.ofdType, filters.cityId, sortBy, sortOrder]);

  const toggleSort = (field: SortField) => {
    if (field === sortBy) {
      setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc');
    } else {
      setSortBy(field);
      setSortOrder('desc');
    }
  };

  const topCities = rows.slice(0, 10);

  if (loading) {
    return (
      <Flex justifyContent="center" padding={8}>
        <Loader>Загрузка…</Loader>
      </Flex>
    );
  }

  if (error) {
    return (
      <Box padding={4}>
        <Typography textColor="danger600">{error}</Typography>
      </Box>
    );
  }

  return (
    <Flex direction="column" gap={4} alignItems="stretch">
      <Box background="neutral0" padding={4} borderColor="neutral150" hasRadius shadow="tableShadow">
        <Typography variant="pi" textColor="neutral500">
          Разбивка по городу точки продажи (адрес чека), не по городу пользователя. «Город не определён» — чеки
          без адреса (например KOFD) или с нераспознанным адресом.
        </Typography>
      </Box>

      <Box background="neutral0" padding={4} borderColor="neutral150" hasRadius shadow="tableShadow">
        <Typography variant="delta" fontWeight="bold">
          Топ-10 городов по {COLUMNS.find((c) => c.field === sortBy)?.label.toLowerCase()}
        </Typography>
        <Box marginTop={4} style={{ width: '100%', height: 280 }}>
          <ResponsiveContainer>
            <BarChart data={topCities} layout="vertical" margin={{ left: 24 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" fontSize={12} />
              <YAxis type="category" dataKey="cityName" fontSize={12} width={120} />
              <Tooltip
                formatter={(v: number) => (sortBy === 'totalAmount' || sortBy === 'totalCashback' ? money(v) : numberFormat.format(v))}
              />
              <Bar dataKey={sortBy} fill="#4945ff" />
            </BarChart>
          </ResponsiveContainer>
        </Box>
      </Box>

      <Box background="neutral0" borderColor="neutral150" hasRadius shadow="tableShadow" style={{ overflowX: 'auto' }}>
        <Table colCount={5} rowCount={rows.length + 1}>
          <Thead>
            <Tr>
              <Th>
                <Typography variant="sigma">Город (точка продажи)</Typography>
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
              <Tr key={row.cityId ?? 'null'}>
                <Td>
                  <Typography>{row.cityName}</Typography>
                </Td>
                <Td>
                  <Typography>{numberFormat.format(row.receiptsCount)}</Typography>
                </Td>
                <Td>
                  <Typography>{money(row.totalAmount)}</Typography>
                </Td>
                <Td>
                  <Typography>{numberFormat.format(row.uniqueUsers)}</Typography>
                </Td>
                <Td>
                  <Typography>{money(row.totalCashback)}</Typography>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </Box>
    </Flex>
  );
}
