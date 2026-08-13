/**
 * The correctness suite for the WooCommerce CSV exporter.
 *
 * Organized by the rules in CLAUDE.md §7, followed by the traps found by
 * reading WooCommerce's importer source (docs/woocommerce-csv-notes.md).
 */

import { describe, expect, it } from 'vitest';

import { UTF8_BOM, exportWooCommerceCsv } from '@proc123/exporters';

import { makeProduct, readCsv } from './helpers.js';

const PAGE = 'https://shop.example/product/nuts';

/** A variable product with two weight variations — the shape most rules concern. */
function variableProduct() {
  return [
    makeProduct({
      sourceUrl: PAGE,
      kind: 'variable',
      name: 'گردو',
      categoryPath: ['آجیل', 'گردو'],
      images: ['https://cdn.example/walnut.jpg'],
      attributes: [{ name: 'وزن', values: ['500 گرم', '1 کیلوگرم'], isVariationAxis: true }],
    }),
    makeProduct({
      sourceUrl: PAGE,
      kind: 'variation',
      name: 'گردو - 500 گرم',
      regularPrice: { amount: 150000, currency: 'IRR', unit: 'toman' },
      attributes: [{ name: 'وزن', values: ['500 گرم'], isVariationAxis: true }],
    }),
    makeProduct({
      sourceUrl: PAGE,
      kind: 'variation',
      name: 'گردو - 1 کیلوگرم',
      regularPrice: { amount: 280000, currency: 'IRR', unit: 'toman' },
      salePrice: { amount: 250000, currency: 'IRR', unit: 'toman' },
      attributes: [{ name: 'وزن', values: ['1 کیلوگرم'], isVariationAxis: true }],
    }),
  ];
}

describe('§7.1 canonical English headers', () => {
  it('emits the canonical English column names', () => {
    const { header } = readCsv(exportWooCommerceCsv([makeProduct()]).csv);
    expect(header).toEqual([
      'ID',
      'Type',
      'SKU',
      'Name',
      'Published',
      'Is featured?',
      'Visibility in catalog',
      'Short description',
      'Description',
      'In stock?',
      'Stock',
      'Weight (kg)',
      'Length (cm)',
      'Width (cm)',
      'Height (cm)',
      'Sale price',
      'Regular price',
      'Categories',
      'Tags',
      'Images',
      'Parent',
      'Position',
    ]);
  });

  it('does not emit GTIN or Brands unless asked (they need manual mapping)', () => {
    const { header } = readCsv(exportWooCommerceCsv([makeProduct({ gtin: '5901234123457' })]).csv);
    expect(header).not.toContain('GTIN, UPC, EAN, or ISBN');
    expect(header).not.toContain('Brands');

    const opted = readCsv(
      exportWooCommerceCsv([makeProduct({ gtin: '5901234123457', brand: 'Acme' })], {
        includeGtin: true,
        includeBrand: true,
      }).csv
    );
    expect(opted.header).toContain('GTIN, UPC, EAN, or ISBN');
    expect(opted.records[0]?.['GTIN, UPC, EAN, or ISBN']).toBe('5901234123457');
    expect(opted.records[0]?.Brands).toBe('Acme');
  });

  it('localized headers are opt-in, never the default', () => {
    const { header } = readCsv(
      exportWooCommerceCsv([makeProduct()], {
        headerOverrides: { name: 'نام', regularPrice: 'قیمت عادی' },
      }).csv
    );
    expect(header).toContain('نام');
    expect(header).toContain('قیمت عادی');
    expect(header).not.toContain('Name');
  });

  it('names weight and dimension columns after the target store units', () => {
    const { header } = readCsv(
      exportWooCommerceCsv([makeProduct()], { weightUnit: 'lbs', dimensionUnit: 'in' }).csv
    );
    expect(header).toContain('Weight (lbs)');
    expect(header).toContain('Length (in)');
  });
});

describe('§7.2 never rely on the ID column', () => {
  it('leaves ID empty on every row', () => {
    const { records } = readCsv(exportWooCommerceCsv(variableProduct()).csv);
    expect(records.map((r) => r.ID)).toEqual(['', '', '']);
  });

  it('links variations to the parent by SKU', () => {
    const { records } = readCsv(exportWooCommerceCsv(variableProduct()).csv);
    const parentSku = records[0]?.SKU ?? '';

    expect(parentSku).not.toBe('');
    expect(records[0]?.Parent).toBe('');
    expect(records[1]?.Parent).toBe(parentSku);
    expect(records[2]?.Parent).toBe(parentSku);
  });
});

describe('§7.3 deterministic, unique SKUs', () => {
  it('generates the documented SKU shapes', () => {
    const { records } = readCsv(exportWooCommerceCsv(variableProduct()).csv);
    expect(records[0]?.SKU).toMatch(/^P123-[0-9a-z]{8}$/);
    expect(records[1]?.SKU).toBe(`${records[0]?.SKU ?? ''}-500-گرم`);
  });

  it('produces identical SKUs on a re-scan, so a re-import updates', () => {
    const first = readCsv(exportWooCommerceCsv(variableProduct()).csv);
    const second = readCsv(exportWooCommerceCsv(variableProduct()).csv);
    expect(second.records.map((r) => r.SKU)).toEqual(first.records.map((r) => r.SKU));
  });

  it('gives every row a unique SKU even when the source repeats one', () => {
    const result = exportWooCommerceCsv([
      makeProduct({ sku: 'SAME', sourceUrl: 'https://shop.example/a' }),
      makeProduct({ sku: 'SAME', sourceUrl: 'https://shop.example/b' }),
    ]);
    const { records } = readCsv(result.csv);

    expect(new Set(records.map((r) => r.SKU)).size).toBe(2);
    expect(result.warnings.some((w) => w.code === 'sku-deduplicated')).toBe(true);
  });

  it('never leaves a SKU cell empty', () => {
    const { records } = readCsv(exportWooCommerceCsv(variableProduct()).csv);
    for (const record of records) expect(record.SKU).not.toBe('');
  });
});

describe('§7.4 row order', () => {
  it('puts each parent immediately before its own variations', () => {
    const other = 'https://shop.example/product/almond';
    const { records } = readCsv(
      exportWooCommerceCsv([...variableProduct(), makeProduct({ sourceUrl: other, name: 'بادام' })])
        .csv
    );

    expect(records.map((r) => r.Type)).toEqual(['variable', 'variation', 'variation', 'simple']);
  });

  it('keeps variations with their own parent when products interleave', () => {
    const a = 'https://shop.example/a';
    const b = 'https://shop.example/b';
    const products = [
      makeProduct({ sourceUrl: a, kind: 'variable', name: 'A' }),
      makeProduct({ sourceUrl: b, kind: 'variable', name: 'B' }),
      makeProduct({
        sourceUrl: a,
        kind: 'variation',
        name: 'A-1',
        attributes: [{ name: 'Size', values: ['S'], isVariationAxis: true }],
      }),
      makeProduct({
        sourceUrl: b,
        kind: 'variation',
        name: 'B-1',
        attributes: [{ name: 'Size', values: ['M'], isVariationAxis: true }],
      }),
    ];

    const { records } = readCsv(exportWooCommerceCsv(products).csv);
    expect(records.map((r) => r.Name)).toEqual(['A', 'A-1', 'B', 'B-1']);
    expect(records[1]?.Parent).toBe(records[0]?.SKU);
    expect(records[3]?.Parent).toBe(records[2]?.SKU);
  });
});

describe('§7.5 variable parents carry empty price cells', () => {
  it('writes empty, not zero', () => {
    const { records } = readCsv(exportWooCommerceCsv(variableProduct()).csv);

    expect(records[0]?.['Regular price']).toBe('');
    expect(records[0]?.['Sale price']).toBe('');
    expect(records[0]?.['Regular price']).not.toBe('0');

    expect(records[1]?.['Regular price']).toBe('150000');
    expect(records[2]?.['Sale price']).toBe('250000');
  });

  it('still prices simple products', () => {
    const { records } = readCsv(
      exportWooCommerceCsv([
        makeProduct({ regularPrice: { amount: 99000, currency: 'IRR', unit: 'toman' } }),
      ]).csv
    );
    expect(records[0]?.['Regular price']).toBe('99000');
  });
});

describe('§7.6 dynamic attribute columns', () => {
  it('sizes the columns to the widest product', () => {
    const single = readCsv(exportWooCommerceCsv(variableProduct()).csv);
    expect(single.header).toContain('Attribute 1 name');
    expect(single.header).not.toContain('Attribute 2 name');

    const wide = readCsv(
      exportWooCommerceCsv([
        ...variableProduct(),
        makeProduct({
          sourceUrl: 'https://shop.example/shirt',
          attributes: [
            { name: 'Color', values: ['Red'], isVariationAxis: false },
            { name: 'Size', values: ['L'], isVariationAxis: false },
            { name: 'Fabric', values: ['Cotton'], isVariationAxis: false },
          ],
        }),
      ]).csv
    );
    expect(wide.header).toContain('Attribute 3 value(s)');
    expect(wide.header).not.toContain('Attribute 4 name');
  });

  it('lists every value on the parent and exactly one per variation', () => {
    const { records } = readCsv(exportWooCommerceCsv(variableProduct()).csv);

    expect(records[0]?.['Attribute 1 name']).toBe('وزن');
    expect(records[0]?.['Attribute 1 value(s)']).toBe('500 گرم, 1 کیلوگرم');
    expect(records[1]?.['Attribute 1 value(s)']).toBe('500 گرم');
    expect(records[2]?.['Attribute 1 value(s)']).toBe('1 کیلوگرم');
  });

  it('pads unused attribute slots with empty cells', () => {
    const { records } = readCsv(
      exportWooCommerceCsv([
        makeProduct({
          sourceUrl: 'https://shop.example/a',
          attributes: [
            { name: 'Color', values: ['Red'], isVariationAxis: false },
            { name: 'Size', values: ['L'], isVariationAxis: false },
          ],
        }),
        makeProduct({
          sourceUrl: 'https://shop.example/b',
          attributes: [{ name: 'Color', values: ['Blue'], isVariationAxis: false }],
        }),
      ]).csv
    );

    // An empty `Attribute N name` makes WooCommerce skip the attribute entirely.
    expect(records[1]?.['Attribute 2 name']).toBe('');
    expect(records[1]?.['Attribute 2 value(s)']).toBe('');
  });

  it('matches parent and variation values character for character', () => {
    const { records } = readCsv(exportWooCommerceCsv(variableProduct()).csv);
    const parentValues = (records[0]?.['Attribute 1 value(s)'] ?? '').split(', ');

    expect(parentValues).toContain(records[1]?.['Attribute 1 value(s)']);
    expect(parentValues).toContain(records[2]?.['Attribute 1 value(s)']);
  });
});

describe('§7.7 attributes default to local', () => {
  it('writes global 0 and visible 1 by default', () => {
    const { records } = readCsv(exportWooCommerceCsv(variableProduct()).csv);
    expect(records[0]?.['Attribute 1 global']).toBe('0');
    expect(records[0]?.['Attribute 1 visible']).toBe('1');
  });

  it('allows opting in to global attributes', () => {
    const { records } = readCsv(
      exportWooCommerceCsv(variableProduct(), { attributesGlobal: true }).csv
    );
    expect(records[0]?.['Attribute 1 global']).toBe('1');
  });
});

describe('§7.8 number normalization and the toman/rial trap', () => {
  it('writes plain ASCII numbers with a dot decimal separator', () => {
    const { records } = readCsv(
      exportWooCommerceCsv([
        makeProduct({
          regularPrice: { amount: 1500000, currency: 'IRR', unit: 'toman' },
          weight: { value: 1.25, unit: 'kg' },
        }),
      ]).csv
    );

    expect(records[0]?.['Regular price']).toBe('1500000');
    expect(records[0]?.['Weight (kg)']).toBe('1.25');
    expect(records[0]?.['Regular price']).not.toContain(',');
  });

  it('converts rial prices to a toman export', () => {
    const { records } = readCsv(
      exportWooCommerceCsv(
        [makeProduct({ regularPrice: { amount: 1500000, currency: 'IRR', unit: 'rial' } })],
        { displayUnit: 'toman' }
      ).csv
    );
    expect(records[0]?.['Regular price']).toBe('150000');
  });

  it('converts toman prices to a rial export', () => {
    const { records } = readCsv(
      exportWooCommerceCsv(
        [makeProduct({ regularPrice: { amount: 150000, currency: 'IRR', unit: 'toman' } })],
        { displayUnit: 'rial' }
      ).csv
    );
    expect(records[0]?.['Regular price']).toBe('1500000');
  });

  it('warns loudly when an IRR price carries no unit', () => {
    const result = exportWooCommerceCsv([
      makeProduct({ regularPrice: { amount: 150000, currency: 'IRR' } }),
    ]);

    const warning = result.warnings.find((w) => w.code === 'currency-unit-assumed');
    expect(warning).toBeDefined();
    expect(warning?.message).toContain('10x');
    // The amount is written unchanged rather than silently scaled.
    expect(readCsv(result.csv).records[0]?.['Regular price']).toBe('150000');
  });

  it('can be made to refuse rather than assume', () => {
    expect(() =>
      exportWooCommerceCsv([makeProduct({ regularPrice: { amount: 150000, currency: 'IRR' } })], {
        strictCurrencyUnit: true,
      })
    ).toThrow(/10x/);
  });

  it('reports the units it saw so the UI can confirm before export', () => {
    const result = exportWooCommerceCsv([
      makeProduct({
        sourceUrl: 'https://shop.example/a',
        regularPrice: { amount: 1, currency: 'IRR', unit: 'toman' },
      }),
      makeProduct({
        sourceUrl: 'https://shop.example/b',
        regularPrice: { amount: 2, currency: 'IRR' },
      }),
      makeProduct({
        sourceUrl: 'https://shop.example/c',
        regularPrice: { amount: 3, currency: 'USD' },
      }),
    ]);

    expect(result.stats.currencyUnits).toEqual({ toman: 1, unknown: 1, USD: 1 });
  });

  it('does not invent an exchange rate for a foreign currency', () => {
    const result = exportWooCommerceCsv(
      [makeProduct({ regularPrice: { amount: 19.99, currency: 'USD' } })],
      { currencyCode: 'IRR' }
    );

    expect(readCsv(result.csv).records[0]?.['Regular price']).toBe('19.99');
    expect(result.warnings.some((w) => w.code === 'currency-mismatch')).toBe(true);
  });

  it('converts weights and dimensions into the target store units', () => {
    const { records } = readCsv(
      exportWooCommerceCsv(
        [
          makeProduct({
            weight: { value: 500, unit: 'g' },
            dimensions: { length: { value: 250, unit: 'mm' }, width: { value: 1, unit: 'm' } },
          }),
        ],
        { weightUnit: 'kg', dimensionUnit: 'cm' }
      ).csv
    );

    expect(records[0]?.['Weight (kg)']).toBe('0.5');
    expect(records[0]?.['Length (cm)']).toBe('25');
    expect(records[0]?.['Width (cm)']).toBe('100');
  });
});

describe('§7.9 encoding', () => {
  it('starts with a UTF-8 BOM', () => {
    expect(exportWooCommerceCsv([makeProduct()]).csv.startsWith(UTF8_BOM)).toBe(true);
  });

  it('can omit the BOM', () => {
    expect(exportWooCommerceCsv([makeProduct()], { bom: false }).csv.startsWith(UTF8_BOM)).toBe(
      false
    );
  });

  it('keeps Persian text intact', () => {
    const { records } = readCsv(exportWooCommerceCsv(variableProduct()).csv);
    expect(records[0]?.Name).toBe('گردو');
    expect(records[0]?.Categories).toBe('آجیل > گردو');
  });
});

describe('§7.10 published flag and category hierarchy', () => {
  it('writes Published as 1', () => {
    const { records } = readCsv(exportWooCommerceCsv(variableProduct()).csv);
    for (const record of records) expect(record.Published).toBe('1');
  });

  it('joins the category path with " > "', () => {
    const { records } = readCsv(
      exportWooCommerceCsv([makeProduct({ categoryPath: ['آجیل', 'گردو', 'پوست کنده'] })]).csv
    );
    expect(records[0]?.Categories).toBe('آجیل > گردو > پوست کنده');
  });

  it('escapes a comma inside a category name', () => {
    // WooCommerce splits the cell on commas; `\,` is its escape.
    const result = exportWooCommerceCsv([makeProduct({ categoryPath: ['Nuts, Dried'] })]);
    expect(readCsv(result.csv).records[0]?.Categories).toBe('Nuts\\, Dried');
  });

  it('warns when a category name contains the hierarchy separator', () => {
    const result = exportWooCommerceCsv([makeProduct({ categoryPath: ['A > B'] })]);
    expect(result.warnings.some((w) => w.code === 'category-separator-in-name')).toBe(true);
  });
});

describe('§7.11 images', () => {
  it('references images by URL, comma separated', () => {
    const { records } = readCsv(
      exportWooCommerceCsv([
        makeProduct({ images: ['https://cdn.example/a.jpg', 'https://cdn.example/b.jpg'] }),
      ]).csv
    );
    expect(records[0]?.Images).toBe('https://cdn.example/a.jpg, https://cdn.example/b.jpg');
  });

  it('escapes commas inside image URLs', () => {
    const { records } = readCsv(
      exportWooCommerceCsv([makeProduct({ images: ['https://cdn.example/a,b.jpg'] })]).csv
    );
    expect(records[0]?.Images).toBe('https://cdn.example/a\\,b.jpg');
  });
});

describe('§8 content mode', () => {
  const described = makeProduct({
    description: '<p>Long authored description.</p>',
    shortDescription: 'Short one.',
  });

  it('defaults to structured-only and leaves descriptions empty', () => {
    const { records } = readCsv(exportWooCommerceCsv([described]).csv);
    expect(records[0]?.Description).toBe('');
    expect(records[0]?.['Short description']).toBe('');
    expect(records[0]?.Name).not.toBe('');
  });

  it('includes descriptions and a source URL in reference mode', () => {
    const { header, records } = readCsv(
      exportWooCommerceCsv([described], { contentMode: 'reference' }).csv
    );

    expect(records[0]?.Description).toBe('<p>Long authored description.</p>');
    expect(header).toContain('Meta: _proc123_source_url');
    expect(records[0]?.['Meta: _proc123_source_url']).toBe(described.sourceUrl);
  });
});

describe('verified importer traps', () => {
  it('never writes an empty "In stock?" cell — empty imports as out of stock', () => {
    const result = exportWooCommerceCsv([makeProduct()]);
    const { records } = readCsv(result.csv);

    expect(records[0]?.['In stock?']).toBe('1');
    expect(result.warnings.some((w) => w.code === 'stock-status-assumed')).toBe(true);
  });

  it('honours a known stock status without warning', () => {
    const result = exportWooCommerceCsv([makeProduct({ inStock: false, stockQuantity: 0 })]);
    const { records } = readCsv(result.csv);

    expect(records[0]?.['In stock?']).toBe('0');
    expect(records[0]?.Stock).toBe('0');
    expect(result.warnings.some((w) => w.code === 'stock-status-assumed')).toBe(false);
  });

  it('never writes an empty "Published" cell — empty imports as draft', () => {
    const { records } = readCsv(exportWooCommerceCsv([makeProduct()]).csv);
    expect(records[0]?.Published).not.toBe('');
  });

  it('always writes a valid "Visibility in catalog" — empty throws on import', () => {
    const { records } = readCsv(exportWooCommerceCsv(variableProduct()).csv);
    for (const record of records) expect(record['Visibility in catalog']).toBe('visible');
  });

  it('escapes a literal backslash-n so descriptions do not sprout newlines', () => {
    const { records } = readCsv(
      exportWooCommerceCsv([makeProduct({ description: 'a\\nb' })], { contentMode: 'reference' })
        .csv
    );
    expect(records[0]?.Description).toBe('a\\\\nb');
  });

  it('drops orphan variations rather than creating placeholder products', () => {
    const result = exportWooCommerceCsv([
      makeProduct({ kind: 'variation', parentSku: 'NOT-IN-THIS-FILE', name: 'Orphan' }),
    ]);

    expect(readCsv(result.csv).rows).toHaveLength(0);
    expect(result.warnings.some((w) => w.code === 'orphan-variation')).toBe(true);
  });

  it('can keep orphan variations when the user insists', () => {
    const result = exportWooCommerceCsv(
      [makeProduct({ kind: 'variation', parentSku: 'NOT-IN-THIS-FILE', name: 'Orphan' })],
      { onOrphanVariation: 'keep' }
    );
    expect(readCsv(result.csv).rows).toHaveLength(1);
  });

  it('aligns a cosmetically different variation value to the parent spelling', () => {
    // A non-breaking space on the parent and a normal space on the variation is
    // a byte-level mismatch that WooCommerce would never resolve.
    const nbsp = String.fromCodePoint(0x00a0);
    const result = exportWooCommerceCsv([
      makeProduct({
        sourceUrl: PAGE,
        kind: 'variable',
        attributes: [{ name: 'وزن', values: [`500${nbsp}گرم`], isVariationAxis: true }],
      }),
      makeProduct({
        sourceUrl: PAGE,
        kind: 'variation',
        attributes: [{ name: 'وزن', values: ['500 گرم'], isVariationAxis: true }],
      }),
    ]);

    const { records } = readCsv(result.csv);
    expect(records[1]?.['Attribute 1 value(s)']).toBe(records[0]?.['Attribute 1 value(s)']);
  });

  it('adds a missing variation value to the parent so the variation works', () => {
    const result = exportWooCommerceCsv([
      makeProduct({
        sourceUrl: PAGE,
        kind: 'variable',
        attributes: [{ name: 'Size', values: ['S'], isVariationAxis: true }],
      }),
      makeProduct({
        sourceUrl: PAGE,
        kind: 'variation',
        attributes: [{ name: 'Size', values: ['XL'], isVariationAxis: true }],
      }),
    ]);

    const { records } = readCsv(result.csv);
    expect(records[0]?.['Attribute 1 value(s)']).toBe('S, XL');
    expect(result.warnings.some((w) => w.code === 'variation-value-added-to-parent')).toBe(true);
  });

  it('reports instead of repairing when repair is disabled', () => {
    const result = exportWooCommerceCsv(
      [
        makeProduct({
          sourceUrl: PAGE,
          kind: 'variable',
          attributes: [{ name: 'Size', values: ['S'], isVariationAxis: true }],
        }),
        makeProduct({
          sourceUrl: PAGE,
          kind: 'variation',
          attributes: [{ name: 'Size', values: ['XL'], isVariationAxis: true }],
        }),
      ],
      { repairVariationValues: false }
    );

    expect(readCsv(result.csv).records[0]?.['Attribute 1 value(s)']).toBe('S');
    expect(result.warnings.some((w) => w.code === 'variation-value-not-on-parent')).toBe(true);
  });

  it('corrects a parent type that contradicts its variation rows', () => {
    const result = exportWooCommerceCsv([
      makeProduct({ sourceUrl: PAGE, kind: 'simple' }),
      makeProduct({
        sourceUrl: PAGE,
        kind: 'variation',
        attributes: [{ name: 'Size', values: ['S'], isVariationAxis: true }],
      }),
    ]);

    expect(readCsv(result.csv).records[0]?.Type).toBe('variable');
    expect(result.warnings.some((w) => w.code === 'parent-type-corrected')).toBe(true);
  });

  it('numbers variation positions so source order survives', () => {
    const { records } = readCsv(exportWooCommerceCsv(variableProduct()).csv);
    expect(records[0]?.Position).toBe('');
    expect(records[1]?.Position).toBe('0');
    expect(records[2]?.Position).toBe('1');
  });
});

describe('export result', () => {
  it('reports row counts and stats', () => {
    const result = exportWooCommerceCsv([
      ...variableProduct(),
      makeProduct({ sourceUrl: 'https://shop.example/simple' }),
    ]);

    expect(result.rowCount).toBe(4);
    expect(result.stats.simple).toBe(1);
    expect(result.stats.variable).toBe(1);
    expect(result.stats.variation).toBe(2);
    expect(result.stats.skusGenerated).toBe(4);
    expect(result.stats.attributeColumns).toBe(1);
    expect(result.columns).toHaveLength(readCsv(result.csv).header.length);
  });

  it('handles an empty catalogue without producing a broken file', () => {
    const result = exportWooCommerceCsv([]);
    const { header, rows } = readCsv(result.csv);

    expect(rows).toHaveLength(0);
    expect(header).toContain('SKU');
    expect(result.rowCount).toBe(0);
  });

  it('produces rows that all match the header width', () => {
    const { header, rows } = readCsv(
      exportWooCommerceCsv([
        ...variableProduct(),
        makeProduct({
          sourceUrl: 'https://shop.example/shirt',
          attributes: [
            { name: 'Color', values: ['Red', 'Blue'], isVariationAxis: false },
            { name: 'Size', values: ['L'], isVariationAxis: false },
          ],
        }),
      ]).csv
    );

    for (const row of rows) expect(row).toHaveLength(header.length);
  });
});
