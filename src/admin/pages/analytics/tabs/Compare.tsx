import React, { useEffect, useMemo, useState } from 'react';
import { Box, DatePicker, Flex, Loader, Typography } from '@strapi/design-system';
import { AnalyticsFilters, CompareData, PeriodStats, useAnalyticsApi } from '../api';

const numberFormat = new Intl.NumberFormat('ru-RU');
const money = (v: number) => `${numberFormat.format(Math.round(v))} ₸`;

const toIso = (d?: Date) => (d ? d.toISOString().slice(0, 10) : '');
const fromIso = (s: string) => (s ? new Date(s) : undefined);

const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 24 * 3600 * 1000);

const METRICS: { key: keyof PeriodStats; label: string; changeKey: keyof CompareData['change']; format: (v: number) => string }[] = [
  { key: 'receiptsCount', label: 'Чеков', changeKey: 'receiptsChangePercent', format: numberFormat.format },
  { key: 'totalAmount', label: 'Сумма', changeKey: 'amountChangePercent', format: money },
  { key: 'avgAmount', label: 'Средний чек', changeKey: 'avgAmountChangePercent', format: money },
  { key: 'uniqueUsers', label: 'Пользователей', changeKey: 'usersChangePercent', format: numberFormat.format },
  { key: 'totalCashback', label: 'Кешбэк', changeKey: 'cashbackChangePercent', format: money },
];

function ChangeBadge({ value }: { value: number | null }) {
  if (value == null) {
    return (
      <Typography variant="pi" textColor="neutral500">
        н/д
      </Typography>
    );
  }
  const positive = value > 0;
  const zero = value === 0;
  const color = zero ? 'neutral500' : positive ? 'success600' : 'danger600';
  const arrow = zero ? '' : positive ? '↑ ' : '↓ ';
  return (
    <Typography variant="pi" fontWeight="bold" textColor={color}>
      {arrow}
      {value > 0 ? '+' : ''}
      {value.toFixed(1)}%
    </Typography>
  );
}

interface Props {
  filters: AnalyticsFilters;
}

export default function Compare({ filters }: Props) {
  const api = useAnalyticsApi();

  const today = useMemo(() => new Date(), []);
  const [currentFrom, setCurrentFrom] = useState(toIso(addDays(today, -6)));
  const [currentTo, setCurrentTo] = useState(toIso(today));
  const [previousFrom, setPreviousFrom] = useState(toIso(addDays(today, -13)));
  const [previousTo, setPreviousTo] = useState(toIso(addDays(today, -7)));

  const [data, setData] = useState<CompareData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentFrom || !currentTo || !previousFrom || !previousTo) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getCompare(filters, currentFrom, currentTo, previousFrom, previousTo)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message ?? 'Не удалось сравнить периоды');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.status, filters.ofdType, filters.cityId, currentFrom, currentTo, previousFrom, previousTo]);

  return (
    <Flex direction="column" gap={4} alignItems="stretch">
      <Box background="neutral0" padding={4} borderColor="neutral150" hasRadius shadow="tableShadow">
        <Flex gap={6} wrap="wrap">
          <Box>
            <Typography variant="sigma" textColor="neutral600">
              Текущий период
            </Typography>
            <Flex gap={2} marginTop={1}>
              <DatePicker value={fromIso(currentFrom)} onChange={(d) => setCurrentFrom(toIso(d))} clearLabel="Очистить" />
              <DatePicker value={fromIso(currentTo)} onChange={(d) => setCurrentTo(toIso(d))} clearLabel="Очистить" />
            </Flex>
          </Box>
          <Box>
            <Typography variant="sigma" textColor="neutral600">
              Период сравнения
            </Typography>
            <Flex gap={2} marginTop={1}>
              <DatePicker value={fromIso(previousFrom)} onChange={(d) => setPreviousFrom(toIso(d))} clearLabel="Очистить" />
              <DatePicker value={fromIso(previousTo)} onChange={(d) => setPreviousTo(toIso(d))} clearLabel="Очистить" />
            </Flex>
          </Box>
        </Flex>
      </Box>

      {loading && (
        <Flex justifyContent="center" padding={8}>
          <Loader>Загрузка…</Loader>
        </Flex>
      )}

      {error && (
        <Box padding={4}>
          <Typography textColor="danger600">{error}</Typography>
        </Box>
      )}

      {!loading && !error && data && (
        <Box background="neutral0" borderColor="neutral150" hasRadius shadow="tableShadow" padding={4}>
          <Flex direction="column" gap={4} alignItems="stretch">
            {METRICS.map((m) => (
              <Flex key={m.key} justifyContent="space-between" alignItems="center" padding={2}>
                <Typography variant="omega" fontWeight="bold" style={{ minWidth: '10rem' }}>
                  {m.label}
                </Typography>
                <Flex gap={6} alignItems="center">
                  <Box>
                    <Typography variant="pi" textColor="neutral500">
                      Текущий
                    </Typography>
                    <Typography variant="beta">{m.format(data.current[m.key])}</Typography>
                  </Box>
                  <Box>
                    <Typography variant="pi" textColor="neutral500">
                      Сравнение
                    </Typography>
                    <Typography variant="beta">{m.format(data.previous[m.key])}</Typography>
                  </Box>
                  <ChangeBadge value={data.change[m.changeKey]} />
                </Flex>
              </Flex>
            ))}
          </Flex>
        </Box>
      )}
    </Flex>
  );
}
