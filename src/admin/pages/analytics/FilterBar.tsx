import React, { useEffect, useState } from 'react';
import { Box, Flex, DatePicker, SingleSelect, SingleSelectOption, Typography } from '@strapi/design-system';
import { AnalyticsFilters, CityOption, useAnalyticsApi } from './api';

const STATUS_OPTIONS = [
  ['auto_verified', 'Авто-подтверждён'],
  ['manually_verified', 'Подтверждён вручную'],
  ['auto_partially_verified', 'Авто, частично'],
  ['manually_partially_verified', 'Вручную, частично'],
  ['auto_rejected', 'Авто-отклонён'],
  ['manually_rejected', 'Отклонён вручную'],
  ['auto_rejected_late_submission', 'Отклонён (поздняя подача)'],
  ['manual_review', 'На проверке'],
] as const;

const OFD_OPTIONS = [
  ['oofd', 'OOFD'],
  ['kofd', 'KOFD'],
  ['wofd', 'WOFD'],
] as const;

const toDate = (iso?: string): Date | undefined => (iso ? new Date(iso) : undefined);
const toIsoDate = (date?: Date): string | undefined => (date ? date.toISOString().slice(0, 10) : undefined);

interface Props {
  filters: AnalyticsFilters;
  onChange: (filters: AnalyticsFilters) => void;
}

/**
 * Общий блок фильтров периода/города/ОФД/статуса — переиспользуется всеми
 * вкладками дашборда. Значения — те же query-параметры, что уже принимают
 * все /analytics/* эндпоинты на бэкенде (from/to/status/ofdType/cityId).
 */
export default function FilterBar({ filters, onChange }: Props) {
  const api = useAnalyticsApi();
  const [cities, setCities] = useState<CityOption[]>([]);

  useEffect(() => {
    api
      .getCitiesList()
      .then(setCities)
      .catch(() => setCities([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Box background="neutral0" padding={4} borderColor="neutral150" hasRadius shadow="filterShadow" marginBottom={4}>
      <Flex gap={4} wrap="wrap" alignItems="flex-end">
        <Box>
          <Typography variant="pi" fontWeight="bold" textColor="neutral600">
            С
          </Typography>
          <DatePicker
            value={toDate(filters.from)}
            onChange={(date) => onChange({ ...filters, from: toIsoDate(date) })}
            onClear={() => onChange({ ...filters, from: undefined })}
            clearLabel="Очистить"
          />
        </Box>
        <Box>
          <Typography variant="pi" fontWeight="bold" textColor="neutral600">
            По
          </Typography>
          <DatePicker
            value={toDate(filters.to)}
            onChange={(date) => onChange({ ...filters, to: toIsoDate(date) })}
            onClear={() => onChange({ ...filters, to: undefined })}
            clearLabel="Очистить"
          />
        </Box>
        <Box minWidth="12rem">
          <Typography variant="pi" fontWeight="bold" textColor="neutral600">
            Город покупки
          </Typography>
          <SingleSelect
            placeholder="Все города"
            value={filters.cityId ?? null}
            onChange={(value) => onChange({ ...filters, cityId: value ? Number(value) : undefined })}
            onClear={() => onChange({ ...filters, cityId: undefined })}
          >
            {cities.map((c) => (
              <SingleSelectOption key={c.cityId} value={c.cityId}>
                {c.cityName}
              </SingleSelectOption>
            ))}
          </SingleSelect>
        </Box>
        <Box minWidth="10rem">
          <Typography variant="pi" fontWeight="bold" textColor="neutral600">
            ОФД
          </Typography>
          <SingleSelect
            placeholder="Все ОФД"
            value={filters.ofdType ?? null}
            onChange={(value) => onChange({ ...filters, ofdType: value ? String(value) : undefined })}
            onClear={() => onChange({ ...filters, ofdType: undefined })}
          >
            {OFD_OPTIONS.map(([value, label]) => (
              <SingleSelectOption key={value} value={value}>
                {label}
              </SingleSelectOption>
            ))}
          </SingleSelect>
        </Box>
        <Box minWidth="16rem">
          <Typography variant="pi" fontWeight="bold" textColor="neutral600">
            Статус
          </Typography>
          <SingleSelect
            placeholder="Все статусы"
            value={filters.status ?? null}
            onChange={(value) => onChange({ ...filters, status: value ? String(value) : undefined })}
            onClear={() => onChange({ ...filters, status: undefined })}
          >
            {STATUS_OPTIONS.map(([value, label]) => (
              <SingleSelectOption key={value} value={value}>
                {label}
              </SingleSelectOption>
            ))}
          </SingleSelect>
        </Box>
      </Flex>
    </Box>
  );
}
