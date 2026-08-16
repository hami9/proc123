/**
 * The user's settings, in `chrome.storage.local`.
 *
 * CLAUDE.md §9: "Everything here must also be settable from the extension
 * popup — most users will never open the JSON." So the popup is the primary
 * surface and the JSON is the escape hatch, not the other way round; the same
 * `Proc123Config` backs both.
 */

import { type Proc123Config, parseConfig, resolveConfig, serializeConfig } from '@proc123/core';

const KEY = 'proc123.config';

/**
 * The AI key lives under its own storage key, never inside the config.
 *
 * CLAUDE.md §4: "never hard-code or commit a key." The config is the thing
 * users export, paste into issues and check into repositories — `saveSettings`
 * writes it as JSON and `resolveConfig` already refuses an `apiKey` found in a
 * file. Keeping the key in a separate entry means no code path can serialise it
 * by accident, because `serializeConfig` is never handed it in the first place.
 */
const API_KEY = 'proc123.apiKey';

export async function loadSettings(): Promise<Proc123Config> {
  const stored = await chrome.storage.local.get(KEY);
  const raw = stored[KEY];
  // A stored config that this build cannot read falls back to the defaults
  // rather than failing the scan — settings are not worth losing a scan over.
  return typeof raw === 'string' ? parseConfig(raw).config : resolveConfig(undefined).config;
}

export async function saveSettings(config: Proc123Config): Promise<void> {
  await chrome.storage.local.set({ [KEY]: serializeConfig(config) });
}

/** The user's own AI key, or `''` when they have not set one. */
export async function loadApiKey(): Promise<string> {
  const stored = await chrome.storage.local.get(API_KEY);
  const raw = stored[API_KEY];
  return typeof raw === 'string' ? raw : '';
}

export async function saveApiKey(key: string): Promise<void> {
  const trimmed = key.trim();
  if (trimmed === '') {
    await chrome.storage.local.remove(API_KEY);
    return;
  }
  await chrome.storage.local.set({ [API_KEY]: trimmed });
}

/** Import a `proc123.config.json` a user pasted, reporting what it could not use. */
export async function importSettings(
  json: string
): Promise<{ config: Proc123Config; problems: string[] }> {
  const result = parseConfig(json);
  await saveSettings(result.config);
  return result;
}
