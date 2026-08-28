import React, { useEffect, useState } from 'react';
import { Box, Flex, Loader, Typography } from '@strapi/design-system';
import { AnalyticsFilters, OfdRow, useAnalyticsApi } from '../api';

const numberFormat = new Intl.NumberFormat('ru-RU');
const money = (v: number) => `${numberFormat.format(Math.round(v))} ₸`;

const STATUS_GROUP_LABELS: { key: keyof OfdRow; label: string }[] = [
  { key: 'verifiedCount', label: 'Подтверждён' },
  { key: 'partiallyVerifiedCount', label: 'Частично' },
  { key: 'rejectedCount', label: 'Отклонён' },
  { key: 'rejectedLateCount', label: 'Отклонён (опоздание)' },
  { key: 'pendingCount', label: 'На проверке' },
];

interface Props {
  filters: AnalyticsFilters;
}

export default function Ofd({ filters }: Props) {
  const api = useAnalyticsApi();
  const [rows, setRows] = useState<OfdRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getOfd(filters)
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message ?? 'Не удалось загрузить данные по ОФД');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.from, filters.to, filters.status, filters.ofdType, filters.cityId]);

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
    <Flex gap={4} wrap="wrap" alignItems="stretch">
      {rows.map((row) => (
        <Box
          key={row.ofdType}
          background="neutral0"
          padding={4}
          borderColor="neutral150"
          hasRadius
          shadow="tableShadow"
          minWidth="18rem"
        >
          <Typography variant="delta" fontWeight="bold">
            {row.ofdType.toUpperCase()}
          </Typography>
          <Box marginTop={2}>
            <Typography variant="alpha" fontWeight="bold">
              {numberFormat.format(row.receiptsCount)} чеков
            </Typography>
          </Box>
          <Typography variant="pi" textColor="neutral500">
            {money(row.totalAmount)} · {money(row.totalCashback)} кешбэк · {numberFormat.format(row.uniqueUsers)} польз.
          </Typography>

          <Box marginTop={4}>
            <Flex direction="column" gap={2} alignItems="stretch">
              {STATUS_GROUP_LABELS.map(({ key, label }) => (
                <Flex key={key} justifyContent="space-between">
                  <Typography variant="pi" textColor="neutral600">
                    {label}
                  </Typography>
                  <Typography variant="pi" fontWeight="bold">
                    {numberFormat.format(row[key] as number)}
                  </Typography>
                </Flex>
              ))}
            </Flex>
          </Box>
        </Box>
      ))}
    </Flex>
  );
}
