/**
 * Разбор казахстанского ИИН (12 цифр, формат ГГММДДXXXXXXX): первые 6 —
 * дата рождения (год берётся из 7-й цифры — век+пол), 7-я цифра — век и
 * пол (1/2=1800-е, 3/4=1900-е, 5/6=2000-е; нечётная=мужчина, чётная=женщина).
 *
 * ВАЖНО: результат этой функции (birthYear/birthMonth/birthDay/gender)
 * используется ТОЛЬКО для вычисления возрастной корзины на бэкенде —
 * наружу в API это не отдаётся никогда (см. queries.ts getDemographics).
 * Сам ИИН и точная дата рождения за пределы этого модуля не выходят.
 */

export type Gender = 'male' | 'female';

export interface IinInfo {
  gender: Gender;
  birthYear: number;
  birthMonth: number; // 1-12
  birthDay: number;
}

const IIN_RE = /^\d{12}$/;

/** Возвращает null на любом невалидном/нераспознаваемом ИИН — не бросает исключений. */
export function parseIin(iin: string | null | undefined, referenceDate: Date = new Date()): IinInfo | null {
  if (!iin) return null;
  const trimmed = iin.trim();
  if (!IIN_RE.test(trimmed)) return null;
  if (!validateIinChecksum(trimmed)) return null;

  const yy = parseInt(trimmed.slice(0, 2), 10);
  const mm = parseInt(trimmed.slice(2, 4), 10);
  const dd = parseInt(trimmed.slice(4, 6), 10);
  const centuryGender = parseInt(trimmed[6], 10);

  if (centuryGender < 1 || centuryGender > 6) return null;
  if (mm < 1 || mm > 12) return null;

  const centuryBase = centuryGender <= 2 ? 1800 : centuryGender <= 4 ? 1900 : 2000;
  const gender: Gender = centuryGender % 2 === 1 ? 'male' : 'female';
  const birthYear = centuryBase + yy;

  const daysInMonth = new Date(Date.UTC(birthYear, mm, 0)).getUTCDate();
  if (dd < 1 || dd > daysInMonth) return null;

  const birthDate = new Date(Date.UTC(birthYear, mm - 1, dd));
  if (birthDate.getTime() > referenceDate.getTime()) return null; // дата рождения в будущем — невалидно

  return { gender, birthYear, birthMonth: mm, birthDay: dd };
}

/** Точный возраст в полных годах на referenceDate. */
export function calculateAge(info: IinInfo, referenceDate: Date = new Date()): number {
  let age = referenceDate.getUTCFullYear() - info.birthYear;
  const hadBirthdayThisYear =
    referenceDate.getUTCMonth() + 1 > info.birthMonth ||
    (referenceDate.getUTCMonth() + 1 === info.birthMonth && referenceDate.getUTCDate() >= info.birthDay);
  if (!hadBirthdayThisYear) age -= 1;
  return age;
}

export const AGE_GROUPS = ['18-25', '26-35', '36-45', '46-60', '60+'] as const;
export type AgeGroup = (typeof AGE_GROUPS)[number] | 'unknown';

/** Возраст вне 18-60+ (например явная ошибка данных) тоже уходит в 'unknown' — отдельной корзины под это не просили. */
export function ageGroupFor(info: IinInfo | null, referenceDate: Date = new Date()): AgeGroup {
  if (!info) return 'unknown';
  const age = calculateAge(info, referenceDate);
  if (age < 18 || age > 130) return 'unknown';
  if (age <= 25) return '18-25';
  if (age <= 35) return '26-35';
  if (age <= 45) return '36-45';
  if (age <= 60) return '46-60';
  return '60+';
}

/**
 * Контрольная 12-я цифра ИИН РК — два прохода весов mod 11 (если первый
 * проход даёт остаток 10, используется второй набор весов). Вырожденный
 * случай (оба прохода дают 10) — контрольная цифра не определена, такой
 * ИИН уходит в 'unknown' через parseIin(), как и обычный несовпадающий чек-сумм.
 *
 * Подключена в parseIin() — round-trip проверена на синтетике и
 * подтверждена на 4 реальных ИИН пользователей (100% совпадение
 * контрольной цифры, 2026-08-26), после чего и включена в отбраковку.
 */
const CHECKSUM_WEIGHTS_1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const CHECKSUM_WEIGHTS_2 = [3, 4, 5, 6, 7, 8, 9, 10, 11, 1, 2];

function weightedSum(digits: number[], weights: number[]): number {
  return digits.reduce((sum, d, i) => sum + d * weights[i], 0);
}

/** Возвращает ожидаемую 12-ю цифру для первых 11 цифр ИИН, либо null в вырожденном случае. */
export function computeIinCheckDigit(first11Digits: string): number | null {
  const digits = first11Digits.split('').map(Number);
  const mod1 = weightedSum(digits, CHECKSUM_WEIGHTS_1) % 11;
  if (mod1 !== 10) return mod1;
  const mod2 = weightedSum(digits, CHECKSUM_WEIGHTS_2) % 11;
  return mod2 === 10 ? null : mod2;
}

/** true — контрольная цифра сходится; false — не сходится ИЛИ формат некорректен ИЛИ вырожденный случай. */
export function validateIinChecksum(iin: string): boolean {
  if (!IIN_RE.test(iin)) return false;
  const expected = computeIinCheckDigit(iin.slice(0, 11));
  if (expected === null) return false;
  return expected === Number(iin[11]);
}
