/**
 * Checking the model's answer against the fragment that was sent.
 *
 * This is the part of Layer D that has no counterpart in A, B or C, and it is
 * the reason Layer D can be shipped at all.
 *
 * The other layers fail loudly: a selector matches nothing, a JSON-LD block is
 * absent, an API returns 404. A language model does not have that failure mode.
 * Asked for a price on a page that never states one, it returns a number — well
 * formed, plausible, in the right currency, and invented. Merged at any
 * confidence, that number becomes a real price in a real shop.
 *
 * So the rule here is: **the model may only tell us what is on the page.** Every
 * value that can be checked is checked back against the exact fragment that was
 * sent, and anything that cannot be found there is dropped and reported.
 *
 * Not every field can be checked that strictly. A name may legitimately be
 * assembled from two elements, and a description is reworded by definition
 * under some content modes. Those are length-capped and accepted, because the
 * alternative — rejecting anything not byte-identical — would reject correct
 * answers. The check is applied where a wrong value does concrete damage:
 * prices, URLs, images, categories and attribute values.
 */

import type { CanonicalProduct, Money, ProductAttribute } from '../model.js';
import type { ExtractionIssue } from '../extract/types.js';
import { toAsciiDigits } from '../numbers.js';
import { cleanText, foldForCompare } from '../text.js';
import { resolveUrl } from '../url.js';
import type { TargetField } from '../config/types.js';
import { FIELD_PROPERTIES } from '../config/types.js';

/** Longest value we will accept for a free-text field, in characters. */
const MAX_TEXT = 8_000;
const MAX_NAME = 500;

export interface VerifyContext {
  /** The exact string sent to the provider. */
  fragment: string;
  /** The page the fragment came from, for resolving relative image URLs. */
  sourceUrl: string;
  /** Fields the user asked for. Anything else is discarded unread. */
  wanted: readonly TargetField[];
}

export interface VerifiedFields {
  fields: Partial<CanonicalProduct>;
  issues: ExtractionIssue[];
  /** Values dropped because they were not in the fragment. */
  rejected: number;
}

/**
 * A searchable view of the fragment.
 *
 * Built once per page: `folded` for text comparison (case, diacritics and
 * Arabic/Persian letter variants normalised by `foldForCompare`), and `digits`
 * for numbers, with every separator removed so that `1,250,000`, `۱٬۲۵۰٬۰۰۰`
 * and `1250000` all match the same way.
 */
interface Haystack {
  folded: string;
  digits: string;
}

function buildHaystack(fragment: string): Haystack {
  return {
    folded: foldForCompare(fragment),
    digits: toAsciiDigits(fragment).replace(/[^0-9]/g, ''),
  };
}

function textIsPresent(haystack: Haystack, value: string): boolean {
  const folded = foldForCompare(value);
  if (folded === '') return false;
  return haystack.folded.includes(folded);
}

/**
 * Is this number actually written on the page?
 *
 * Compared as a bare digit string, so grouping separators, decimal commas and
 * non-ASCII numerals cannot cause a false rejection. A price with a fractional
 * part is checked against its integer part too, because pages routinely write
 * `1,250,000` for a value the pipeline models as `1250000.00`.
 */
function numberIsPresent(haystack: Haystack, value: number): boolean {
  const whole = Math.trunc(Math.abs(value));
  const digits = String(whole);
  // A one- or two-digit number appears in almost any page by coincidence, so it
  // proves nothing. Those are accepted on the strength of the surrounding
  // field check instead — a fabricated price is never 7.
  if (digits.length <= 2) return true;
  if (haystack.digits.includes(digits)) return true;

  // Toman/rial: a page quoting toman for a value the model reported in rial
  // (or the reverse) is a unit disagreement, not a fabrication. Accept the
  // 10x-related form so `setPricePair` and the unit guard can settle it later.
  if (whole % 10 === 0 && haystack.digits.includes(String(whole / 10))) return true;
  return haystack.digits.includes(`${digits}0`);
}

function verifyMoney(haystack: Haystack, money: unknown): Money | undefined {
  if (typeof money !== 'object' || money === null) return undefined;
  const record = money as Record<string, unknown>;
  const amount = typeof record['amount'] === 'number' ? record['amount'] : undefined;
  if (amount === undefined || !Number.isFinite(amount) || amount <= 0) return undefined;
  if (!numberIsPresent(haystack, amount)) return undefined;

  const currency = typeof record['currency'] === 'string' ? record['currency'].trim() : '';
  const unit = record['unit'];
  const result: Money = {
    amount,
    currency: currency === '' ? 'IRR' : currency.toUpperCase(),
  };
  if (unit === 'toman' || unit === 'rial') result.unit = unit;
  return result;
}

/**
 * Keep only image URLs that appear in the fragment.
 *
 * Resolved against the page first, so a model that returns the `src` it saw
 * verbatim (`/img/a.jpg`) and one that helpfully absolutises it
 * (`https://shop.example/img/a.jpg`) both pass. The check is on the raw string
 * as it appeared, because that is what was actually sent.
 */
function verifyUrls(haystack: Haystack, raw: unknown, sourceUrl: string): string[] {
  if (!Array.isArray(raw)) return [];
  const kept: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const value = entry.trim();
    if (value === '') continue;

    // Data URIs are never on the page in a form we sent (the trimmer keeps
    // `src` but a base64 blob would have blown the budget), so a data URI here
    // is always invented.
    if (value.startsWith('data:')) continue;

    const resolved = resolveUrl(value, sourceUrl);
    if (resolved === undefined) continue;

    // Match on the path, which is the part common to both spellings.
    let needle = value;
    try {
      needle = new URL(resolved).pathname;
    } catch {
      /* keep the raw value */
    }
    if (needle.length > 1 && !textIsPresent(haystack, needle)) continue;
    if (!kept.includes(resolved)) kept.push(resolved);
  }
  return kept;
}

function verifyStrings(haystack: Haystack, raw: unknown, requirePresent: boolean): string[] {
  if (!Array.isArray(raw)) return [];
  const kept: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const value = cleanText(entry);
    if (value === '' || value.length > MAX_NAME) continue;
    if (requirePresent && !textIsPresent(haystack, value)) continue;
    if (!kept.includes(value)) kept.push(value);
  }
  return kept;
}

function verifyAttributes(haystack: Haystack, raw: unknown): ProductAttribute[] {
  if (!Array.isArray(raw)) return [];
  const kept: ProductAttribute[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const name = typeof record['name'] === 'string' ? cleanText(record['name']) : '';
    if (name === '' || !textIsPresent(haystack, name)) continue;

    const values = verifyStrings(haystack, record['values'], true);
    if (values.length === 0) continue;

    kept.push({
      name,
      values,
      // Layer D is not allowed to decide this. Which attributes a product
      // actually varies on is structural: getting it wrong makes WooCommerce
      // drop every variation row, and the variation table — not a model — is
      // what knows the answer.
      isVariationAxis: false,
    });
  }
  return kept;
}

function reject(issues: ExtractionIssue[], field: string, url: string, detail: string): void {
  issues.push({
    severity: 'warning',
    code: 'ai-value-not-on-page',
    source: 'ai',
    url,
    message:
      `The AI answer for "${field}" was discarded: ${detail}. ` +
      `Layer D may only report what is present in the page content sent to it.`,
  });
}

/**
 * Coerce and check one provider answer.
 *
 * Unknown keys are ignored rather than reported: a provider that adds a
 * `confidence` or `reasoning` field to its own output is being helpful, not
 * broken, and there is nothing for the user to do about it.
 */
export function verifyAnswer(
  answer: Partial<CanonicalProduct> | Record<string, unknown>,
  context: VerifyContext
): VerifiedFields {
  const haystack = buildHaystack(context.fragment);
  const issues: ExtractionIssue[] = [];
  const fields: Partial<CanonicalProduct> = {};
  const raw = answer as Record<string, unknown>;
  let rejected = 0;

  // Only the properties behind fields the user asked for are even looked at.
  const allowed = new Set<string>(context.wanted.flatMap((field) => FIELD_PROPERTIES[field] ?? []));
  const url = context.sourceUrl;

  if (allowed.has('name') && typeof raw['name'] === 'string') {
    const name = cleanText(raw['name']);
    if (name !== '' && name.length <= MAX_NAME) fields.name = name;
  }

  for (const key of ['description', 'shortDescription'] as const) {
    if (!allowed.has(key)) continue;
    const value = raw[key];
    if (typeof value !== 'string') continue;
    const text = cleanText(value);
    if (text !== '' && text.length <= MAX_TEXT) fields[key] = text;
  }

  for (const key of ['regularPrice', 'salePrice'] as const) {
    if (!allowed.has(key) || raw[key] === undefined || raw[key] === null) continue;
    const money = verifyMoney(haystack, raw[key]);
    if (money === undefined) {
      rejected += 1;
      reject(issues, key, url, 'that amount does not appear in the page content');
      continue;
    }
    fields[key] = money;
  }

  if (allowed.has('images')) {
    const images = verifyUrls(haystack, raw['images'], url);
    const claimed = Array.isArray(raw['images']) ? raw['images'].length : 0;
    if (claimed > images.length) {
      rejected += claimed - images.length;
      reject(
        issues,
        'images',
        url,
        `${String(claimed - images.length)} image URL(s) were not in the page`
      );
    }
    if (images.length > 0) fields.images = images;
  }

  if (allowed.has('categoryPath')) {
    const path = verifyStrings(haystack, raw['categoryPath'], true);
    if (path.length > 0) fields.categoryPath = path;
  }

  if (allowed.has('tags')) {
    const tags = verifyStrings(haystack, raw['tags'], true);
    if (tags.length > 0) fields.tags = tags;
  }

  if (allowed.has('attributes')) {
    const attributes = verifyAttributes(haystack, raw['attributes']);
    if (attributes.length > 0) fields.attributes = attributes;
  }

  if (allowed.has('inStock') && typeof raw['inStock'] === 'boolean') {
    fields.inStock = raw['inStock'];
  }

  if (allowed.has('stockQuantity') && typeof raw['stockQuantity'] === 'number') {
    const quantity = raw['stockQuantity'];
    if (Number.isFinite(quantity) && quantity >= 0 && numberIsPresent(haystack, quantity)) {
      fields.stockQuantity = Math.trunc(quantity);
    } else {
      rejected += 1;
      reject(issues, 'stockQuantity', url, 'that quantity does not appear in the page content');
    }
  }

  for (const key of ['brand', 'gtin', 'sku'] as const) {
    if (!allowed.has(key) || typeof raw[key] !== 'string') continue;
    const value = cleanText(raw[key]);
    if (value === '' || value.length > MAX_NAME) continue;
    if (!textIsPresent(haystack, value)) {
      rejected += 1;
      reject(issues, key, url, 'that value does not appear in the page content');
      continue;
    }
    fields[key] = value;
  }

  return { fields, issues, rejected };
}
