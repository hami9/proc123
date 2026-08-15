/**
 * Reading prices and stock out of schema.org `offers`.
 *
 * Two things make this the delicate part of Layer B.
 *
 * First, schema.org has no "was / now" pair. A store on sale publishes the sale
 * price as `price` and, if it is thorough, the original as a `ListPrice`
 * `priceSpecification`. Missing that pair means importing a sale price as the
 * regular price, which permanently marks the product down in the target store.
 *
 * Second, a category page publishes `AggregateOffer` ranges rather than prices.
 * A range is not a price, and quietly writing its low end into the CSV is the
 * class of silent numeric error CLAUDE.md §7.8 exists to prevent — so a range
 * is reported as one and carries reduced confidence.
 */

import type { CurrencyUnit, Money } from '../model.js';
import { parseMoney } from '../money.js';
import {
  type JsonObject,
  type JsonValue,
  asArray,
  asNumber,
  asObjects,
  asText,
  isJsonObject,
} from './json.js';
import { normalizeType } from './schema-values.js';

/**
 * `availability` accepts the bare name, the full schema.org URL, and — from
 * feed plugins that reuse their Google Merchant vocabulary — `in_stock`.
 */
function normalizeAvailability(raw: string): string {
  return normalizeType(raw).replace(/[\s_-]/g, '');
}

/**
 * Pre-order and back-order are stocked as available on purpose: the store is
 * taking money for them, so an importer that marks them out of stock hides
 * products the merchant is actively selling.
 */
const AVAILABILITY: Readonly<Record<string, boolean>> = {
  instock: true,
  instoreonly: true,
  onlineonly: true,
  limitedavailability: true,
  presale: true,
  preorder: true,
  backorder: true,
  // OpenGraph `product:availability` uses its own vocabulary.
  available: true,
  availablefororder: true,
  outofstock: false,
  oos: false,
  soldout: false,
  discontinued: false,
};

export function readAvailability(value: JsonValue | undefined): boolean | undefined {
  const text = asText(value);
  if (text === undefined) return undefined;
  return AVAILABILITY[normalizeAvailability(text)];
}

/** `inventoryLevel` is a `QuantitativeValue`, or the bare number sites write instead. */
function readInventoryLevel(value: JsonValue | undefined): number | undefined {
  for (const entry of asArray(value)) {
    const raw = isJsonObject(entry) ? entry['value'] : entry;
    const amount = asNumber(raw);
    if (amount !== undefined && amount >= 0) return Math.trunc(amount);
  }
  return undefined;
}

/** `priceType` values that mean "this is the price before the discount". */
const LIST_PRICE_TYPES = new Set([
  'listprice',
  'msrp',
  'strikethroughprice',
  'regularprice',
  'suggestedretailprice',
  'recommendedretailprice',
]);

/** `priceType` values that mean "this is the price you pay today". */
const SALE_PRICE_TYPES = new Set(['saleprice', 'discountedprice', 'promotionalprice']);

function priceTypeOf(spec: JsonObject): string | undefined {
  const raw = asText(spec['priceType']);
  return raw === undefined ? undefined : normalizeType(raw);
}

export interface MoneyContext {
  /** Used when the markup gives a price with no `priceCurrency`. */
  defaultCurrency?: string;
  /**
   * Used when the currency is `IRR` and nothing on the page says toman or rial.
   * Must come from an explicit user setting, never from a guess.
   */
  defaultUnit?: CurrencyUnit;
}

interface ParsedPrice {
  money: Money;
  ambiguousGrouping: boolean;
  unitFromSource: boolean;
}

function readPrice(
  raw: JsonValue | undefined,
  currency: string | undefined,
  ctx: MoneyContext
): ParsedPrice | undefined {
  const text = asText(raw);
  if (text === undefined) return undefined;

  const effectiveCurrency = currency ?? ctx.defaultCurrency;

  const parsed = parseMoney(text, {
    // A lone separator with three trailing digits is grouping in a price:
    // `1,500` and `1.500` are both fifteen hundred, not one and a half.
    ambiguousGrouping: 'thousands',
    ...(effectiveCurrency !== undefined ? { defaultCurrency: effectiveCurrency } : {}),
    ...(ctx.defaultUnit !== undefined ? { defaultUnit: ctx.defaultUnit } : {}),
  });
  if (parsed === undefined) return undefined;

  return {
    money: parsed.money,
    ambiguousGrouping: parsed.ambiguousGrouping,
    unitFromSource: parsed.unitFromSource,
  };
}

interface SingleOffer {
  regular?: ParsedPrice;
  sale?: ParsedPrice;
  /** Set when this one offer is itself a range (`AggregateOffer.highPrice`). */
  high?: number;
  inStock?: boolean;
  stockQuantity?: number;
  sku?: string;
}

function readSingleOffer(node: JsonObject, ctx: MoneyContext): SingleOffer | undefined {
  const currency = asText(node['priceCurrency']);
  const specs = asObjects(node['priceSpecification']);

  const listSpec = specs.find((spec) => {
    const type = priceTypeOf(spec);
    return type !== undefined && LIST_PRICE_TYPES.has(type);
  });
  const saleSpec = specs.find((spec) => {
    const type = priceTypeOf(spec);
    return type !== undefined && SALE_PRICE_TYPES.has(type);
  });
  const plainSpec = specs.find((spec) => priceTypeOf(spec) === undefined);

  const currentSource = saleSpec ?? plainSpec;
  const currentRaw = node['price'] ?? currentSource?.['price'] ?? node['lowPrice'];
  const currentCurrency = currency ?? asText(currentSource?.['priceCurrency']);

  const current = readPrice(currentRaw, currentCurrency, ctx);
  const list =
    listSpec === undefined
      ? undefined
      : readPrice(listSpec['price'], asText(listSpec['priceCurrency']) ?? currency, ctx);

  const offer: SingleOffer = {};

  // A list price only counts when it is actually higher; plugins emit an equal
  // one for products that are not on sale, and a sale price equal to the
  // regular price imports as a permanent 0% discount.
  if (list !== undefined && current !== undefined && list.money.amount > current.money.amount) {
    offer.regular = list;
    offer.sale = current;
  } else if (current !== undefined) {
    offer.regular = current;
  } else if (list !== undefined) {
    offer.regular = list;
  }

  const high = readPrice(node['highPrice'], currentCurrency, ctx);
  if (
    high !== undefined &&
    offer.regular !== undefined &&
    high.money.amount > offer.regular.money.amount
  ) {
    offer.high = high.money.amount;
  }

  const availability = readAvailability(node['availability']);
  if (availability !== undefined) offer.inStock = availability;

  const inventory = readInventoryLevel(node['inventoryLevel']);
  if (inventory !== undefined) offer.stockQuantity = inventory;

  const sku = asText(node['sku']);
  if (sku !== undefined) offer.sku = sku;

  const hasAnything =
    offer.regular !== undefined ||
    offer.inStock !== undefined ||
    offer.stockQuantity !== undefined ||
    offer.sku !== undefined;
  return hasAnything ? offer : undefined;
}

/** Depth guard for the rare `AggregateOffer` → `AggregateOffer` → `Offer` nesting. */
const MAX_OFFER_DEPTH = 3;

function collectOffers(
  nodes: readonly JsonObject[],
  ctx: MoneyContext,
  out: SingleOffer[],
  depth = 0
): void {
  if (depth > MAX_OFFER_DEPTH) return;

  for (const node of nodes) {
    const nested = asObjects(node['offers']);
    if (nested.length > 0) {
      // An AggregateOffer that lists its members is fully described by them;
      // its low/high are a summary of the very same numbers.
      collectOffers(nested, ctx, out, depth + 1);
      continue;
    }

    const single = readSingleOffer(node, ctx);
    if (single !== undefined) out.push(single);
  }
}

export interface OfferReading {
  regularPrice?: Money;
  salePrice?: Money;
  inStock?: boolean;
  stockQuantity?: number;
  sku?: string;
  /**
   * The page published several prices or a range, so the chosen price is the
   * lowest of them rather than a stated fact. Callers must lower the field's
   * confidence and tell the user.
   */
  priceIsRange: boolean;
  priceRange?: { low: number; high: number };
  /** The number's separator could have been read either way. */
  ambiguousGrouping: boolean;
  /** The page named toman or rial itself, rather than a default filling in. */
  unitFromSource: boolean;
}

export function readOffers(
  value: JsonValue | undefined,
  ctx: MoneyContext
): OfferReading | undefined {
  const offers: SingleOffer[] = [];
  collectOffers(asObjects(value), ctx, offers);
  if (offers.length === 0) return undefined;

  const priced = offers.filter(
    (offer): offer is SingleOffer & { regular: ParsedPrice } => offer.regular !== undefined
  );

  const reading: OfferReading = {
    priceIsRange: false,
    ambiguousGrouping: false,
    unitFromSource: false,
  };

  // One offer in stock makes the product buyable, whatever the others say.
  const inStock = offers.some((offer) => offer.inStock === true)
    ? true
    : offers.some((offer) => offer.inStock === false)
      ? false
      : undefined;
  if (inStock !== undefined) reading.inStock = inStock;

  const stockQuantity = offers.find((offer) => offer.stockQuantity !== undefined)?.stockQuantity;
  if (stockQuantity !== undefined) reading.stockQuantity = stockQuantity;

  const sku = offers.find((offer) => offer.sku !== undefined)?.sku;
  if (sku !== undefined) reading.sku = sku;

  const [first, ...rest] = priced;
  if (first === undefined) return reading;

  // Cheapest wins, so "from X" matches what the store's own listing shows.
  const chosen = rest.reduce(
    (best, offer) => (offer.regular.money.amount < best.regular.money.amount ? offer : best),
    first
  );

  const low = chosen.regular.money.amount;
  const high = priced.reduce(
    (max, offer) => Math.max(max, offer.high ?? offer.regular.money.amount),
    low
  );

  reading.regularPrice = chosen.regular.money;
  if (chosen.sale !== undefined) reading.salePrice = chosen.sale.money;
  reading.ambiguousGrouping = chosen.regular.ambiguousGrouping;
  reading.unitFromSource = chosen.regular.unitFromSource;

  if (high > low) {
    reading.priceIsRange = true;
    reading.priceRange = { low, high };
  }

  return reading;
}
