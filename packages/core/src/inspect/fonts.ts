/**
 * Which fonts a page asks for.
 *
 * Four things state a font in markup `core` can see: an `@font-face` block in
 * an inline `<style>`, a `<link>` to a stylesheet (a font service names its
 * families in the query string, a self-hosted one does not), a `font-family`
 * in an inline `style` attribute, and a preloaded font file.
 *
 * There is a fifth, and it is the one that actually answers "what font is this
 * paragraph in": computed style. That needs a live DOM, which `core` does not
 * have and must not acquire — the same code runs in a service worker, in Node
 * and in Tauri's WebView (CLAUDE.md §16). So the extension measures and hands
 * the measurements in through `InspectFontsOptions.computed`, rather than
 * implementing font logic the app would then need a second copy of.
 *
 * A declared family is not a used family. A stylesheet can load six weights the
 * page never renders, and `@font-face` cannot tell you which. That distinction
 * is why `usedBy` is only ever filled from `computed` and is absent otherwise:
 * an empty `usedBy` means "not measured", never "unused".
 */

import { type CheerioAPI, attr } from '../extract/html.js';
import type { PageContext } from '../extract/types.js';
import { resolveUrl } from '../url.js';
import type { ComputedFontUsage, FontFamily, FontOrigin, InspectFontsOptions } from './types.js';

/**
 * Hostnames that serve fonts, and the service name to report for each.
 *
 * The single home for these — `technologies.ts` detects the same services as a
 * `font-service` technology and reads its rules from the same public
 * documentation, so a host added here should be added there too.
 */
const FONT_SERVICE_HOSTS: readonly (readonly [string, string])[] = [
  ['fonts.googleapis.com', 'Google Fonts'],
  ['fonts.gstatic.com', 'Google Fonts'],
  ['use.typekit.net', 'Adobe Fonts'],
  ['p.typekit.net', 'Adobe Fonts'],
  ['kit.fontawesome.com', 'Font Awesome'],
  ['use.fontawesome.com', 'Font Awesome'],
  ['cdnjs.cloudflare.com/ajax/libs/font-awesome', 'Font Awesome'],
  ['fontiran.com', 'FontIran'],
  ['cdn.fontcdn.ir', 'FontCDN'],
];

/** The service serving this URL, or `undefined` for a self-hosted file. */
function serviceFor(url: string): string | undefined {
  const lower = url.toLowerCase();
  return FONT_SERVICE_HOSTS.find(([host]) => lower.includes(host))?.[1];
}

/**
 * Split a `font-family` stack into its families, quotes and spacing removed.
 *
 * Only the families are kept, not the generic fallbacks — `sans-serif` is what
 * the browser does when the real answer is missing, and listing it as a font
 * the site uses would be noise in every single report.
 */
const GENERIC_FAMILIES: ReadonlySet<string> = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'math',
  'emoji',
  'fangsong',
  'inherit',
  'initial',
  'unset',
  'revert',
  'revert-layer',
]);

export function parseFontStack(value: string): string[] {
  return value
    .split(',')
    .map((part) =>
      part
        .trim()
        .replace(/^["']|["']$/g, '')
        .trim()
    )
    .filter((family) => family !== '' && !GENERIC_FAMILIES.has(family.toLowerCase()));
}

/**
 * An accumulator keyed by the family name case-insensitively, because a
 * stylesheet writing `Vazirmatn` and an inline style writing `vazirmatn` mean
 * the same font. The first spelling seen is the one reported — §16 wants the
 * name a person would recognise, not a lowercased key.
 */
class FamilyIndex {
  private readonly byKey = new Map<
    string,
    {
      family: string;
      weights: Set<string>;
      styles: Set<string>;
      origins: FontOrigin[];
      usedBy: Set<string>;
    }
  >();

  add(
    family: string,
    origin: FontOrigin,
    weights: readonly string[] = [],
    styles: readonly string[] = []
  ): void {
    const key = family.toLowerCase();
    let entry = this.byKey.get(key);
    if (entry === undefined) {
      entry = { family, weights: new Set(), styles: new Set(), origins: [], usedBy: new Set() };
      this.byKey.set(key, entry);
    }
    for (const weight of weights) entry.weights.add(weight);
    for (const style of styles) entry.styles.add(style);
    // De-duplicate origins: one stylesheet declaring six weights of one family
    // is one origin, not six.
    const seen = entry.origins.some(
      (existing) =>
        existing.kind === origin.kind &&
        existing.url === origin.url &&
        existing.service === origin.service
    );
    if (!seen) entry.origins.push(origin);
  }

  markUsed(family: string, selector: string): void {
    this.byKey.get(family.toLowerCase())?.usedBy.add(selector);
  }

  has(family: string): boolean {
    return this.byKey.has(family.toLowerCase());
  }

  toArray(): FontFamily[] {
    return [...this.byKey.values()]
      .map(({ family, weights, styles, origins, usedBy }) => ({
        family,
        // Numeric weights sort numerically, keywords after them alphabetically,
        // so `400, 700, bold` reads the way a stylesheet would list it.
        weights: [...weights].sort(compareWeights),
        styles: [...styles].sort(),
        origins,
        ...(usedBy.size === 0 ? {} : { usedBy: [...usedBy].sort() }),
      }))
      .sort((a, b) => (a.family.toLowerCase() < b.family.toLowerCase() ? -1 : 1));
  }
}

function compareWeights(a: string, b: string): number {
  const numberA = Number(a);
  const numberB = Number(b);
  const aIsNumber = !Number.isNaN(numberA);
  const bIsNumber = !Number.isNaN(numberB);
  if (aIsNumber && bIsNumber) return numberA - numberB;
  if (aIsNumber) return -1;
  if (bIsNumber) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Pull the `@font-face` blocks out of a stylesheet body.
 *
 * A regex rather than a CSS parser on purpose: the whole job is to find blocks
 * of a known shape and read three properties out of each, and a real parser is
 * a dependency `core` would then ship into a content script for no gain. It
 * follows that a stylesheet doing something exotic is skipped rather than
 * mis-read, which is the correct failure direction here.
 */
const FONT_FACE_BLOCK = /@font-face\s*\{([^}]*)\}/gi;

function declaration(block: string, property: string): string | undefined {
  const match = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, 'i').exec(block);
  return match?.[1]?.trim();
}

/** Every `url(...)` in a `src` declaration, resolved against the document. */
function srcUrls(src: string, baseUrl: string): string[] {
  const urls: string[] = [];
  const pattern = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(src)) !== null) {
    const raw = match[2];
    if (raw === undefined) continue;
    // A data: URI is the font itself rather than a location. It is a real
    // origin but not a URL worth reporting — nobody can click a 40KB base64
    // blob, and putting it in the report would drown it.
    if (/^data:/i.test(raw)) continue;
    const resolved = resolveUrl(raw, baseUrl);
    if (resolved !== undefined) urls.push(resolved);
  }
  return urls;
}

function readFontFaces(css: string, baseUrl: string, index: FamilyIndex): void {
  FONT_FACE_BLOCK.lastIndex = 0;
  let block: RegExpExecArray | null;
  while ((block = FONT_FACE_BLOCK.exec(css)) !== null) {
    const body = block[1];
    if (body === undefined) continue;

    const families = parseFontStack(declaration(body, 'font-family') ?? '');
    if (families.length === 0) continue;

    // `font-weight: 100 900` is a variable font's range, and both ends are
    // meaningful, so the declaration is kept whole rather than split.
    const weight = declaration(body, 'font-weight');
    const style = declaration(body, 'font-style');
    const src = declaration(body, 'src');
    const urls = src === undefined ? [] : srcUrls(src, baseUrl);

    for (const family of families) {
      const origins: FontOrigin[] =
        urls.length === 0
          ? [{ kind: 'font-face' }]
          : urls.map((url) => {
              const service = serviceFor(url);
              return {
                kind: 'font-face' as const,
                url,
                ...(service === undefined ? {} : { service }),
              };
            });
      for (const origin of origins) {
        index.add(
          family,
          origin,
          weight === undefined ? [] : [weight],
          style === undefined ? [] : [style]
        );
      }
    }
  }
}

/**
 * Read the families a font service was asked for out of its stylesheet URL.
 *
 * Google Fonts states them in the query string — `?family=Vazirmatn:wght@400;700`
 * for v2, `?family=Open+Sans:400,700` for v1 — which means the families and
 * their weights are knowable without fetching the stylesheet. That is the whole
 * reason this is worth doing: it is the one case where a `<link>` says exactly
 * what it will load.
 */
function readServiceLink(absolute: string, index: FamilyIndex): void {
  let url: URL;
  try {
    url = new URL(absolute);
  } catch {
    return;
  }

  const service = serviceFor(absolute);
  const families = url.searchParams.getAll('family');
  if (families.length === 0) return;

  for (const entry of families) {
    // v2: `Vazirmatn:ital,wght@0,400;0,700`. v1: `Open Sans:400,700italic`.
    const [namePart = '', axisPart] = entry.split(':');
    const family = namePart.replace(/\+/g, ' ').trim();
    if (family === '') continue;

    const weights = new Set<string>();
    const styles = new Set<string>();
    if (axisPart !== undefined) {
      // Take every 3-or-4-digit run as a weight, wherever it sits in the axis
      // syntax — the two versions place them differently and neither places
      // anything else numeric there.
      for (const match of axisPart.matchAll(/\b([1-9]00|1000)\b/g)) {
        const weight = match[1];
        if (weight !== undefined) weights.add(weight);
      }
      if (/ital/i.test(axisPart)) styles.add('italic');
    }

    index.add(
      family,
      { kind: 'font-service', url: absolute, ...(service === undefined ? {} : { service }) },
      [...weights],
      [...styles]
    );
  }
}

/**
 * Every font family the document asks for.
 *
 * Takes a document that was already fetched, and never fetches: a linked
 * stylesheet on the site's own domain is recorded as an origin whose families
 * are unknown, because knowing them would mean downloading it. The surface with
 * a network budget — the app, §15 — can widen that later.
 *
 * An empty array means the page states no font at all, which is a real and
 * common answer for markup that leaves typography to an external stylesheet.
 */
export function inspectFonts(
  page: PageContext,
  $: CheerioAPI,
  options: InspectFontsOptions = {}
): FontFamily[] {
  const index = new FamilyIndex();

  // Inline <style> blocks, which is where @font-face is visible without a
  // request. <style> content is not HTML-escaped, so it is read verbatim.
  $('style').each((_, node) => {
    readFontFaces($(node).text(), page.url, index);
  });

  // Stylesheet links. A font service names its families in the query string; a
  // self-hosted stylesheet does not, and is recorded as an origin with no
  // families rather than guessed at.
  $('link[rel~="stylesheet"], link[rel="preload"][as="style"]').each((_, node) => {
    const href = attr(node, 'href');
    if (href === undefined || href.trim() === '') return;
    const absolute = resolveUrl(href, page.url);
    if (absolute === undefined) return;
    readServiceLink(absolute, index);
  });

  // Preloaded font files. The family is not stated, but the file often names
  // it, and a preload is strong evidence the font is actually used.
  $('link[rel="preload"][as="font"]').each((_, node) => {
    const href = attr(node, 'href');
    if (href === undefined || href.trim() === '') return;
    const absolute = resolveUrl(href, page.url);
    if (absolute === undefined) return;
    const family = familyFromFileName(absolute);
    if (family === undefined) return;
    const service = serviceFor(absolute);
    index.add(family, {
      kind: 'font-face',
      url: absolute,
      ...(service === undefined ? {} : { service }),
    });
  });

  // Inline style attributes. Rare on a modern page, decisive on an old one.
  $('[style]').each((_, node) => {
    const style = attr(node, 'style');
    if (style === undefined) return;
    const declared = declaration(`;${style}`, 'font-family');
    if (declared === undefined) return;
    const weight = declaration(`;${style}`, 'font-weight');
    const fontStyle = declaration(`;${style}`, 'font-style');
    for (const family of parseFontStack(declared)) {
      index.add(
        family,
        { kind: 'inline-style' },
        weight === undefined ? [] : [weight],
        fontStyle === undefined ? [] : [fontStyle]
      );
    }
  });

  applyComputed(options.computed ?? [], index);

  return index.toArray();
}

/**
 * Fold in what a surface with a real DOM measured.
 *
 * A computed family the markup never declared is still a real font — a
 * stylesheet this module could not read had to have declared it somewhere — so
 * it is added rather than dropped. That is the case `usedBy` exists for.
 */
function applyComputed(computed: readonly ComputedFontUsage[], index: FamilyIndex): void {
  for (const usage of computed) {
    const [family] = parseFontStack(usage.family);
    if (family === undefined) continue;
    if (!index.has(family)) index.add(family, { kind: 'computed' });
    index.add(
      family,
      { kind: 'computed' },
      usage.weight === undefined ? [] : [usage.weight],
      usage.style === undefined ? [] : [usage.style]
    );
    index.markUsed(family, usage.selector);
  }
}

/**
 * Guess a family name from a font file's name — `Vazirmatn-Bold.woff2`.
 *
 * The one place in this module that infers rather than reads, and it is
 * confined to preloads, where there is no other source and the convention is
 * near-universal. A name that survives the filters is still only as good as the
 * file naming; anything that does not look like a family name is dropped.
 */
function familyFromFileName(url: string): string | undefined {
  const path = url.split(/[?#]/)[0] ?? '';
  const file = path.split('/').pop();
  if (file === undefined) return undefined;

  const stem = file.replace(/\.(woff2?|ttf|otf|eot)$/i, '');
  if (stem === file) return undefined;

  const [name] = stem.split(/[-_.]/);
  if (name === undefined || name.length < 3) return undefined;
  // A hashed filename is not a family name.
  if (/^[0-9a-f]{8,}$/i.test(name) || /\d/.test(name)) return undefined;
  return name;
}
