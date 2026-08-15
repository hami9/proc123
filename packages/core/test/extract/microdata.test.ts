import { describe, expect, it } from 'vitest';

import { collectMicrodata, extractMicrodata, loadHtml } from '@proc123/core';

const PAGE = 'https://shop.example/product/x/';

function items(html: string) {
  return collectMicrodata(loadHtml(html), PAGE);
}

describe('collectMicrodata', () => {
  it('turns an item into a schema.org-shaped node', () => {
    expect(
      items(`<div itemscope itemtype="https://schema.org/Product">
        <span itemprop="name">Walnut</span>
        <span itemprop="sku">W1</span>
      </div>`)
    ).toEqual([{ '@type': 'https://schema.org/Product', name: 'Walnut', sku: 'W1' }]);
  });

  it('keeps several itemtypes as a list', () => {
    expect(
      items(`<div itemscope itemtype="https://schema.org/Product https://schema.org/Book"></div>`)
    ).toEqual([{ '@type': ['https://schema.org/Product', 'https://schema.org/Book'] }]);
  });

  it('nests an inner itemscope instead of flattening it to text', () => {
    expect(
      items(`<div itemscope itemtype="https://schema.org/Product">
        <div itemprop="offers" itemscope itemtype="https://schema.org/Offer">
          <meta itemprop="price" content="1500" />
        </div>
      </div>`)
    ).toEqual([
      {
        '@type': 'https://schema.org/Product',
        offers: { '@type': 'https://schema.org/Offer', price: '1500' },
      },
    ]);
  });

  it('does not steal a nested item’s properties for its parent', () => {
    const [product] = items(`<div itemscope itemtype="https://schema.org/Product">
      <span itemprop="name">Outer</span>
      <div itemprop="offers" itemscope itemtype="https://schema.org/Offer">
        <span itemprop="name">Inner</span>
      </div>
    </div>`);

    expect(product?.['name']).toBe('Outer');
  });

  it('collects a repeated property into an array', () => {
    expect(
      items(`<div itemscope itemtype="https://schema.org/Product">
        <img itemprop="image" src="/a.jpg" /><img itemprop="image" src="/b.jpg" />
      </div>`)
    ).toEqual([
      {
        '@type': 'https://schema.org/Product',
        image: ['https://shop.example/a.jpg', 'https://shop.example/b.jpg'],
      },
    ]);
  });

  it('splits a multi-name itemprop across both names', () => {
    const [node] = items(
      `<div itemscope itemtype="https://schema.org/Product"><span itemprop="name alternateName">X</span></div>`
    );
    expect(node?.['name']).toBe('X');
    expect(node?.['alternateName']).toBe('X');
  });

  describe('value extraction', () => {
    const value = (markup: string): unknown =>
      items(`<div itemscope itemtype="https://schema.org/Product">${markup}</div>`)[0]?.['p'];

    it('reads meta from content', () => {
      expect(value('<meta itemprop="p" content="1500">')).toBe('1500');
    });

    it('reads links and media as resolved URLs', () => {
      expect(value('<a itemprop="p" href="/x">t</a>')).toBe('https://shop.example/x');
      expect(value('<link itemprop="p" href="https://schema.org/InStock">')).toBe(
        'https://schema.org/InStock'
      );
      expect(value('<img itemprop="p" src="/i.jpg">')).toBe('https://shop.example/i.jpg');
      expect(value('<object itemprop="p" data="/o">')).toBe('https://shop.example/o');
    });

    it('reads data, meter and time from their own attributes', () => {
      expect(value('<data itemprop="p" value="7">seven</data>')).toBe('7');
      expect(value('<meter itemprop="p" value="4">four</meter>')).toBe('4');
      expect(value('<time itemprop="p" datetime="2026-08-15">today</time>')).toBe('2026-08-15');
    });

    it('falls back to the element text', () => {
      expect(value('<span itemprop="p"> spaced <b>text</b> </span>')).toBe(' spaced text ');
    });

    it('prefers a content attribute on any element, not just meta', () => {
      // The displayed price is Persian and formatted; `content` is the number.
      expect(value('<span itemprop="p" content="4200000">۴٬۲۰۰٬۰۰۰ تومان</span>')).toBe('4200000');
    });

    it('looks past a lazy-loading placeholder to the real image URL', () => {
      expect(
        value('<img itemprop="p" src="data:image/gif;base64,R0lGOD" data-src="/real.jpg">')
      ).toBe('https://shop.example/real.jpg');
      expect(value('<img itemprop="p" srcset="/a.jpg 1x, /b.jpg 2x">')).toBe(
        'https://shop.example/a.jpg'
      );
    });
  });

  it('pulls a property in from elsewhere via itemref', () => {
    const [node] = items(`
      <div itemscope itemtype="https://schema.org/Product" itemref="extra"></div>
      <meta id="extra" itemprop="sku" content="W1">
    `);
    expect(node?.['sku']).toBe('W1');
  });

  it('treats an element with both itemscope and itemprop as nested, not top level', () => {
    expect(
      items(`<div itemscope itemtype="https://schema.org/Product">
        <div itemprop="brand" itemscope itemtype="https://schema.org/Brand"></div>
      </div>`)
    ).toHaveLength(1);
  });
});

describe('extractMicrodata', () => {
  it('maps a product through the same schema.org semantics as JSON-LD', () => {
    const html = `<div itemscope itemtype="https://schema.org/Product">
      <span itemprop="name">گردو</span>
      <link itemprop="url" href="/product/walnut/">
      <div itemprop="offers" itemscope itemtype="https://schema.org/Offer">
        <meta itemprop="priceCurrency" content="IRR">
        <span itemprop="price" content="150000">۱۵۰٬۰۰۰ تومان</span>
        <link itemprop="availability" href="https://schema.org/InStock">
      </div>
    </div>`;

    const reading = extractMicrodata(loadHtml(html), { url: PAGE, html });
    const [draft] = reading.drafts;

    expect(draft?.sourceUrl).toBe('https://shop.example/product/walnut');
    expect(draft?.values.name?.value).toBe('گردو');
    expect(draft?.values.regularPrice?.value).toEqual({ amount: 150000, currency: 'IRR' });
    expect(draft?.values.name?.confidence).toBe(0.7);
    expect(draft?.values.name?.source).toBe('microdata');
  });

  it('reads a breadcrumb trail written as microdata', () => {
    const html = `<nav itemscope itemtype="https://schema.org/BreadcrumbList">
      <span itemprop="itemListElement" itemscope itemtype="https://schema.org/ListItem">
        <a itemprop="item" href="/"><span itemprop="name">Home</span></a>
        <meta itemprop="position" content="1">
      </span>
      <span itemprop="itemListElement" itemscope itemtype="https://schema.org/ListItem">
        <a itemprop="item" href="/c/nuts"><span itemprop="name">Nuts</span></a>
        <meta itemprop="position" content="2">
      </span>
    </nav>`;

    expect(extractMicrodata(loadHtml(html), { url: PAGE, html }).breadcrumb).toEqual(['Nuts']);
  });

  it('finds nothing on a page with no microdata', () => {
    const html = '<div class="product"><h1>Walnut</h1></div>';
    expect(extractMicrodata(loadHtml(html), { url: PAGE, html }).drafts).toEqual([]);
  });
});
