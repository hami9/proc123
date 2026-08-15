/**
 * The Layer A adapters, against canned endpoint responses shaped exactly as the
 * real ones are — the WooCommerce ones checked against `woocommerce/woocommerce`
 * trunk, see docs/store-api-notes.md.
 */

import { describe, expect, it } from 'vitest';

import {
  type CanonicalProduct,
  embeddedStateAdapter,
  loadHtml,
  scanCategory,
  shopifyAdapter,
  wooCommerceAdapter,
} from '@proc123/core';

import { type Route, SCANNED_AT, fakeHttp, page } from './helpers.js';

type Routes = readonly (readonly [string | RegExp, Route])[];

// ---------------------------------------------------------------------------
// WooCommerce Store API
// ---------------------------------------------------------------------------

const WOO_PAGE = page('woo-store-api.html', 'https://ajil.example/shop/product-category/nuts/');

/**
 * A Persian store: IRR with zero decimals, and the toman word in the store's
 * own currency suffix — which is the signal Layer B never gets.
 */
const TOMAN = {
  currency_code: 'IRR',
  currency_symbol: 'تومان',
  currency_minor_unit: 0,
  currency_decimal_separator: '.',
  currency_thousand_separator: ',',
  currency_prefix: '',
  currency_suffix: ' تومان',
};

const CATEGORIES = [
  { id: 12, name: 'آجیل', slug: 'nuts', parent: 0, count: 2 },
  { id: 15, name: 'بادام', slug: 'almond', parent: 12, count: 1 },
  { id: 16, name: 'پسته', slug: 'pistachio', parent: 12, count: 1 },
];

const ALMOND = {
  id: 101,
  name: 'بادام درختی شور',
  slug: 'almond',
  parent: 0,
  type: 'simple',
  permalink: 'https://ajil.example/shop/product/almond/',
  sku: 'AJ-ALM',
  description: '<p>بادام درختی شور، برشته.</p>',
  short_description: '<p>برشته و شور.</p>',
  on_sale: true,
  prices: {
    ...TOMAN,
    price: '920000',
    regular_price: '1000000',
    sale_price: '920000',
    price_range: null,
  },
  images: [{ id: 1, src: 'https://cdn.ajil.example/almond.jpg' }],
  categories: [
    { id: 12, name: 'آجیل', slug: 'nuts', link: '' },
    { id: 15, name: 'بادام', slug: 'almond', link: '' },
  ],
  tags: [{ id: 3, name: 'خشکبار', slug: 'dried' }],
  brands: [{ id: 9, name: 'آجیل نمونه', slug: 'ajil' }],
  attributes: [],
  variations: [],
  is_in_stock: true,
};

/**
 * The variation trap in fixture form: the parent lists Persian term *names*,
 * while `variations[].attributes[].value` holds the term **slug**. Exporting
 * both untranslated gives a CSV whose variations match nothing.
 */
const PISTACHIO = {
  id: 102,
  name: 'پسته اکبری',
  slug: 'pistachio',
  parent: 0,
  type: 'variable',
  permalink: 'https://ajil.example/shop/product/pistachio/',
  sku: 'AJ-PIS',
  description: '<p>پسته اکبری درجه یک.</p>',
  short_description: '',
  on_sale: false,
  prices: {
    ...TOMAN,
    price: '1800000',
    regular_price: '1800000',
    sale_price: '1800000',
    price_range: { min_amount: '1800000', max_amount: '3400000' },
  },
  images: [{ id: 2, src: 'https://cdn.ajil.example/pistachio.jpg' }],
  categories: [
    { id: 12, name: 'آجیل', slug: 'nuts', link: '' },
    { id: 16, name: 'پسته', slug: 'pistachio', link: '' },
  ],
  tags: [],
  brands: [],
  attributes: [
    {
      id: 4,
      name: 'وزن',
      taxonomy: 'pa_weight',
      has_variations: true,
      terms: [
        { id: 41, name: '۵۰۰ گرم', slug: '500-gram', default: false },
        { id: 42, name: '۱ کیلوگرم', slug: '1-kilogram', default: false },
      ],
    },
  ],
  variations: [
    { id: 501, attributes: [{ name: 'وزن', value: '500-gram' }] },
    { id: 502, attributes: [{ name: 'وزن', value: '1-kilogram' }] },
  ],
  is_in_stock: true,
};

const VARIATIONS = [
  {
    id: 501,
    name: 'پسته اکبری - ۵۰۰ گرم',
    parent: 102,
    type: 'variation',
    permalink: 'https://ajil.example/shop/product/pistachio/?attribute_pa_weight=500-gram',
    sku: 'AJ-PIS-500',
    on_sale: false,
    prices: {
      ...TOMAN,
      price: '1800000',
      regular_price: '1800000',
      sale_price: '1800000',
      price_range: null,
    },
    images: [],
    categories: [],
    tags: [],
    attributes: [],
    variations: [],
    is_in_stock: true,
  },
  {
    id: 502,
    name: 'پسته اکبری - ۱ کیلوگرم',
    parent: 102,
    type: 'variation',
    permalink: 'https://ajil.example/shop/product/pistachio/?attribute_pa_weight=1-kilogram',
    sku: 'AJ-PIS-1000',
    on_sale: false,
    prices: {
      ...TOMAN,
      price: '3400000',
      regular_price: '3400000',
      sale_price: '3400000',
      price_range: null,
    },
    images: [],
    categories: [],
    tags: [],
    attributes: [],
    variations: [],
    is_in_stock: false,
  },
];

function wooRoutes(overrides: Routes = []): Routes {
  return [
    ...overrides,
    [
      /products\/categories/,
      { body: CATEGORIES, headers: { 'x-wp-totalpages': '1', 'x-wp-total': '3' } },
    ],
    [/type=variation/, { body: VARIATIONS, headers: { 'x-wp-totalpages': '1' } }],
    [
      /\/products\?/,
      { body: [ALMOND, PISTACHIO], headers: { 'x-wp-totalpages': '1', 'x-wp-total': '2' } },
    ],
  ];
}

async function runWoo(routes = wooRoutes(), log: string[] = []) {
  return {
    log,
    reading: await wooCommerceAdapter.fetchCategory({
      page: WOO_PAGE,
      $: loadHtml(WOO_PAGE.html),
      http: fakeHttp(routes, log),
      options: { scannedAt: SCANNED_AT },
    }),
  };
}

function named(products: readonly CanonicalProduct[], name: string): CanonicalProduct {
  const found = products.find((product) => product.name === name);
  if (found === undefined) throw new Error(`no product named ${name}`);
  return found;
}

describe('the WooCommerce Store API adapter', () => {
  it('finds the REST root the page advertises, not the default one', async () => {
    const { log } = await runWoo();
    // This store runs in /shop/; assuming /wp-json/ would 404 every request.
    expect(
      log.every((url) => url.startsWith('https://ajil.example/shop/wp-json/wc/store/v1/'))
    ).toBe(true);
  });

  it('reads the category slug off the page URL', async () => {
    const { log } = await runWoo();
    expect(log.some((url) => url.includes('category=nuts'))).toBe(true);
  });

  it('asks for the largest page the endpoint allows', async () => {
    const { log } = await runWoo();
    expect(log.some((url) => url.includes('per_page=100'))).toBe(true);
  });

  it('decodes prices out of the smallest currency unit', async () => {
    const { reading } = await runWoo();
    const almond = named(reading.products, 'بادام درختی شور');
    // minor_unit 0 here, so the integer is already the amount.
    expect(almond.regularPrice?.amount).toBe(1000000);
    expect(almond.salePrice?.amount).toBe(920000);
  });

  it('divides by the minor unit when the store uses decimals', async () => {
    const euro = {
      ...ALMOND,
      name: 'Almonds',
      permalink: 'https://ajil.example/shop/product/almonds-eu/',
      prices: {
        ...TOMAN,
        currency_code: 'EUR',
        currency_minor_unit: 2,
        currency_suffix: '',
        currency_prefix: '€',
        price: '895',
        regular_price: '1250',
        sale_price: '895',
        price_range: null,
      },
    };

    const { reading } = await runWoo(
      wooRoutes([[/\/products\?/, { body: [euro], headers: { 'x-wp-totalpages': '1' } }]])
    );

    // "1250" with two decimals is €12.50, not €1250. Reading it raw is a 100x error.
    expect(reading.products[0]?.regularPrice).toEqual({ amount: 12.5, currency: 'EUR' });
    expect(reading.products[0]?.salePrice).toEqual({ amount: 8.95, currency: 'EUR' });
  });

  it('takes the toman/rial unit from the store’s own currency suffix', async () => {
    const { reading } = await runWoo();
    // Layer B can only see "IRR" here and has to ask the user. The store's
    // settings say تومان outright.
    expect(named(reading.products, 'بادام درختی شور').regularPrice?.unit).toBe('toman');
  });

  it('builds a hierarchical category path from the term tree', async () => {
    const { reading } = await runWoo();
    // `categories` is a flat list; the hierarchy comes from the terms endpoint.
    expect(named(reading.products, 'بادام درختی شور').categoryPath).toEqual(['آجیل', 'بادام']);
  });

  it('leaves a variable parent without prices and says why', async () => {
    const { reading } = await runWoo();
    const parent = named(reading.products, 'پسته اکبری');

    expect(parent.kind).toBe('variable');
    // The Store API fills a variable product's prices from the *minimum* across
    // its variations. That is a range summary, not this row's price.
    expect(parent.regularPrice).toBeUndefined();
    expect(parent.salePrice).toBeUndefined();

    const issue = reading.issues.find((entry) => entry.code === 'price-range-only');
    expect(issue?.message).toContain('3400000');
  });

  it('emits the parent immediately before its own variation rows', async () => {
    const { reading } = await runWoo();
    expect(reading.products.map((product) => [product.kind, product.sku])).toEqual([
      ['simple', 'AJ-ALM'],
      ['variable', 'AJ-PIS'],
      ['variation', 'AJ-PIS-500'],
      ['variation', 'AJ-PIS-1000'],
    ]);
  });

  it('translates a variation’s term slug back to the parent’s spelling', async () => {
    const { reading } = await runWoo();
    const [, parent, small, large] = reading.products;

    // The API gives the parent `۵۰۰ گرم` and the variation `500-gram`. Exported
    // untranslated, WooCommerce matches them character for character, fails,
    // and silently drops every variation.
    expect(parent?.attributes).toEqual([
      { name: 'وزن', values: ['۵۰۰ گرم', '۱ کیلوگرم'], isVariationAxis: true },
    ]);
    expect(small?.attributes).toEqual([
      { name: 'وزن', values: ['۵۰۰ گرم'], isVariationAxis: true },
    ]);
    expect(large?.attributes).toEqual([
      { name: 'وزن', values: ['۱ کیلوگرم'], isVariationAxis: true },
    ]);
  });

  it('keeps per-variation prices and stock', async () => {
    const { reading } = await runWoo();
    expect(reading.products[2]?.regularPrice?.amount).toBe(1800000);
    expect(reading.products[2]?.inStock).toBe(true);
    expect(reading.products[3]?.regularPrice?.amount).toBe(3400000);
    expect(reading.products[3]?.inStock).toBe(false);
  });

  it('links every variation to its parent by SKU', async () => {
    const { reading } = await runWoo();
    expect(reading.products.slice(2).map((product) => product.parentSku)).toEqual([
      'AJ-PIS',
      'AJ-PIS',
    ]);
  });

  it('marks the layer as A on every row', async () => {
    const { reading } = await runWoo();
    for (const product of reading.products) {
      expect(product.extractionMeta.layer).toBe('A');
      expect(product.extractionMeta.fieldConfidence['name']).toBe(1);
    }
  });

  it('reports nothing at all when the Store API is switched off', async () => {
    const { reading } = await runWoo([]);
    expect(reading.products).toEqual([]);
    expect(reading.incomplete).toBe(true);
  });

  it('keeps the product when its variations cannot be fetched, and says so', async () => {
    const routes: Routes = [
      [/products\/categories/, { body: CATEGORIES, headers: { 'x-wp-totalpages': '1' } }],
      [/type=variation/, { status: 404, body: '<html>gone</html>' }],
      [/\/products\?/, { body: [PISTACHIO], headers: { 'x-wp-totalpages': '1' } }],
    ];

    const { reading } = await runWoo(routes);
    expect(reading.products).toHaveLength(1);
    expect(reading.incomplete).toBe(true);
    expect(reading.issues.map((issue) => issue.code)).toContain('variations-unavailable');
  });

  it('skips the variation request when asked to', async () => {
    const log: string[] = [];
    await wooCommerceAdapter.fetchCategory({
      page: WOO_PAGE,
      $: loadHtml(WOO_PAGE.html),
      http: fakeHttp(wooRoutes(), log),
      options: { scannedAt: SCANNED_AT, includeVariations: false },
    });
    expect(log.some((url) => url.includes('type=variation'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Shopify
// ---------------------------------------------------------------------------

const SHOPIFY_PAGE = page('shopify-collection.html', 'https://roastery.example/collections/nuts');

const SHOPIFY_PRODUCT = {
  id: 111,
  title: 'Marcona Almonds',
  handle: 'marcona-almonds',
  body_html: '<p>Fried in olive oil.</p>',
  vendor: 'Example Roastery',
  product_type: 'Nuts',
  tags: ['spanish'],
  images: [{ id: 1, src: 'https://cdn.shopify.com/almonds.jpg' }],
  options: [{ name: 'Size', position: 1, values: ['250g', '1kg'] }],
  variants: [
    {
      id: 1,
      title: '250g',
      option1: '250g',
      sku: 'ALM-250',
      price: '8.50',
      compare_at_price: '10.00',
      available: true,
      grams: 250,
    },
    {
      id: 2,
      title: '1kg',
      option1: '1kg',
      sku: 'ALM-1000',
      price: '29.00',
      compare_at_price: null,
      available: false,
      grams: 1000,
    },
  ],
};

const SHOPIFY_SIMPLE = {
  id: 222,
  title: 'House Blend',
  handle: 'house-blend',
  body_html: '<p>Everyday coffee.</p>',
  vendor: 'Example Roastery',
  product_type: 'Coffee',
  tags: [],
  images: [],
  options: [{ name: 'Title', position: 1, values: ['Default Title'] }],
  variants: [
    {
      id: 3,
      title: 'Default Title',
      option1: 'Default Title',
      sku: 'HB',
      price: '12.00',
      compare_at_price: null,
      available: true,
      grams: 0,
    },
  ],
};

async function runShopify(body: unknown, count = 2) {
  const products = Array.isArray(body) ? body : [];
  const html = SHOPIFY_PAGE.html.replace('"numberOfItems": 3', `"numberOfItems": ${String(count)}`);
  const context = { url: SHOPIFY_PAGE.url, html };

  return shopifyAdapter.fetchCategory({
    page: context,
    $: loadHtml(html),
    http: fakeHttp([[/products\.json/, { body: { products } }]]),
    options: { scannedAt: SCANNED_AT },
  });
}

describe('the Shopify adapter', () => {
  it('reads a single-variant product as a simple one', async () => {
    const reading = await runShopify([SHOPIFY_SIMPLE], 1);
    expect(reading.products).toHaveLength(1);
    expect(reading.products[0]?.kind).toBe('simple');
    expect(reading.products[0]?.sku).toBe('HB');
    // "Default Title" is Shopify's placeholder, not an option worth exporting.
    expect(reading.products[0]?.attributes).toEqual([]);
  });

  it('reads prices as decimals, the opposite of the Store API', async () => {
    const reading = await runShopify([SHOPIFY_SIMPLE], 1);
    expect(reading.products[0]?.regularPrice).toEqual({ amount: 12, currency: 'EUR' });
  });

  it('takes the currency from the page, since products.json never states it', async () => {
    const reading = await runShopify([SHOPIFY_SIMPLE], 1);
    expect(reading.products[0]?.regularPrice?.currency).toBe('EUR');
  });

  it('reads compare_at_price as the was/now pair', async () => {
    const reading = await runShopify([SHOPIFY_PRODUCT], 1);
    const [, small] = reading.products;
    expect(small?.regularPrice?.amount).toBe(10);
    expect(small?.salePrice?.amount).toBe(8.5);
  });

  it('does not invent a discount when compare_at_price is absent', async () => {
    const reading = await runShopify([SHOPIFY_PRODUCT], 1);
    expect(reading.products[2]?.regularPrice?.amount).toBe(29);
    expect(reading.products[2]?.salePrice).toBeUndefined();
  });

  it('turns options into matching parent and variation values', async () => {
    const reading = await runShopify([SHOPIFY_PRODUCT], 1);
    expect(reading.products[0]?.attributes).toEqual([
      { name: 'Size', values: ['250g', '1kg'], isVariationAxis: true },
    ]);
    expect(reading.products[1]?.attributes).toEqual([
      { name: 'Size', values: ['250g'], isVariationAxis: true },
    ]);
  });

  it('reads grams as a weight, but not a zero one', async () => {
    const reading = await runShopify([SHOPIFY_PRODUCT, SHOPIFY_SIMPLE], 2);
    expect(reading.products[1]?.weight).toEqual({ value: 250, unit: 'g' });
    // 0 grams means "not weighed", which every digital product carries.
    expect(reading.products.at(-1)?.weight).toBeUndefined();
  });

  it('flags a short answer against the collection’s declared count', async () => {
    // ROADMAP §6.14 — the endpoint is capped or partly disabled more often
    // than it admits, and a half catalogue looks exactly like a whole one.
    const reading = await runShopify([SHOPIFY_SIMPLE], 3);
    expect(reading.incomplete).toBe(true);
    expect(reading.issues.map((issue) => issue.code)).toContain('shopify-count-mismatch');
  });

  it('is content when the count agrees', async () => {
    const reading = await runShopify([SHOPIFY_PRODUCT, SHOPIFY_SIMPLE], 2);
    expect(reading.incomplete).toBe(false);
  });

  it('treats a storefront HTML answer as the endpoint being switched off', async () => {
    const reading = await shopifyAdapter.fetchCategory({
      page: SHOPIFY_PAGE,
      $: loadHtml(SHOPIFY_PAGE.html),
      http: fakeHttp([[/products\.json/, { body: '<html>Not found</html>' }]]),
      options: { scannedAt: SCANNED_AT },
    });
    expect(reading.products).toEqual([]);
    expect(reading.incomplete).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Embedded state
// ---------------------------------------------------------------------------

const NEXT_PAGE = page('nextjs-storefront.html', 'https://headless.example/collections/nuts');

describe('the embedded-state adapter', () => {
  const run = async () =>
    embeddedStateAdapter.fetchCategory({
      page: NEXT_PAGE,
      $: loadHtml(NEXT_PAGE.html),
      http: fakeHttp([]),
      options: { scannedAt: SCANNED_AT },
    });

  it('needs no request at all', async () => {
    const log: string[] = [];
    await embeddedStateAdapter.fetchCategory({
      page: NEXT_PAGE,
      $: loadHtml(NEXT_PAGE.html),
      http: fakeHttp([], log),
      options: { scannedAt: SCANNED_AT },
    });
    expect(log).toEqual([]);
  });

  it('maps a Shopify-shaped payload with the Shopify mapper', async () => {
    const reading = await run();
    const almonds = reading.products.filter((product) =>
      product.sourceUrl.includes('marcona-almonds')
    );

    expect(almonds.map((product) => product.kind)).toEqual(['variable', 'variation', 'variation']);
    // The currency is not in the Shopify REST shape at all; it comes from the
    // `currencyCode` the GraphQL half of the same blob states.
    expect(almonds[1]?.regularPrice).toEqual({ amount: 10, currency: 'EUR' });
    expect(almonds[1]?.salePrice).toEqual({ amount: 8.5, currency: 'EUR' });
  });

  it('maps the GraphQL shape a headless build actually receives', async () => {
    const reading = await run();
    const pistachios = reading.products.find((product) =>
      product.sourceUrl.includes('sicilian-pistachios')
    );

    expect(pistachios?.name).toBe('Sicilian Pistachios');
    expect(pistachios?.regularPrice).toEqual({ amount: 30, currency: 'EUR' });
    expect(pistachios?.salePrice).toEqual({ amount: 24, currency: 'EUR' });
    expect(pistachios?.images).toEqual(['https://cdn.shopify.com/pistachios.jpg']);
    expect(pistachios?.inStock).toBe(true);
  });

  it('trusts a recognised shape less than a stated one', async () => {
    const reading = await run();
    const pistachios = reading.products.find((product) =>
      product.sourceUrl.includes('sicilian-pistachios')
    );
    // Inferred from its shape, so it must lose to JSON-LD if the page has any.
    expect(pistachios?.extractionMeta.fieldConfidence['name']).toBe(0.8);
  });

  it('ignores an object that is named and identified but has no price', async () => {
    const reading = await run();
    // The `collections` entry looks like a product until you ask its price.
    expect(reading.products.some((product) => product.name === 'Nuts')).toBe(false);
  });

  it('finds nothing on a page with no state blob', async () => {
    const plain = page('no-markup.html', 'https://outdoors.example/p/mug');
    const reading = await embeddedStateAdapter.fetchCategory({
      page: plain,
      $: loadHtml(plain.html),
      http: fakeHttp([]),
      options: { scannedAt: SCANNED_AT },
    });
    expect(reading.products).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The scan orchestrator
// ---------------------------------------------------------------------------

describe('scanCategory', () => {
  it('uses Layer A when an adapter answers completely', async () => {
    const result = await scanCategory(WOO_PAGE, {
      scannedAt: SCANNED_AT,
      http: fakeHttp(wooRoutes()),
      politeness: { delayMsBetweenRequests: 0 },
    });

    expect(result.layer).toBe('A');
    expect(result.platform).toBe('woocommerce');
    expect(result.products).toHaveLength(4);
    expect(result.requests).toBeGreaterThan(0);
  });

  it('falls through to Layer B when the endpoint is switched off', async () => {
    const woo = page('woo-product.html', 'https://ajil.example/product/walnut-500/');
    const result = await scanCategory(woo, {
      scannedAt: SCANNED_AT,
      http: fakeHttp([]),
      politeness: { delayMsBetweenRequests: 0 },
    });

    expect(result.layer).toBe('B');
    expect(result.products).toHaveLength(1);
    expect(result.products[0]?.name).toBe('گردو با پوست ۵۰۰ گرم');
  });

  it('runs the no-network adapters when no client is supplied', async () => {
    const result = await scanCategory(NEXT_PAGE, { scannedAt: SCANNED_AT });
    expect(result.layer).toBe('A');
    expect(result.products.length).toBeGreaterThan(0);
    expect(result.requests).toBe(0);
  });

  it('stops the scan when the site signals a block, and does not work around it', async () => {
    const result = await scanCategory(WOO_PAGE, {
      scannedAt: SCANNED_AT,
      http: fakeHttp([[/./, { status: 429, body: 'slow down' }]]),
      politeness: { delayMsBetweenRequests: 0 },
    });

    expect(result.products).toEqual([]);
    expect(result.incomplete).toBe(true);
    expect(result.requests).toBe(1);

    const blocked = result.issues.find((issue) => issue.code === 'site-blocked');
    expect(blocked?.severity).toBe('error');
    expect(blocked?.kind).toBe('site-blocked');
    expect(blocked?.message).toMatch(/does not work around one/);
  });

  it('says when it recognised a platform it has no adapter for', async () => {
    const html = `<html><head><meta name="generator" content="Magento 2.4">
      <script type="text/x-magento-init">{}</script></head><body></body></html>`;
    const result = await scanCategory(
      { url: 'https://m.example/c/nuts', html },
      {
        scannedAt: SCANNED_AT,
      }
    );

    expect(result.layer).toBe('B');
    expect(result.issues.map((issue) => issue.code)).toContain('no-adapter-for-platform');
  });

  it('prefers Layer B when Layer A admits it returned less', async () => {
    // The endpoint returns one product while the collection declares five and
    // the page's own markup describes two. ROADMAP §6.14 says believe the page.
    const html = page('woo-category.html', 'x')
      .html.replace('<head>', '<head><script>Shopify.shop="x.myshopify.com"</script>')
      .replace('"@type": "ItemList",', '"@type": "ItemList", "numberOfItems": 5,');
    const context = { url: 'https://ajil.example/collections/nuts', html };

    const result = await scanCategory(context, {
      scannedAt: SCANNED_AT,
      http: fakeHttp([[/products\.json/, { body: { products: [SHOPIFY_SIMPLE] } }]]),
      politeness: { delayMsBetweenRequests: 0 },
    });

    expect(result.layer).toBe('B');
    expect(result.products).toHaveLength(2);
  });
});
