/**
 * The popup ↔ service worker protocol.
 *
 * Kept explicit and narrow. The popup can be closed at any moment and the
 * worker can be killed at any moment, so every message has to be meaningful on
 * its own rather than relying on a live conversation.
 */

import type { CrawlStatus, CurrencyUnit, ExporterName, ExtractionIssue } from '@proc123/core';
import { isExporterName } from '@proc123/exporters';

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
  /**
   * Overrides the configured exporter for this download only, so the same scan
   * can be taken to two shops without changing settings.
   */
  exporter?: ExporterName;
}

export interface TeachRequest {
  kind: 'teach';
  tabId: number;
  url: string;
}

/**
 * "Why is this field empty?" (§11).
 *
 * `tabId` is optional because the report is worth having even when the tab has
 * been closed — everything but the profile health check reads from the saved
 * crawl. When a tab is available, the page is re-read so a taught profile can
 * be checked against the markup as it stands today.
 */
export interface ReportRequest {
  kind: 'report';
  url: string;
  tabId?: number;
}

export type ExtensionRequest =
  ScanRequest | LastResultRequest | ExportRequest | TeachRequest | ReportRequest;

export interface ExportedReport {
  filename: string;
  /** The readable report. */
  text: string;
  /** The structured log, as JSON lines, for whoever is helping. */
  log: string;
  /** Shown in the popup without downloading anything. */
  summary: string;
}

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
  /** The file's text. Named `csv` from when that was the only kind. */
  csv: string;
  /** So the popup can hand the blob the right type — JSON is not `text/csv`. */
  mimeType?: string;
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
  | { ok: true; kind: 'report'; report: ExportedReport }
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
    (candidate.displayUnit === 'toman' || candidate.displayUnit === 'rial') &&
    (candidate.exporter === undefined || isExporterName(candidate.exporter))
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

export function isReportRequest(message: unknown): message is ReportRequest {
  if (typeof message !== 'object' || message === null) return false;
  const candidate = message as Partial<ReportRequest>;
  return candidate.kind === 'report' && typeof candidate.url === 'string';
}

export function isLastResultRequest(message: unknown): message is LastResultRequest {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as Partial<LastResultRequest>).kind === 'last-result'
  );
}
