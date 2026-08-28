import React, { useEffect, useMemo, useState } from 'react';
import { Box, Flex, Loader, SingleSelect, SingleSelectOption, Table, Tbody, Td, Th, Thead, Tr, Typography } from '@strapi/design-system';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AnalyticsFilters, AppVersionRow, AppVersionTrendPoint, useAnalyticsApi } from '../api';

const numberFormat = new Intl.NumberFormat('ru-RU');
const money = (v: number) => `${numberFormat.format(Math.round(v))} ₸`;

const LINE_COLORS = ['#4945ff', '#00b0b6', '#d02b20', '#ff8f00', '#9736e8', '#328048', '#4a4a6a'];

interface Props {
  filters: AnalyticsFilters;
}

/**
 * Receipt.appVersion хранится на каждом чеке (не на User) — поэтому
 * динамика по датам возможна: значение фиксируется в момент отправки
 * чека, а не отражает текущую версию телефона пользователя.
 */
export default function AppVersions({ filters }: Props) {
  const api = useAnalyticsApi();
  const [rows, setRows] = useState<AppVersionRow[]>([]);
  const [trend, setTrend] = useState<AppVersionTrendPoint[]>([]);
  const [granularity, setGranularity] = useState<'day' | 'week'>('day');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([api.getAppVersions(filters), api.getAppVersionsTrend(filters, granularity)])
      .then(([r, t]) => {
        if (cancelled) return;
        setRows(r);
        setTrend(t);
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message ?? 'Не удалось загрузить версии приложения');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.from, filters.to, filters.status, filters.ofdType, filters.cityId, granularity]);

  const { chartData, versionKeys } = useMemo(() => {
    const byPeriod = new Map<string, Record<string, string | number>>();
    const keys = new Set<string>();
    for (const point of trend) {
      const key = point.appVersion ?? 'не указана';
      keys.add(key);
      if (!byPeriod.has(point.period)) byPeriod.set(point.period, { period: point.period });
      (byPeriod.get(point.period) as Record<string, number>)[key] = point.count;
    }
    const data = Array.from(byPeriod.values()).sort((a, b) =>
      String(a.period).localeCompare(String(b.period))
    );
    return { chartData: data, versionKeys: Array.from(keys) };
  }, [trend]);

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
        <Flex justifyContent="space-between" alignItems="center">
          <Typography variant="delta" fontWeight="bold">
            Динамика версий
          </Typography>
          <Box minWidth="10rem">
            <SingleSelect value={granularity} onChange={(v) => setGranularity(v as 'day' | 'week')}>
              <SingleSelectOption value="day">По дням</SingleSelectOption>
              <SingleSelectOption value="week">По неделям</SingleSelectOption>
            </SingleSelect>
          </Box>
        </Flex>
        <Box marginTop={4} style={{ width: '100%', height: 300 }}>
          <ResponsiveContainer>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="period" fontSize={12} />
              <YAxis fontSize={12} />
              <Tooltip formatter={(v: number) => numberFormat.format(v)} />
              <Legend />
              {versionKeys.map((key, i) => (
                <Line
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stroke={LINE_COLORS[i % LINE_COLORS.length]}
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </Box>
      </Box>

      <Box background="neutral0" borderColor="neutral150" hasRadius shadow="tableShadow" style={{ overflowX: 'auto' }}>
        <Table colCount={4} rowCount={rows.length + 1}>
          <Thead>
            <Tr>
              <Th>
                <Typography variant="sigma">Версия</Typography>
              </Th>
              <Th>
                <Typography variant="sigma">Чеков</Typography>
              </Th>
              <Th>
                <Typography variant="sigma">Сумма</Typography>
              </Th>
              <Th>
                <Typography variant="sigma">Пользователей</Typography>
              </Th>
            </Tr>
          </Thead>
          <Tbody>
            {rows.map((row) => (
              <Tr key={row.appVersion ?? 'null'}>
                <Td>
                  <Typography>{row.appVersion ?? 'Не указана'}</Typography>
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
              </Tr>
            ))}
          </Tbody>
        </Table>
      </Box>
    </Flex>
  );
}
