import type { CanonicalProduct } from '@proc123/core';

/**
 * Build a `CanonicalProduct` for tests without restating the boilerplate.
 *
 * Overrides explicitly set to `undefined` are ignored rather than written, so
 * the result satisfies `exactOptionalPropertyTypes`.
 */
export function makeProduct(overrides: Partial<CanonicalProduct> = {}): CanonicalProduct {
  const product: CanonicalProduct = {
    sourceUrl: 'https://shop.example/product/walnut',
    kind: 'simple',
    name: 'Walnut',
    categoryPath: [],
    images: [],
    attributes: [],
    extractionMeta: {
      layer: 'B',
      fieldConfidence: {},
      scannedAt: '2026-08-13T00:00:00.000Z',
    },
  };

  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) Object.assign(product, { [key]: value });
  }
  return product;
}
