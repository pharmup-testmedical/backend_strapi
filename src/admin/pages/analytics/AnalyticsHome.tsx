import React from 'react';
import { Box, Tabs, Typography } from '@strapi/design-system';
import FilterBar from './FilterBar';
import Overview from './tabs/Overview';
import Cities from './tabs/Cities';
import Ofd from './tabs/Ofd';
import Demographics from './tabs/Demographics';
import AppVersions from './tabs/AppVersions';
import Users from './tabs/Users';
import Catalog from './tabs/Catalog';
import Compare from './tabs/Compare';
import { AnalyticsFilters } from './api';

interface Props {
  filters: AnalyticsFilters;
  onFiltersChange: (filters: AnalyticsFilters) => void;
}

/**
 * Табы дашборда (без вложенной страницы пользователя — та в UserDetail.tsx,
 * подключена отдельным роутом в index.tsx).
 */
export default function AnalyticsHome({ filters, onFiltersChange }: Props) {
  return (
    <Box padding={8}>
      <Typography variant="alpha" tag="h1">
        Аналитика
      </Typography>
      <Box marginTop={2} marginBottom={4}>
        <Typography variant="epsilon" textColor="neutral600">
          Статистика по чекам, кешбэку и активности пользователей PharmUp
        </Typography>
      </Box>

      <FilterBar filters={filters} onChange={onFiltersChange} />

      <Tabs.Root defaultValue="overview" variant="simple">
        <Tabs.List aria-label="Разделы аналитики">
          <Tabs.Trigger value="overview">Обзор</Tabs.Trigger>
          <Tabs.Trigger value="cities">Города</Tabs.Trigger>
          <Tabs.Trigger value="users">Пользователи</Tabs.Trigger>
          <Tabs.Trigger value="ofd">ОФД</Tabs.Trigger>
          <Tabs.Trigger value="demographics">Демография</Tabs.Trigger>
          <Tabs.Trigger value="app-versions">Версии приложения</Tabs.Trigger>
          <Tabs.Trigger value="catalog">Каталог</Tabs.Trigger>
          <Tabs.Trigger value="compare">Сравнение периодов</Tabs.Trigger>
        </Tabs.List>
        <Box marginTop={4}>
          <Tabs.Content value="overview">
            <Overview filters={filters} />
          </Tabs.Content>
          <Tabs.Content value="cities">
            <Cities filters={filters} />
          </Tabs.Content>
          <Tabs.Content value="users">
            <Users filters={filters} />
          </Tabs.Content>
          <Tabs.Content value="ofd">
            <Ofd filters={filters} />
          </Tabs.Content>
          <Tabs.Content value="demographics">
            <Demographics filters={filters} />
          </Tabs.Content>
          <Tabs.Content value="app-versions">
            <AppVersions filters={filters} />
          </Tabs.Content>
          <Tabs.Content value="catalog">
            <Catalog filters={filters} />
          </Tabs.Content>
          <Tabs.Content value="compare">
            <Compare filters={filters} />
          </Tabs.Content>
        </Box>
      </Tabs.Root>
    </Box>
  );
}
