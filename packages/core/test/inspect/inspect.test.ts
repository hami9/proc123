/**
 * Phase 13 — the inspector engine.
 *
 * Fixture-driven and offline, like everything else in this package (CLAUDE.md
 * §12). The point of most of these is not that the inspector finds things; it
 * is that it does not find things that are not there. A technology detector
 * that is generous is worse than no detector, because a person reads its output
 * as a fact about the shop they are about to scan.
 */

import { describe, expect, it } from 'vitest';

import {
  type FontFamily,
  type ImageAsset,
  type Technology,
  type TechnologyCategory,
  detectTechnologies,
  groupTechnologies,
  inspectFonts,
  inspectImages,
  inspectPage,
  loadHtml,
  parseSrcset,
} from '@proc123/core';

import { fixture, page } from '../extract/fixtures.js';

const SHOP = page('inspector-shop.html', 'https://ajil.example/product/walnut');
const BARE = page('no-markup.html', 'https://outdoors.example/products/mug');

function technologies(context = SHOP): Technology[] {
  return detectTechnologies(context, loadHtml(context.html));
}

function byId(found: readonly Technology[], id: string): Technology {
  const technology = found.find((entry) => entry.id === id);
  if (technology === undefined) {
    throw new Error(`No technology ${id}. Found: ${found.map((entry) => entry.id).join(', ')}`);
  }
  return technology;
}

function fonts(context = SHOP): FontFamily[] {
  return inspectFonts(context, loadHtml(context.html));
}

function family(found: readonly FontFamily[], name: string): FontFamily {
  const entry = found.find((candidate) => candidate.family === name);
  if (entry === undefined) {
    throw new Error(
      `No family ${name}. Found: ${found.map((candidate) => candidate.family).join(', ')}`
    );
  }
  return entry;
}

function images(context = SHOP): ImageAsset[] {
  return inspectImages(context, loadHtml(context.html));
}

function image(found: readonly ImageAsset[], url: string): ImageAsset {
  const asset = found.find((candidate) => candidate.url === url);
  if (asset === undefined) {
    throw new Error(
      `No image ${url}. Found:\n${found.map((candidate) => candidate.url).join('\n')}`
    );
  }
  return asset;
}

describe('technology detection', () => {
  it('reports technologies across the categories an inspector needs', () => {
    const categories = new Set(technologies().map((entry) => entry.category));

    // The phase asks for at least three categories beyond storefronts.
    expect(categories).toContain('ecommerce');
    for (const category of [
      'framework',
      'analytics',
      'tag-manager',
      'error-tracking',
      'chat',
      'payment',
      'cdn',
      'font-service',
      'cms',
    ]) {
      expect(categories).toContain(category as TechnologyCategory);
    }
  });

  it('keeps every signal that fired, so the report can say why', () => {
    const sentry = byId(technologies(), 'sentry');

    expect(sentry.name).toBe('Sentry');
    expect(sentry.category).toBe('error-tracking');
    expect(sentry.signals).toContain('browser.sentry-cdn.com bundle');
    expect(sentry.signals).toContain('Sentry.init call');
    expect(sentry.signals).toContain('sentry ingest endpoint');
    expect(sentry.confidence).toBeGreaterThan(0.9);
  });

  it('detects the storefront and the framework in front of it', () => {
    const found = technologies();

    expect(byId(found, 'woocommerce').category).toBe('ecommerce');
    expect(byId(found, 'nextjs').category).toBe('framework');
    expect(byId(found, 'wordpress').category).toBe('cms');
  });

  it('recognises the widgets a Persian shop actually carries', () => {
    const found = technologies();

    expect(byId(found, 'goftino').category).toBe('chat');
    expect(byId(found, 'zarinpal').category).toBe('payment');
  });

  it('reports a version only where the page states one', () => {
    const found = technologies();

    // Stated verbatim in the generator meta and in the tag ids.
    expect(byId(found, 'wordpress').version).toBe('6.5.2');
    expect(byId(found, 'google-analytics').version).toBe('G-4RQ81ZM2XP');
    expect(byId(found, 'google-tag-manager').version).toBe('GTM-N7XK4QP');

    // Next.js states a buildId, which is a deployment and not a release.
    expect(byId(found, 'nextjs').version).toBeUndefined();
  });

  it('sorts most confident first, and breaks ties stably', () => {
    const found = technologies();
    const confidences = found.map((entry) => entry.confidence);

    expect([...confidences].sort((a, b) => b - a)).toEqual(confidences);
    // Same input, same order — a report that reshuffles is a report nobody trusts.
    expect(technologies().map((entry) => entry.id)).toEqual(found.map((entry) => entry.id));
  });

  it('returns nothing at all for a page that carries no marker', () => {
    // The honest-unknown case, and the one that matters: a confident wrong
    // answer here is worse than no answer.
    expect(technologies(BARE)).toEqual([]);
  });

  it('does not invent a technology from one weak coincidence', () => {
    // `fa-` icon classes alone are weight 0.2 — below MIN_CONFIDENCE — so
    // Font Awesome must not be claimed on their evidence.
    const html = '<html><body><i class="fa-user"></i></body></html>';
    const found = detectTechnologies({ url: 'https://x.example/', html }, loadHtml(html));

    expect(found.find((entry) => entry.id === 'font-awesome')).toBeUndefined();
  });

  it('does not read a GTM container id out of an unrelated class name', () => {
    const html = '<html><body><div class="gtm-wrapper gtm-hero"></div></body></html>';
    const found = detectTechnologies({ url: 'https://x.example/', html }, loadHtml(html));

    expect(found.find((entry) => entry.id === 'google-tag-manager')).toBeUndefined();
  });

  it('groups into categories, omitting the ones with nothing in them', () => {
    const grouped = groupTechnologies(technologies());

    expect(grouped.get('chat')?.map((entry) => entry.id)).toEqual(['goftino']);
    expect([...grouped.values()].every((bucket) => bucket.length > 0)).toBe(true);
    expect(groupTechnologies(technologies(BARE)).size).toBe(0);
  });
});

describe('font inventory', () => {
  it('reads families, weights and styles out of @font-face', () => {
    const estedad = family(fonts(), 'Estedad');

    expect(estedad.weights).toEqual(['500', '700']);
    expect(estedad.styles).toEqual(['normal']);
    expect(estedad.origins.map((origin) => origin.kind)).toContain('font-face');
    expect(estedad.origins.map((origin) => origin.url)).toContain(
      'https://ajil.example/fonts/Estedad-Medium.woff2'
    );
  });

  it('reads what a font service was asked for out of its stylesheet URL', () => {
    const found = fonts();
    const vazirmatn = family(found, 'Vazirmatn');
    const openSans = family(found, 'Open Sans');

    expect(vazirmatn.weights).toEqual(['400', '700']);
    expect(vazirmatn.origins.some((origin) => origin.service === 'Google Fonts')).toBe(true);

    // `+` in the query string is a space in the family name.
    expect(openSans.weights).toEqual(['300', '600']);
    expect(openSans.styles).toEqual(['italic']);
  });

  it('records an inline style attribute as its own kind of origin', () => {
    const vazirmatn = family(fonts(), 'Vazirmatn');

    expect(vazirmatn.origins.map((origin) => origin.kind)).toContain('inline-style');
  });

  it('drops the generic fallbacks, which are not fonts the site uses', () => {
    const families = fonts().map((entry) => entry.family.toLowerCase());

    expect(families).not.toContain('sans-serif');
    expect(families).not.toContain('serif');
  });

  it('leaves usedBy absent when nothing measured the page', () => {
    // Absent means "not measured", never "unused" — a stylesheet cannot say
    // which elements matched it.
    expect(fonts().every((entry) => entry.usedBy === undefined)).toBe(true);
  });

  it('folds in what a surface with a real DOM measured', () => {
    const found = inspectFonts(SHOP, loadHtml(SHOP.html), {
      computed: [
        { selector: 'body', family: 'Vazirmatn', weight: '400', style: 'normal' },
        { selector: '.price', family: 'IRANSans, sans-serif', weight: '700' },
      ],
    });

    expect(family(found, 'Vazirmatn').usedBy).toEqual(['body']);

    // A family only computed style knows about is still a real font: some
    // stylesheet this module could not read declared it.
    const iranSans = family(found, 'IRANSans');
    expect(iranSans.origins.map((origin) => origin.kind)).toEqual(['computed']);
    expect(iranSans.weights).toEqual(['700']);
  });

  it('returns nothing for a page that declares no font', () => {
    expect(fonts(BARE)).toEqual([]);
  });

  it('records a self-hosted stylesheet without guessing what is in it', () => {
    // /wp-content/themes/ajil/style.css could declare anything. Knowing would
    // mean fetching it, which §16 forbids — so no family is invented from it.
    expect(fonts().map((entry) => entry.family)).not.toContain('style');
  });
});

describe('image inventory', () => {
  it('merges every reference to one file into one entry', () => {
    const hero = image(images(), 'https://ajil.example/img/hero-1200.jpg');

    // Preloaded, given as src, listed in srcset, and art-directed in a source.
    expect(hero.origins).toEqual(['img', 'preload', 'source', 'srcset']);
    expect(hero.descriptors).toContain('1200w');
    expect(hero.width).toBe(1200);
    expect(hero.height).toBe(630);
    expect(hero.alt).toBe('گردوی تازه');
  });

  it('resolves every URL against the document', () => {
    expect(images().every((asset) => asset.url.startsWith('https://'))).toBe(true);
  });

  it('covers srcset, picture sources, CSS backgrounds and preloads', () => {
    const found = images();
    const kinds = new Set(found.flatMap((asset) => asset.origins));

    expect(kinds).toContain('img');
    expect(kinds).toContain('srcset');
    expect(kinds).toContain('source');
    expect(kinds).toContain('css-background');
    expect(kinds).toContain('preload');
    expect(kinds).toContain('icon');
    expect(kinds).toContain('meta');

    expect(image(found, 'https://ajil.example/img/hero-small@2x.jpg').descriptors).toEqual(['2x']);
    expect(image(found, 'https://ajil.example/img/pattern.svg').origins).toEqual([
      'css-background',
    ]);
    expect(image(found, 'https://cdn.jsdelivr.net/npm/flags/ir.svg').origins).toEqual([
      'css-background',
    ]);
  });

  it('keeps a favicon apart from the photographs', () => {
    const found = images();

    expect(image(found, 'https://ajil.example/favicon.ico').origins).toEqual(['icon']);
    expect(image(found, 'https://ajil.example/img/touch-icon.png').origins).toEqual(['icon']);
    expect(image(found, 'https://cdn.example.ir/social/preview.png').origins).toEqual(['meta']);
  });

  it('survives a resizing CDN that puts commas inside the URL', () => {
    const found = images();

    // A naive comma-split turns these two into four broken URLs.
    expect(
      image(found, 'https://cdn.example.ir/c_fill,w_300,h_300/walnut.jpg').descriptors
    ).toEqual(['300w']);
    expect(
      image(found, 'https://cdn.example.ir/c_fill,w_600,h_600/walnut.jpg').descriptors
    ).toEqual(['600w']);
  });

  it('finds the real file behind a lazy-loading placeholder', () => {
    const found = images();

    expect(image(found, 'https://ajil.example/img/pistachio.jpg').alt).toBe('پسته');
  });

  it('reports dimensions only where the markup states them', () => {
    const found = images();

    expect(image(found, 'https://ajil.example/img/pattern.svg').width).toBeUndefined();
    expect(image(found, 'https://ajil.example/img/hero-400.jpg').width).toBe(1200);
  });

  it('resolves against <base href> when the document sets one', () => {
    const html =
      '<html><head><base href="https://cdn.example.ir/assets/" /></head><body><img src="pic.jpg" /></body></html>';
    const found = inspectImages({ url: 'https://shop.example/product/1', html }, loadHtml(html));

    expect(found.map((asset) => asset.url)).toEqual(['https://cdn.example.ir/assets/pic.jpg']);
  });

  it('skips data URIs, which are the image rather than a location', () => {
    const html =
      '<html><body><img src="data:image/gif;base64,R0lGOD" /><div style="background:url(data:image/png;base64,iVBOR)"></div></body></html>';
    const found = inspectImages({ url: 'https://x.example/', html }, loadHtml(html));

    expect(found).toEqual([]);
  });

  it('de-duplicates rather than listing the same file twice', () => {
    const urls = images().map((asset) => asset.url);

    expect(new Set(urls).size).toBe(urls.length);
  });

  it('sorts by URL, so two scans of one page compare cleanly', () => {
    const urls = images().map((asset) => asset.url);

    expect([...urls].sort()).toEqual(urls);
  });
});

describe('parseSrcset', () => {
  it('reads the ordinary shapes', () => {
    expect(parseSrcset('a.jpg 1x, b.jpg 2x')).toEqual([
      { url: 'a.jpg', descriptor: '1x' },
      { url: 'b.jpg', descriptor: '2x' },
    ]);
    expect(parseSrcset('only.jpg')).toEqual([{ url: 'only.jpg' }]);
  });

  it('does not split a URL that contains commas', () => {
    expect(parseSrcset('/c_fill,w_300/a.jpg 300w, /c_fill,w_600/a.jpg 600w')).toEqual([
      { url: '/c_fill,w_300/a.jpg', descriptor: '300w' },
      { url: '/c_fill,w_600/a.jpg', descriptor: '600w' },
    ]);
  });

  it('treats a trailing comma on a URL as the end of the candidate', () => {
    expect(parseSrcset('a.jpg, b.jpg 2x')).toEqual([
      { url: 'a.jpg' },
      { url: 'b.jpg', descriptor: '2x' },
    ]);
  });

  it('tolerates newlines and runs of whitespace', () => {
    expect(parseSrcset('\n  a.jpg   400w,\n  b.jpg   800w\n')).toEqual([
      { url: 'a.jpg', descriptor: '400w' },
      { url: 'b.jpg', descriptor: '800w' },
    ]);
  });

  it('returns nothing for an empty value', () => {
    expect(parseSrcset('')).toEqual([]);
    expect(parseSrcset('   ,  ')).toEqual([]);
  });
});

describe('inspectPage', () => {
  it('answers all three questions about one document', () => {
    const inspection = inspectPage(SHOP);

    expect(inspection.url).toBe(SHOP.url);
    expect(inspection.technologies.length).toBeGreaterThan(5);
    expect(inspection.fonts.length).toBeGreaterThan(0);
    expect(inspection.images.length).toBeGreaterThan(0);
  });

  it('reuses a parse the caller already has', () => {
    const $ = loadHtml(SHOP.html);

    expect(inspectPage(SHOP, { $ })).toEqual(inspectPage(SHOP));
  });

  it('is honest about a page that states nothing', () => {
    const inspection = inspectPage(BARE);

    expect(inspection.technologies).toEqual([]);
    expect(inspection.fonts).toEqual([]);
    // One <img>, and no claim of anything else.
    expect(inspection.images.map((asset) => asset.url)).toEqual([
      'https://outdoors.example/img/mug.jpg',
    ]);
  });

  it('never mutates the document it was handed', () => {
    const before = fixture('inspector-shop.html');
    inspectPage(SHOP);

    expect(SHOP.html).toBe(before);
  });
});
