/**
 * The popup.
 *
 * Two things it owns that the worker cannot:
 *
 * - **The permission prompt.** `chrome.permissions.request` only works inside a
 *   user gesture, so asking has to happen in the click handler. `activeTab`
 *   already covers reading the page the user is looking at; permission for the
 *   origin is only needed to fetch the *other* pages of the category, so the
 *   scan degrades to one page rather than failing if it is declined.
 * - **Surviving its own death.** A popup is destroyed the moment it loses
 *   focus, so on open it asks the worker for the last result instead of
 *   assuming it has none.
 */

import type { ExtensionResponse, ScanSummary } from './messages.js';

const element = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`missing #${id}`);
  return found as T;
};

const scanButton = element<HTMLButtonElement>('scan');
const rescanButton = element<HTMLButtonElement>('rescan');
const statusLine = element('status');
const pageLine = element('page');
const counts = element('counts');
const headline = element('headline');
const detail = element<HTMLDListElement>('detail');
const issueList = element<HTMLUListElement>('issues');

const STATUS_TEXT: Record<string, string> = {
  complete: 'Read the whole category.',
  'budget-reached': 'Stopped at the page limit — scan again to carry on.',
  'needs-browser': 'This category loads more as you scroll; only the loaded products were read.',
  blocked: 'The site blocks automated reading. The scan stopped.',
  running: 'Still running.',
};

function describeTab(tab: chrome.tabs.Tab): string {
  try {
    const url = new URL(tab.url ?? '');
    return `${url.hostname}${url.pathname}`;
  } catch {
    return 'No page open.';
  }
}

function originPattern(url: string): string | undefined {
  try {
    return `${new URL(url).origin}/*`;
  } catch {
    return undefined;
  }
}

function row(label: string, value: string): void {
  const dt = document.createElement('dt');
  dt.textContent = label;
  const dd = document.createElement('dd');
  dd.textContent = value;
  detail.append(dt, dd);
}

function render(summary: ScanSummary): void {
  counts.classList.add('shown');
  detail.replaceChildren();
  issueList.replaceChildren();

  const products = summary.productCount;
  headline.textContent = `${String(products)} product${products === 1 ? '' : 's'}`;

  const small = document.createElement('small');
  small.textContent =
    `${String(summary.rowCount)} CSV rows, including ${String(summary.variationCount)} variation` +
    `${summary.variationCount === 1 ? '' : 's'}`;
  headline.append(small);

  row('Read from', summary.layer === 'A' ? `${summary.platform} API` : 'page markup');
  row('Pages', String(summary.pagesScanned));
  if (summary.requests > 0) row('Requests', String(summary.requests));
  if (summary.duplicates > 0) row('Duplicates merged', String(summary.duplicates));
  if (summary.resumed) row('Resumed', 'carried on from a saved scan');

  statusLine.textContent = STATUS_TEXT[summary.status] ?? summary.status;

  for (const issue of summary.issues) {
    const item = document.createElement('li');
    item.className = issue.severity;
    item.textContent = issue.message;
    issueList.append(item);
  }

  rescanButton.hidden = false;
}

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function scan(restart: boolean): Promise<void> {
  const tab = await activeTab();
  if (tab?.id === undefined || tab.url === undefined) {
    statusLine.textContent = 'No page to scan.';
    return;
  }

  const pattern = originPattern(tab.url);
  if (pattern === undefined) {
    statusLine.textContent = 'This page cannot be scanned.';
    return;
  }

  // Asked here, inside the click, because that is the only place Chrome allows
  // it. Declining is a normal answer, not an error.
  let canFetch = await chrome.permissions.contains({ origins: [pattern] });
  if (!canFetch) {
    canFetch = await chrome.permissions.request({ origins: [pattern] });
  }

  scanButton.disabled = true;
  rescanButton.disabled = true;
  statusLine.textContent = canFetch
    ? 'Scanning…'
    : 'Scanning this page only — permission for the rest of the site was declined.';

  try {
    const response = await chrome.runtime.sendMessage<unknown, ExtensionResponse>({
      kind: 'scan',
      tabId: tab.id,
      url: tab.url,
      canFetch,
      restart,
    });

    if (!response.ok) {
      statusLine.textContent = response.message;
      return;
    }
    if (response.summary !== undefined) render(response.summary);
  } catch (error) {
    statusLine.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    scanButton.disabled = false;
    rescanButton.disabled = false;
  }
}

scanButton.addEventListener('click', () => {
  void scan(false);
});
rescanButton.addEventListener('click', () => {
  void scan(true);
});

void (async (): Promise<void> => {
  const tab = await activeTab();
  pageLine.textContent = tab === undefined ? 'No page open.' : describeTab(tab);

  // The popup may have been closed while the last scan was still running.
  const response = await chrome.runtime
    .sendMessage<unknown, ExtensionResponse>({ kind: 'last-result' })
    .catch(() => undefined);

  if (response?.ok === true && response.summary !== undefined) {
    if (response.summary.url === tab?.url) {
      render(response.summary);
      statusLine.textContent = `${STATUS_TEXT[response.summary.status] ?? ''} (last scan)`;
    }
  }
})();
