/**
 * The troubleshooting subsystem (CLAUDE.md §11).
 *
 * The report's job is not to describe the pipeline — it is to tell a user
 * whether an empty column is their doing, the shop's doing, or a bug. So most
 * of what is tested here is that the four cases stay distinguishable, and that
 * the prose never leaks internals at the person reading it.
 *
 * For the log, the tests that matter are the two that make it safe to share: a
 * key is never written, and page HTML is never written.
 */

import { describe, expect, it } from 'vitest';

import {
  type CanonicalProduct,
  DEFAULT_CONFIG,
  type ExtractionIssue,
  type Proc123Config,
  createLogger,
  describeConfidence,
  explainScan,
  formatLog,
  formatReport,
  redact,
  silentLogger,
  summarizeIssues,
} from '@proc123/core';

const SCANNED_AT = '2026-08-16T09:00:00.000Z';
const URL = 'https://ajil.example/c/nuts';

/**
 * Overrides that may explicitly clear an optional field.
 *
 * The interesting cases here are the ones where a field is deliberately absent
 * — a product with no price, no brand — and under `exactOptionalPropertyTypes`
 * a plain `Partial<…>` will not accept `{ regularPrice: undefined }`. Only the
 * genuinely optional properties are widened, so a typo that clears `name` or
 * `images` still fails to compile.
 */
type OptionalKeys<T> = { [K in keyof T]-?: undefined extends T[K] ? K : never }[keyof T];

type ProductOverrides = Partial<Omit<CanonicalProduct, OptionalKeys<CanonicalProduct>>> & {
  [K in OptionalKeys<CanonicalProduct>]?: CanonicalProduct[K] | undefined;
};

/**
 * Drop the keys set to `undefined` rather than spreading them in.
 *
 * `{ ...base, regularPrice: undefined }` leaves a `regularPrice` key present
 * and holding `undefined`, which is a different object shape from one where the
 * shop never published a price. Removing the key makes the fixture match what
 * the pipeline actually produces.
 */
function omitUndefined(overrides: ProductOverrides): Partial<CanonicalProduct> {
  return Object.fromEntries(Object.entries(overrides).filter(([, value]) => value !== undefined));
}

function product(overrides: ProductOverrides = {}): CanonicalProduct {
  const base: CanonicalProduct = {
    sourceUrl: 'https://ajil.example/p/walnut',
    kind: 'simple',
    name: 'گردو',
    categoryPath: ['آجیل'],
    images: ['https://cdn.ajil.example/w.jpg'],
    attributes: [{ name: 'وزن', values: ['۵۰۰ گرم'], isVariationAxis: false }],
    regularPrice: { amount: 150_000, currency: 'IRR', unit: 'toman' },
    description: 'گردوی تازه.',
    shortDescription: 'تازه',
    salePrice: { amount: 120_000, currency: 'IRR', unit: 'toman' },
    inStock: true,
    extractionMeta: {
      layer: 'B',
      fieldConfidence: { name: 0.95, regularPrice: 0.95, images: 0.95 },
      scannedAt: SCANNED_AT,
    },
  };

  // Keys the caller cleared are removed from the base, not overwritten with
  // `undefined` — see `omitUndefined`.
  const mutable = base as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete mutable[key];
  }

  return { ...base, ...omitUndefined(overrides) };
}

const config = (over: Partial<Proc123Config> = {}): Proc123Config => ({
  ...DEFAULT_CONFIG,
  ...over,
});

const field = (report: ReturnType<typeof explainScan>, name: string) =>
  report.fields.find((entry) => entry.field === name);

describe('explainScan', () => {
  it('tells a user they switched a field off, and how to undo it', () => {
    const report = explainScan({
      url: URL,
      products: [product()],
      issues: [],
      config: config({ targetFields: ['name', 'regularPrice'] }),
    });

    const brand = field(report, 'brand');
    expect(brand?.reason).toBe('turned-off');
    expect(brand?.message).toContain('switched off in your settings');
  });

  it('separates "the shop never published it" from anything being wrong', () => {
    const report = explainScan({
      url: URL,
      products: [product()],
      issues: [],
      config: config({ targetFields: [...DEFAULT_CONFIG.targetFields, 'gtin'] }),
    });

    const gtin = field(report, 'gtin');
    expect(gtin?.reason).toBe('not-published');
    expect(gtin?.message).toContain('common and usually fine');
    expect(report.problems).toEqual([]);
  });

  it('points a missing Tier-1 field at the fix the user actually has', () => {
    const noPrice = product({ regularPrice: undefined, salePrice: undefined });
    const report = explainScan({ url: URL, products: [noPrice], issues: [], config: config() });

    const price = field(report, 'regularPrice');
    expect(price?.reason).toBe('not-published');
    expect(price?.message).toContain('Teach proc123 this site');
  });

  it('blames the failure, not the shop, when the scan could not finish', () => {
    const blocked: ExtractionIssue = {
      severity: 'error',
      code: 'site-blocked',
      kind: 'site-blocked',
      message: 'This shop blocks automated reading.',
    };
    const report = explainScan({
      url: URL,
      products: [product({ regularPrice: undefined })],
      issues: [blocked],
      config: config(),
    });

    const price = field(report, 'regularPrice');
    expect(price?.reason).toBe('scan-failed');
    expect(price?.message).toContain('blocks automated reading');
  });

  it('reports a field that is only sometimes there as partial, not missing', () => {
    const report = explainScan({
      url: URL,
      products: [product(), product({ regularPrice: undefined })],
      issues: [],
      config: config(),
    });

    const price = field(report, 'regularPrice');
    expect(price?.reason).toBe('partial');
    expect(price?.filled).toBe(1);
    expect(price?.message).toContain('1 of 2');
  });

  it('names where a value came from, in words rather than layer letters', () => {
    const report = explainScan({ url: URL, products: [product()], issues: [], config: config() });

    const name = field(report, 'name');
    expect(name?.reason).toBe('filled');
    expect(name?.message).toContain('structured data');
    expect(name?.message).not.toContain('layer B');
    expect(name?.message).toContain('certain');
  });

  it('says plainly when nothing is wrong', () => {
    const report = explainScan({ url: URL, products: [product()], issues: [], config: config() });

    expect(report.summary).toContain('Nothing here looks wrong');
  });

  it('explains an empty scan without leaving the user stuck', () => {
    const report = explainScan({ url: URL, products: [], issues: [], config: config() });

    expect(report.summary).toContain('Teach proc123 this site');
  });

  it('flags a taught profile that has stopped matching', () => {
    const report = explainScan({
      url: URL,
      products: [product()],
      issues: [],
      config: config(),
      profileHealth: {
        healthy: false,
        summary: '12 cards found, but price matched nothing.',
        brokenFields: ['price'],
      },
    });

    expect(report.profileHealth).toContain('stopped matching');
    expect(report.profileHealth).toContain('price matched nothing');
  });

  it('stays quiet about a profile that is fine', () => {
    const report = explainScan({
      url: URL,
      products: [product()],
      issues: [],
      config: config(),
      profileHealth: { healthy: true, summary: 'all good', brokenFields: [] },
    });

    expect(report.profileHealth).toBeUndefined();
  });

  it('names the Tier-3 columns once, so nobody goes hunting for them', () => {
    const report = explainScan({ url: URL, products: [product()], issues: [], config: config() });

    expect(report.neverAvailable).toContain('woodmart_');
    expect(report.neverAvailable).toContain('rather than inventing values');
  });
});

describe('summarizeIssues', () => {
  const warn = (code: string, message: string): ExtractionIssue => ({
    severity: 'warning',
    code,
    message,
  });

  it('merges the same warning repeated across a crawl', () => {
    const summarized = summarizeIssues([
      warn('price-unit-unknown', 'A price did not say toman or rial.'),
      warn('price-unit-unknown', 'A price did not say toman or rial.'),
      warn('price-unit-unknown', 'A price did not say toman or rial.'),
    ]);

    expect(summarized).toHaveLength(1);
    expect(summarized[0]?.message).toContain('(3 times)');
  });

  it('drops the informational notes, which are decisions rather than problems', () => {
    const summarized = summarizeIssues([
      { severity: 'info', code: 'fields-turned-off', message: 'Some fields are off.' },
      warn('price-range-only', 'A price was a range.'),
    ]);

    expect(summarized).toHaveLength(1);
    expect(summarized[0]?.code).toBe('price-range-only');
  });

  it('puts errors above warnings', () => {
    const summarized = summarizeIssues([
      warn('price-range-only', 'A price was a range.'),
      { severity: 'error', code: 'site-blocked', kind: 'site-blocked', message: 'Blocked.' },
    ]);

    expect(summarized[0]?.severity).toBe('error');
  });
});

describe('formatReport', () => {
  it('reads as prose, and omits the fields that are fine', () => {
    const text = formatReport(
      explainScan({
        url: URL,
        products: [product({ brand: undefined })],
        issues: [],
        config: config({ targetFields: ['name', 'brand'] }),
      })
    );

    expect(text).toContain('why is this field empty?');
    expect(text).toContain(URL);
    expect(text).toContain('brand:');
    expect(text).not.toContain('name:');
  });
});

describe('describeConfidence', () => {
  it('turns a number nobody can interpret into a word anyone can', () => {
    expect(describeConfidence(1)).toBe('certain');
    expect(describeConfidence(0.95)).toBe('certain');
    expect(describeConfidence(0.7)).toBe('reliable');
    expect(describeConfidence(0.5)).toBe('probable');
    // Layer D sits here on purpose — see `AI_CONFIDENCE`.
    expect(describeConfidence(0.3)).toBe('worth checking');
  });
});

describe('the log', () => {
  const at = (): string => SCANNED_AT;

  it('writes one JSON object per event', () => {
    const log = createLogger({ now: at });
    log.info('scan.started', { url: URL, pages: 3 });

    const [record] = log.records();
    expect(record).toEqual({
      at: SCANNED_AT,
      level: 'info',
      event: 'scan.started',
      url: URL,
      pages: 3,
    });
    expect(JSON.parse(formatLog(log.records()))).toMatchObject({ event: 'scan.started' });
  });

  it('never writes an API key, however it is spelled', () => {
    const log = createLogger({ now: at });
    log.info('ai.called', {
      apiKey: 'sk-real-secret',
      api_key: 'sk-real-secret',
      authorization: 'Bearer sk-real-secret',
      nested: { token: 'sk-real-secret' },
    });

    expect(formatLog(log.records())).not.toContain('sk-real-secret');
    expect(log.records()[0]?.['apiKey']).toBe('[redacted]');
    expect((log.records()[0]?.['nested'] as Record<string, unknown>)['token']).toBe('[redacted]');
  });

  it('never writes page HTML, only how much there was', () => {
    const log = createLogger({ now: at });
    log.info('page.read', { html: '<div>گردو</div>'.repeat(400) });

    const value = log.records()[0]?.['html'];
    expect(typeof value).toBe('string');
    expect(value).toMatch(/^\[\d+ chars\]$/);
  });

  it('keeps a short string as it is — a URL is not page content', () => {
    const log = createLogger({ now: at });
    log.info('page.read', { url: URL });

    expect(log.records()[0]?.['url']).toBe(URL);
  });

  it('drops records below the chosen level', () => {
    const log = createLogger({ now: at, level: 'warn' });
    log.debug('a');
    log.info('b');
    log.warn('c');
    log.error('d');

    expect(log.records().map((record) => record.event)).toEqual(['c', 'd']);
  });

  it('stamps a child’s fields onto everything it writes', () => {
    const log = createLogger({ now: at }).child({ crawlId: 'crawl-abc' });
    log.info('page.done');

    expect(log.records()[0]?.['crawlId']).toBe('crawl-abc');
  });

  it('redacts a secret bound to a child, not just one passed per call', () => {
    const log = createLogger({ now: at }).child({ apiKey: 'sk-real-secret' });
    log.info('ai.called');

    expect(formatLog(log.records())).not.toContain('sk-real-secret');
  });

  it('never lets a broken sink take down the scan', () => {
    const log = createLogger({
      now: at,
      sink: () => {
        throw new Error('disk full');
      },
    });

    expect(() => {
      log.error('page.failed');
    }).not.toThrow();
  });

  it('offers a logger that keeps nothing', () => {
    const log = silentLogger();
    log.error('page.failed');

    expect(log.records()).toEqual([]);
  });
});

describe('redact', () => {
  it('is safe to call on anything a caller hands it', () => {
    expect(redact({ n: 1, b: true, u: undefined, nul: null })).toEqual({
      n: 1,
      b: true,
      u: undefined,
      nul: null,
    });
  });

  it('caps a long array rather than writing all of it', () => {
    const long = Array.from({ length: 50 }, (_, index) => index);
    expect((redact({ urls: long })['urls'] as unknown[]).length).toBe(20);
  });
});
