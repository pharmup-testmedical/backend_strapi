import React, { useEffect, useState } from 'react';
import {
  Box,
  Flex,
  IconButton,
  Loader,
  Table,
  Tabs,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Typography,
} from '@strapi/design-system';
import { ArrowLeft, ArrowRight } from '@strapi/icons';
import {
  AnalyticsFilters,
  CategoryRow,
  GroupRow,
  ProductRow,
  SortOrder,
  SupplierRow,
  useAnalyticsApi,
} from '../api';

const numberFormat = new Intl.NumberFormat('ru-RU');
const money = (v: number) => `${numberFormat.format(Math.round(v))} ₸`;
const PAGE_SIZE = 20;

function SortableTh<F extends string>({
  field,
  label,
  sortBy,
  sortOrder,
  onSort,
}: {
  field: F;
  label: string;
  sortBy: F;
  sortOrder: SortOrder;
  onSort: (field: F) => void;
}) {
  return (
    <Th onClick={() => onSort(field)} style={{ cursor: 'pointer' }}>
      <Typography variant="sigma">
        {label}
        {sortBy === field ? (sortOrder === 'desc' ? ' ↓' : ' ↑') : ''}
      </Typography>
    </Th>
  );
}

function Pager({
  offset,
  total,
  onChange,
}: {
  offset: number;
  total: number;
  onChange: (offset: number) => void;
}) {
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <Flex justifyContent="space-between" alignItems="center" marginTop={3}>
      <Typography variant="pi" textColor="neutral600">
        Всего: {numberFormat.format(total)}
      </Typography>
      <Flex gap={2} alignItems="center">
        <IconButton label="Предыдущая" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - PAGE_SIZE))}>
          <ArrowLeft />
        </IconButton>
        <Typography variant="pi">
          {page} / {pageCount}
        </Typography>
        <IconButton label="Следующая" disabled={offset + PAGE_SIZE >= total} onClick={() => onChange(offset + PAGE_SIZE)}>
          <ArrowRight />
        </IconButton>
      </Flex>
    </Flex>
  );
}

interface Props {
  filters: AnalyticsFilters;
}

type ProductSort = 'article' | 'productName' | 'receiptsCount' | 'quantity' | 'totalAmount' | 'totalCashback';
type GroupSort = 'groupName' | 'productsCount' | 'receiptsCount' | 'totalAmount' | 'totalCashback';
type CategorySort = GroupSort | 'categoryName';
type SupplierSort = 'supplierName' | 'productsCount' | 'receiptsCount' | 'totalAmount' | 'totalCashback';

function ProductsTable({ filters }: Props) {
  const api = useAnalyticsApi();
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [sortBy, setSortBy] = useState<ProductSort>('totalAmount');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [loading, setLoading] = useState(true);

  useEffect(() => setOffset(0), [filters.from, filters.to, filters.status, filters.ofdType, filters.cityId, sortBy, sortOrder]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getProducts(filters, {}, sortBy, sortOrder, PAGE_SIZE, offset)
      .then(({ rows: r, pagination }) => {
        if (cancelled) return;
        setRows(r);
        setTotal(pagination.total);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.from, filters.to, filters.status, filters.ofdType, filters.cityId, sortBy, sortOrder, offset]);

  const toggleSort = (field: ProductSort) => {
    if (field === sortBy) setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc');
    else {
      setSortBy(field);
      setSortOrder('desc');
    }
  };

  return (
    <Box>
      <Box background="neutral0" borderColor="neutral150" hasRadius shadow="tableShadow" style={{ overflowX: 'auto' }}>
        <Table colCount={7} rowCount={rows.length + 1}>
          <Thead>
            <Tr>
              <SortableTh field="productName" label="Товар" sortBy={sortBy} sortOrder={sortOrder} onSort={toggleSort} />
              <SortableTh field="article" label="Артикул" sortBy={sortBy} sortOrder={sortOrder} onSort={toggleSort} />
              <Th>
                <Typography variant="sigma">Группа / Категория</Typography>
              </Th>
              <SortableTh field="receiptsCount" label="Чеков" sortBy={sortBy} sortOrder={sortOrder} onSort={toggleSort} />
              <SortableTh field="quantity" label="Кол-во" sortBy={sortBy} sortOrder={sortOrder} onSort={toggleSort} />
              <SortableTh field="totalAmount" label="Сумма" sortBy={sortBy} sortOrder={sortOrder} onSort={toggleSort} />
              <SortableTh field="totalCashback" label="Кешбэк" sortBy={sortBy} sortOrder={sortOrder} onSort={toggleSort} />
            </Tr>
          </Thead>
          <Tbody>
            {rows.map((p) => (
              <Tr key={p.productId}>
                <Td>
                  <Typography>{p.productName ?? '—'}</Typography>
                </Td>
                <Td>
                  <Typography>{p.article ?? '—'}</Typography>
                </Td>
                <Td>
                  <Typography variant="pi">
                    {p.groupName ?? '—'} / {p.categoryName ?? '—'}
                  </Typography>
                </Td>
                <Td>
                  <Typography>{numberFormat.format(p.receiptsCount)}</Typography>
                </Td>
                <Td>
                  <Typography>{numberFormat.format(p.quantity)}</Typography>
                </Td>
                <Td>
                  <Typography>{money(p.totalAmount)}</Typography>
                </Td>
                <Td>
                  <Typography>{money(p.totalCashback)}</Typography>
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
      <Pager offset={offset} total={total} onChange={setOffset} />
    </Box>
  );
}

function CategoriesTable({ filters }: Props) {
  const api = useAnalyticsApi();
  const [rows, setRows] = useState<CategoryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [sortBy, setSortBy] = useState<CategorySort>('totalAmount');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [loading, setLoading] = useState(true);

  useEffect(() => setOffset(0), [filters.from, filters.to, filters.status, filters.ofdType, filters.cityId, sortBy, sortOrder]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getCategories(filters, {}, sortBy, sortOrder, PAGE_SIZE, offset)
      .then(({ rows: r, pagination }) => {
        if (cancelled) return;
        setRows(r);
        setTotal(pagination.total);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.from, filters.to, filters.status, filters.ofdType, filters.cityId, sortBy, sortOrder, offset]);

  const toggleSort = (field: CategorySort) => {
    if (field === sortBy) setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc');
    else {
      setSortBy(field);
      setSortOrder('desc');
    }
  };

  return (
    <Box>
      <Box background="neutral0" borderColor="neutral150" hasRadius shadow="tableShadow" style={{ overflowX: 'auto' }}>
        <Table colCount={6} rowCount={rows.length + 1}>
          <Thead>
            <Tr>
              <SortableTh field="categoryName" label="Категория" sortBy={sortBy} sortOrder={sortOrder} onSort={toggleSort} />
              <Th>
                <Typography variant="sigma">Группа</Typography>
              </Th>
              <SortableTh field="productsCount" label="Товаров" sortBy={sortBy} sortOrder={sortOrder} onSort={toggleSort} />
              <SortableTh field="receiptsCount" label="Чеков" sortBy={sortBy} sortOrder={sortOrder} onSort={toggleSort} />
              <SortableTh field="totalAmount" label="Сумма" sortBy={sortBy} sortOrder={sortOrder} onSort={toggleSort} />
              <SortableTh field="totalCashback" label="Кешбэк" sortBy={sortBy} sortOrder={sortOrder} onSort={toggleSort} />
            </Tr>
          </Thead>
          <Tbody>
            {rows.map((c) => (
              <Tr key={c.categoryId}>
                <Td>
                  <Typography>{c.categoryName}</Typography>
                </Td>
                <Td>
                  <Typography>{c.groupName ?? '—'}</Typography>
                </Td>
                <Td>
                  <Typography>{numberFormat.format(c.productsCount)}</Typography>
                </Td>
                <Td>
                  <Typography>{numberFormat.format(c.receiptsCount)}</Typography>
                </Td>
                <Td>
                  <Typography>{money(c.totalAmount)}</Typography>
                </Td>
                <Td>
                  <Typography>{money(c.totalCashback)}</Typography>
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
      <Pager offset={offset} total={total} onChange={setOffset} />
    </Box>
  );
}

function GroupsTable({ filters }: Props) {
  const api = useAnalyticsApi();
  const [rows, setRows] = useState<GroupRow[]>([]);
  const [sortBy, setSortBy] = useState<GroupSort>('totalAmount');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getGroups(filters, {}, sortBy, sortOrder)
      .then((r) => {
        if (!cancelled) setRows(r);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.from, filters.to, filters.status, filters.ofdType, filters.cityId, sortBy, sortOrder]);

  const toggleSort = (field: GroupSort) => {
    if (field === sortBy) setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc');
    else {
      setSortBy(field);
      setSortOrder('desc');
    }
  };

  return (
    <Box background="neutral0" borderColor="neutral150" hasRadius shadow="tableShadow" style={{ overflowX: 'auto' }}>
      <Table colCount={5} rowCount={rows.length + 1}>
        <Thead>
          <Tr>
            <SortableTh field="groupName" label="Группа" sortBy={sortBy} sortOrder={sortOrder} onSort={toggleSort} />
            <SortableTh field="productsCount" label="Товаров" sortBy={sortBy} sortOrder={sortOrder} onSort={toggleSort} />
            <SortableTh field="receiptsCount" label="Чеков" sortBy={sortBy} sortOrder={sortOrder} onSort={toggleSort} />
            <SortableTh field="totalAmount" label="Сумма" sortBy={sortBy} sortOrder={sortOrder} onSort={toggleSort} />
            <SortableTh field="totalCashback" label="Кешбэк" sortBy={sortBy} sortOrder={sortOrder} onSort={toggleSort} />
          </Tr>
        </Thead>
        <Tbody>
          {rows.map((g) => (
            <Tr key={g.groupId}>
              <Td>
                <Typography>{g.groupName}</Typography>
              </Td>
              <Td>
                <Typography>{numberFormat.format(g.productsCount)}</Typography>
              </Td>
              <Td>
                <Typography>{numberFormat.format(g.receiptsCount)}</Typography>
              </Td>
              <Td>
                <Typography>{money(g.totalAmount)}</Typography>
              </Td>
              <Td>
                <Typography>{money(g.totalCashback)}</Typography>
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
  );
}

function SuppliersTable({ filters }: Props) {
  const api = useAnalyticsApi();
  const [rows, setRows] = useState<SupplierRow[]>([]);
  const [sortBy, setSortBy] = useState<SupplierSort>('totalAmount');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getSuppliers(filters, {}, sortBy, sortOrder)
      .then((r) => {
        if (!cancelled) setRows(r);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.from, filters.to, filters.status, filters.ofdType, filters.cityId, sortBy, sortOrder]);

  const toggleSort = (field: SupplierSort) => {
    if (field === sortBy) setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc');
    else {
      setSortBy(field);
      setSortOrder('desc');
    }
  };

  return (
    <Box>
      <Box marginBottom={3}>
        <Typography variant="pi" textColor="neutral500">
          Это не «продажи через поставщика» — ProductSupplier показывает, какие товары этот поставщик потенциально
          может поставить (для будущего раздела «Заказ»). Источник фактической покупки в чеке — организация из
          фискальных данных, с поставщиком напрямую не связана.
        </Typography>
      </Box>
      <Box background="neutral0" borderColor="neutral150" hasRadius shadow="tableShadow" style={{ overflowX: 'auto' }}>
        <Table colCount={5} rowCount={rows.length + 1}>
          <Thead>
            <Tr>
              <SortableTh field="supplierName" label="Поставщик" sortBy={sortBy} sortOrder={sortOrder} onSort={toggleSort} />
              <SortableTh field="productsCount" label="Товаров" sortBy={sortBy} sortOrder={sortOrder} onSort={toggleSort} />
              <SortableTh field="receiptsCount" label="Чеков" sortBy={sortBy} sortOrder={sortOrder} onSort={toggleSort} />
              <SortableTh field="totalAmount" label="Сумма" sortBy={sortBy} sortOrder={sortOrder} onSort={toggleSort} />
              <SortableTh field="totalCashback" label="Кешбэк" sortBy={sortBy} sortOrder={sortOrder} onSort={toggleSort} />
            </Tr>
          </Thead>
          <Tbody>
            {rows.map((s) => (
              <Tr key={s.supplierId}>
                <Td>
                  <Typography>{s.supplierName}</Typography>
                </Td>
                <Td>
                  <Typography>{numberFormat.format(s.productsCount)}</Typography>
                </Td>
                <Td>
                  <Typography>{numberFormat.format(s.receiptsCount)}</Typography>
                </Td>
                <Td>
                  <Typography>{money(s.totalAmount)}</Typography>
                </Td>
                <Td>
                  <Typography>{money(s.totalCashback)}</Typography>
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
    </Box>
  );
}

export default function Catalog({ filters }: Props) {
  return (
    <Tabs.Root defaultValue="groups" variant="simple">
      <Tabs.List aria-label="Разделы каталога">
        <Tabs.Trigger value="groups">Группы</Tabs.Trigger>
        <Tabs.Trigger value="categories">Категории</Tabs.Trigger>
        <Tabs.Trigger value="products">Товары</Tabs.Trigger>
        <Tabs.Trigger value="suppliers">Поставщики</Tabs.Trigger>
      </Tabs.List>
      <Box marginTop={4}>
        <Tabs.Content value="groups">
          <GroupsTable filters={filters} />
        </Tabs.Content>
        <Tabs.Content value="categories">
          <CategoriesTable filters={filters} />
        </Tabs.Content>
        <Tabs.Content value="products">
          <ProductsTable filters={filters} />
        </Tabs.Content>
        <Tabs.Content value="suppliers">
          <SuppliersTable filters={filters} />
        </Tabs.Content>
      </Box>
    </Tabs.Root>
  );
}
