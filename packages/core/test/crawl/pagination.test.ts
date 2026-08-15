import { describe, expect, it } from 'vitest';

import { detectPagination, loadHtml, pageNumberFromUrl } from '@proc123/core';

const BASE = 'https://ajil.example/product-category/nuts/';

function plan(body: string, url = BASE) {
  const html = `<html><head>${body.includes('<link') ? body : ''}</head><body>${body}</body></html>`;
  return detectPagination(loadHtml(html), { url, html });
}

describe('pageNumberFromUrl', () => {
  it('reads the common query parameters', () => {
    expect(pageNumberFromUrl('https://s.example/c?page=3')).toBe(3);
    expect(pageNumberFromUrl('https://s.example/c?paged=4')).toBe(4);
    expect(pageNumberFromUrl('https://s.example/c?product-page=7')).toBe(7);
  });

  it('reads a path segment', () => {
    expect(pageNumberFromUrl('https://s.example/c/nuts/page/5/')).toBe(5);
    expect(pageNumberFromUrl('https://s.example/c/nuts/صفحه/2/')).toBe(2);
  });

  it('is not fooled by a number that is not a page', () => {
    // A category filed by year, which is exactly the case that breaks a
    // URL-template guess.
    expect(pageNumberFromUrl('https://s.example/product-category/2024/')).toBeUndefined();
    expect(pageNumberFromUrl('https://s.example/c?sort=2')).toBeUndefined();
    expect(pageNumberFromUrl('not a url')).toBeUndefined();
  });
});

describe('detectPagination', () => {
  it('prefers what the page says about itself', () => {
    const result = plan('<link rel="next" href="/product-category/nuts/page/2/">');
    expect(result.strategy).toBe('rel-next');
    expect(result.nextUrl).toBe('https://ajil.example/product-category/nuts/page/2');
    expect(result.automatable).toBe(true);
  });

  it('reads an <a rel="next"> too', () => {
    const result = plan('<nav><a rel="next prev" href="?paged=2">Next</a></nav>');
    expect(result.strategy).toBe('rel-next');
    // canonicalizeUrl drops the trailing slash, so the same page reached two
    // ways produces one key and the crawl does not read it twice.
    expect(result.nextUrl).toBe('https://ajil.example/product-category/nuts?paged=2');
  });

  it('follows the numbered link one past where it is', () => {
    const result = plan(
      `<nav class="pagination">
         <a class="page-numbers" href="/product-category/nuts/">1</a>
         <a class="page-numbers" href="/product-category/nuts/page/2/">2</a>
         <a class="page-numbers" href="/product-category/nuts/page/3/">3</a>
       </nav>`
    );

    expect(result.strategy).toBe('numbered');
    expect(result.nextUrl).toBe('https://ajil.example/product-category/nuts/page/2');
    expect(result.lastPage).toBe(3);
    expect(result.currentPage).toBe(1);
  });

  it('carries on from the middle of a run', () => {
    const result = plan(
      `<ul class="pagination">
         <li><a href="/c/nuts/page/2/">2</a></li>
         <li><a href="/c/nuts/page/3/">3</a></li>
         <li><a href="/c/nuts/page/4/">4</a></li>
       </ul>`,
      'https://ajil.example/c/nuts/page/3/'
    );

    expect(result.currentPage).toBe(3);
    expect(result.nextUrl).toBe('https://ajil.example/c/nuts/page/4');
  });

  it('knows the last page is the last page', () => {
    const result = plan(
      `<ul class="pagination">
         <li><a href="/c/nuts/page/2/">2</a></li>
         <li><a href="/c/nuts/page/3/">3</a></li>
       </ul>`,
      'https://ajil.example/c/nuts/page/3/'
    );

    expect(result.strategy).toBe('none');
    expect(result.nextUrl).toBeUndefined();
  });

  it('takes the number from the link URL, not its text', () => {
    // The label is an arrow; the href is where the number actually lives.
    const result = plan(`<nav class="pagination"><a href="/c/nuts/page/2/">»</a></nav>`);
    expect(result.nextUrl).toBe('https://ajil.example/c/nuts/page/2');
  });

  it('follows a load-more button that carries its own URL', () => {
    const result = plan('<button class="load-more" data-url="/c/nuts/page/2/">Load more</button>');
    expect(result.strategy).toBe('load-more');
    expect(result.automatable).toBe(true);
    expect(result.nextUrl).toBe('https://ajil.example/c/nuts/page/2');
    expect(result.signals).toContain('next page URL in data-url');
  });

  it('recognises a load-more button by its label in either language', () => {
    for (const label of ['Load more', 'نمایش بیشتر']) {
      const result = plan(`<button class="btn">${label}</button>`);
      expect(result.strategy).toBe('load-more');
      // No URL anywhere, so a real browser has to click it.
      expect(result.automatable).toBe(false);
    }
  });

  it('resolves a load-more page number against the numbered links', () => {
    const result = plan(
      `<nav class="pagination"><a href="/c/nuts/page/2/">2</a></nav>
       <button class="loadmore" data-next-page="2">Show more</button>`,
      'https://ajil.example/c/nuts/'
    );
    // The numbered nav wins outright here, which is the better answer anyway.
    expect(result.nextUrl).toBe('https://ajil.example/c/nuts/page/2');
  });

  it('recognises infinite scroll and admits it needs a browser', () => {
    const result = plan('<div class="products infinite-scroll" data-infinite-scroll></div>');
    expect(result.strategy).toBe('infinite-scroll');
    expect(result.automatable).toBe(false);
    expect(result.nextUrl).toBeUndefined();
  });

  it('finds infinite scroll in the page scripts', () => {
    const result = plan('<script>new InfiniteScroll(".products", {});</script>');
    expect(result.strategy).toBe('infinite-scroll');
  });

  it('says none when a category genuinely has one page', () => {
    const result = plan('<ul class="products"><li>one</li></ul>');
    expect(result.strategy).toBe('none');
    expect(result.automatable).toBe(false);
  });

  it('never points at the page it is already on', () => {
    const result = plan(`<link rel="next" href="${BASE}">`);
    expect(result.strategy).not.toBe('rel-next');
  });
});
