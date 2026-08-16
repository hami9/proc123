/**
 * What the three provider adapters have in common.
 *
 * One thing here is a correctness point rather than a convenience: **a 429 or a
 * 403 from an AI vendor is not a blocked site.** CLAUDE.md §2's rule is about
 * the *store* refusing to be read, and it ends the scan. An AI vendor rate
 * limiting our own account is an ordinary billing-shaped problem with the user's
 * own key; treating it as a §2 block would abandon a crawl that Layers A/B/C
 * were completing perfectly well. So these adapters never raise
 * `SiteBlockedError` — they report an `ai-failed` issue and let the scan carry
 * on without them.
 */

import type { HttpClient, HttpRequest } from '../../platform/http.js';
import type { ExtractionIssue } from '../../extract/types.js';
import type { AIExtractResult, AIUsage } from '../types.js';
import { emptyUsage } from '../types.js';

export interface ProviderOptions {
  /** From extension settings. Never read from a config file. */
  apiKey: string;
  client: HttpClient;
  model?: string;
  /** Override for a proxy or a self-hosted gateway. */
  baseUrl?: string;
}

export function aiIssue(message: string, url?: string): ExtractionIssue {
  return {
    severity: 'warning',
    code: 'ai-request-failed',
    kind: 'ai-failed',
    source: 'ai',
    message,
    ...(url === undefined ? {} : { url }),
  };
}

/** A failed call still reports its usage: a refused request may still bill. */
export function failed(usage: AIUsage, message: string, url?: string): AIExtractResult {
  return { fields: {}, usage, issues: [aiIssue(message, url)] };
}

/**
 * Describe a non-2xx response without ever echoing the request.
 *
 * The body is truncated hard: vendor error bodies are usually short, but an
 * HTML error page from a proxy is not, and this string ends up in a report the
 * user reads.
 */
export function describeStatus(provider: string, status: number, body: string): string {
  const detail = body.trim().slice(0, 300);
  if (status === 401 || status === 403) {
    return `${provider} rejected the API key (HTTP ${String(status)}). Check the key in settings.`;
  }
  if (status === 429) {
    return `${provider} is rate limiting this key (HTTP 429). This is not the shop blocking us; the scan continues without AI.`;
  }
  return `${provider} returned HTTP ${String(status)}${detail === '' ? '' : `: ${detail}`}`;
}

/**
 * Pull the JSON object out of a model's text answer.
 *
 * Structured-output mode should make this a plain `JSON.parse`, and usually
 * does. The fence-stripping fallback exists because a provider that silently
 * ignores the schema — an older model, a gateway that drops the parameter —
 * answers with a fenced code block instead, and losing the whole page's answer
 * to three backticks would be a poor trade.
 */
export function parseModelJson(text: string): Record<string, unknown> | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;

  const candidates = [trimmed];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced?.[1] !== undefined) candidates.push(fenced[1]);
  const braced = trimmed.slice(trimmed.indexOf('{'), trimmed.lastIndexOf('}') + 1);
  if (braced.startsWith('{')) candidates.push(braced);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      continue;
    }
  }
  return undefined;
}

/** Read a number out of a vendor's usage block, tolerating absence. */
export function usageNumber(source: unknown, ...names: string[]): number {
  if (typeof source !== 'object' || source === null) return 0;
  const record = source as Record<string, unknown>;
  for (const name of names) {
    const value = record[name];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return 0;
}

export interface CallOutcome {
  text?: string;
  usage: AIUsage;
  failure?: string;
}

/**
 * Issue one request and report the outcome, never throwing.
 *
 * A network error here is expected rather than exceptional — the user may be
 * offline, behind a captive portal, or running with the AI host blocked — and
 * an exception would take down a crawl that is otherwise fine.
 */
export async function callProvider(
  provider: string,
  model: string,
  client: HttpClient,
  request: HttpRequest,
  read: (body: unknown) => { text?: string; usage: AIUsage }
): Promise<CallOutcome> {
  const base = emptyUsage(provider, model);
  base.requests = 1;

  let response;
  try {
    response = await client(request);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { usage: base, failure: `${provider} could not be reached: ${detail}` };
  }

  if (response.status < 200 || response.status >= 300) {
    return {
      usage: base,
      failure: describeStatus(provider, response.status, response.body),
    };
  }

  let body: unknown;
  try {
    body = JSON.parse(response.body) as unknown;
  } catch {
    return { usage: base, failure: `${provider} returned a response that is not JSON.` };
  }

  const read_ = read(body);
  const usage: AIUsage = { ...read_.usage, requests: 1 };
  if (read_.text === undefined || read_.text.trim() === '') {
    return { usage, failure: `${provider} returned an empty answer.` };
  }
  return { text: read_.text, usage };
}
