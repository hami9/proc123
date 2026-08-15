import { describe, expect, it } from 'vitest';

import { filterSitemapUrls, parseSitemap } from '@proc123/core';

import { fixture } from './fixtures.js';

describe('parseSitemap', () => {
  it('reads a urlset', () => {
    const reading = parseSitemap(fixture('sitemap-products.xml'));

    expect(reading.urls).toEqual([
      {
        loc: 'https://ajil.example/product/walnut-500/',
        lastmod: '2026-08-10T08:00:00+03:30',
      },
      { loc: 'https://ajil.example/product/almond/', lastmod: '2026-08-11T08:00:00+03:30' },
      { loc: 'https://ajil.example/product-category/nuts/' },
    ]);
  });

  it('ignores namespaced children such as image:loc', () => {
    const reading = parseSitemap(fixture('sitemap-products.xml'));
    expect(reading.urls.map((entry) => entry.loc)).not.toContain(
      'https://cdn.ajil.example/walnut-1.jpg'
    );
  });

  it('drops repeats and anything that is not a page', () => {
    const reading = parseSitemap(fixture('sitemap-products.xml'));
    expect(reading.urls).toHaveLength(3);
    expect(reading.urls.map((entry) => entry.loc)).not.toContain('mailto:shop@ajil.example');
  });

  it('reads a sitemap index and resolves relative entries', () => {
    const reading = parseSitemap(fixture('sitemap-index.xml'), 'https://ajil.example/sitemap.xml');

    expect(reading.sitemaps).toEqual([
      'https://ajil.example/product-sitemap.xml',
      'https://ajil.example/product_cat-sitemap.xml',
      'https://ajil.example/page-sitemap.xml',
    ]);
    expect(reading.urls).toEqual([]);
  });

  it('reports an empty document rather than pretending the store has no products', () => {
    const reading = parseSitemap('<html><body>404 Not Found</body></html>');
    expect(reading.urls).toEqual([]);
    expect(reading.issues[0]?.code).toBe('sitemap-empty');
    expect(reading.issues[0]?.message).toContain('gzipped');
  });
});

describe('filterSitemapUrls', () => {
  const entries = [
    { loc: 'https://ajil.example/product/walnut-500/' },
    { loc: 'https://ajil.example/product-category/nuts/' },
    { loc: 'https://ajil.example/about-us/' },
    { loc: 'https://ajil.example/%D9%85%D8%AD%D8%B5%D9%88%D9%84/walnut/' },
  ];

  it('keeps everything when given no hints', () => {
    expect(filterSitemapUrls(entries, [])).toHaveLength(4);
  });

  it('matches on the path', () => {
    expect(filterSitemapUrls(entries, ['/product/'])).toEqual([
      { loc: 'https://ajil.example/product/walnut-500/' },
    ]);
  });

  it('matches a percent-encoded non-Latin path', () => {
    expect(filterSitemapUrls(entries, ['/محصول/'])).toEqual([
      { loc: 'https://ajil.example/%D9%85%D8%AD%D8%B5%D9%88%D9%84/walnut/' },
    ]);
  });

  it('falls back to matching the whole string when it is not a URL', () => {
    expect(filterSitemapUrls([{ loc: '/product/walnut/' }], ['/product/'])).toEqual([
      { loc: '/product/walnut/' },
    ]);
  });
});
