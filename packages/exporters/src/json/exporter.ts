/**
 * The generic JSON exporter.
 *
 * The other two exporters answer "how does this shop want to be fed?". This one
 * answers a different question: "what did proc123 actually find?" — for
 * somebody writing their own importer, diffing two scans, or filing a bug about
 * a field that came out wrong.
 *
 * So it is the one exporter that does **not** reshape anything. No column
 * mapping, no unit assumptions, no invented defaults. `Money` keeps its
 * `unit: undefined` when the page never said toman or rial, because that
 * unanswered question is exactly what a person debugging a 10x error needs to
 * see — a CSV has to pick one, and this does not.
 *
 * What it adds is provenance: the confidence and layer behind every field,
 * which the CSVs have no column for and which is the whole audit trail §11
 * asks the pipeline to keep.
 */

import type { CanonicalProduct } from '@proc123/core';

export interface JsonExportOptions {
  /** Pretty-print. Default `true` — this is meant to be read. */
  pretty?: boolean;
  /**
   * Include `extractionMeta` per product. Default `true`.
   *
   * The reason to turn it off is feeding another system that would choke on
   * unexpected keys, not size.
   */
  includeMeta?: boolean;
  /** Stamped into the envelope so a file can be traced back to a scan. */
  scannedUrl?: string;
  generatedAt?: string;
}

/**
 * A product as written.
 *
 * Meta-less rather than `CanonicalProduct` with an empty `extractionMeta`,
 * because a reader should be able to tell "provenance was not exported" from
 * "the pipeline found nothing" — an empty meta block claims the second.
 */
export type ExportedProduct = CanonicalProduct | Omit<CanonicalProduct, 'extractionMeta'>;

export interface JsonExportEnvelope {
  /** Bumped when the shape changes in a way a reader must notice. */
  format: 'proc123-products';
  version: 1;
  generatedAt: string;
  scannedUrl?: string;
  counts: {
    products: number;
    variations: number;
  };
  products: ExportedProduct[];
}

export interface JsonExportResult {
  json: string;
  envelope: JsonExportEnvelope;
  rowCount: number;
}

/**
 * Sort keys so two scans of the same shop produce comparable files.
 *
 * `JSON.stringify` emits keys in insertion order, which for these objects is
 * whichever layer happened to fill each field first — so the same catalogue
 * scanned twice can produce two files that differ only in key order and defeat
 * a diff. This is the same reasoning as `prompt-caching`'s deterministic
 * serialisation, for a different reason.
 */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value !== 'object' || value === null) return value;

  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    // `undefined` is dropped by JSON.stringify anyway; dropping it here keeps
    // the sorted object honest about what it contains.
    if (source[key] === undefined) continue;
    out[key] = sortKeys(source[key]);
  }
  return out;
}

export function exportJson(
  products: readonly CanonicalProduct[],
  options: JsonExportOptions = {}
): JsonExportResult {
  const variations = products.filter((product) => product.kind === 'variation').length;

  const cleaned: ExportedProduct[] = products.map((product) => {
    if (options.includeMeta !== false) return product;
    const copy: Partial<CanonicalProduct> = { ...product };
    delete copy.extractionMeta;
    return copy as Omit<CanonicalProduct, 'extractionMeta'>;
  });

  const envelope: JsonExportEnvelope = {
    format: 'proc123-products',
    version: 1,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    ...(options.scannedUrl === undefined ? {} : { scannedUrl: options.scannedUrl }),
    counts: {
      products: products.length - variations,
      variations,
    },
    products: cleaned,
  };

  const sorted = sortKeys(envelope);
  const json = JSON.stringify(sorted, null, options.pretty === false ? undefined : 2);

  return { json: `${json}\n`, envelope, rowCount: products.length };
}
