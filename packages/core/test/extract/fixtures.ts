import { readFileSync } from 'node:fs';

import type { CanonicalProduct, PageContext } from '@proc123/core';

/** Fixtures are real files rather than template literals so they read like pages. */
export function fixture(name: string): string {
  return readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
}

export function page(name: string, url: string): PageContext {
  return { url, html: fixture(name) };
}

/** Fixed so `scannedAt` never makes a snapshot depend on the clock. */
export const SCANNED_AT = '2026-08-15T09:00:00.000Z';

export function byName(products: readonly CanonicalProduct[], name: string): CanonicalProduct {
  const found = products.find((product) => product.name === name);
  if (found === undefined) {
    throw new Error(
      `No product named ${JSON.stringify(name)}. Found: ${products
        .map((product) => JSON.stringify(product.name))
        .join(', ')}`
    );
  }
  return found;
}

export function issueCodes(issues: readonly { code: string }[]): string[] {
  return issues.map((issue) => issue.code);
}
