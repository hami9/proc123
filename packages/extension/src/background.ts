/**
 * The service worker: the only place in the extension that touches the network.
 *
 * It is also the only long-lived-ish thing here, and it is not very long-lived
 * — Chrome kills it when idle. Nothing is kept in memory between messages;
 * every scan reads and writes its state through `chrome.storage`.
 */

import { createFetchClient } from './http.js';
import { isLastResultRequest, isScanRequest } from './messages.js';
import type { ExtensionResponse, ScanSummary } from './messages.js';
import { runScan } from './scan.js';
import { createChromeCrawlStore, loadLastResult, saveLastResult } from './storage.js';

/**
 * Read the page as the user is seeing it.
 *
 * `document.documentElement.outerHTML` is the *rendered* DOM, which is the
 * whole argument for building this as an extension (CLAUDE.md §2): an SPA
 * storefront that ships an empty shell to a scraper is fully rendered here, for
 * free, in the user's own session.
 *
 * The function is serialized and injected, so it must close over nothing.
 */
async function readPage(tabId: number): Promise<{ url: string; html: string; title: string }> {
  const [injected] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({
      url: location.href,
      html: document.documentElement.outerHTML,
      title: document.title,
    }),
  });

  const result = injected?.result;
  if (result === undefined) {
    throw new Error('Could not read this tab. Try reloading the page and scanning again.');
  }
  return result;
}

async function handleScan(request: {
  tabId: number;
  canFetch: boolean;
  restart?: boolean;
}): Promise<ScanSummary> {
  const { url, html, title } = await readPage(request.tabId);

  const summary = await runScan(
    {
      page: { url, html },
      title,
      ...(request.restart === true ? { restart: true } : {}),
    },
    {
      // No permission for this origin means no requests to it — so the scan
      // reads the one page the user already has open and says so, rather than
      // asking again or reaching out anyway.
      ...(request.canFetch ? { http: createFetchClient() } : {}),
      store: createChromeCrawlStore(),
    }
  );

  await saveLastResult(summary);

  // CLAUDE.md §14 step 5 asks for exactly this, and it stays useful: the
  // worker's console is where a scan that went wrong is diagnosed.
  console.info(
    `[proc123] ${String(summary.rowCount)} rows ` +
      `(${String(summary.productCount)} products, ${String(summary.variationCount)} variations) ` +
      `from ${String(summary.pagesScanned)} page(s) via Layer ${summary.layer} ` +
      `on ${summary.platform} — ${summary.status}`
  );

  return summary;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (isScanRequest(message)) {
    handleScan(message).then(
      (summary) => {
        sendResponse({ ok: true, summary } satisfies ExtensionResponse);
      },
      (error: unknown) => {
        const text = error instanceof Error ? error.message : String(error);
        console.error('[proc123] scan failed', error);
        sendResponse({ ok: false, message: text } satisfies ExtensionResponse);
      }
    );
    // Keeps the channel open for the async reply above.
    return true;
  }

  if (isLastResultRequest(message)) {
    loadLastResult<ScanSummary>().then(
      (summary) => {
        sendResponse({ ok: true, summary } satisfies ExtensionResponse);
      },
      () => {
        sendResponse({ ok: true, summary: undefined } satisfies ExtensionResponse);
      }
    );
    return true;
  }

  return undefined;
});
