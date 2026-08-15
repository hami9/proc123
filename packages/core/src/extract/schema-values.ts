/**
 * Reading schema.org property values.
 *
 * schema.org is deliberately permissive: almost every property accepts a
 * string, a node, or an array of either, and the `@type` may be written bare
 * (`Product`), prefixed (`schema:Product`) or as a full URL. These helpers
 * absorb that so the mapping code above them can read like the spec does.
 *
 * The same helpers serve JSON-LD and Microdata, because `microdata.ts` converts
 * the DOM into schema.org-shaped JSON first. One set of semantics, tested once.
 */

import type { DimensionUnit, Measure, ProductAttribute, WeightUnit } from '../model.js';
import { parseNumberValue } from '../numbers.js';
import { cleanText, foldForCompare } from '../text.js';
import { isDimensionUnit, isWeightUnit } from '../units.js';
import { resolveUrl } from '../url.js';
import { type JsonObject, type JsonValue, asArray, asObjects, asText } from './json.js';

/** `https://schema.org/Product`, `schema:Product` and `Product` all mean the same. */
export function normalizeType(raw: string): string {
  const trimmed = raw.trim();
  const lastSlash = trimmed.lastIndexOf('/');
  const withoutHost = lastSlash >= 0 ? trimmed.slice(lastSlash + 1) : trimmed;
  const lastColon = withoutHost.lastIndexOf(':');
  const bare = lastColon >= 0 ? withoutHost.slice(lastColon + 1) : withoutHost;
  return bare.replace(/^#/, '').toLowerCase();
}

/** Every `@type` on a node, normalized. A node may legitimately carry several. */
export function typesOf(node: JsonObject): string[] {
  return asArray(node['@type'])
    .map((value) => (typeof value === 'string' ? normalizeType(value) : ''))
    .filter((value) => value !== '');
}

export function isType(node: JsonObject, ...names: readonly string[]): boolean {
  const types = typesOf(node);
  return names.some((name) => types.includes(name));
}

/**
 * schema.org types that represent something a store sells.
 *
 * Deliberately short. Broadening it to "anything with an `offers` property"
 * pulls in `WebPage` and `Organization` nodes that carry a site-wide offer and
 * turns them into phantom products.
 */
const PRODUCT_TYPES = [
  'product',
  'productgroup',
  'productmodel',
  'individualproduct',
  'book',
  'vehicle',
  'car',
];

export function isProductNode(node: JsonObject): boolean {
  return isType(node, ...PRODUCT_TYPES);
}

/** True for the `ProductGroup` shape, where variations live under `hasVariant`. */
export function isProductGroup(node: JsonObject): boolean {
  return isType(node, 'productgroup') || node['hasVariant'] !== undefined;
}

/**
 * Resolve a possibly-relative URL and drop it if it is unusable.
 *
 * Only `http(s)` survives. Everything else that can appear in these slots —
 * `data:` placeholder images, `javascript:` links, and the `urn:` values
 * Microdata's `itemid` often holds — is not something the target store can
 * fetch, and writing one into an `Images` column fails the import.
 */
export function absoluteUrl(raw: JsonValue | undefined, pageUrl: string): string | undefined {
  const text = asText(raw);
  if (text === undefined) return undefined;

  const resolved = resolveUrl(text, pageUrl);
  if (resolved === undefined) return undefined;
  return /^https?:/i.test(resolved) ? resolved : undefined;
}

/** The URL a node points at, whichever of the three spellings it used. */
export function nodeUrl(node: JsonObject, pageUrl: string): string | undefined {
  return (
    absoluteUrl(node['url'], pageUrl) ??
    absoluteUrl(node['@id'], pageUrl) ??
    absoluteUrl(node['contentUrl'], pageUrl)
  );
}

/**
 * `image` may be a URL, an `ImageObject`, or an array mixing both. Order is
 * preserved because the first image becomes the product's main image.
 */
export function readImages(value: JsonValue | undefined, pageUrl: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const entry of asArray(value)) {
    const url =
      typeof entry === 'object' && entry !== null && !Array.isArray(entry)
        ? nodeUrl(entry, pageUrl)
        : absoluteUrl(entry, pageUrl);
    if (url === undefined || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }

  return out;
}

/** `brand` is a string or a `Brand`/`Organization` node. */
export function readName(value: JsonValue | undefined): string | undefined {
  for (const entry of asArray(value)) {
    const text =
      typeof entry === 'object' && entry !== null && !Array.isArray(entry)
        ? (asText(entry['name']) ?? asText(entry['alternateName']))
        : asText(entry);
    if (text !== undefined) return text;
  }
  return undefined;
}

/** The GTIN spellings, most specific first — Google prefers `gtin13`. */
const GTIN_KEYS = ['gtin13', 'gtin12', 'gtin14', 'gtin8', 'gtin', 'isbn'] as const;

export function readGtin(node: JsonObject): string | undefined {
  for (const key of GTIN_KEYS) {
    const value = asText(node[key]);
    // A GTIN is digits with an optional check-digit hyphen; anything else is a
    // placeholder the plugin emitted, and a fabricated GTIN blocks an import.
    if (value !== undefined && /^[\d-]{6,20}$/.test(value)) return value.replace(/-/g, '');
  }
  return undefined;
}

const CATEGORY_SEPARATOR = /\s*>\s*/;

/**
 * `category` is one hierarchical path. Sites write it as `Nuts > Walnuts`, as
 * an array of paths, or as a `Thing` with a name.
 *
 * When several are offered the deepest wins: a store that says both `Nuts` and
 * `Nuts > Walnuts` is describing one shelf, and the specific one is the answer.
 */
export function readCategoryPath(value: JsonValue | undefined): string[] {
  let best: string[] = [];

  for (const entry of asArray(value)) {
    const text =
      typeof entry === 'object' && entry !== null && !Array.isArray(entry)
        ? readName(entry)
        : asText(entry);
    if (text === undefined) continue;

    const path = text
      .split(CATEGORY_SEPARATOR)
      .map((segment) => cleanText(segment))
      .filter((segment) => segment !== '');
    if (path.length > best.length) best = path;
  }

  return best;
}

/** UN/CEFACT common codes, which is what `unitCode` is required to hold. */
const UNIT_CODES: Readonly<Record<string, string>> = {
  GRM: 'g',
  KGM: 'kg',
  LBR: 'lbs',
  ONZ: 'oz',
  MMT: 'mm',
  CMT: 'cm',
  MTR: 'm',
  INH: 'in',
  YRD: 'yd',
};

/** What `unitText` actually contains, which is whatever the shop assistant typed. */
const UNIT_WORDS: Readonly<Record<string, string>> = {
  g: 'g',
  gr: 'g',
  gm: 'g',
  gram: 'g',
  grams: 'g',
  gramme: 'g',
  grammes: 'g',
  گرم: 'g',
  kg: 'kg',
  kgs: 'kg',
  kilo: 'kg',
  kilos: 'kg',
  kilogram: 'kg',
  kilograms: 'kg',
  کیلو: 'kg',
  کیلوگرم: 'kg',
  lb: 'lbs',
  lbs: 'lbs',
  pound: 'lbs',
  pounds: 'lbs',
  oz: 'oz',
  ounce: 'oz',
  ounces: 'oz',
  mm: 'mm',
  millimeter: 'mm',
  millimetre: 'mm',
  millimeters: 'mm',
  millimetres: 'mm',
  میلیمتر: 'mm',
  cm: 'cm',
  centimeter: 'cm',
  centimetre: 'cm',
  centimeters: 'cm',
  centimetres: 'cm',
  سانتیمتر: 'cm',
  سانت: 'cm',
  m: 'm',
  meter: 'm',
  metre: 'm',
  meters: 'm',
  metres: 'm',
  متر: 'm',
  in: 'in',
  inch: 'in',
  inches: 'in',
  '"': 'in',
  yd: 'yd',
  yard: 'yd',
  yards: 'yd',
};

const TRAILING_UNIT = /[\p{L}"]+\.?\s*$/u;

function resolveUnit(node: JsonObject | undefined, text: string): string | undefined {
  const code = node === undefined ? undefined : asText(node['unitCode']);
  if (code !== undefined) {
    const mapped = UNIT_CODES[code.trim().toUpperCase()];
    if (mapped !== undefined) return mapped;
  }

  const unitText = node === undefined ? undefined : asText(node['unitText']);
  for (const candidate of [unitText, text]) {
    if (candidate === undefined || candidate === '') continue;
    // The unit is the trailing run of letters: `500 g`, `500g`, `۵۰۰ گرم`, `5"`.
    const trailing = TRAILING_UNIT.exec(candidate)?.[0] ?? candidate;
    const mapped = UNIT_WORDS[foldForCompare(trailing)];
    if (mapped !== undefined) return mapped;
  }

  return undefined;
}

interface Quantity {
  value: number;
  unit: string | undefined;
}

/**
 * Read a `QuantitativeValue`, or the `500 g` string that stands in for one.
 *
 * `ambiguousGrouping: 'decimal'` is deliberate and is the opposite of the price
 * default: `1.500` kg is one and a half kilos, whereas `1.500` toman is fifteen
 * hundred. Measurements group in the small direction, prices in the large.
 */
function readQuantity(value: JsonValue | undefined): Quantity | undefined {
  for (const entry of asArray(value)) {
    const node =
      typeof entry === 'object' && entry !== null && !Array.isArray(entry) ? entry : undefined;
    const raw = node === undefined ? entry : (node['value'] ?? node['minValue']);

    const amount =
      typeof raw === 'number'
        ? raw
        : typeof raw === 'string'
          ? parseNumberValue(raw, { ambiguousGrouping: 'decimal' })
          : undefined;
    if (amount === undefined) continue;

    return { value: amount, unit: resolveUnit(node, typeof raw === 'string' ? raw : '') };
  }
  return undefined;
}

export function readWeight(value: JsonValue | undefined): Measure<WeightUnit> | undefined {
  const quantity = readQuantity(value);
  if (quantity === undefined) return undefined;
  // Without a unit the number is meaningless — 500 of what? — and guessing
  // between grams and kilograms is a 1000x error. See CLAUDE.md §6 Tier 2.
  if (quantity.unit === undefined || !isWeightUnit(quantity.unit)) return undefined;
  return { value: quantity.value, unit: quantity.unit };
}

export function readDimension(value: JsonValue | undefined): Measure<DimensionUnit> | undefined {
  const quantity = readQuantity(value);
  if (quantity === undefined) return undefined;
  if (quantity.unit === undefined || !isDimensionUnit(quantity.unit)) return undefined;
  return { value: quantity.value, unit: quantity.unit };
}

/**
 * `additionalProperty` holds the specification table: material, origin, roast
 * level. Repeated names are folded into one attribute with several values, the
 * way a store's own attribute list works.
 */
export function readAdditionalProperties(value: JsonValue | undefined): ProductAttribute[] {
  const byKey = new Map<string, ProductAttribute>();

  for (const entry of asObjects(value)) {
    const name = asText(entry['name']) ?? asText(entry['propertyID']);
    if (name === undefined) continue;

    const values = asArray(entry['value'])
      .map((candidate) =>
        typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate)
          ? readName(candidate)
          : asText(candidate)
      )
      .filter((candidate): candidate is string => candidate !== undefined);
    if (values.length === 0) continue;

    const key = foldForCompare(name);
    const existing = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, { name, values: [...values], isVariationAxis: false });
      continue;
    }
    for (const candidate of values) {
      if (!existing.values.includes(candidate)) existing.values.push(candidate);
    }
  }

  return [...byKey.values()];
}

/** `keywords` is a comma-separated string or an array. */
export function readKeywords(value: JsonValue | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const entry of asArray(value)) {
    const text =
      typeof entry === 'object' && entry !== null && !Array.isArray(entry)
        ? readName(entry)
        : asText(entry);
    if (text === undefined) continue;

    for (const part of text.split(',')) {
      const tag = cleanText(part);
      if (tag === '' || seen.has(tag)) continue;
      seen.add(tag);
      out.push(tag);
    }
  }

  return out;
}
