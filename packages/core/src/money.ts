/**
 * Currency detection and the toman/rial problem.
 *
 * Iranian stores price in toman or in rial — 1 toman = 10 rial — and both are
 * ISO 4217 `IRR`. A store that quotes toman while its JSON-LD says `IRR` is
 * completely normal, so the ISO code is *not* treated as evidence of the unit.
 * Only an explicit word on the page ("تومان" / "ریال") sets `Money.unit`.
 *
 * When the unit is unknown it stays `undefined` and the caller has to decide
 * what to do — deliberately, and visibly. See CLAUDE.md §7.8.
 */

import type { CurrencyUnit, Money } from './model.js';
import { type ParseNumberOptions, parseNumber, roundTo } from './numbers.js';
import { foldForCompare } from './text.js';

export const RIAL_PER_TOMAN = 10;

const RIAL_SIGN = String.fromCodePoint(0xfdfc);

interface CurrencyToken {
  /** Matched against `foldForCompare`d page text. */
  readonly token: string;
  readonly currency: string;
  readonly unit?: CurrencyUnit;
  /** Latin tokens need a word boundary; symbols and Persian words do not. */
  readonly wordBoundary?: boolean;
}

/**
 * Ordered by specificity. Unit-bearing words are checked before bare ISO codes
 * so that "IRR ۱۵۰٬۰۰۰ تومان" is read as toman.
 *
 * Arabic spellings are absent on purpose — `foldForCompare` folds ARABIC YEH to
 * FARSI YEH, so "ريال" already matches "ریال".
 */
const CURRENCY_TOKENS: readonly CurrencyToken[] = [
  { token: 'تومان', currency: 'IRR', unit: 'toman' },
  { token: 'تومن', currency: 'IRR', unit: 'toman' },
  { token: 'toman', currency: 'IRR', unit: 'toman', wordBoundary: true },
  { token: 'tomaan', currency: 'IRR', unit: 'toman', wordBoundary: true },
  { token: 'irt', currency: 'IRR', unit: 'toman', wordBoundary: true },
  { token: 'ریال', currency: 'IRR', unit: 'rial' },
  { token: RIAL_SIGN, currency: 'IRR', unit: 'rial' },
  { token: 'rial', currency: 'IRR', unit: 'rial', wordBoundary: true },
  // Bare ISO code: currency is certain, unit is not.
  { token: 'irr', currency: 'IRR', wordBoundary: true },
  { token: '$', currency: 'USD' },
  { token: 'usd', currency: 'USD', wordBoundary: true },
  { token: '€', currency: 'EUR' },
  { token: 'eur', currency: 'EUR', wordBoundary: true },
  { token: '£', currency: 'GBP' },
  { token: 'gbp', currency: 'GBP', wordBoundary: true },
  { token: '₺', currency: 'TRY' },
  { token: 'try', currency: 'TRY', wordBoundary: true },
  { token: '₽', currency: 'RUB' },
  { token: '₹', currency: 'INR' },
  { token: 'aed', currency: 'AED', wordBoundary: true },
  { token: 'sar', currency: 'SAR', wordBoundary: true },
];

export interface DetectedCurrency {
  currency: string;
  /** Only ever set for `IRR`, and only from an explicit word. */
  unit?: CurrencyUnit;
}

/** Find the currency a price string is quoted in, if it says. */
export function detectCurrency(text: string): DetectedCurrency | undefined {
  const folded = foldForCompare(text);

  for (const candidate of CURRENCY_TOKENS) {
    const found =
      candidate.wordBoundary === true
        ? containsWord(folded, candidate.token)
        : folded.includes(candidate.token);
    if (!found) continue;

    return candidate.unit === undefined
      ? { currency: candidate.currency }
      : { currency: candidate.currency, unit: candidate.unit };
  }
  return undefined;
}

function containsWord(haystack: string, needle: string): boolean {
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return false;

    const before = haystack[at - 1];
    const after = haystack[at + needle.length];
    if (!isWordChar(before) && !isWordChar(after)) return true;
    from = at + 1;
  }
}

function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /[\p{L}\p{N}]/u.test(char);
}

export interface ParseMoneyOptions extends ParseNumberOptions {
  /** Used when the text does not name a currency. */
  defaultCurrency?: string;
  /**
   * Used when the text names no toman/rial unit. Set this from the user's
   * explicit UI toggle, never from a guess.
   */
  defaultUnit?: CurrencyUnit;
}

export interface ParsedMoney {
  money: Money;
  /** The separator in the number could have been read either way. */
  ambiguousGrouping: boolean;
  /** The toman/rial unit came from the page rather than from `defaultUnit`. */
  unitFromSource: boolean;
}

/**
 * Parse a price string such as `۱٬۵۰۰٬۰۰۰ تومان` into `Money`.
 *
 * Returns `undefined` when there is no number, so that a missing price stays
 * missing instead of becoming `0`.
 */
export function parseMoney(raw: string, options: ParseMoneyOptions = {}): ParsedMoney | undefined {
  const parsed = parseNumber(raw, options);
  if (parsed === undefined) return undefined;

  const detected = detectCurrency(raw);
  const currency = detected?.currency ?? options.defaultCurrency ?? '';
  const unit = detected?.unit ?? (isIranianCurrency(currency) ? options.defaultUnit : undefined);

  return {
    money:
      unit === undefined
        ? { amount: parsed.value, currency }
        : { amount: parsed.value, currency, unit },
    ambiguousGrouping: parsed.ambiguous,
    unitFromSource: detected?.unit !== undefined,
  };
}

/** True for the currencies where the toman/rial distinction applies. */
export function isIranianCurrency(code: string): boolean {
  const upper = code.toUpperCase();
  return upper === 'IRR' || upper === 'IRT';
}

/** `Money` that is known to carry a unit, so conversion is total rather than partial. */
export type UnitedMoney = Money & { unit: CurrencyUnit };

export function hasUnit(money: Money): money is UnitedMoney {
  return money.unit !== undefined;
}

/**
 * Convert between toman and rial. A no-op for non-Iranian currencies, where the
 * unit is meaningless.
 */
export function convertCurrencyUnit(money: UnitedMoney, target: CurrencyUnit): UnitedMoney {
  if (!isIranianCurrency(money.currency) || money.unit === target) {
    return { ...money, unit: target };
  }

  const amount = target === 'rial' ? money.amount * RIAL_PER_TOMAN : money.amount / RIAL_PER_TOMAN;

  return { ...money, amount: roundTo(amount, 6), unit: target };
}

/** Amount expressed in rial, for comparing prices quoted in different units. */
export function toRial(money: UnitedMoney): number {
  return convertCurrencyUnit(money, 'rial').amount;
}
