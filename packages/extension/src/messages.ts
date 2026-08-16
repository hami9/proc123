/**
 * The popup ↔ service worker protocol.
 *
 * Kept explicit and narrow. The popup can be closed at any moment and the
 * worker can be killed at any moment, so every message has to be meaningful on
 * its own rather than relying on a live conversation.
 */

import type { CrawlStatus, CurrencyUnit, ExtractionIssue } from '@proc123/core';

export interface ScanRequest {
  kind: 'scan';
  tabId: number;
  url: string;
  /** False when the user declined the host permission: first page only. */
  canFetch: boolean;
  /** Start over rather than resuming a saved crawl for this URL. */
  restart?: boolean;
}

export interface LastResultRequest {
  kind: 'last-result';
}

export interface ExportRequest {
  kind: 'export';
  /** The scan to export, identified by the page it started from. */
  url: string;
  /**
   * Which unit IRR prices are written in. The popup asks the user before this
   * is sent, because reading toman as rial is a silent 10x error (§7.8).
   */
  displayUnit: CurrencyUnit;
}

export interface TeachRequest {
  kind: 'teach';
  tabId: number;
  url: string;
}

export type ExtensionRequest = ScanRequest | LastResultRequest | ExportRequest | TeachRequest;

export interface TeachResult {
  /** The profile that was learned and saved, if any. */
  domain?: string;
  /** How many product cards the learned selector matched. */
  cardCount: number;
  /** Everything the user should know before trusting it. */
  warnings: string[];
  cancelled: boolean;
}

export interface ExportedCsv {
  filename: string;
  csv: string;
  rowCount: number;
  /** Every assumption and repair the exporter had to make. */
  warnings: { code: string; message: string }[];
}

/** What the popup shows. Deliberately small — it is written to storage too. */
export interface ScanSummary {
  url: string;
  title: string;
  /** Which layer answered: the store's own API, the page's markup, or a profile. */
  layer: 'A' | 'B' | 'C';
  platform: string;
  /** Rows that would be written, variations included. */
  rowCount: number;
  /** Products a person would recognise as products. */
  productCount: number;
  variationCount: number;
  duplicates: number;
  pagesScanned: number;
  requests: number;
  status: CrawlStatus;
  /** Worth showing: errors and warnings, most severe first. */
  issues: ExtractionIssue[];
  /** True when a saved crawl was picked up rather than started. */
  resumed: boolean;
  /**
   * How the prices were quoted, e.g. `{ toman: 42, unknown: 5 }`. Shown before
   * export so the user can confirm the unit rather than discover it afterwards
   * in the target store (CLAUDE.md §7.8).
   */
  currencyUnits: Record<string, number>;
  finishedAt: string;
}

export type ExtensionResponse =
  | { ok: true; kind: 'summary'; summary: ScanSummary | undefined }
  | { ok: true; kind: 'download'; download: ExportedCsv }
  | { ok: true; kind: 'taught'; taught: TeachResult }
  | { ok: false; message: string };

export function isScanRequest(message: unknown): message is ScanRequest {
  if (typeof message !== 'object' || message === null) return false;
  const candidate = message as Partial<ScanRequest>;
  return (
    candidate.kind === 'scan' &&
    typeof candidate.tabId === 'number' &&
    typeof candidate.url === 'string'
  );
}

export function isExportRequest(message: unknown): message is ExportRequest {
  if (typeof message !== 'object' || message === null) return false;
  const candidate = message as Partial<ExportRequest>;
  return (
    candidate.kind === 'export' &&
    typeof candidate.url === 'string' &&
    (candidate.displayUnit === 'toman' || candidate.displayUnit === 'rial')
  );
}

export function isTeachRequest(message: unknown): message is TeachRequest {
  if (typeof message !== 'object' || message === null) return false;
  const candidate = message as Partial<TeachRequest>;
  return (
    candidate.kind === 'teach' &&
    typeof candidate.tabId === 'number' &&
    typeof candidate.url === 'string'
  );
}

export function isLastResultRequest(message: unknown): message is LastResultRequest {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as Partial<LastResultRequest>).kind === 'last-result'
  );
}
