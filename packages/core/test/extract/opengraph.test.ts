import { describe, expect, it } from 'vitest';

import { collectMetaTags, extractOpenGraph, loadHtml } from '@proc123/core';

const PAGE = 'https://shop.example/p/mug';

function read(head: string) {
  const html = `<html><head>${head}</head><body></body></html>`;
  return extractOpenGraph(loadHtml(html), { url: PAGE, html });
}

describe('collectMetaTags', () => {
  it('reads both property and name, which pages mix freely', () => {
    const tags = collectMetaTags(
      loadHtml(`<meta property="og:title" content="A"><meta name="og:url" content="/x">`)
    );
    expect(tags.get('og:title')).toEqual(['A']);
    expect(tags.get('og:url')).toEqual(['/x']);
  });

  it('keeps repeated tags in order and skips empty ones', () => {
    const tags = collectMetaTags(
      loadHtml(
        `<meta property="og:image" content="/a.jpg"><meta property="og:image" content="/b.jpg"><meta property="og:image" content="">`
      )
    );
    expect(tags.get('og:image')).toEqual(['/a.jpg', '/b.jpg']);
  });
});

describe('extractOpenGraph', () => {
  it('reads a product page', () => {
    const reading = read(`
      <meta property="og:type" content="product">
      <meta property="og:title" content="Enamel Mug">
      <meta property="og:description" content="350ml camping mug.">
      <meta property="og:url" content="https://shop.example/p/mug?utm_source=x">
      <meta property="og:image" content="/img/mug.jpg">
      <meta property="product:price:amount" content="18.00">
      <meta property="product:price:currency" content="USD">
      <meta property="product:availability" content="in stock">
      <meta property="product:retailer_item_id" content="MUG-350">
      <meta property="product:brand" content="Example Outdoors">
    `);

    const [draft] = reading.drafts;
    expect(draft?.sourceUrl).toBe('https://shop.example/p/mug');
    expect(draft?.values.name?.value).toBe('Enamel Mug');
    // og:description is an excerpt, so it lands in the short field.
    expect(draft?.values.shortDescription?.value).toBe('350ml camping mug.');
    expect(draft?.values.description).toBeUndefined();
    expect(draft?.values.images?.value).toEqual(['https://shop.example/img/mug.jpg']);
    expect(draft?.values.regularPrice?.value).toEqual({ amount: 18, currency: 'USD' });
    expect(draft?.values.inStock?.value).toBe(true);
    expect(draft?.values.sku?.value).toBe('MUG-350');
    expect(draft?.values.brand?.value).toBe('Example Outdoors');
    expect(draft?.values.name?.confidence).toBe(0.5);
  });

  it('reads original_price as the was/now pair', () => {
    const [draft] = read(`
      <meta property="og:type" content="product">
      <meta property="og:title" content="Moka Pot">
      <meta property="product:price:amount" content="49.00">
      <meta property="product:original_price:amount" content="65.00">
      <meta property="product:price:currency" content="EUR">
    `).drafts;

    expect(draft?.values.regularPrice?.value).toEqual({ amount: 65, currency: 'EUR' });
    expect(draft?.values.salePrice?.value).toEqual({ amount: 49, currency: 'EUR' });
  });

  it('reads sale_price as the was/now pair', () => {
    const [draft] = read(`
      <meta property="og:type" content="product">
      <meta property="og:title" content="Moka Pot">
      <meta property="product:price:amount" content="65.00">
      <meta property="product:sale_price:amount" content="49.00">
      <meta property="product:price:currency" content="EUR">
    `).drafts;

    expect(draft?.values.regularPrice?.value).toEqual({ amount: 65, currency: 'EUR' });
    expect(draft?.values.salePrice?.value).toEqual({ amount: 49, currency: 'EUR' });
  });

  it('prefers the https image over the http one and dedupes', () => {
    const [draft] = read(`
      <meta property="og:type" content="product">
      <meta property="og:title" content="X">
      <meta property="og:image" content="http://shop.example/a.jpg">
      <meta property="og:image:secure_url" content="https://shop.example/a.jpg">
      <meta property="og:image" content="https://shop.example/b.jpg">
    `).drafts;

    expect(draft?.values.images?.value).toEqual([
      'https://shop.example/a.jpg',
      'http://shop.example/a.jpg',
      'https://shop.example/b.jpg',
    ]);
  });

  it('reads a weight from value and units', () => {
    const [draft] = read(`
      <meta property="og:type" content="product">
      <meta property="og:title" content="X">
      <meta property="product:weight:value" content="0.9">
      <meta property="product:weight:units" content="kg">
    `).drafts;

    expect(draft?.values.weight?.value).toEqual({ value: 0.9, unit: 'kg' });
  });

  it('ignores a numeric product:category, which names nothing to a person', () => {
    const [numeric] = read(`
      <meta property="og:type" content="product">
      <meta property="og:title" content="X">
      <meta property="product:category" content="2901">
    `).drafts;
    expect(numeric?.values.categoryPath).toBeUndefined();

    const [named] = read(`
      <meta property="og:type" content="product">
      <meta property="og:title" content="X">
      <meta property="product:category" content="Kitchen">
    `).drafts;
    expect(named?.values.categoryPath?.value).toEqual(['Kitchen']);
  });

  it('refuses to turn a category page into a product', () => {
    const reading = read(`
      <meta property="og:type" content="website">
      <meta property="og:title" content="Nuts — Example Shop">
      <meta property="og:url" content="https://shop.example/c/nuts">
    `);
    expect(reading.drafts).toEqual([]);
  });

  it('still reads a product when only the price tags identify it', () => {
    const reading = read(`
      <meta property="og:title" content="Mug">
      <meta property="product:price:amount" content="18">
      <meta property="product:price:currency" content="USD">
    `);
    expect(reading.drafts).toHaveLength(1);
  });

  it('falls back to the page URL when og:url is missing', () => {
    const [draft] = read(`
      <meta property="og:type" content="product">
      <meta property="og:title" content="Mug">
    `).drafts;
    expect(draft?.sourceUrl).toBe(PAGE);
  });
});
