/**
 * Decisions about the images the inspector found.
 *
 * Its own module rather than living in `background.ts` for one practical
 * reason: importing the worker registers a message listener, so anything that
 * wants to test these rules would have to stand up the whole extension API
 * first. These are pure functions over data `core` produced, and they are the
 * part worth testing.
 *
 * Both surfaces use them — the popup to decide what to offer, the worker to
 * decide what to call the file — so there is one answer rather than two that
 * drift.
 */

import type { ImageAsset } from '@proc123/core';

import { shortHash } from '@proc123/core';

/**
 * Images a person means when they say "the images on this page".
 *
 * Favicons, touch icons and Open Graph previews are all images the page
 * genuinely references, and none of them is what someone ticking "select all"
 * wants. Phase 13 gave them their own origin kinds precisely so this filter
 * could exist rather than being a guess at filenames.
 *
 * CSS backgrounds are excluded too, which is a judgement rather than a
 * certainty: on a shop they are overwhelmingly sprites, gradients and section
 * decoration, and a product photograph reaches the page as an `<img>`. They are
 * still in the inspection, and still counted — they are just not offered.
 */
export function isPhotograph(asset: ImageAsset): boolean {
  return asset.origins.some(
    (origin) => origin !== 'icon' && origin !== 'meta' && origin !== 'css-background'
  );
}

/**
 * Everything a filename is allowed to keep: letters, digits, dot, underscore,
 * hyphen.
 *
 * An allowlist rather than a list of dangerous characters, deliberately. A
 * denylist of `/`, `\`, `:` and friends is a list you can be wrong about, and
 * being wrong once is a path escaping the downloads folder; an allowlist is
 * wrong only in the harmless direction. `\p{L}` keeps Persian and Arabic names
 * readable rather than reducing every one of them to a hash.
 */
const DISALLOWED = /[^\p{L}\p{N}._-]/gu;

/** Leading dots, which is how `..` climbs out of the folder it was given. */
const LEADING_DOTS = /^\.+/;

/**
 * Where a downloaded image should be written.
 *
 * Under a folder named after the shop, keeping the name the shop gave it —
 * that is what someone hunting for one photograph among forty will recognise,
 * and it is information the URL already carries.
 *
 * **The sanitising is not cosmetic.** `filename` is interpreted relative to the
 * downloads folder, so a path segment out of a remote URL is untrusted input:
 * `..` escapes the folder, a leading slash makes it absolute, and a separator
 * writes somewhere nobody asked for. A name that does not survive sanitising is
 * replaced by one derived from the URL, so two images can never collapse into
 * the same file.
 */
export function imageFilename(imageUrl: string, pageUrl: string): string {
  let host = '';
  try {
    host = new URL(pageUrl).hostname.replace(/^www\./, '');
  } catch {
    // A malformed page URL is not worth failing a download over.
  }
  host = host.replace(/[^a-z0-9.-]/gi, '');
  if (host === '' || /^\.+$/.test(host)) host = 'images';

  let name = '';
  try {
    name = decodeURIComponent(new URL(imageUrl).pathname.split('/').pop() ?? '');
  } catch {
    // A name that will not even decode is not one worth repairing.
    name = '';
  }

  // Order matters. Disallowed characters go first, so a percent-encoded
  // `..%2F..` cannot survive decoding as `../..` and then be read as a path;
  // only once the separators are gone are the leading dots stripped.
  name = name.replace(DISALLOWED, '').replace(LEADING_DOTS, '');

  // No recognisable extension means the browser would have to guess the type,
  // and two extensionless URLs would collide. A name derived from the URL is
  // unique, and honest about being derived.
  if (name === '' || !/\.[a-z0-9]{2,5}$/i.test(name)) {
    name = `image-${shortHash(imageUrl, 8)}.jpg`;
  }

  // Long names are a filesystem limit rather than a taste question, and the
  // extension has to survive being trimmed.
  if (name.length > 100) {
    const dot = name.lastIndexOf('.');
    const extension = dot === -1 ? '' : name.slice(dot);
    name = name.slice(0, 100 - extension.length) + extension;
  }

  return `proc123-${host}/${name}`;
}
