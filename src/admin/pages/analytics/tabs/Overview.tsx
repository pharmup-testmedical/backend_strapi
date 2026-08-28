import React, { useEffect, useMemo, useState } from 'react';
import { Box, Flex, Grid, Loader, SingleSelect, SingleSelectOption, Typography } from '@strapi/design-system';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AnalyticsFilters,
  DailyPoint,
  CashbackDailyPoint,
  HourlyPoint,
  OverviewData,
  PlatformRow,
  StatusRow,
  WeekdayPoint,
  useAnalyticsApi,
} from '../api';

const numberFormat = new Intl.NumberFormat('ru-RU');
const money = (v: number) => `${numberFormat.format(Math.round(v))} ₸`;

const WEEKDAY_LABELS = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

const STATUS_GROUP_LABELS: Record<string, string> = {
  verified: 'Подтверждён',
  partiallyVerified: 'Частично подтверждён',
  rejected: 'Отклонён',
  rejectedLate: 'Отклонён (поздняя подача)',
  pending: 'На проверке',
};

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <Box background="neutral0" padding={4} borderColor="neutral150" hasRadius shadow="tableShadow">
      <Typography variant="sigma" textColor="neutral600">
        {label}
      </Typography>
      <Box marginTop={1}>
        <Typography variant="alpha" fontWeight="bold">
          {value}
        </Typography>
      </Box>
    </Box>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box background="neutral0" padding={4} borderColor="neutral150" hasRadius shadow="tableShadow">
      <Typography variant="delta" fontWeight="bold">
        {title}
      </Typography>
      <Box marginTop={4} style={{ width: '100%', height: 260 }}>
        {children}
      </Box>
    </Box>
  );
}

interface Props {
  filters: AnalyticsFilters;
}

export default function Overview({ filters }: Props) {
  const api = useAnalyticsApi();
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [receiptsDaily, setReceiptsDaily] = useState<DailyPoint[]>([]);
  const [cashbackDaily, setCashbackDaily] = useState<CashbackDailyPoint[]>([]);
  const [statuses, setStatuses] = useState<StatusRow[]>([]);
  const [weekday, setWeekday] = useState<WeekdayPoint[]>([]);
  const [hourly, setHourly] = useState<HourlyPoint[]>([]);
  const [platforms, setPlatforms] = useState<{ data: PlatformRow[]; note: string } | null>(null);
  const [dailyMetric, setDailyMetric] = useState<'count' | 'sum'>('count');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      api.getOverview(filters),
      api.getReceiptsDaily(filters),
      api.getCashbackDaily(filters),
      api.getStatuses(filters),
      api.getWeekday(filters),
      api.getHourly(filters),
      api.getPlatforms(filters),
    ])
      .then(([o, rd, cd, st, wd, hr, pl]) => {
        if (cancelled) return;
        setOverview(o);
        setReceiptsDaily(rd);
        setCashbackDaily(cd);
        setStatuses(st);
        setWeekday(wd);
        setHourly(hr);
        setPlatforms(pl);
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message ?? 'Не удалось загрузить аналитику');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.from, filters.to, filters.status, filters.ofdType, filters.cityId]);

  const weekdayChartData = useMemo(
    () => weekday.map((w) => ({ ...w, label: WEEKDAY_LABELS[w.weekday] ?? String(w.weekday) })),
    [weekday]
  );

  const statusGroups = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const row of statuses) {
      totals[row.group] = (totals[row.group] ?? 0) + row.count;
    }
    return Object.entries(totals);
  }, [statuses]);

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
      <Grid.Root gridCols={5} gap={4}>
        <Grid.Item col={1}>
          <KpiCard label="Чеков" value={overview ? numberFormat.format(overview.receiptsCount) : '—'} />
        </Grid.Item>
        <Grid.Item col={1}>
          <KpiCard label="Сумма" value={overview ? money(overview.totalAmount) : '—'} />
        </Grid.Item>
        <Grid.Item col={1}>
          <KpiCard label="Средний чек" value={overview ? money(overview.avgAmount) : '—'} />
        </Grid.Item>
        <Grid.Item col={1}>
          <KpiCard label="Кешбэк" value={overview ? money(overview.totalCashback) : '—'} />
        </Grid.Item>
        <Grid.Item col={1}>
          <KpiCard label="Пользователей" value={overview ? numberFormat.format(overview.uniqueUsers) : '—'} />
        </Grid.Item>
      </Grid.Root>

      <Box background="neutral0" padding={4} borderColor="neutral150" hasRadius shadow="tableShadow">
        <Flex justifyContent="space-between" alignItems="center">
          <Typography variant="delta" fontWeight="bold">
            Чеки по дням
          </Typography>
          <Box minWidth="12rem">
            <SingleSelect value={dailyMetric} onChange={(v) => setDailyMetric(v as 'count' | 'sum')}>
              <SingleSelectOption value="count">Количество</SingleSelectOption>
              <SingleSelectOption value="sum">Сумма, ₸</SingleSelectOption>
            </SingleSelect>
          </Box>
        </Flex>
        <Box marginTop={4} style={{ width: '100%', height: 280 }}>
          <ResponsiveContainer>
            <LineChart data={receiptsDaily}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="day" fontSize={12} />
              <YAxis fontSize={12} />
              <Tooltip formatter={(v: number) => (dailyMetric === 'sum' ? money(v) : numberFormat.format(v))} />
              <Line type="monotone" dataKey={dailyMetric} stroke="#4945ff" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </Box>
      </Box>

      <ChartCard title="Кешбэк по дням">
        <ResponsiveContainer>
          <LineChart data={cashbackDaily}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="day" fontSize={12} />
            <YAxis fontSize={12} />
            <Tooltip formatter={(v: number) => money(v)} />
            <Line type="monotone" dataKey="cashback" stroke="#00b0b6" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <Grid.Root gridCols={2} gap={4}>
        <Grid.Item col={1} alignItems="stretch">
          <ChartCard title="По дням недели">
            <ResponsiveContainer>
              <BarChart data={weekdayChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" fontSize={12} />
                <YAxis fontSize={12} />
                <Tooltip formatter={(v: number) => numberFormat.format(v)} />
                <Bar dataKey="count" fill="#4945ff" />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </Grid.Item>
        <Grid.Item col={1} alignItems="stretch">
          <ChartCard title="По часам">
            <ResponsiveContainer>
              <BarChart data={hourly}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="hour" fontSize={12} />
                <YAxis fontSize={12} />
                <Tooltip formatter={(v: number) => numberFormat.format(v)} />
                <Bar dataKey="count" fill="#00b0b6" />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </Grid.Item>
      </Grid.Root>

      <Box background="neutral0" padding={4} borderColor="neutral150" hasRadius shadow="tableShadow">
        <Typography variant="delta" fontWeight="bold">
          Статусы
        </Typography>
        <Flex marginTop={4} gap={4} wrap="wrap">
          {statusGroups.map(([group, count]) => (
            <Box key={group} padding={3} background="neutral100" hasRadius minWidth="10rem">
              <Typography variant="pi" textColor="neutral600">
                {STATUS_GROUP_LABELS[group] ?? group}
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

      {platforms && (
        <Box background="neutral0" padding={4} borderColor="neutral150" hasRadius shadow="tableShadow">
          <Typography variant="delta" fontWeight="bold">
            Платформы
          </Typography>
          <Flex marginTop={4} gap={4} wrap="wrap">
            {platforms.data.map((p) => (
              <Box key={p.platform ?? 'null'} padding={3} background="neutral100" hasRadius minWidth="12rem">
                <Typography variant="pi" textColor="neutral600">
                  {p.platform ?? 'Не указана'}
                </Typography>
                <Box marginTop={1}>
                  <Typography variant="beta" fontWeight="bold">
                    {numberFormat.format(p.receiptsCount)} чеков
                  </Typography>
                </Box>
                <Typography variant="pi" textColor="neutral500">
                  {money(p.totalAmount)} · {numberFormat.format(p.uniqueUsers)} польз.
                </Typography>
              </Box>
            ))}
          </Flex>
          <Box marginTop={3}>
            <Typography variant="pi" textColor="neutral500">
              {platforms.note}
            </Typography>
          </Box>
        </Box>
      )}
    </Flex>
  );
}
