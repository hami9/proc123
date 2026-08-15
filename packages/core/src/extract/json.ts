/**
 * A typed view over parsed JSON, plus a parser that survives the JSON-LD found
 * in the wild.
 *
 * Store plugins template their JSON-LD into the page with string concatenation,
 * so a share of it is not valid JSON: trailing commas from a loop that always
 * appends, `<!-- -->` wrappers left over from XHTML-era advice, CDATA guards,
 * raw newlines inside a description. One bad block must never take out the
 * others on the page.
 */

import { parseNumberValue } from '../numbers.js';
import { cleanText } from '../text.js';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;
export interface JsonObject {
  [key: string]: JsonValue;
}

export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Read a property that schema.org allows to be either a single value or an
 * array of them — which is nearly all of them.
 */
export function asArray(value: JsonValue | undefined): JsonValue[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value.filter((item) => item !== null) : [value];
}

export function asObjects(value: JsonValue | undefined): JsonObject[] {
  return asArray(value).filter(isJsonObject);
}

/** Cleaned text from a string or a number. Booleans are not text. */
export function asText(value: JsonValue | undefined): string | undefined {
  if (typeof value === 'string') {
    const cleaned = cleanText(value);
    return cleaned === '' ? undefined : cleaned;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

export function asNumber(value: JsonValue | undefined): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') return parseNumberValue(value);
  return undefined;
}

/** schema.org booleans arrive as `true`, `"true"`, `"True"` or `"1"`. */
export function asBoolean(value: JsonValue | undefined): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase();
    if (lower === 'true' || lower === '1' || lower === 'yes') return true;
    if (lower === 'false' || lower === '0' || lower === 'no') return false;
  }
  if (typeof value === 'number') return value !== 0;
  return undefined;
}

/** `//` guards on both ends: the JS-comment form is what script blocks use. */
const CDATA = /^\s*(?:\/\/)?\s*<!\[CDATA\[([\s\S]*?)(?:\/\/)?\s*\]\]>\s*$/;
const HTML_COMMENT = /^\s*<!--([\s\S]*?)-->\s*$/;

/** Strip the wrappers that scripts get bundled in, without touching the JSON. */
function unwrapScript(raw: string): string {
  let text = raw.trim();
  for (const pattern of [HTML_COMMENT, CDATA]) {
    const match = pattern.exec(text);
    if (match?.[1] !== undefined) text = match[1].trim();
  }
  return text;
}

/**
 * Remove trailing commas before `}` or `]`, ignoring anything inside a string.
 *
 * This is the one repair worth attempting: it is unambiguous, it is what a
 * template loop produces, and it cannot change the meaning of valid JSON
 * because valid JSON has no trailing commas.
 */
function dropTrailingCommas(text: string): string {
  let out = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i] ?? '';

    if (inString) {
      out += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }

    if (char === ',') {
      let next = i + 1;
      while (next < text.length && /\s/.test(text[next] ?? '')) next++;
      const following = text[next];
      if (following === '}' || following === ']') continue;
    }

    out += char;
  }

  return out;
}

export interface JsonParseResult {
  value?: JsonValue;
  /** Present when the text could not be parsed at all. */
  error?: string;
  /** True when parsing only succeeded after repairing the text. */
  repaired?: boolean;
}

/** Parse a `<script type="application/ld+json">` body without ever throwing. */
export function parseJsonLenient(raw: string): JsonParseResult {
  const text = unwrapScript(raw);
  if (text === '') return { error: 'empty script block' };

  try {
    return { value: JSON.parse(text) as JsonValue };
  } catch (firstError) {
    try {
      return { value: JSON.parse(dropTrailingCommas(text)) as JsonValue, repaired: true };
    } catch {
      return { error: firstError instanceof Error ? firstError.message : String(firstError) };
    }
  }
}
