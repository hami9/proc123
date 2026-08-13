import { describe, expect, it } from 'vitest';

import { canonicalizeUrl, resolveUrl } from '@proc123/core';

describe('canonicalizeUrl', () => {
  it('lowercases scheme and host but not the path', () => {
    expect(canonicalizeUrl('HTTPS://Shop.Example.COM/Product/Walnut')).toBe(
      'https://shop.example.com/Product/Walnut'
    );
  });

  it('drops the fragment', () => {
    expect(canonicalizeUrl('https://shop.example/p/1#reviews')).toBe('https://shop.example/p/1');
  });

  it('strips tracking parameters', () => {
    expect(
      canonicalizeUrl('https://shop.example/p/1?utm_source=ig&utm_medium=cpc&fbclid=abc&color=red')
    ).toBe('https://shop.example/p/1?color=red');
  });

  it('keeps parameters that identify the product', () => {
    expect(canonicalizeUrl('https://shop.example/index.php?id=42&variant=7')).toBe(
      'https://shop.example/index.php?id=42&variant=7'
    );
  });

  it('sorts remaining parameters so order does not create duplicates', () => {
    expect(canonicalizeUrl('https://shop.example/p?b=2&a=1')).toBe(
      canonicalizeUrl('https://shop.example/p?a=1&b=2')
    );
  });

  it('treats trailing slashes as the same page', () => {
    expect(canonicalizeUrl('https://shop.example/p/1/')).toBe(
      canonicalizeUrl('https://shop.example/p/1')
    );
  });

  it('keeps the root path intact', () => {
    expect(canonicalizeUrl('https://shop.example/')).toBe('https://shop.example/');
  });

  it('drops the default port', () => {
    expect(canonicalizeUrl('https://shop.example:443/p/1')).toBe('https://shop.example/p/1');
  });

  it('preserves percent-encoded Persian paths', () => {
    const url = canonicalizeUrl('https://shop.example/محصول/گردو');
    expect(url).toContain('%D9%85%D8%AD%D8%B5%D9%88%D9%84');
    expect(canonicalizeUrl(url)).toBe(url);
  });

  it('is idempotent', () => {
    const once = canonicalizeUrl('https://Shop.Example/p/1/?utm_source=x&b=2&a=1#top');
    expect(canonicalizeUrl(once)).toBe(once);
  });

  it('returns unparseable input trimmed rather than throwing', () => {
    expect(canonicalizeUrl('  not a url  ')).toBe('not a url');
  });
});

describe('resolveUrl', () => {
  it('resolves relative hrefs against the page', () => {
    expect(resolveUrl('/p/1', 'https://shop.example/category/nuts')).toBe(
      'https://shop.example/p/1'
    );
    expect(resolveUrl('../p/1', 'https://shop.example/category/nuts')).toBe(
      'https://shop.example/p/1'
    );
  });

  it('leaves absolute URLs alone', () => {
    expect(resolveUrl('https://cdn.example/img.jpg', 'https://shop.example/')).toBe(
      'https://cdn.example/img.jpg'
    );
  });

  it('returns undefined for junk', () => {
    expect(resolveUrl('', 'not-a-base')).toBeUndefined();
  });
});
