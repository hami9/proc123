/**
 * Number normalization.
 *
 * Source pages show `۱٬۵۰۰٬۰۰۰ تومان`; a CSV needs `1500000`. This module does
 * the digit and separator half of that; `money.ts` does the currency half.
 *
 * See CLAUDE.md §7.8 — a silent 10x price error is the worst failure mode this
 * tool has, so anything genuinely ambiguous is reported rather than guessed at.
 */

import { cleanText } from './text.js';

const PERSIAN_ZERO = 0x06f0; // EXTENDED ARABIC-INDIC DIGIT ZERO
const ARABIC_INDIC_ZERO = 0x0660; // ARABIC-INDIC DIGIT ZERO

const ARABIC_DECIMAL_SEPARATOR = String.fromCodePoint(0x066b);
const ARABIC_THOUSANDS_SEPARATOR = String.fromCodePoint(0x066c);
const ARABIC_COMMA = String.fromCodePoint(0x060c);
const RIGHT_SINGLE_QUOTE = String.fromCodePoint(0x2019);

/** Convert Persian and Arabic-Indic digits to ASCII, leaving everything else alone. */
export function toAsciiDigits(input: string): string {
  let out = '';
  for (const char of input) {
    const codePoint = char.codePointAt(0);
    if (codePoint === undefined) continue;

    if (codePoint >= PERSIAN_ZERO && codePoint <= PERSIAN_ZERO + 9) {
      out += String(codePoint - PERSIAN_ZERO);
    } else if (codePoint >= ARABIC_INDIC_ZERO && codePoint <= ARABIC_INDIC_ZERO + 9) {
      out += String(codePoint - ARABIC_INDIC_ZERO);
    } else {
      out += char;
    }
  }
  return out;
}

/**
 * Map every separator convention we have seen onto `.` (decimal) and `,` (group).
 * Whitespace and apostrophes are only treated as group separators between digits,
 * so `1 500` becomes `1,500` but `500 grams` is untouched.
 */
function normalizeSeparators(input: string): string {
  return input
    .split(ARABIC_DECIMAL_SEPARATOR)
    .join('.')
    .split(ARABIC_THOUSANDS_SEPARATOR)
    .join(',')
    .split(ARABIC_COMMA)
    .join(',')
    .replace(new RegExp(`(?<=\\d)[\\s'${RIGHT_SINGLE_QUOTE}](?=\\d)`, 'g'), ',');
}

/** How to read a lone separator followed by exactly three digits. */
export type GroupingPreference = 'thousands' | 'decimal';

export interface ParseNumberOptions {
  /**
   * `1,500` and `1.500` are genuinely ambiguous: 1500 with a group separator, or
   * 1.5 with a decimal separator. Prices are overwhelmingly the former and
   * measurements are often the latter, so callers pick. Defaults to `thousands`.
   */
  ambiguousGrouping?: GroupingPreference;
}

export interface ParsedNumber {
  value: number;
  /**
   * True when the separator could have been read either way and the preference
   * decided it. Callers that care about a 10x error should surface this.
   */
  ambiguous: boolean;
}

const NUMBER_TOKEN = /-?\d[\d.,]*|-?[.,]\d+/;

/**
 * Pull a number out of arbitrary scraped text.
 *
 * Returns `undefined` rather than `NaN` or `0` when there is no number to find —
 * an absent price must stay absent, never become zero.
 */
export function parseNumber(
  raw: string | number,
  options: ParseNumberOptions = {}
): ParsedNumber | undefined {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? { value: raw, ambiguous: false } : undefined;
  }

  const normalized = normalizeSeparators(toAsciiDigits(cleanText(raw)));
  const match = NUMBER_TOKEN.exec(normalized);
  if (match === null) return undefined;

  let token = match[0].replace(/[.,]+$/, '');
  const negative = token.startsWith('-');
  if (negative) token = token.slice(1);
  if (token === '') return undefined;

  const { digits, ambiguous } = resolveSeparators(token, options.ambiguousGrouping ?? 'thousands');
  const value = Number(digits);
  if (!Number.isFinite(value)) return undefined;

  return { value: negative ? -value : value, ambiguous };
}

/** Convenience wrapper for callers that do not need the ambiguity flag. */
export function parseNumberValue(
  raw: string | number,
  options: ParseNumberOptions = {}
): number | undefined {
  return parseNumber(raw, options)?.value;
}

function resolveSeparators(
  token: string,
  preference: GroupingPreference
): { digits: string; ambiguous: boolean } {
  const lastDot = token.lastIndexOf('.');
  const lastComma = token.lastIndexOf(',');

  // Both separators present: the rightmost one is the decimal point, whichever
  // convention the site uses. `1.234,56` and `1,234.56` both work.
  if (lastDot >= 0 && lastComma >= 0) {
    const decimal = lastDot > lastComma ? '.' : ',';
    const group = decimal === '.' ? ',' : '.';
    return { digits: token.split(group).join('').split(decimal).join('.'), ambiguous: false };
  }

  if (lastDot < 0 && lastComma < 0) {
    return { digits: token, ambiguous: false };
  }

  const separator = lastDot >= 0 ? '.' : ',';
  const parts = token.split(separator);

  // Repeated separator can only be grouping: `1,500,000`.
  if (parts.length > 2) {
    return { digits: parts.join(''), ambiguous: false };
  }

  const head = parts[0] ?? '';
  const tail = parts[1] ?? '';

  // A single separator with exactly three digits after it, and a leading group
  // of one to three non-zero digits, is the ambiguous case. Anything else is a
  // decimal point: `19.99`, `0.500`, `1234.567`.
  const looksGrouped = tail.length === 3 && head.length >= 1 && head.length <= 3 && head !== '0';
  if (!looksGrouped) {
    return { digits: `${head}.${tail}`, ambiguous: false };
  }

  return {
    digits: preference === 'thousands' ? `${head}${tail}` : `${head}.${tail}`,
    ambiguous: true,
  };
}

/** Round to a fixed number of decimals, killing binary floating point dust. */
export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Format a number for a CSV cell: plain decimal, `.` for the decimal point,
 * no thousands separator, no exponent notation, no trailing zeros.
 */
export function formatDecimal(value: number, maxDecimals = 6): string {
  if (!Number.isFinite(value)) return '';
  const rounded = roundTo(value, maxDecimals);
  if (Number.isInteger(rounded)) {
    // String() switches to exponent notation at 1e21.
    return Math.abs(rounded) < 1e21 ? String(rounded) : BigInt(rounded).toString();
  }
  return rounded.toFixed(maxDecimals).replace(/0+$/, '').replace(/\.$/, '');
}
