import React, { useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import AnalyticsHome from './AnalyticsHome';
import UserDetail from './UserDetail';
import { AnalyticsFilters } from './api';

/**
 * Точка входа раздела «Аналитика» в Admin Panel. Регистрируется через
 * app.addMenuLink({ to: 'analytics', Component: () => import(...) }) в
 * src/admin/app.tsx, что даёт роут analytics/* (wildcard) — вложенная
 * маршрутизация (например /analytics/users/:id) обрабатывается прямо тут,
 * обычным react-router-dom, без доп. регистрации в app.tsx.
 *
 * filters живут здесь (не внутри AnalyticsHome) — чтобы при переходе на
 * детальную страницу пользователя тот же период/фильтр оставался в силе.
 */
export default function AnalyticsPage() {
  const [filters, setFilters] = useState<AnalyticsFilters>({});

  return (
    <Routes>
      <Route path="/" element={<AnalyticsHome filters={filters} onFiltersChange={setFilters} />} />
      <Route path="/users/:id" element={<UserDetail filters={filters} />} />
    </Routes>
  );
}
