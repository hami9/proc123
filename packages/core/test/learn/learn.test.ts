/**
 * Layer C: learning a store from three clicks, and using what was learned.
 *
 * The fixture is a hand-built storefront with no machine-readable data of any
 * kind, which is the only situation Layer C is for.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  type ElementPath,
  type FieldPick,
  candidatesFor,
  checkProfileHealth,
  extractWithProfile,
  findCard,
  isElement,
  isGeneratedClass,
  learnProfile,
  loadHtml,
  pathOf,
  resolvePath,
} from '@proc123/core';
import { parseProfile, profileDomain, serializeProfile, validateProfile } from '@proc123/profiles';

const SCANNED_AT = '2026-08-16T09:00:00.000Z';
const NOW = (): string => SCANNED_AT;
const URL_ = 'https://dastsaz.example/c/nuts';

const html = readFileSync(new URL('../fixtures/no-markup-category.html', import.meta.url), 'utf8');
const page = { url: URL_, html };

/** Where an element sits, the same way the extension's picker reports it. */
function pathTo(selector: string, index = 0): ElementPath {
  const $ = loadHtml(html);
  const target = $(selector).eq(index).get(0);
  if (target === undefined || !isElement(target)) throw new Error(`no element for ${selector}`);
  return pathOf(target);
}

const PICKS: FieldPick[] = [
  { field: 'name', path: pathTo('.tile-title') },
  { field: 'regularPrice', path: pathTo('.price-now') },
  { field: 'image', path: pathTo('.tile-image') },
];

describe('selector scoring', () => {
  it('knows a build-generated class when it sees one', () => {
    for (const name of [
      'css-1f8a2b',
      'sc-bdVaJa',
      'jsx-283746',
      'Button_root__2x3Yz',
      'post-4821',
    ]) {
      expect(isGeneratedClass(name), name).toBe(true);
    }
    for (const name of ['product-tile', 'price-now', 'woocommerce-loop-product__title']) {
      expect(isGeneratedClass(name), name).toBe(false);
    }
  });

  it('prefers what the markup says over what a class is called', () => {
    const $ = loadHtml('<span itemprop="name" class="tile-title mt-2">Walnut</span>');
    const element = $('span').get(0);
    if (element === undefined) throw new Error('no element');

    const [best, second] = candidatesFor(element);
    expect(best?.selector).toBe('[itemprop="name"]');
    // An authored class beats a utility class, which says nothing about this
    // element because everything else has it too.
    expect(second?.selector).toBe('.tile-title');
  });

  it('never offers a generated class as a candidate', () => {
    const $ = loadHtml('<li class="product-tile css-1f8a2b"></li>');
    const element = $('li').get(0);
    if (element === undefined) throw new Error('no element');

    const selectors = candidatesFor(element).map((candidate) => candidate.selector);
    expect(selectors).toContain('.product-tile');
    expect(selectors).not.toContain('.css-1f8a2b');
  });
});

describe('finding the product card', () => {
  it('walks up to the element that repeats', () => {
    const $ = loadHtml(html);
    const clicks = [
      resolvePath($, PICKS[0]?.path ?? []),
      resolvePath($, PICKS[1]?.path ?? []),
      resolvePath($, PICKS[2]?.path ?? []),
    ].filter((element): element is NonNullable<typeof element> => element !== undefined);

    expect(clicks).toHaveLength(3);

    const detection = findCard(clicks);
    // Not the <a> the title and image share, and not the <ul> — the <li> that
    // there are three of.
    expect(detection?.card.tagName).toBe('li');
    expect(detection?.siblings).toBe(3);
  });
});

describe('learnProfile', () => {
  const learned = learnProfile(loadHtml(html), PICKS, { url: URL_, now: NOW, label: 'دست‌ساز' });

  it('produces a valid profile', () => {
    expect(learned.profile).toBeDefined();
    expect(validateProfile(learned.profile).valid).toBe(true);
  });

  it('keys the profile by domain, not by the page it was taught on', () => {
    expect(learned.profile?.domain).toBe('dastsaz.example');
  });

  it('learns a container selector that matches every card and nothing else', () => {
    expect(learned.cardCount).toBe(3);
    // The promo <li> sits among the cards and must not be one.
    expect(learned.profile?.card.container).not.toContain('css-');
  });

  it('learns each field relative to the card', () => {
    const fields = learned.profile?.card.fields;
    expect(fields?.name?.selector).toBe('.tile-title');
    expect(fields?.name?.from).toBe('text');
    expect(fields?.regularPrice?.selector).toBe('.price-now');
    expect(fields?.image?.from).toBe('attribute');
    expect(fields?.image?.attribute).toBe('src');
  });

  it('writes down why it chose each selector', () => {
    // A profile a person cannot audit is a profile they cannot fix.
    expect(learned.profile?.card.fields.name?.note).toMatch(/tile-title/);
    expect(learned.profile?.notes).toContain('look like this one');
  });

  it('never reaches for a position when the markup identifies the element', () => {
    const serialized = serializeProfile(learned.profile ?? ({} as never));
    expect(serialized).not.toContain('nth-of-type');
    expect(learned.warnings).toEqual([]);
  });

  it('refuses to learn without a name, and says why', () => {
    const result = learnProfile(loadHtml(html), [PICKS[1] as FieldPick], { url: URL_, now: NOW });
    expect(result.profile).toBeUndefined();
    expect(result.warnings.join(' ')).toContain('Point at the product name');
  });

  it('warns when it only had one card to learn from', () => {
    const single = html.replace(
      /<li class="product-tile[\s\S]*?<\/li>\s*(?=<li class="product-tile)/g,
      ''
    );
    const result = learnProfile(loadHtml(single), PICKS, { url: URL_, now: NOW });
    expect(result.warnings.join(' ')).toMatch(/single example|one product card/i);
  });
});

describe('applying a learned profile', () => {
  const profile = learnProfile(loadHtml(html), PICKS, { url: URL_, now: NOW }).profile;
  if (profile === undefined) throw new Error('learning failed');

  const result = extractWithProfile(page, profile, {
    scannedAt: SCANNED_AT,
    defaultCurrencyUnit: 'toman',
  });

  it('reads every card and no promos', () => {
    expect(result.products.map((product) => product.name)).toEqual([
      'گردو با پوست ۵۰۰ گرم',
      'پسته اکبری ۵۰۰ گرم',
      'بادام درختی ۵۰۰ گرم',
    ]);
  });

  it('normalizes the Persian display price', () => {
    // The card says ۱٬۵۰۰٬۰۰۰ تومان; the model needs a number and a unit.
    expect(result.products[0]?.regularPrice).toEqual({
      amount: 1500000,
      currency: 'IRR',
      unit: 'toman',
    });
  });

  it('resolves relative links and images', () => {
    expect(result.products[0]?.sourceUrl).toBe('https://dastsaz.example/product/walnut-500');
    expect(result.products[0]?.images).toEqual(['https://dastsaz.example/img/walnut.jpg']);
  });

  it('looks past a lazy-loading placeholder, the same as every other layer', () => {
    // A profile always records `src`, because that is the attribute the clicked
    // element appeared to hold. A lazy theme keeps a 1x1 grey pixel there and
    // the real URL somewhere else, which used to export three identical
    // placeholders — or three empty cells — for three different products.
    const lazy = html
      .replace(
        '<img class="tile-image" src="/img/walnut.jpg"',
        '<img class="tile-image" src="data:image/gif;base64,R0lGOD" data-src="/img/walnut.jpg"'
      )
      .replace(
        '<img class="tile-image" src="/img/pistachio.jpg"',
        '<img class="tile-image" data-lazy-src="/img/pistachio.jpg"'
      )
      .replace(
        '<img class="tile-image" src="/img/almond.jpg"',
        '<img class="tile-image" src="" srcset="/img/almond.jpg 1x, /img/almond@2x.jpg 2x"'
      );

    const scanned = extractWithProfile({ url: URL_, html: lazy }, profile, {
      scannedAt: SCANNED_AT,
      defaultCurrencyUnit: 'toman',
    });

    expect(scanned.products.map((product) => product.images)).toEqual([
      ['https://dastsaz.example/img/walnut.jpg'],
      ['https://dastsaz.example/img/pistachio.jpg'],
      ['https://dastsaz.example/img/almond.jpg'],
    ]);
  });

  it('never exports a data: placeholder as a product image', () => {
    // No real URL anywhere on the element. An empty cell is the honest answer;
    // a grey pixel imported into a shop is not.
    const placeholderOnly = html.replace(
      /src="\/img\/[a-z]+\.jpg"/g,
      'src="data:image/gif;base64,R0lGOD"'
    );

    const scanned = extractWithProfile({ url: URL_, html: placeholderOnly }, profile, {
      scannedAt: SCANNED_AT,
      defaultCurrencyUnit: 'toman',
    });

    expect(scanned.products.length).toBe(3);
    for (const product of scanned.products) {
      expect(product.images ?? []).toEqual([]);
    }
  });

  it('marks the rows as Layer C, below what markup would have earned', () => {
    for (const product of result.products) {
      expect(product.extractionMeta.layer).toBe('C');
      expect(product.extractionMeta.fieldConfidence['name']).toBe(0.4);
    }
  });

  it('says so when the theme has moved on', () => {
    const stale = { ...profile, card: { ...profile.card, container: '.old-theme-tile' } };
    const missed = extractWithProfile(page, stale, { scannedAt: SCANNED_AT });

    expect(missed.products).toEqual([]);
    const issue = missed.issues.find((entry) => entry.code === 'profile-container-missed');
    expect(issue?.kind).toBe('structure-changed');
    expect(issue?.message).toContain('needs teaching again');
  });

  it('reports a rule that matched nothing, but not one that is merely optional', () => {
    const withPrices = {
      ...profile,
      card: {
        ...profile.card,
        fields: {
          ...profile.card.fields,
          salePrice: { selector: '.price-was', from: 'text' as const },
          sku: { selector: '.nope', from: 'text' as const },
        },
      },
    };

    const codes = extractWithProfile(page, withPrices, { scannedAt: SCANNED_AT }).issues.map(
      (issue) => issue.message
    );
    // Only one card is on sale, which is normal and must not be reported.
    expect(codes.join(' ')).not.toContain('salePrice');
    expect(codes.join(' ')).toContain('sku');
  });
});

describe('profile health', () => {
  const profile = learnProfile(loadHtml(html), PICKS, { url: URL_, now: NOW }).profile;
  if (profile === undefined) throw new Error('learning failed');

  it('passes a profile that still works', () => {
    const health = checkProfileHealth(page, profile);
    expect(health.healthy).toBe(true);
    expect(health.cardCount).toBe(3);
    expect(health.summary).toContain('every rule matched');
  });

  it('flags a profile whose selectors have stopped matching', () => {
    const stale = {
      ...profile,
      card: { ...profile.card, fields: { name: { selector: '.gone', from: 'text' as const } } },
    };
    const health = checkProfileHealth(page, stale);

    expect(health.healthy).toBe(false);
    expect(health.brokenFields).toEqual(['name']);
  });

  it('separates "missing everywhere" from "missing on some cards"', () => {
    const withSale = {
      ...profile,
      card: {
        ...profile.card,
        fields: {
          ...profile.card.fields,
          salePrice: { selector: '.price-was', from: 'text' as const },
        },
      },
    };
    const health = checkProfileHealth(page, withSale);

    expect(health.healthy).toBe(true);
    expect(health.partialFields).toContain('salePrice');
    expect(health.summary).toContain('often normal');
  });
});

describe('the profile file', () => {
  it('round-trips through JSON', () => {
    const profile = learnProfile(loadHtml(html), PICKS, { url: URL_, now: NOW }).profile;
    if (profile === undefined) throw new Error('learning failed');

    expect(parseProfile(serializeProfile(profile))).toEqual(profile);
  });

  it('is written to be read and edited by a person', () => {
    const profile = learnProfile(loadHtml(html), PICKS, { url: URL_, now: NOW }).profile;
    const text = serializeProfile(profile ?? ({} as never));

    expect(text).toContain('\n  "domain": "dastsaz.example"');
    expect(text.endsWith('\n')).toBe(true);
  });

  it('refuses a file from a future version rather than guessing', () => {
    expect(() =>
      parseProfile('{"version":99,"domain":"x","card":{"container":"li","fields":{}}}')
    ).toThrow(/unsupported profile version/);
  });

  it('lists every problem at once, not just the first', () => {
    const result = validateProfile({ version: 1, card: { container: '', fields: { name: {} } } });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(2);
  });

  it('insists on a name field', () => {
    const result = validateProfile({
      version: 1,
      domain: 'x.example',
      card: {
        container: 'li',
        fields: { image: { selector: 'img', from: 'attribute', attribute: 'src' } },
      },
    });
    expect(result.errors.join(' ')).toContain('must include "name"');
  });

  it('catches an attribute rule that does not say which attribute', () => {
    const result = validateProfile({
      version: 1,
      domain: 'x.example',
      card: { container: 'li', fields: { name: { selector: 'h3', from: 'attribute' } } },
    });
    expect(result.errors.join(' ')).toContain('does not say which');
  });

  it('normalizes however the domain was written', () => {
    expect(profileDomain('https://www.Shop.Example/c/nuts')).toBe('shop.example');
    expect(profileDomain('WWW.SHOP.EXAMPLE')).toBe('shop.example');
  });
});
