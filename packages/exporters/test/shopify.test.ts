/**
 * The Shopify CSV exporter.
 *
 * Verified against the template Shopify publishes at
 * `help.shopify.com/csv/product_template.csv` — header names, column order,
 * uppercase booleans, and the first-row-only discipline all come from that file
 * rather than from the guides, which still show the older `Handle` /
 * `Body (HTML)` / `Variant Price` spellings.
 *
 * The first `describe` block is the one that matters. Shopify's price columns
 * are the inverse of WooCommerce's, and copying the mapping across produces a
 * file that imports perfectly and is wrong about every price in the shop.
 */

import { describe, expect, it } from 'vitest';

import {
  SHOPIFY_HEADERS,
  type ShopifyCsvOptions,
  exportShopifyCsv,
  handleCandidate,
} from '@proc123/exporters';

import { makeProduct, parseCsv } from './helpers.js';

/** Parse an export into `{ header, rows }` with column lookup by header name. */
function exportRows(
  products: Parameters<typeof exportShopifyCsv>[0],
  options: ShopifyCsvOptions = {}
) {
  const result = exportShopifyCsv(products, options);
  const [header = [], ...rows] = parseCsv(result.csv);

  const cell = (row: string[], key: keyof typeof SHOPIFY_HEADERS): string => {
    const index = header.indexOf(SHOPIFY_HEADERS[key]);
    return index === -1 ? '' : (row[index] ?? '');
  };

  return { result, header, rows, cell };
}

const toman = (amount: number) => ({ amount, currency: 'IRR', unit: 'toman' as const });

describe('the price columns, which are inverted from WooCommerce', () => {
  it('writes a discounted product’s sale price as Price and its regular price as Compare-at', () => {
    const { rows, cell } = exportRows([
      makeProduct({ regularPrice: toman(150_000), salePrice: toman(120_000) }),
    ]);

    const row = rows[0] ?? [];
    // What the customer is charged.
    expect(cell(row, 'price')).toBe('120000');
    // The struck-through "was" figure.
    expect(cell(row, 'compareAtPrice')).toBe('150000');
  });

  it('leaves Compare-at empty when the product is not on sale', () => {
    const { rows, cell } = exportRows([makeProduct({ regularPrice: toman(150_000) })]);
    const row = rows[0] ?? [];

    expect(cell(row, 'price')).toBe('150000');
    // Repeating the price here would show every product at a 0% discount.
    expect(cell(row, 'compareAtPrice')).toBe('');
  });

  it('does not sell at the pre-discount price when only a sale price is known', () => {
    const { rows, cell } = exportRows([makeProduct({ salePrice: toman(120_000) })]);
    const row = rows[0] ?? [];

    expect(cell(row, 'price')).toBe('120000');
    expect(cell(row, 'compareAtPrice')).toBe('');
  });

  it('converts rial to the export’s unit rather than writing it as-is', () => {
    const { rows, cell } = exportRows([
      makeProduct({ regularPrice: { amount: 1_500_000, currency: 'IRR', unit: 'rial' } }),
    ]);

    expect(cell(rows[0] ?? [], 'price')).toBe('150000');
  });

  it('warns rather than guessing when an IRR price carries no unit', () => {
    const { result } = exportRows([
      makeProduct({ regularPrice: { amount: 150_000, currency: 'IRR' } }),
    ]);

    expect(result.warnings.map((warning) => warning.code)).toContain('currency-unit-assumed');
    expect(result.warnings[0]?.message).toContain('10x');
  });

  it('can be told to refuse instead of assuming', () => {
    expect(() =>
      exportShopifyCsv([makeProduct({ regularPrice: { amount: 1, currency: 'IRR' } })], {
        strictCurrencyUnit: true,
      })
    ).toThrow(/10x/);
  });
});

describe('the header', () => {
  it('matches Shopify’s own template, in its order', () => {
    const { header } = exportRows([makeProduct()]);

    expect(header[0]).toBe('Title');
    expect(header[1]).toBe('URL handle');
    // The renamed columns, not the `Handle` / `Body (HTML)` spellings the
    // third-party guides still show.
    expect(header).toContain('Description');
    expect(header).toContain('Compare-at price');
    expect(header).toContain('Continue selling when out of stock');
    expect(header).not.toContain('Body (HTML)');
    expect(header).not.toContain('Variant Price');
  });
});

describe('row structure', () => {
  const variable = () => [
    makeProduct({
      sku: 'P-1',
      kind: 'variable',
      name: 'گردو',
      attributes: [{ name: 'وزن', values: ['۵۰۰ گرم', '۱ کیلو'], isVariationAxis: true }],
    }),
    makeProduct({
      kind: 'variation',
      parentSku: 'P-1',
      name: 'گردو ۵۰۰',
      sku: 'P-1-A',
      regularPrice: toman(150_000),
      attributes: [{ name: 'وزن', values: ['۵۰۰ گرم'], isVariationAxis: false }],
    }),
    makeProduct({
      kind: 'variation',
      parentSku: 'P-1',
      name: 'گردو ۱ کیلو',
      sku: 'P-1-B',
      regularPrice: toman(280_000),
      attributes: [{ name: 'وزن', values: ['۱ کیلو'], isVariationAxis: false }],
    }),
  ];

  it('gives every row of a product the same handle', () => {
    const { rows, cell } = exportRows(variable());
    const handles = new Set(rows.map((row) => cell(row, 'handle')));

    expect(rows).toHaveLength(2);
    expect(handles.size).toBe(1);
  });

  it('puts the product-level fields on the first row only', () => {
    const { rows, cell } = exportRows(variable());
    const [first = [], second = []] = rows;

    expect(cell(first, 'title')).toBe('گردو');
    expect(cell(first, 'option1Name')).toBe('وزن');

    // A repeated Title is read as a competing definition of the same handle.
    expect(cell(second, 'title')).toBe('');
    expect(cell(second, 'option1Name')).toBe('');
    expect(cell(second, 'status')).toBe('');
  });

  it('puts the variant fields on every row', () => {
    const { rows, cell } = exportRows(variable());

    expect(rows.map((row) => cell(row, 'option1Value'))).toEqual(['۵۰۰ گرم', '۱ کیلو']);
    expect(rows.map((row) => cell(row, 'price'))).toEqual(['150000', '280000']);
    expect(rows.map((row) => cell(row, 'sku'))).toEqual(['P-1-A', 'P-1-B']);
  });

  it('still writes a variant row for a product with no options', () => {
    // Price and stock live on the variant in Shopify's model, never on the
    // product, so a simple product without a variant row has no price at all.
    const { rows, cell } = exportRows([makeProduct({ regularPrice: toman(150_000) })]);
    const row = rows[0] ?? [];

    expect(cell(row, 'option1Name')).toBe('Title');
    expect(cell(row, 'option1Value')).toBe('Default Title');
    expect(cell(row, 'price')).toBe('150000');
  });

  it('gives each extra image its own row carrying nothing else', () => {
    const { rows, cell, result } = exportRows([
      makeProduct({ images: ['https://cdn/a.jpg', 'https://cdn/b.jpg', 'https://cdn/c.jpg'] }),
    ]);

    expect(rows).toHaveLength(3);
    expect(rows.map((row) => cell(row, 'imagePosition'))).toEqual(['1', '2', '3']);

    const extra = rows[1] ?? [];
    expect(cell(extra, 'imageSrc')).toBe('https://cdn/b.jpg');
    // Anything else here would be read as another variant.
    expect(cell(extra, 'price')).toBe('');
    expect(cell(extra, 'option1Value')).toBe('');
    expect(cell(extra, 'title')).toBe('');
    expect(result.stats.imageRows).toBe(2);
  });

  it('drops a variation whose parent is not in the export', () => {
    const { rows, result } = exportRows([
      makeProduct({ kind: 'variation', parentSku: 'missing', sourceUrl: 'https://x.example/v' }),
    ]);

    expect(rows).toHaveLength(0);
    expect(result.warnings[0]?.code).toBe('orphan-variation');
  });
});

describe('handles', () => {
  it('produces a URL-safe ASCII handle from a Persian name', () => {
    const handle = handleCandidate(makeProduct({ name: 'گردو با پوست' }));

    expect(handle).toMatch(/^[a-z0-9-]+$/);
    expect(handle).not.toBe('');
  });

  it('keeps two products with the same name apart', () => {
    const { rows, cell, result } = exportRows([
      makeProduct({ name: 'Walnut', sourceUrl: 'https://x.example/a' }),
      makeProduct({ name: 'Walnut', sourceUrl: 'https://x.example/b' }),
    ]);

    const handles = rows.map((row) => cell(row, 'handle'));
    // Sharing a handle would have merged them into one product on import.
    expect(new Set(handles).size).toBe(2);
    expect(result.warnings.map((warning) => warning.code)).toContain('handle-deduplicated');
  });

  it('honours a prefix, for a store importing from several sources', () => {
    const { rows, cell } = exportRows([makeProduct({ name: 'Walnut' })], { handlePrefix: 'ajil' });

    expect(cell(rows[0] ?? [], 'handle')).toMatch(/^ajil-/);
  });
});

describe('the conservative defaults', () => {
  it('imports as a draft, not straight to the storefront', () => {
    const { rows, cell } = exportRows([makeProduct()]);
    const row = rows[0] ?? [];

    // A few hundred scanned products going live at prices nobody has checked
    // is not something this should do on the user's behalf.
    expect(cell(row, 'status')).toBe('draft');
    expect(cell(row, 'published')).toBe('FALSE');
  });

  it('does not track inventory borrowed from another shop', () => {
    const { rows, cell } = exportRows([makeProduct({ inStock: true, stockQuantity: 7 })]);
    const row = rows[0] ?? [];

    expect(cell(row, 'inventoryTracker')).toBe('');
    expect(cell(row, 'inventoryQuantity')).toBe('');
  });

  it('tracks inventory when explicitly asked to', () => {
    const { rows, cell } = exportRows([makeProduct({ inStock: true, stockQuantity: 7 })], {
      trackInventory: true,
    });
    const row = rows[0] ?? [];

    expect(cell(row, 'inventoryTracker')).toBe('shopify');
    expect(cell(row, 'inventoryQuantity')).toBe('7');
  });

  it('writes booleans the way Shopify’s own export does', () => {
    const { rows, cell } = exportRows([makeProduct()]);
    const row = rows[0] ?? [];

    expect(cell(row, 'chargeTax')).toBe('TRUE');
    expect(cell(row, 'requiresShipping')).toBe('TRUE');
    expect(cell(row, 'inventoryPolicy')).toBe('DENY');
  });

  it('leaves descriptions out under structured-only', () => {
    const { rows, cell } = exportRows([makeProduct({ description: '<p>Fresh walnuts.</p>' })]);

    expect(cell(rows[0] ?? [], 'description')).toBe('');
  });

  it('tags a copied description with its source under reference mode', () => {
    const { rows, cell } = exportRows([makeProduct({ description: '<p>Fresh walnuts.</p>' })], {
      contentMode: 'reference',
    });

    const body = cell(rows[0] ?? [], 'description');
    expect(body).toContain('Fresh walnuts');
    expect(body).toContain('source: https://shop.example/product/walnut');
  });

  it('leaves Product category empty rather than guessing Shopify’s taxonomy', () => {
    const { rows, cell } = exportRows([makeProduct({ categoryPath: ['آجیل', 'گردو'] })]);
    const row = rows[0] ?? [];

    // Shopify uses this for tax and marketplace rules; a wrong value is worse
    // than none. The readable path goes to Type and Tags instead.
    expect(cell(row, 'productCategory')).toBe('');
    expect(cell(row, 'type')).toBe('گردو');
    expect(cell(row, 'tags')).toContain('آجیل');
  });
});

describe('limits Shopify imposes', () => {
  it('reports the axes it had to drop past three, rather than merging variants silently', () => {
    const axes = ['A', 'B', 'C', 'D'].map((name) => ({
      name,
      values: ['1', '2'],
      isVariationAxis: true,
    }));

    const { result } = exportRows([
      makeProduct({ sku: 'P-1', kind: 'variable', attributes: axes }),
      makeProduct({ kind: 'variation', parentSku: 'P-1', attributes: axes }),
    ]);

    const warning = result.warnings.find((entry) => entry.code === 'too-many-options');
    expect(warning?.message).toContain('D');
    expect(warning?.message).toContain('duplicates');
  });

  it('converts weight to grams, whatever the source used', () => {
    const { rows, cell } = exportRows([makeProduct({ weight: { value: 1.5, unit: 'kg' } })]);

    expect(cell(rows[0] ?? [], 'weightGrams')).toBe('1500');
  });
});
