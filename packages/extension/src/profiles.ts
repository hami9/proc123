/**
 * Saved site profiles, in the browser's extension storage.
 *
 * Keyed by domain rather than by page, because that is what a profile is for:
 * teach one category page and every other category on the same store works.
 */

import { type SiteProfile, parseProfile, profileDomain, serializeProfile } from '@proc123/profiles';

import { storage } from './browser.js';

const PREFIX = 'proc123.profile.';

export async function loadProfile(domain: string): Promise<SiteProfile | undefined> {
  const key = PREFIX + profileDomain(domain);
  const stored = await storage.local.get(key);
  const raw = stored[key];
  if (typeof raw !== 'string') return undefined;

  try {
    return parseProfile(raw);
  } catch {
    // A profile this build cannot read is not a profile. Falling back to the
    // layers above it is better than failing the scan.
    return undefined;
  }
}

export async function saveProfile(profile: SiteProfile): Promise<void> {
  const key = PREFIX + profileDomain(profile.domain);
  await storage.local.set({ [key]: serializeProfile(profile) });
}

export async function deleteProfile(domain: string): Promise<void> {
  await storage.local.remove(PREFIX + profileDomain(domain));
}

/** Every saved profile, for an export-everything button and for the health check. */
export async function listProfiles(): Promise<SiteProfile[]> {
  const stored = await storage.local.get(null);
  const found: SiteProfile[] = [];

  for (const [key, value] of Object.entries(stored)) {
    if (!key.startsWith(PREFIX) || typeof value !== 'string') continue;
    try {
      found.push(parseProfile(value));
    } catch {
      // Skip anything unreadable rather than failing the whole list.
    }
  }
  return found.sort((a, b) => a.domain.localeCompare(b.domain));
}
