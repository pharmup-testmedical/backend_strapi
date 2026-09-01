import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Box,
  Flex,
  Grid,
  IconButton,
  Loader,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Typography,
} from '@strapi/design-system';
import { ArrowLeft, ArrowRight } from '@strapi/icons';
import { BalanceSummary, ReceiptRow, TransactionRow, useUserVerificationApi } from './api';

const numberFormat = new Intl.NumberFormat('ru-RU');
const money = (v: number) => `${numberFormat.format(Math.round(v))} ₸`;

const RECEIPTS_PAGE_SIZE = 20;
const TX_PAGE_SIZE = 30;

function KpiCard({
  label,
  value,
  onClick,
  active,
}: {
  label: string;
  value: string;
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <Box
      background="neutral0"
      padding={4}
      borderColor={active ? 'primary600' : 'neutral150'}
      hasRadius
      shadow="tableShadow"
      onClick={onClick}
      style={onClick ? { cursor: 'pointer' } : undefined}
    >
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

export default function UserBalancePage() {
  const { userId: userIdParam } = useParams<{ userId: string }>();
  const userId = Number(userIdParam);
  const navigate = useNavigate();
  const api = useUserVerificationApi();

  const [summary, setSummary] = useState<BalanceSummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
  const [receiptsTotal, setReceiptsTotal] = useState(0);
  const [receiptsPage, setReceiptsPage] = useState(1);
  const [expandedReceiptId, setExpandedReceiptId] = useState<string | null>(null);

  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [txTotal, setTxTotal] = useState(0);
  const [txPage, setTxPage] = useState(1);
  const [txKind, setTxKind] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setLoadingSummary(true);
    setSummaryError(null);
    api
      .getSummary(userId)
      .then((s) => {
        if (!cancelled) setSummary(s);
      })
      .catch((e) => {
        if (!cancelled) setSummaryError(e?.message ?? 'Не удалось загрузить пользователя');
      })
      .finally(() => {
        if (!cancelled) setLoadingSummary(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    let cancelled = false;
    api.getReceipts(userId, receiptsPage, RECEIPTS_PAGE_SIZE).then(({ rows, pagination }) => {
      if (!cancelled) {
        setReceipts(rows);
        setReceiptsTotal(pagination.total);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, receiptsPage]);

  useEffect(() => {
    let cancelled = false;
    api.getTransactions(userId, txPage, TX_PAGE_SIZE, txKind).then(({ rows, pagination }) => {
      if (!cancelled) {
        setTransactions(rows);
        setTxTotal(pagination.total);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, txPage, txKind]);

  const selectTxKind = (kind: string | undefined) => {
    setTxKind(kind);
    setTxPage(1);
  };

  const receiptsPageCount = Math.max(1, Math.ceil(receiptsTotal / RECEIPTS_PAGE_SIZE));
  const txPageCount = Math.max(1, Math.ceil(txTotal / TX_PAGE_SIZE));

  if (loadingSummary) {
    return (
      <Flex justifyContent="center" padding={8}>
        <Loader>Загрузка…</Loader>
      </Flex>
    );
  }

  if (summaryError || !summary) {
    return (
      <Box padding={8}>
        <Typography textColor="danger600">{summaryError ?? 'Пользователь не найден'}</Typography>
      </Box>
    );
  }

  return (
    <Box padding={8}>
      <Flex gap={3} alignItems="center" marginBottom={5}>
        <IconButton label="К поиску" onClick={() => navigate('/user-verification')}>
          <ArrowLeft />
        </IconButton>
        <Box>
          <Typography variant="alpha" tag="h1">
            {[summary.user.name, summary.user.surname].filter(Boolean).join(' ') || `Пользователь #${summary.user.id}`}
          </Typography>
          <Typography variant="pi" textColor="neutral600">
            {summary.user.phone ?? '—'} · {summary.user.email ?? '—'}
          </Typography>
        </Box>
      </Flex>

      {/* Блок 1 — Баланс */}
      <Typography variant="beta" tag="h2">
        Баланс
      </Typography>
      <Box marginTop={3}>
        <Grid.Root gridCols={5} gap={4}>
          <Grid.Item col={1}>
            <KpiCard label="Всего накоплено" value={money(summary.totalEarned)} onClick={() => selectTxKind(undefined)} />
          </Grid.Item>
          <Grid.Item col={1}>
            <KpiCard label="Доступно к выводу" value={money(summary.available)} onClick={() => selectTxKind(undefined)} />
          </Grid.Item>
          <Grid.Item col={1}>
            <KpiCard
              label="Ожидается"
              value={money(summary.expected)}
              onClick={() => selectTxKind('cashback_pending')}
              active={txKind === 'cashback_pending'}
            />
          </Grid.Item>
          <Grid.Item col={1}>
            <KpiCard
              label="В обработке"
              value={money(summary.processing)}
              onClick={() => selectTxKind('withdraw_pending')}
              active={txKind === 'withdraw_pending'}
            />
          </Grid.Item>
          <Grid.Item col={1}>
            <KpiCard
              label="Выведено"
              value={money(summary.withdrawn)}
              onClick={() => selectTxKind('withdraw_approved')}
              active={txKind === 'withdraw_approved'}
            />
          </Grid.Item>
        </Grid.Root>
      </Box>

      <Box
        marginTop={4}
        background="neutral0"
        padding={4}
        borderColor={summary.account.mismatch ? 'danger500' : 'neutral150'}
        hasRadius
        shadow="tableShadow"
      >
        <Typography variant="delta" fontWeight="bold">
          Проверка хранимого баланса (user.account)
        </Typography>
        <Flex gap={6} marginTop={3}>
          <Box>
            <Typography variant="pi" textColor="neutral600">
              Хранится в БД
            </Typography>
            <Typography variant="beta" fontWeight="bold">
              {money(summary.account.stored)}
            </Typography>
          </Box>
          <Box>
            <Typography variant="pi" textColor="neutral600">
              Пересчитано независимо
            </Typography>
            <Typography variant="beta" fontWeight="bold" textColor={summary.account.mismatch ? 'danger600' : 'success600'}>
              {money(summary.account.recomputed)}
            </Typography>
          </Box>
        </Flex>
        {summary.account.mismatch && (
          <Typography marginTop={3} textColor="danger600">
            Расхождение {money(summary.account.recomputed - summary.account.stored)} — хранимое значение не
            совпадает с пересчитанным. «Всего накоплено», «Доступно к выводу» и «Выведено» выше уже посчитаны от
            корректного (пересчитанного) значения.
          </Typography>
        )}
        <Typography marginTop={3} variant="pi" textColor="neutral500">
          «Доступно к выводу» = пересчитанный баланс минус заявки на вывод в статусе «В обработке». Суммы со
          статусом «Ожидается» (неподтверждённые позиции чеков) в баланс не входят — они появляются только после
          подтверждения чека администратором.
        </Typography>
      </Box>

      {summary.itemRateMismatchCount > 0 && (
        <Box marginTop={4} background="neutral0" padding={4} borderColor="danger500" hasRadius shadow="tableShadow">
          <Typography variant="delta" fontWeight="bold" textColor="danger600">
            Позиций с расхождением ставки кешбэка: {summary.itemRateMismatchCount}
          </Typography>
          <Typography variant="pi" textColor="neutral600" marginTop={1}>
            Ставка кешбэка позиции чека не совпадает с текущей ставкой карточки товара. Может быть ошибкой
            ручного ввода чека или легитимным изменением ставки товара после даты чека — требует ручной проверки.
          </Typography>
          <Box marginTop={3} style={{ overflowX: 'auto' }}>
            <Table colCount={5} rowCount={summary.itemRateMismatches.length + 1}>
              <Thead>
                <Tr>
                  <Th>
                    <Typography variant="sigma">Чек</Typography>
                  </Th>
                  <Th>
                    <Typography variant="sigma">Позиция</Typography>
                  </Th>
                  <Th>
                    <Typography variant="sigma">Кол-во</Typography>
                  </Th>
                  <Th>
                    <Typography variant="sigma">Ставка на чеке</Typography>
                  </Th>
                  <Th>
                    <Typography variant="sigma">Ставка карточки товара</Typography>
                  </Th>
                </Tr>
              </Thead>
              <Tbody>
                {summary.itemRateMismatches.map((m) => (
                  <Tr key={`${m.receiptId}-${m.itemId}`}>
                    <Td>
                      <a
                        href={`/admin/content-manager/collection-types/api::receipt.receipt/${m.receiptId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Typography textColor="primary600">№{m.receiptFiscalId ?? m.receiptId}</Typography>
                      </a>
                    </Td>
                    <Td>
                      <Typography>{m.itemName}</Typography>
                    </Td>
                    <Td>
                      <Typography>{m.quantity}</Typography>
                    </Td>
                    <Td>
                      <Typography textColor="danger600">{money(m.cashbackPerUnit)}</Typography>
                    </Td>
                    <Td>
                      <Typography>{m.productCashbackAmount != null ? money(m.productCashbackAmount) : '—'}</Typography>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </Box>
        </Box>
      )}

      {/* Блок 2 — Чеки */}
      <Typography variant="beta" tag="h2" marginTop={7}>
        Чеки
      </Typography>
      <Typography variant="pi" textColor="neutral600">
        Клик по строке разворачивает позиции чека (количество и кешбэк по каждой).
      </Typography>
      <Box marginTop={3} background="neutral0" borderColor="neutral150" hasRadius shadow="tableShadow" style={{ overflowX: 'auto' }}>
        <Table colCount={6} rowCount={receipts.length + 1}>
          <Thead>
            <Tr>
              <Th>
                <Typography variant="sigma">№ чека</Typography>
              </Th>
              <Th>
                <Typography variant="sigma">Дата</Typography>
              </Th>
              <Th>
                <Typography variant="sigma">Позиций</Typography>
              </Th>
              <Th>
                <Typography variant="sigma">Сумма чека</Typography>
              </Th>
              <Th>
                <Typography variant="sigma">Кешбэк</Typography>
              </Th>
              <Th>
                <Typography variant="sigma">Статус</Typography>
              </Th>
            </Tr>
          </Thead>
          <Tbody>
            {receipts.map((r) => (
              <React.Fragment key={r.documentId}>
                <Tr
                  onClick={() => setExpandedReceiptId(expandedReceiptId === r.documentId ? null : r.documentId)}
                  style={{ cursor: 'pointer' }}
                >
                  <Td>
                    <Typography>№{r.fiscalId ?? r.documentId}</Typography>
                  </Td>
                  <Td>
                    <Typography>{r.date?.slice(0, 10) ?? '—'}</Typography>
                  </Td>
                  <Td>
                    <Typography>{r.itemsCount}</Typography>
                  </Td>
                  <Td>
                    <Typography>{money(r.totalAmount)}</Typography>
                  </Td>
                  <Td>
                    {r.confirmedCashback > 0 && <Typography textColor="success600">+{money(r.confirmedCashback)}</Typography>}
                    {r.pendingCashback > 0 && (
                      <Typography textColor="warning600">+{money(r.pendingCashback)} ожидается</Typography>
                    )}
                    {r.confirmedCashback === 0 && r.pendingCashback === 0 && (
                      <Typography textColor="neutral500">—</Typography>
                    )}
                  </Td>
                  <Td>
                    <Typography>{r.statusLabel}</Typography>
                  </Td>
                </Tr>
                {expandedReceiptId === r.documentId && (
                  <Tr>
                    <Td colSpan={6}>
                      <Box padding={3} background="neutral100">
                        {r.items.length === 0 ? (
                          <Typography textColor="neutral600">В чеке нет позиций для кешбэка.</Typography>
                        ) : (
                          <Table colCount={6} rowCount={r.items.length + 1}>
                            <Thead>
                              <Tr>
                                <Th>
                                  <Typography variant="sigma">Позиция</Typography>
                                </Th>
                                <Th>
                                  <Typography variant="sigma">Заявленный товар</Typography>
                                </Th>
                                <Th>
                                  <Typography variant="sigma">Кол-во</Typography>
                                </Th>
                                <Th>
                                  <Typography variant="sigma">Кешбэк/ед.</Typography>
                                </Th>
                                <Th>
                                  <Typography variant="sigma">Итог по позиции</Typography>
                                </Th>
                                <Th>
                                  <Typography variant="sigma">Ставка карточки товара</Typography>
                                </Th>
                              </Tr>
                            </Thead>
                            <Tbody>
                              {r.items.map((it) => (
                                <Tr key={it.id}>
                                  <Td>
                                    <Typography>{it.name}</Typography>
                                  </Td>
                                  <Td>
                                    <Typography textColor={it.claimedProductName ? undefined : 'neutral500'}>
                                      {it.claimedProductName ?? '—'}
                                    </Typography>
                                  </Td>
                                  <Td>
                                    <Typography>{it.quantity}</Typography>
                                  </Td>
                                  <Td>
                                    <Typography textColor={it.rateMismatch ? 'danger600' : undefined}>
                                      {money(it.cashbackPerUnit)}
                                    </Typography>
                                  </Td>
                                  <Td>
                                    <Typography>{money(it.cashbackTotal)}</Typography>
                                  </Td>
                                  <Td>
                                    <Typography textColor={it.rateMismatch ? 'danger600' : 'neutral500'}>
                                      {it.productCashbackAmount != null ? money(it.productCashbackAmount) : '—'}
                                    </Typography>
                                  </Td>
                                </Tr>
                              ))}
                            </Tbody>
                          </Table>
                        )}
                      </Box>
                    </Td>
                  </Tr>
                )}
              </React.Fragment>
            ))}
          </Tbody>
        </Table>
      </Box>
      <Flex justifyContent="space-between" alignItems="center" marginTop={3}>
        <Typography variant="pi" textColor="neutral600">
          Всего чеков: {receiptsTotal}
        </Typography>
        <Flex gap={2} alignItems="center">
          <IconButton label="Предыдущая страница" disabled={receiptsPage <= 1} onClick={() => setReceiptsPage((p) => p - 1)}>
            <ArrowLeft />
          </IconButton>
          <Typography variant="pi">
            {receiptsPage} / {receiptsPageCount}
          </Typography>
          <IconButton
            label="Следующая страница"
            disabled={receiptsPage >= receiptsPageCount}
            onClick={() => setReceiptsPage((p) => p + 1)}
          >
            <ArrowRight />
          </IconButton>
        </Flex>
      </Flex>

      {/* Блок 3 — История транзакций */}
      <Flex justifyContent="space-between" alignItems="center" marginTop={7}>
        <Typography variant="beta" tag="h2">
          История транзакций
        </Typography>
        {txKind && (
          <Typography
            variant="pi"
            textColor="primary600"
            onClick={() => selectTxKind(undefined)}
            style={{ cursor: 'pointer' }}
          >
            Показать все операции ×
          </Typography>
        )}
      </Flex>
      <Box marginTop={3} background="neutral0" borderColor="neutral150" hasRadius shadow="tableShadow" style={{ overflowX: 'auto' }}>
        <Table colCount={4} rowCount={transactions.length + 1}>
          <Thead>
            <Tr>
              <Th>
                <Typography variant="sigma">Дата</Typography>
              </Th>
              <Th>
                <Typography variant="sigma">Операция</Typography>
              </Th>
              <Th>
                <Typography variant="sigma">Сумма</Typography>
              </Th>
              <Th>
                <Typography variant="sigma">Статус</Typography>
              </Th>
            </Tr>
          </Thead>
          <Tbody>
            {transactions.map((t) => (
              <Tr key={t.id}>
                <Td>
                  <Typography>{t.date?.slice(0, 10) ?? '—'}</Typography>
                </Td>
                <Td>
                  <Typography>{t.title}</Typography>
                </Td>
                <Td>
                  <Typography textColor={t.amount >= 0 ? 'success600' : undefined}>
                    {t.amount >= 0 ? '+' : ''}
                    {money(t.amount)}
                  </Typography>
                </Td>
                <Td>
                  <Typography>{t.statusLabel}</Typography>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </Box>
      <Flex justifyContent="space-between" alignItems="center" marginTop={3}>
        <Typography variant="pi" textColor="neutral600">
          Всего операций: {txTotal}
        </Typography>
        <Flex gap={2} alignItems="center">
          <IconButton label="Предыдущая страница" disabled={txPage <= 1} onClick={() => setTxPage((p) => p - 1)}>
            <ArrowLeft />
          </IconButton>
          <Typography variant="pi">
            {txPage} / {txPageCount}
          </Typography>
          <IconButton label="Следующая страница" disabled={txPage >= txPageCount} onClick={() => setTxPage((p) => p + 1)}>
            <ArrowRight />
          </IconButton>
        </Flex>
      </Flex>
    </Box>
  );
}
