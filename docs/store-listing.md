# Store listing copy

Ready to paste. Keep the two stores saying the same thing — a listing that
describes a different product from the one in the other store is the kind of
inconsistency a reviewer notices.

Every claim below is one the extension actually delivers. Nothing here promises
a shop it cannot read or a field it cannot fill; §6's field tiers are real and
overselling them produces one-star reviews from people who were told otherwise.

---

## Both stores

**Name:** `proc123`

**Summary** (AMO allows 250 characters, Chrome 132 — the short one fits both):

```
Scan a shop's category page and export a CSV another shop can import.
```

**Categories:** Shopping, and Web Development if a second is allowed.

**Support site:** `https://github.com/hami9/proc123`
**Support email:** whichever address you want issues to reach.

**Privacy policy URL:**

```
https://github.com/hami9/proc123/blob/main/docs/privacy-policy.md
```

**Licence:** MIT.

---

## Description

```
proc123 reads a category or collection page you already have open, extracts
every product on it, and writes a CSV built for the shop you are moving to.

WHAT IT DOES

• Reads simple and variable products, with all their variations
• Exports WooCommerce CSV, Shopify CSV, or plain JSON
• Works on WooCommerce, Shopify, Magento, headless storefronts, and shops
  built on nothing recognisable at all
• Follows pagination — numbered pages, "load more", infinite scroll
• Resumes where it stopped instead of starting over

HOW IT READS A PAGE

Four layers, tried in order, and it tells you which one answered:

  A · the shop's own catalogue API, where one is open
  B · structured markup — JSON-LD, Microdata, OpenGraph
  C · a layout you taught it by clicking a title, a price, an image
  D · AI, off until you switch it on with your own API key

Layer C is why "any shop" is not a marketing claim. When the first two layers
find nothing, you point at one product card and it applies what it learned to
every card on every page. What it learns is readable JSON you can edit, export
and share.

BUILT FOR PERSIAN SHOPS TOO

Persian and Arabic-Indic numerals are normalised to ASCII, thousands separators
are stripped, and — the important one — it asks whether prices are in toman or
rial before it writes anything, rather than guessing. Guessing wrong is a silent
10x price error, and that is the mistake this tool works hardest to prevent.

WHEN A FIELD COMES OUT EMPTY

Press "Why is this field empty?" and it explains every blank column in plain
language: you switched it off, the shop never published it, or something
genuinely went wrong. The report carries no API keys and no page content, so it
is safe to attach to a bug report.

WHAT IT WILL NOT DO

It does not solve CAPTCHAs, spoof fingerprints, rotate proxies, or retry past a
block. When a shop signals that it does not want to be read automatically,
proc123 stops and says so. Requests are paced by default so as not to burden
the shop's server.

There is no account, no server, and no analytics. Nothing you scan reaches
anyone but the shop you are scanning — and your own AI provider, if you chose
to switch that on with your own key.

Descriptions and photographs are someone's authored content. By default
proc123 copies the structured data and leaves description columns empty; you
can opt into including them with attribution, or into rewriting them.

Open source, MIT licensed: https://github.com/hami9/proc123
```

---

## Screenshots

Two, at 1280×800. Both stores accept that size.

1. **The popup mid-scan** — page count climbing, the layer that answered
   visible. It shows the thing working and shows the honesty about which layer
   produced the data.
2. **The popup after a scan, currency line visible.** This is the screenshot
   that explains what makes the tool careful rather than fast, and it is the
   feature most worth being known for.

A third, if you want one: the "Why is this field empty?" report.

---

## Notes for the AMO submission

- **Source code is required on every version**, because the shipped bundles are
  built by esbuild. Upload the repository at the matching tag. The bundles are
  deliberately not minified, which makes the reviewer's job — and this
  requirement — easier rather than harder.
- The build is reproducible: `npm install && npm run build:zip -w @proc123/extension`
  produces byte-identical zips to the release assets. Say so in the reviewer
  notes; it is the fastest way to answer "does this source match this build?".

## Notes for the Chrome submission

- Answer **no** to remote code. Everything executed is in the package.
- Declare **Website content** under data usage, and tick that it is not sold,
  not used for creditworthiness, and not used for anything unrelated to the
  single purpose.
- The permission justifications are in
  [`publishing.md`](publishing.md#permission-justifications), written from the
  code rather than from the manifest.
