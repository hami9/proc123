import { describe, expect, it } from 'vitest';

import {
  type JsonObject,
  isProductNode,
  isType,
  normalizeType,
  readAdditionalProperties,
  readAvailability,
  readCategoryPath,
  readDimension,
  readGtin,
  readImages,
  readKeywords,
  readName,
  readOffers,
  readWeight,
} from '@proc123/core';

const PAGE = 'https://shop.example/product/walnut/';

describe('normalizeType', () => {
  it('accepts every spelling of a schema.org type', () => {
    expect(normalizeType('Product')).toBe('product');
    expect(normalizeType('https://schema.org/Product')).toBe('product');
    expect(normalizeType('http://schema.org/Product')).toBe('product');
    expect(normalizeType('schema:Product')).toBe('product');
    expect(normalizeType('  ProductGroup ')).toBe('productgroup');
  });
});

describe('isType / isProductNode', () => {
  it('reads a single type or a list of them', () => {
    expect(isType({ '@type': 'Product' }, 'product')).toBe(true);
    expect(isType({ '@type': ['Product', 'Book'] }, 'book')).toBe(true);
    expect(isType({ '@type': 'Offer' }, 'product')).toBe(false);
    expect(isType({}, 'product')).toBe(false);
  });

  it('does not mistake an Organization with offers for a product', () => {
    expect(isProductNode({ '@type': 'Organization', offers: { price: '1' } })).toBe(false);
    expect(isProductNode({ '@type': 'https://schema.org/ProductGroup' })).toBe(true);
  });
});

describe('readImages', () => {
  it('resolves relative URLs and accepts ImageObjects', () => {
    const images = readImages(
      [
        '/img/a.jpg',
        { '@type': 'ImageObject', url: 'https://cdn.example/b.jpg' },
        { '@type': 'ImageObject', contentUrl: '//cdn.example/c.jpg' },
      ],
      PAGE
    );

    expect(images).toEqual([
      'https://shop.example/img/a.jpg',
      'https://cdn.example/b.jpg',
      'https://cdn.example/c.jpg',
    ]);
  });

  it('dedupes while keeping the first image first', () => {
    expect(readImages(['/a.jpg', '/a.jpg', '/b.jpg'], PAGE)).toEqual([
      'https://shop.example/a.jpg',
      'https://shop.example/b.jpg',
    ]);
  });

  it('drops URLs the target store could never fetch', () => {
    expect(
      readImages(['data:image/gif;base64,R0lGOD', 'javascript:void(0)', 'mailto:a@b.c'], PAGE)
    ).toEqual([]);
  });
});

describe('readName', () => {
  it('reads a bare string or a named node', () => {
    expect(readName('Acme')).toBe('Acme');
    expect(readName({ '@type': 'Brand', name: 'Acme' })).toBe('Acme');
    expect(readName([{ '@type': 'Brand' }, { name: 'Second' }])).toBe('Second');
    expect(readName({})).toBeUndefined();
  });
});

describe('readGtin', () => {
  it('prefers gtin13 and strips separators', () => {
    expect(readGtin({ gtin13: '626-000-000-0017', gtin8: '12345678' })).toBe('6260000000017');
  });

  it('refuses a placeholder, because a fabricated GTIN blocks the import', () => {
    expect(readGtin({ gtin13: 'N/A' })).toBeUndefined();
    expect(readGtin({ gtin13: '' })).toBeUndefined();
    expect(readGtin({ gtin: '12345' })).toBeUndefined();
  });
});

describe('readCategoryPath', () => {
  it('splits a path written with >', () => {
    expect(readCategoryPath('آجیل > گردو')).toEqual(['آجیل', 'گردو']);
  });

  it('takes the deepest path when several are offered', () => {
    expect(readCategoryPath(['Nuts', 'Nuts > Walnuts > Shelled'])).toEqual([
      'Nuts',
      'Walnuts',
      'Shelled',
    ]);
  });

  it('reads a Thing with a name', () => {
    expect(readCategoryPath({ '@type': 'Thing', name: 'Spices > Saffron' })).toEqual([
      'Spices',
      'Saffron',
    ]);
  });

  it('returns nothing rather than an empty segment', () => {
    expect(readCategoryPath('  >  ')).toEqual([]);
    expect(readCategoryPath(undefined)).toEqual([]);
  });
});

describe('readWeight / readDimension', () => {
  it('reads a QuantitativeValue by unitCode', () => {
    expect(readWeight({ '@type': 'QuantitativeValue', value: 500, unitCode: 'GRM' })).toEqual({
      value: 500,
      unit: 'g',
    });
    expect(readDimension({ value: '26', unitCode: 'CMT' })).toEqual({ value: 26, unit: 'cm' });
  });

  it('reads unitText and the plain strings sites write instead', () => {
    expect(readWeight({ value: 1.5, unitText: 'kilograms' })).toEqual({ value: 1.5, unit: 'kg' });
    expect(readWeight('500 g')).toEqual({ value: 500, unit: 'g' });
    expect(readWeight('۵۰۰ گرم')).toEqual({ value: 500, unit: 'g' });
    expect(readDimension('5cm')).toEqual({ value: 5, unit: 'cm' });
    expect(readDimension('12 inches')).toEqual({ value: 12, unit: 'in' });
  });

  it('reads a measurement separator as a decimal point, not as thousands', () => {
    // The opposite of the price rule: 1.500 kg is a kilo and a half.
    expect(readWeight('1.500 kg')).toEqual({ value: 1.5, unit: 'kg' });
  });

  it('refuses a number with no unit, because 500 of nothing is not a weight', () => {
    expect(readWeight({ value: 500 })).toBeUndefined();
    expect(readWeight('500')).toBeUndefined();
    expect(readDimension({ value: 26, unitCode: 'GRM' })).toBeUndefined();
  });
});

describe('readAdditionalProperties', () => {
  it('folds repeated names into one attribute', () => {
    expect(
      readAdditionalProperties([
        { '@type': 'PropertyValue', name: 'Origin', value: 'Hamedan' },
        { '@type': 'PropertyValue', name: 'Origin', value: 'Toyserkan' },
        { '@type': 'PropertyValue', name: 'Origin', value: 'Hamedan' },
      ])
    ).toEqual([{ name: 'Origin', values: ['Hamedan', 'Toyserkan'], isVariationAxis: false }]);
  });

  it('skips entries with no name or no value', () => {
    expect(
      readAdditionalProperties([{ value: 'orphan' }, { name: 'Empty' }, { name: 'Ok', value: '1' }])
    ).toEqual([{ name: 'Ok', values: ['1'], isVariationAxis: false }]);
  });
});

describe('readKeywords', () => {
  it('splits a comma-separated string and an array alike', () => {
    expect(readKeywords('گردو, آجیل ,خشکبار')).toEqual(['گردو', 'آجیل', 'خشکبار']);
    expect(readKeywords(['a', 'b,c', 'a'])).toEqual(['a', 'b', 'c']);
  });
});

describe('readAvailability', () => {
  it('maps every spelling in use', () => {
    expect(readAvailability('https://schema.org/InStock')).toBe(true);
    expect(readAvailability('InStock')).toBe(true);
    expect(readAvailability('in_stock')).toBe(true);
    expect(readAvailability('in stock')).toBe(true);
    expect(readAvailability('LimitedAvailability')).toBe(true);
    expect(readAvailability('http://schema.org/OutOfStock')).toBe(false);
    expect(readAvailability('SoldOut')).toBe(false);
    expect(readAvailability('oos')).toBe(false);
    expect(readAvailability('Discontinued')).toBe(false);
  });

  it('treats pre-order and back-order as available, since the store is selling them', () => {
    expect(readAvailability('https://schema.org/PreOrder')).toBe(true);
    expect(readAvailability('BackOrder')).toBe(true);
  });

  it('says nothing when the page says nothing', () => {
    expect(readAvailability(undefined)).toBeUndefined();
    expect(readAvailability('perhaps')).toBeUndefined();
  });
});

describe('readOffers', () => {
  const offer = (extra: JsonObject): JsonObject => ({
    '@type': 'Offer',
    priceCurrency: 'IRR',
    ...extra,
  });

  it('reads a plain offer', () => {
    const reading = readOffers(offer({ price: '150000', availability: 'InStock', sku: 'W1' }), {});

    expect(reading?.regularPrice).toEqual({ amount: 150000, currency: 'IRR' });
    expect(reading?.salePrice).toBeUndefined();
    expect(reading?.inStock).toBe(true);
    expect(reading?.sku).toBe('W1');
    expect(reading?.priceIsRange).toBe(false);
  });

  it('reads a ListPrice priceSpecification as the was/now pair', () => {
    const reading = readOffers(
      offer({
        price: '1350000',
        priceSpecification: [
          {
            '@type': 'UnitPriceSpecification',
            priceType: 'https://schema.org/ListPrice',
            price: '1500000',
          },
        ],
      }),
      {}
    );

    expect(reading?.regularPrice?.amount).toBe(1500000);
    expect(reading?.salePrice?.amount).toBe(1350000);
  });

  it('ignores a list price that is not actually higher', () => {
    const reading = readOffers(
      offer({
        price: '1500000',
        priceSpecification: { priceType: 'ListPrice', price: '1500000' },
      }),
      {}
    );

    expect(reading?.regularPrice?.amount).toBe(1500000);
    expect(reading?.salePrice).toBeUndefined();
  });

  it('reports an AggregateOffer range instead of passing off its low end as a price', () => {
    const reading = readOffers(
      {
        '@type': 'AggregateOffer',
        lowPrice: '1800000',
        highPrice: '3400000',
        priceCurrency: 'IRR',
        offerCount: 3,
      },
      {}
    );

    expect(reading?.regularPrice?.amount).toBe(1800000);
    expect(reading?.priceIsRange).toBe(true);
    expect(reading?.priceRange).toEqual({ low: 1800000, high: 3400000 });
  });

  it('prefers the members of an AggregateOffer over its summary', () => {
    const reading = readOffers(
      {
        '@type': 'AggregateOffer',
        lowPrice: '999',
        priceCurrency: 'IRR',
        offers: [
          offer({ price: '520000', sku: 'L', availability: 'OutOfStock' }),
          offer({ price: '480000', sku: 'S', availability: 'InStock' }),
        ],
      },
      {}
    );

    expect(reading?.regularPrice?.amount).toBe(480000);
    expect(reading?.priceRange).toEqual({ low: 480000, high: 520000 });
    // One buyable variation makes the product buyable.
    expect(reading?.inStock).toBe(true);
  });

  it('reads inventoryLevel', () => {
    const reading = readOffers(
      offer({ price: '1', inventoryLevel: { '@type': 'QuantitativeValue', value: 12 } }),
      {}
    );
    expect(reading?.stockQuantity).toBe(12);
  });

  it('leaves the toman/rial unit unset when only the ISO code is given', () => {
    const reading = readOffers(offer({ price: '150000' }), {});
    // IRR is not evidence of the unit: Iranian stores tag toman prices as IRR.
    expect(reading?.regularPrice?.unit).toBeUndefined();
    expect(reading?.unitFromSource).toBe(false);
  });

  it('takes the unit from the page when the page states it', () => {
    const reading = readOffers(offer({ price: '150000 تومان' }), {});
    expect(reading?.regularPrice).toEqual({ amount: 150000, currency: 'IRR', unit: 'toman' });
    expect(reading?.unitFromSource).toBe(true);
  });

  it('applies the caller default only when the page is silent', () => {
    const reading = readOffers(offer({ price: '150000' }), { defaultUnit: 'rial' });
    expect(reading?.regularPrice?.unit).toBe('rial');
    expect(reading?.unitFromSource).toBe(false);
  });

  it('reads a grouped price as thousands and says the reading was ambiguous', () => {
    const reading = readOffers(offer({ price: '1,250', priceCurrency: 'TRY' }), {});
    expect(reading?.regularPrice).toEqual({ amount: 1250, currency: 'TRY' });
    expect(reading?.ambiguousGrouping).toBe(true);
  });

  it('reads a decimal price without calling it ambiguous', () => {
    const reading = readOffers(offer({ price: '19.99', priceCurrency: 'EUR' }), {});
    expect(reading?.regularPrice).toEqual({ amount: 19.99, currency: 'EUR' });
    expect(reading?.ambiguousGrouping).toBe(false);
  });

  it('returns undefined when there is no offer at all', () => {
    expect(readOffers(undefined, {})).toBeUndefined();
    expect(readOffers([], {})).toBeUndefined();
    expect(readOffers({ '@type': 'Offer' }, {})).toBeUndefined();
  });

  it('keeps stock and SKU even when there is no price', () => {
    const reading = readOffers(offer({ availability: 'OutOfStock' }), {});
    expect(reading?.regularPrice).toBeUndefined();
    expect(reading?.inStock).toBe(false);
  });
});
