/**
 * The popup ↔ service worker protocol.
 *
 * Kept explicit and narrow. The popup can be closed at any moment and the
 * worker can be killed at any moment, so every message has to be meaningful on
 * its own rather than relying on a live conversation.
 */

import type { CrawlStatus, ExtractionIssue } from '@proc123/core';

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

export type ExtensionRequest = ScanRequest | LastResultRequest;

/** What the popup shows. Deliberately small — it is written to storage too. */
export interface ScanSummary {
  url: string;
  title: string;
  /** Which layer answered: the store's own API, or the page's markup. */
  layer: 'A' | 'B';
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
  finishedAt: string;
}

export type ExtensionResponse =
  | { ok: true; summary: ScanSummary }
  | { ok: true; summary: undefined }
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

export function isLastResultRequest(message: unknown): message is LastResultRequest {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as Partial<LastResultRequest>).kind === 'last-result'
  );
}
