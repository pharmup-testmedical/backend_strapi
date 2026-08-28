import React, { useEffect, useState } from 'react';
import { Box, Flex, Grid, Loader, Typography } from '@strapi/design-system';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AnalyticsFilters, DemographicsData, useAnalyticsApi } from '../api';

const numberFormat = new Intl.NumberFormat('ru-RU');

const AGE_GROUP_LABELS: Record<string, string> = {
  '18-25': '18–25',
  '26-35': '26–35',
  '36-45': '36–45',
  '46-60': '46–60',
  '60+': '60+',
  unknown: 'Не определён',
};

const GENDER_LABELS: Record<string, string> = {
  male: 'Мужчины',
  female: 'Женщины',
  unknown: 'Не определён',
};

const GENDER_COLORS: Record<string, string> = {
  male: '#4945ff',
  female: '#d02b20',
  unknown: '#a5a5ba',
};

interface Props {
  filters: AnalyticsFilters;
}

/**
 * Источник — возраст/пол, извлечённые из ИИН пользователя на бэкенде
 * (src/analytics/iin.ts). Сюда попадает уже только обезличенный агрегат —
 * ни ИИН, ни точная дата рождения на фронтенд не приходят никогда.
 */
export default function Demographics({ filters }: Props) {
  const api = useAnalyticsApi();
  const [data, setData] = useState<DemographicsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getDemographics(filters)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message ?? 'Не удалось загрузить демографию');
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

  if (!data) return null;

  const ageChartData = data.ageGroups.map((g) => ({ ...g, label: AGE_GROUP_LABELS[g.group] ?? g.group }));
  const genderChartData = data.genders.map((g) => ({ ...g, label: GENDER_LABELS[g.gender] ?? g.gender }));

  return (
    <Flex direction="column" gap={4} alignItems="stretch">
      <Box background="neutral0" padding={4} borderColor="neutral150" hasRadius shadow="tableShadow">
        <Typography variant="pi" textColor="neutral600">
          Всего пользователей в выборке
        </Typography>
        <Box marginTop={1}>
          <Typography variant="alpha" fontWeight="bold">
            {numberFormat.format(data.totalUsers)}
          </Typography>
        </Box>
      </Box>

      <Grid.Root gridCols={2} gap={4}>
        <Grid.Item col={1} alignItems="stretch">
          <Box background="neutral0" padding={4} borderColor="neutral150" hasRadius shadow="tableShadow" width="100%">
            <Typography variant="delta" fontWeight="bold">
              Возраст
            </Typography>
            <Box marginTop={4} style={{ width: '100%', height: 280 }}>
              <ResponsiveContainer>
                <BarChart data={ageChartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" fontSize={12} />
                  <YAxis fontSize={12} />
                  <Tooltip formatter={(v: number) => numberFormat.format(v)} />
                  <Bar dataKey="count" fill="#4945ff" />
                </BarChart>
              </ResponsiveContainer>
            </Box>
          </Box>
        </Grid.Item>
        <Grid.Item col={1} alignItems="stretch">
          <Box background="neutral0" padding={4} borderColor="neutral150" hasRadius shadow="tableShadow" width="100%">
            <Typography variant="delta" fontWeight="bold">
              Пол
            </Typography>
            <Box marginTop={4} style={{ width: '100%', height: 280 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={genderChartData} dataKey="count" nameKey="label" outerRadius={90} label>
                    {genderChartData.map((g) => (
                      <Cell key={g.gender} fill={GENDER_COLORS[g.gender] ?? '#a5a5ba'} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => numberFormat.format(v)} />
                </PieChart>
              </ResponsiveContainer>
            </Box>
          </Box>
        </Grid.Item>
      </Grid.Root>
    </Flex>
  );
}
