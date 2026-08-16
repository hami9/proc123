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

/** Import a `proc123.config.json` a user pasted, reporting what it could not use. */
export async function importSettings(
  json: string
): Promise<{ config: Proc123Config; problems: string[] }> {
  const result = parseConfig(json);
  await saveSettings(result.config);
  return result;
}
