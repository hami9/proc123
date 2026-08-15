/**
 * OpenGraph and `product:*` meta tags — the floor of Layer B.
 *
 * These describe one product, never a list, so they only fire on a product
 * page. Their reliability is lower than schema.org's (`og:title` carries the
 * site name suffix as often as not), which is what the confidence ordering in
 * `CONFIDENCE` is for: OpenGraph fills gaps, it does not overrule JSON-LD.
 */

import type { Measure, Money, WeightUnit } from '../model.js';
import { parseMoney } from '../money.js';
import { canonicalizeUrl } from '../url.js';
import { type ProductDraft, createDraft, setField, setPricePair } from './draft.js';
import type { CheerioAPI } from './html.js';
import { readAvailability } from './schema-offers.js';
import { absoluteUrl, readWeight } from './schema-values.js';
import {
  CONFIDENCE,
  type ExtractionIssue,
  type ExtractionOptions,
  type PageContext,
  type SourceReading,
} from './types.js';

/**
 * All `<meta>` tags, keyed by lowercased `property` or `name`.
 *
 * Both attributes are read: `property` is what the OpenGraph spec says, `name`
 * is what half the CMS plugins emit, and a page often mixes them.
 */
export function collectMetaTags($: CheerioAPI): Map<string, string[]> {
  const tags = new Map<string, string[]>();

  $('meta').each((_, element) => {
    const key = ($(element).attr('property') ?? $(element).attr('name'))?.trim().toLowerCase();
    const content = $(element).attr('content')?.trim();
    if (key === undefined || key === '' || content === undefined || content === '') return;

    const existing = tags.get(key);
    if (existing === undefined) tags.set(key, [content]);
    else existing.push(content);
  });

  return tags;
}

function first(tags: Map<string, string[]>, ...keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = tags.get(key)?.[0];
    if (value !== undefined) return value;
  }
  return undefined;
}

function all(tags: Map<string, string[]>, ...keys: readonly string[]): string[] {
  const out: string[] = [];
  for (const key of keys) {
    for (const value of tags.get(key) ?? []) {
      if (!out.includes(value)) out.push(value);
    }
  }
  return out;
}

/** `og:type` values that mean "this page is one product". */
const PRODUCT_TYPES = new Set(['product', 'og:product', 'product.item', 'product.group']);

function readPrice(
  amount: string | undefined,
  currency: string | undefined,
  options: ExtractionOptions
): Money | undefined {
  if (amount === undefined) return undefined;

  const parsed = parseMoney(amount, {
    ambiguousGrouping: 'thousands',
    ...(currency !== undefined
      ? { defaultCurrency: currency }
      : options.defaultCurrency !== undefined
        ? { defaultCurrency: options.defaultCurrency }
        : {}),
    ...(options.defaultCurrencyUnit !== undefined
      ? { defaultUnit: options.defaultCurrencyUnit }
      : {}),
  });

  return parsed?.money;
}

function readOgWeight(tags: Map<string, string[]>): Measure<WeightUnit> | undefined {
  const value = first(tags, 'product:weight:value');
  if (value === undefined) return undefined;
  const units = first(tags, 'product:weight:units');
  return readWeight(units === undefined ? value : { value, unitText: units });
}

export function extractOpenGraph(
  $: CheerioAPI,
  page: PageContext,
  options: ExtractionOptions = {}
): SourceReading {
  const issues: ExtractionIssue[] = [];
  const tags = collectMetaTags($);

  const type = first(tags, 'og:type')?.toLowerCase();
  const hasPrice = tags.has('product:price:amount') || tags.has('product:sale_price:amount');

  // A category page's OpenGraph block describes the *category*. Emitting a
  // product from it invents a product named after the shelf it sits on.
  if ((type === undefined || !PRODUCT_TYPES.has(type)) && !hasPrice) {
    return { source: 'opengraph', drafts: [], discoveredUrls: [], breadcrumb: [], issues };
  }

  const url = absoluteUrl(first(tags, 'og:url'), page.url) ?? page.url;
  const draft: ProductDraft = createDraft(canonicalizeUrl(url));
  const confidence = CONFIDENCE.opengraph;
  const source = 'opengraph';

  setField(draft, 'name', first(tags, 'og:title', 'twitter:title'), confidence, source);
  // `og:description` is an excerpt, not the product copy — the short field is
  // where it belongs, and it keeps the long description honestly empty.
  setField(
    draft,
    'shortDescription',
    first(tags, 'og:description', 'twitter:description'),
    confidence,
    source
  );

  const images = all(tags, 'og:image:secure_url', 'og:image', 'og:image:url', 'twitter:image')
    .map((candidate) => absoluteUrl(candidate, page.url))
    .filter((candidate): candidate is string => candidate !== undefined);
  setField(draft, 'images', [...new Set(images)], confidence, source);

  setField(
    draft,
    'sku',
    first(tags, 'product:retailer_item_id', 'product:retailer_part_no', 'product:sku'),
    confidence,
    source
  );
  setField(draft, 'brand', first(tags, 'product:brand', 'og:brand'), confidence, source);

  const gtin = first(tags, 'product:ean', 'product:gtin13', 'product:upc', 'product:isbn');
  if (gtin !== undefined && /^\d{6,14}$/.test(gtin)) {
    setField(draft, 'gtin', gtin, confidence, source);
  }

  const currency = first(tags, 'product:price:currency', 'og:price:currency');
  const price = readPrice(
    first(tags, 'product:price:amount', 'og:price:amount'),
    currency,
    options
  );
  const sale = readPrice(
    first(tags, 'product:sale_price:amount'),
    first(tags, 'product:sale_price:currency') ?? currency,
    options
  );
  const original = readPrice(
    first(tags, 'product:original_price:amount'),
    first(tags, 'product:original_price:currency') ?? currency,
    options
  );

  // Three tags, one "was / now" pair. Whichever pair is present, the higher
  // number is the regular price — importing them the other way round marks the
  // product up and shows a negative discount.
  if (sale !== undefined && price !== undefined && sale.amount < price.amount) {
    setPricePair(draft, { regular: price, sale }, confidence, source);
  } else if (original !== undefined && price !== undefined && original.amount > price.amount) {
    setPricePair(draft, { regular: original, sale: price }, confidence, source);
  } else {
    setPricePair(draft, { regular: price ?? sale ?? original }, confidence, source);
  }

  setField(
    draft,
    'inStock',
    readAvailability(first(tags, 'product:availability', 'og:availability')),
    confidence,
    source
  );
  setField(draft, 'weight', readOgWeight(tags), confidence, source);

  // `product:category` is usually a numeric Google taxonomy id, which names
  // nothing a person would recognise in a Categories column.
  const category = first(tags, 'product:category', 'article:section');
  if (category !== undefined && !/^\d+$/.test(category)) {
    setField(draft, 'categoryPath', [category], confidence, source);
  }

  return { source, drafts: [draft], discoveredUrls: [], breadcrumb: [], issues };
}
