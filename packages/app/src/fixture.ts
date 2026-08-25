/**
 * A saved scan, so the shell has something real to render.
 *
 * Phase 15 does not fetch — that is phase 16 — but "renders a real scan result"
 * has to mean a genuine `CanonicalProduct[]` rather than a hand-written table,
 * or the shell proves nothing about whether the model actually displays.
 *
 * These are `CanonicalProduct` values exactly as `core` produces them: a
 * variable parent with empty prices (§7.5) followed by its own variations
 * (§7.4), linked by SKU (§7.2), with the attribute values spelled identically
 * on both (§7.6). The prices are IRR with **no unit stated**, which is the case
 * §7.8 exists for and the reason the currency step is on this screen.
 */

import type { CanonicalProduct } from '@proc123/core';

const SCANNED_AT = '2026-08-25T09:00:00.000Z';

function meta(): CanonicalProduct['extractionMeta'] {
  return { layer: 'B', fieldConfidence: { name: 0.95 }, scannedAt: SCANNED_AT };
}

export const FIXTURE_PRODUCTS: CanonicalProduct[] = [
  {
    sourceUrl: 'https://ajil.example/product/walnut/',
    kind: 'variable',
    sku: 'P123-2bqlwer6',
    name: 'گردو ممتاز',
    categoryPath: ['آجیل', 'گردو'],
    images: ['https://ajil.example/img/walnut.jpg'],
    // The parent lists every option; each variation carries exactly one, and
    // the strings match character-for-character (§7.6).
    attributes: [
      { name: 'وزن', values: ['۵۰۰ گرم', '۱ کیلوگرم', '۲ کیلوگرم'], isVariationAxis: true },
    ],
    extractionMeta: meta(),
  },
  {
    sourceUrl: 'https://ajil.example/product/walnut/?attribute_pa_weight=500g',
    kind: 'variation',
    sku: 'WAL-500',
    parentSku: 'P123-2bqlwer6',
    name: 'گردو ممتاز',
    // No `unit` on purpose. The shop said IRR and never said which unit, which
    // is exactly the unanswered question the confirmation step asks.
    regularPrice: { amount: 460000, currency: 'IRR' },
    salePrice: { amount: 420000, currency: 'IRR' },
    inStock: true,
    stockQuantity: 14,
    categoryPath: ['آجیل', 'گردو'],
    images: ['https://ajil.example/img/walnut-500.jpg'],
    attributes: [{ name: 'وزن', values: ['۵۰۰ گرم'], isVariationAxis: true }],
    weight: { value: 0.5, unit: 'kg' },
    extractionMeta: meta(),
  },
  {
    sourceUrl: 'https://ajil.example/product/walnut/?attribute_pa_weight=1kg',
    kind: 'variation',
    sku: 'WAL-1000',
    parentSku: 'P123-2bqlwer6',
    name: 'گردو ممتاز',
    regularPrice: { amount: 810000, currency: 'IRR' },
    inStock: true,
    stockQuantity: 6,
    categoryPath: ['آجیل', 'گردو'],
    images: ['https://ajil.example/img/walnut-1000.jpg'],
    attributes: [{ name: 'وزن', values: ['۱ کیلوگرم'], isVariationAxis: true }],
    weight: { value: 1, unit: 'kg' },
    extractionMeta: meta(),
  },
  {
    sourceUrl: 'https://ajil.example/product/pistachio/',
    kind: 'simple',
    sku: 'PIS-001',
    name: 'پسته اکبری',
    regularPrice: { amount: 1250000, currency: 'IRR' },
    inStock: false,
    categoryPath: ['آجیل', 'پسته'],
    images: ['https://ajil.example/img/pistachio.jpg'],
    attributes: [],
    extractionMeta: meta(),
  },
];

/** What the header line reports, mirroring the extension's `ScanSummary`. */
export const FIXTURE_SUMMARY = {
  url: 'https://ajil.example/shop/nuts/',
  layer: 'B' as const,
  platform: 'woocommerce',
  pagesScanned: 3,
};
