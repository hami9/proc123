/**
 * The JSON-LD mechanics the fixtures do not exercise: `@graph` containers,
 * `@id` references between nodes, the shapes an `ItemList` takes, and the
 * `WebPage` wrappers plugins put around a product.
 */

import { describe, expect, it } from 'vitest';

import { type JsonValue, extractJsonLd, extractStructured, loadHtml } from '@proc123/core';

import { SCANNED_AT } from './fixtures.js';

const PAGE = 'https://shop.example/p/walnut';

function withJsonLd(...blocks: JsonValue[]): string {
  const scripts = blocks
    .map((block) => `<script type="application/ld+json">${JSON.stringify(block)}</script>`)
    .join('\n');
  return `<html><head>${scripts}</head><body></body></html>`;
}

function scan(...blocks: JsonValue[]) {
  return extractStructured({ url: PAGE, html: withJsonLd(...blocks) }, { scannedAt: SCANNED_AT });
}

const PRODUCT = {
  '@type': 'Product',
  name: 'Walnut',
  sku: 'W1',
  offers: { '@type': 'Offer', price: '150000', priceCurrency: 'IRR' },
};

describe('script discovery', () => {
  it('reads every block on the page', () => {
    const result = scan(
      { '@context': 'https://schema.org', ...PRODUCT },
      {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://shop.example/' },
          { '@type': 'ListItem', position: 2, name: 'Nuts', item: 'https://shop.example/c/nuts' },
        ],
      }
    );

    expect(result.products[0]?.categoryPath).toEqual(['Nuts']);
  });

  it('accepts the application/json+ld spelling too', () => {
    const html = `<script type="application/json+ld">${JSON.stringify(PRODUCT)}</script>`;
    expect(extractJsonLd(loadHtml(html), { url: PAGE, html }).drafts).toHaveLength(1);
  });

  it('ignores scripts of other types', () => {
    const html = `<script type="application/json">${JSON.stringify(PRODUCT)}</script>`;
    expect(extractJsonLd(loadHtml(html), { url: PAGE, html }).drafts).toEqual([]);
  });
});

describe('@graph and @id references', () => {
  it('flattens a @graph container', () => {
    const result = scan({ '@context': 'https://schema.org', '@graph': [PRODUCT] });
    expect(result.products.map((product) => product.name)).toEqual(['Walnut']);
  });

  it('follows a bare @id reference to the node it names', () => {
    const result = scan({
      '@context': 'https://schema.org',
      '@graph': [
        { ...PRODUCT, brand: { '@id': '#brand' } },
        { '@type': 'Brand', '@id': '#brand', name: 'Example Nuts' },
      ],
    });

    expect(result.products[0]?.brand).toBe('Example Nuts');
  });

  it('follows a reference written as a plain string', () => {
    const result = scan({
      '@context': 'https://schema.org',
      '@graph': [
        { ...PRODUCT, offers: '#offer' },
        {
          '@type': 'Offer',
          '@id': '#offer',
          price: '150000',
          priceCurrency: 'IRR',
          availability: 'InStock',
        },
      ],
    });

    expect(result.products[0]?.regularPrice?.amount).toBe(150000);
    expect(result.products[0]?.inStock).toBe(true);
  });

  it('does not let a bare reference shadow the node it points at', () => {
    const result = scan({
      '@context': 'https://schema.org',
      '@graph': [
        { ...PRODUCT, brand: { '@id': '#brand' } },
        { '@id': '#brand' },
        { '@type': 'Brand', '@id': '#brand', name: 'Example Nuts' },
      ],
    });

    expect(result.products[0]?.brand).toBe('Example Nuts');
  });

  it('unwraps a WebPage that points at the product through mainEntity', () => {
    const result = scan({
      '@context': 'https://schema.org',
      '@type': 'ItemPage',
      name: 'Walnut — Example Nuts',
      mainEntity: PRODUCT,
    });

    expect(result.products.map((product) => product.name)).toEqual(['Walnut']);
  });
});

describe('ItemList shapes', () => {
  const listOf = (...elements: JsonValue[]): JsonValue => ({
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: elements,
  });

  it('reads products described inline', () => {
    const result = scan(
      listOf({ '@type': 'ListItem', position: 1, item: { ...PRODUCT, url: '/p/a' } })
    );
    expect(result.products[0]?.sourceUrl).toBe('https://shop.example/p/a');
  });

  it('reads a list of bare product nodes without ListItem wrappers', () => {
    const result = scan(
      listOf({ ...PRODUCT, name: 'A', url: '/p/a' }, { ...PRODUCT, name: 'B', url: '/p/b' })
    );
    expect(result.products.map((product) => product.name)).toEqual(['A', 'B']);
  });

  it('collects a plain string element as a URL to visit', () => {
    const result = scan(listOf('/p/a', 'https://shop.example/p/b'));
    expect(result.discoveredUrls).toEqual(['https://shop.example/p/a', 'https://shop.example/p/b']);
  });

  it('collects a ListItem whose item is a non-product node', () => {
    const result = scan(
      listOf({
        '@type': 'ListItem',
        position: 1,
        item: { '@type': 'WebPage', url: '/p/a' },
      })
    );
    expect(result.discoveredUrls).toEqual(['https://shop.example/p/a']);
  });

  it('sorts by position, not by serialization order', () => {
    const result = scan(
      listOf(
        { '@type': 'ListItem', position: 3, item: { ...PRODUCT, name: 'C', url: '/p/c' } },
        { '@type': 'ListItem', position: 1, item: { ...PRODUCT, name: 'A', url: '/p/a' } },
        { '@type': 'ListItem', position: 2, item: { ...PRODUCT, name: 'B', url: '/p/b' } }
      )
    );
    expect(result.products.map((product) => product.name)).toEqual(['A', 'B', 'C']);
  });

  it('keeps serialization order when no positions are given', () => {
    const result = scan(
      listOf(
        { '@type': 'ListItem', item: { ...PRODUCT, name: 'C', url: '/p/c' } },
        { '@type': 'ListItem', item: { ...PRODUCT, name: 'A', url: '/p/a' } }
      )
    );
    expect(result.products.map((product) => product.name)).toEqual(['C', 'A']);
  });

  it('does not list a URL it also produced a product for', () => {
    const result = scan(
      listOf(
        { '@type': 'ListItem', position: 1, item: { ...PRODUCT, url: '/p/a' } },
        { '@type': 'ListItem', position: 2, url: '/p/a/' }
      )
    );
    expect(result.discoveredUrls).toEqual([]);
  });
});

describe('breadcrumbs', () => {
  const crumbs = (...elements: JsonValue[]): JsonValue => ({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: elements,
  });

  it('drops a home crumb identified by its URL rather than its name', () => {
    const result = scan(
      { '@context': 'https://schema.org', ...PRODUCT },
      crumbs(
        { '@type': 'ListItem', position: 1, name: 'خانه', item: 'https://shop.example/' },
        { '@type': 'ListItem', position: 2, name: 'Nuts', item: 'https://shop.example/c/nuts' }
      )
    );
    expect(result.products[0]?.categoryPath).toEqual(['Nuts']);
  });

  it('drops a home crumb identified by its name rather than its URL', () => {
    const result = scan(
      { '@context': 'https://schema.org', ...PRODUCT },
      crumbs(
        { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://shop.example/en/home' },
        { '@type': 'ListItem', position: 2, name: 'Nuts', item: 'https://shop.example/c/nuts' }
      )
    );
    expect(result.products[0]?.categoryPath).toEqual(['Nuts']);
  });

  it('reads a name off the item node when the ListItem has none', () => {
    const result = scan(
      { '@context': 'https://schema.org', ...PRODUCT },
      crumbs({
        '@type': 'ListItem',
        position: 1,
        item: { '@id': 'https://shop.example/c/nuts', name: 'Nuts' },
      })
    );
    expect(result.products[0]?.categoryPath).toEqual(['Nuts']);
  });

  it('prefers an explicit category over the breadcrumb trail', () => {
    const result = scan(
      { '@context': 'https://schema.org', ...PRODUCT, category: 'Nuts > Walnuts' },
      crumbs({ '@type': 'ListItem', position: 1, name: 'Shop', item: 'https://shop.example/shop' })
    );
    expect(result.products[0]?.categoryPath).toEqual(['Nuts', 'Walnuts']);
  });
});

describe('variations without variesBy', () => {
  it('infers the axes from the properties the variants carry', () => {
    const result = scan({
      '@context': 'https://schema.org',
      '@type': 'ProductGroup',
      name: 'Tee',
      sku: 'TEE',
      hasVariant: [
        {
          '@type': 'Product',
          sku: 'TEE-R',
          color: 'Red',
          offers: { price: '10', priceCurrency: 'EUR' },
        },
        {
          '@type': 'Product',
          sku: 'TEE-B',
          color: 'Blue',
          offers: { price: '10', priceCurrency: 'EUR' },
        },
      ],
    });

    expect(result.products[0]?.attributes).toEqual([
      { name: 'Color', values: ['Red', 'Blue'], isVariationAxis: true },
    ]);
    expect(result.products[1]?.attributes).toEqual([
      { name: 'Color', values: ['Red'], isVariationAxis: true },
    ]);
  });

  it('reads an axis value out of additionalProperty', () => {
    const result = scan({
      '@context': 'https://schema.org',
      '@type': 'ProductGroup',
      name: 'Coffee',
      sku: 'COF',
      hasVariant: [
        {
          '@type': 'Product',
          sku: 'COF-250',
          additionalProperty: [{ '@type': 'PropertyValue', name: 'Weight', value: '250 g' }],
          offers: { price: '10', priceCurrency: 'EUR' },
        },
      ],
    });

    expect(result.products[0]?.attributes).toEqual([
      { name: 'Weight', values: ['250 g'], isVariationAxis: true },
    ]);
  });

  it('reads an axis value from a named node', () => {
    const result = scan({
      '@context': 'https://schema.org',
      '@type': 'ProductGroup',
      name: 'Tee',
      sku: 'TEE',
      variesBy: ['size'],
      hasVariant: [
        {
          '@type': 'Product',
          sku: 'TEE-S',
          size: { '@type': 'SizeSpecification', name: 'Small' },
          offers: { price: '10', priceCurrency: 'EUR' },
        },
      ],
    });

    expect(result.products[1]?.attributes).toEqual([
      { name: 'Size', values: ['Small'], isVariationAxis: true },
    ]);
  });

  it('leaves a hasVariant list with no discernible axes as a simple product', () => {
    const result = scan({
      '@context': 'https://schema.org',
      '@type': 'ProductGroup',
      name: 'Tee',
      sku: 'TEE',
      hasVariant: [{ '@type': 'Product', sku: 'TEE-1' }],
    });

    // Better a single row than a variable product WooCommerce cannot sell.
    expect(result.products[0]?.kind).toBe('variable');
    expect(result.products[0]?.attributes).toEqual([]);
  });
});

describe('deduplication', () => {
  it('folds two descriptions of the same product into one row', () => {
    const result = scan(
      { '@context': 'https://schema.org', ...PRODUCT, url: PAGE },
      {
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        itemListElement: [
          {
            '@type': 'ListItem',
            position: 1,
            item: { '@type': 'Product', name: 'Walnut', url: PAGE, image: '/img/w.jpg' },
          },
        ],
      }
    );

    expect(result.products).toHaveLength(1);
    expect(result.products[0]?.sku).toBe('W1');
    expect(result.products[0]?.images).toEqual(['https://shop.example/img/w.jpg']);
  });

  it('skips a nameless product and says why', () => {
    const result = scan({
      '@context': 'https://schema.org',
      '@type': 'Product',
      sku: 'W1',
      url: '/p/nameless',
    });

    expect(result.products).toEqual([]);
    const issue = result.issues.find((entry) => entry.code === 'product-name-missing');
    expect(issue?.url).toBe('https://shop.example/p/nameless');
  });
});

describe('merging across sources on one product page', () => {
  it('folds two sources that disagree about the canonical URL', () => {
    // JSON-LD gives the clean URL; OpenGraph keeps the variant query. Without
    // the single-product rule this exports two half-filled rows.
    const html = `<html><head>
      <script type="application/ld+json">${JSON.stringify({
        '@context': 'https://schema.org',
        ...PRODUCT,
        url: 'https://shop.example/p/walnut',
      })}</script>
      <meta property="og:type" content="product">
      <meta property="og:url" content="https://shop.example/p/walnut?variant=99">
      <meta property="og:title" content="Walnut — Example Nuts">
      <meta property="og:image" content="/img/og.jpg">
    </head><body></body></html>`;

    const result = extractStructured({ url: PAGE, html }, { scannedAt: SCANNED_AT });

    expect(result.products).toHaveLength(1);
    expect(result.products[0]?.name).toBe('Walnut');
    expect(result.products[0]?.images).toEqual(['https://shop.example/img/og.jpg']);
  });
});
