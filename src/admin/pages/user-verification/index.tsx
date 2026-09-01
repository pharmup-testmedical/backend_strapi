import React, { useState } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import {
  Box,
  Field,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  TextInput,
  Typography,
} from '@strapi/design-system';
import { UserSearchRow, useUserVerificationApi } from './api';
import UserBalancePage from './UserBalancePage';

const numberFormat = new Intl.NumberFormat('ru-RU');
const money = (v: number) => `${numberFormat.format(Math.round(v))} ₸`;

function SearchScreen() {
  const api = useUserVerificationApi();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<UserSearchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const runSearch = async (value: string) => {
    setQ(value);
    const trimmed = value.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setSearched(false);
      return;
    }
    setLoading(true);
    try {
      const rows = await api.search(trimmed);
      setResults(rows);
      setSearched(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box padding={8}>
      <Typography variant="alpha" tag="h1">
        Проверка пользователя
      </Typography>
      <Typography variant="pi" textColor="neutral600">
        Независимый пересчёт баланса, чеков и транзакций прямо из БД — эталон для сверки с тем, что показывает
        приложение (не переиспользует расчёты приложения).
      </Typography>

      <Box marginTop={4} maxWidth="30rem">
        <Field.Root name="search">
          <Field.Label>Поиск по имени, телефону, email или ИИН</Field.Label>
          <TextInput
            value={q}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => runSearch(e.target.value)}
            placeholder="Например: +7 700 000 00 00"
          />
        </Field.Root>
      </Box>

      {loading && (
        <Typography marginTop={3} textColor="neutral600">
          Поиск…
        </Typography>
      )}

      {!loading && searched && results.length === 0 && (
        <Typography marginTop={3} textColor="neutral600">
          Никого не найдено.
        </Typography>
      )}

      {results.length > 0 && (
        <Box marginTop={4} background="neutral0" borderColor="neutral150" hasRadius shadow="tableShadow">
          <Table colCount={4} rowCount={results.length + 1}>
            <Thead>
              <Tr>
                <Th>
                  <Typography variant="sigma">Имя</Typography>
                </Th>
                <Th>
                  <Typography variant="sigma">Телефон</Typography>
                </Th>
                <Th>
                  <Typography variant="sigma">Email</Typography>
                </Th>
                <Th>
                  <Typography variant="sigma">Баланс (хранимый)</Typography>
                </Th>
              </Tr>
            </Thead>
            <Tbody>
              {results.map((u) => (
                <Tr key={u.id} onClick={() => navigate(`/user-verification/${u.id}`)} style={{ cursor: 'pointer' }}>
                  <Td>
                    <Typography>{[u.name, u.surname].filter(Boolean).join(' ') || `#${u.id}`}</Typography>
                  </Td>
                  <Td>
                    <Typography>{u.phone ?? '—'}</Typography>
                  </Td>
                  <Td>
                    <Typography>{u.email ?? '—'}</Typography>
                  </Td>
                  <Td>
                    <Typography>{money(u.account ?? 0)}</Typography>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </Box>
      )}
    </Box>
  );
}

export default function UserVerification() {
  return (
    <Routes>
      <Route path="/" element={<SearchScreen />} />
      <Route path="/:userId" element={<UserBalancePage />} />
    </Routes>
  );
}
