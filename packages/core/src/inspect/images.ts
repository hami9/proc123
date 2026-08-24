/**
 * Every image the page references.
 *
 * Six kinds of markup name an image and a report that reads only `<img src>`
 * misses most of a modern page: the responsive candidates live in `srcset`, the
 * art-directed ones in `<picture><source>`, the decorative ones in CSS
 * backgrounds, and the one the page cares most about is usually the
 * `<link rel=preload as=image>`.
 *
 * The same file appears in several of them — a hero image is routinely
 * preloaded, given as `src`, and listed in `srcset` at four widths — so the
 * unit here is the **absolute URL**, and every kind of markup that referenced
 * it is merged onto that one entry. A list that repeated the hero five times
 * would be technically complete and useless.
 *
 * Dimensions come from `width`/`height` attributes and nothing else. Natural
 * size and byte size are facts about the file, not about the markup, and
 * learning them means downloading it — which this module must never do
 * (CLAUDE.md §16). A surface with a network budget fills them in later; here
 * their absence is honest.
 */

import { type CheerioAPI, type Element, attr } from '../extract/html.js';
import type { PageContext } from '../extract/types.js';
import { resolveUrl } from '../url.js';
import type { ImageAsset, ImageOriginKind } from './types.js';

/**
 * Accumulates by absolute URL, merging origins and descriptors.
 *
 * First write wins for `alt`, `width` and `height`: when the same file appears
 * as both a described `<img>` and a bare CSS background, the description is the
 * better answer and a later blank must not overwrite it.
 */
class ImageIndex {
  private readonly byUrl = new Map<
    string,
    {
      url: string;
      origins: Set<ImageOriginKind>;
      descriptors: Set<string>;
      alt?: string;
      width?: number;
      height?: number;
    }
  >();

  add(
    url: string,
    origin: ImageOriginKind,
    extra: { alt?: string; width?: number; height?: number; descriptor?: string } = {}
  ): void {
    let entry = this.byUrl.get(url);
    if (entry === undefined) {
      entry = { url, origins: new Set(), descriptors: new Set() };
      this.byUrl.set(url, entry);
    }
    entry.origins.add(origin);
    if (extra.descriptor !== undefined) entry.descriptors.add(extra.descriptor);
    if (entry.alt === undefined && extra.alt !== undefined && extra.alt !== '')
      entry.alt = extra.alt;
    if (entry.width === undefined && extra.width !== undefined) entry.width = extra.width;
    if (entry.height === undefined && extra.height !== undefined) entry.height = extra.height;
  }

  toArray(): ImageAsset[] {
    return [...this.byUrl.values()]
      .map((entry) => ({
        url: entry.url,
        origins: [...entry.origins].sort(),
        ...(entry.width === undefined ? {} : { width: entry.width }),
        ...(entry.height === undefined ? {} : { height: entry.height }),
        ...(entry.alt === undefined ? {} : { alt: entry.alt }),
        ...(entry.descriptors.size === 0 ? {} : { descriptors: [...entry.descriptors].sort() }),
      }))
      .sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
  }
}

/**
 * Parse a dimension attribute.
 *
 * `width="300"` is a number. `width="100%"` is a layout instruction and not a
 * natural dimension, so it is dropped rather than reported as `100`.
 */
function dimension(node: Element, name: string): number | undefined {
  const raw = attr(node, name);
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return value > 0 ? value : undefined;
}

/**
 * Split a `srcset` into its candidates.
 *
 * Splitting on every comma is the obvious implementation and it is wrong, in
 * exactly the case a shop is most likely to produce: a resizing CDN writes
 * `/cdn/w_300,h_200/pic.jpg`, and a comma-split turns one image into two
 * broken URLs. HTML's own parse is not comma-first — it takes the URL as a run
 * of non-whitespace, commas and all, and only then looks for a descriptor. So
 * that is what this does.
 *
 * The one ambiguity the grammar leaves is a URL ending in a comma: there it
 * means "candidate over, no descriptor", which is why the trailing commas are
 * stripped and the descriptor skipped rather than read.
 */
export function parseSrcset(value: string): { url: string; descriptor?: string }[] {
  const candidates: { url: string; descriptor?: string }[] = [];
  let position = 0;

  while (position < value.length) {
    // Leading whitespace, and the commas separating this candidate from the last.
    while (position < value.length && /[\s,]/.test(value[position] ?? '')) position += 1;
    if (position >= value.length) break;

    const start = position;
    while (position < value.length && !/\s/.test(value[position] ?? '')) position += 1;
    let url = value.slice(start, position);

    if (url.endsWith(',')) {
      // Trailing comma ends the candidate outright — there is no descriptor.
      url = url.replace(/,+$/, '');
      if (url !== '') candidates.push({ url });
      continue;
    }

    // Everything up to the next comma is this candidate's descriptor.
    const comma = value.indexOf(',', position);
    const descriptor = (comma === -1 ? value.slice(position) : value.slice(position, comma)).trim();
    position = comma === -1 ? value.length : comma + 1;

    if (url === '') continue;
    candidates.push(descriptor === '' ? { url } : { url, descriptor });
  }

  return candidates;
}

/** Every `url(...)` in a CSS value, data URIs and gradients skipped. */
function cssUrls(value: string): string[] {
  const urls: string[] = [];
  const pattern = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value)) !== null) {
    const raw = match[2]?.trim();
    if (raw === undefined || raw === '') continue;
    // A data: URI is the image, not a location. Nothing can be downloaded from
    // it and reporting a 40KB base64 string as a URL would drown the list.
    if (/^data:/i.test(raw)) continue;
    urls.push(raw);
  }
  return urls;
}

/** CSS properties that can carry an image, beyond the obvious one. */
const IMAGE_PROPERTIES = [
  'background-image',
  'background',
  'border-image',
  'mask-image',
  'content',
];

function readCssBlock(css: string, baseUrl: string, index: ImageIndex): void {
  for (const property of IMAGE_PROPERTIES) {
    const pattern = new RegExp(`${property}\\s*:\\s*([^;{}]+)`, 'gi');
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(css)) !== null) {
      const value = match[1];
      if (value === undefined) continue;
      for (const raw of cssUrls(value)) {
        const absolute = resolveUrl(raw, baseUrl);
        if (absolute !== undefined) index.add(absolute, 'css-background');
      }
    }
  }
}

/**
 * `<img>`, `<source>`, `<link>`, inline `<style>` and `style` attributes.
 *
 * Relative URLs resolve against `<base href>` when the document sets one, and
 * against the page URL otherwise — a page with a `<base>` and relative image
 * paths resolves wrongly against the page URL, and shops with a CDN base do
 * exactly this.
 */
export function inspectImages(page: PageContext, $: CheerioAPI): ImageAsset[] {
  const index = new ImageIndex();
  const declaredBase = $('base[href]').first().attr('href');
  const baseUrl =
    declaredBase === undefined ? page.url : (resolveUrl(declaredBase, page.url) ?? page.url);

  const absolute = (raw: string): string | undefined => {
    const trimmed = raw.trim();
    if (trimmed === '' || /^data:/i.test(trimmed)) return undefined;
    return resolveUrl(trimmed, baseUrl);
  };

  $('img').each((_, node) => {
    const alt = attr(node, 'alt');
    const width = dimension(node, 'width');
    const height = dimension(node, 'height');
    const extra = {
      ...(alt === undefined ? {} : { alt }),
      ...(width === undefined ? {} : { width }),
      ...(height === undefined ? {} : { height }),
    };

    // `src`, and the lazy-loading attributes that stand in for it. A lazy image
    // whose `src` is a placeholder has the real file in `data-src`, and a
    // report that missed those would miss most of a product grid.
    for (const name of ['src', 'data-src', 'data-original', 'data-lazy-src']) {
      const value = attr(node, name);
      if (value === undefined) continue;
      const url = absolute(value);
      if (url !== undefined) index.add(url, 'img', extra);
    }

    for (const name of ['srcset', 'data-srcset', 'data-lazy-srcset']) {
      const value = attr(node, name);
      if (value === undefined) continue;
      for (const candidate of parseSrcset(value)) {
        const url = absolute(candidate.url);
        if (url === undefined) continue;
        index.add(url, 'srcset', {
          ...extra,
          ...(candidate.descriptor === undefined ? {} : { descriptor: candidate.descriptor }),
        });
      }
    }
  });

  // <picture><source>, and <source> under <video> for a poster-like image.
  $('source[srcset], source[data-srcset]').each((_, node) => {
    const value = attr(node, 'srcset') ?? attr(node, 'data-srcset');
    if (value === undefined) return;
    for (const candidate of parseSrcset(value)) {
      const url = absolute(candidate.url);
      if (url === undefined) continue;
      index.add(
        url,
        'source',
        candidate.descriptor === undefined ? {} : { descriptor: candidate.descriptor }
      );
    }
  });

  $('link[rel="preload"][as="image"]').each((_, node) => {
    const href = attr(node, 'href');
    if (href !== undefined) {
      const url = absolute(href);
      if (url !== undefined) index.add(url, 'preload');
    }
    // A preload may carry an imagesrcset instead of, or as well as, an href.
    const srcset = attr(node, 'imagesrcset');
    if (srcset === undefined) return;
    for (const candidate of parseSrcset(srcset)) {
      const url = absolute(candidate.url);
      if (url === undefined) continue;
      index.add(
        url,
        'preload',
        candidate.descriptor === undefined ? {} : { descriptor: candidate.descriptor }
      );
    }
  });

  // Favicons and touch icons. Their own origin kind, because a report that
  // filed them under `img` would put a 32px favicon in a list of product
  // photographs the user is about to download.
  $('link[rel~="icon"], link[rel="apple-touch-icon"], link[rel="mask-icon"]').each((_, node) => {
    const href = attr(node, 'href');
    if (href === undefined) return;
    const url = absolute(href);
    if (url !== undefined) index.add(url, 'icon');
  });

  // Social-preview images. They are `<meta>` rather than markup that renders,
  // but they are images the page references and a shop's OG image is often the
  // only high-resolution copy on the page.
  $('meta[property="og:image"], meta[property="og:image:url"], meta[name="twitter:image"]').each(
    (_, node) => {
      const content = attr(node, 'content');
      if (content === undefined) return;
      const url = absolute(content);
      if (url !== undefined) index.add(url, 'meta');
    }
  );

  $('style').each((_, node) => {
    readCssBlock($(node).text(), baseUrl, index);
  });

  $('[style]').each((_, node) => {
    const style = attr(node, 'style');
    if (style !== undefined) readCssBlock(style, baseUrl, index);
  });

  return index.toArray();
}
