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

**Contributions URL:** leave empty. AMO accepts only a fixed list of donation
hosts there, and this project's support links are not among them — see
[`licensing.md`](licensing.md). Telegram `@ham1235i` goes in the support field,
not this one.

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

## AMO product page, field by field

**The four long fields are also in [`amo/`](amo/), one file each, whose entire
contents are the paste.** Open the file, select all, paste — there is no block
to find inside it and nothing to trim off the ends. The fenced copies below are
the same text, kept here so this document reads on its own; `amo/` is generated
from them, so edit here and re-generate rather than editing both.

| Field           | File                                             |
| --------------- | ------------------------------------------------ |
| Summary         | [`amo/summary.txt`](amo/summary.txt)             |
| Description     | [`amo/description.txt`](amo/description.txt)     |
| Privacy Policy  | [`amo/privacy-policy.txt`](amo/privacy-policy.txt) |
| Notes to Reviewer | [`amo/reviewer-notes.txt`](amo/reviewer-notes.txt) |

AMO differs from Chrome in three ways that matter when pasting:

- **The privacy policy is a textarea, not a URL.** Paste the text of
  [`privacy-policy.md`](privacy-policy.md) in, minus its Markdown.
- **Summary allows 250 characters** — Chrome allows 132, so AMO can carry the
  longer one below.
- **The description field says "Some Markdown supported"** — a subset: bold,
  italic, links, and bullet lists. Not headings, not tables, not monospace,
  which is why the ASCII layer diagram above is for Chrome and the README and
  not for here. Do not paste HTML into it; the older AMO behaviour of accepting
  inline tags is not what the current form advertises.

| Field         | Value                                                                     |
| ------------- | ------------------------------------------------------------------------- |
| Name          | `proc123`                                                                 |
| Add-on URL    | `proc123`                                                                 |
| Summary       | the 250-character one below                                               |
| Categories    | **Shopping**, and **Web Development** as the second                       |
| Support site  | `https://github.com/hami9/proc123` (or `https://t.me/ham1235i`)           |
| Support email | wherever you want issues to reach                                         |
| Contributions | leave empty — AMO rejects URLs outside its donation-host list             |
| Licence       | MIT                                                                       |
| Privacy       | tick "This add-on has a privacy policy", paste `privacy-policy.md`'s text |

**Summary** (208 characters):

```
Open a shop's category page, press Scan, and get a CSV another shop can import — WooCommerce, Shopify or JSON. Simple and variable products with every variation. No account, no server, nothing leaves your browser.
```

### Description, ready to paste into AMO

The plain-text description above is for Chrome. Paste **only** what is between
the fences below into AMO's Description field — not this sentence, not the
heading, and not the rest of this file. It uses only the Markdown AMO renders:
bold, bullets, and a bare link.

```
proc123 reads a category or collection page you already have open, extracts every product on it, and writes a CSV built for the shop you are moving to.

**What it does**

- Reads simple and variable products, with all their variations
- Exports WooCommerce CSV, Shopify CSV, or plain JSON
- Works on WooCommerce, Shopify, Magento, headless storefronts, and shops built on nothing recognisable at all
- Follows pagination — numbered pages, "load more", infinite scroll
- Resumes where it stopped instead of starting over

**How it reads a page**

Four layers, tried in order, and it tells you which one answered:

- **A** — the shop's own catalogue API, where one is open
- **B** — structured markup: JSON-LD, Microdata, OpenGraph
- **C** — a layout you taught it by clicking a title, a price, an image
- **D** — AI, off until you switch it on with your own API key

Layer C is why "any shop" is not a marketing claim. When the first two layers find nothing, you point at one product card and it applies what it learned to every card on every page. What it learns is readable JSON you can edit, export and share.

**Built for Persian shops too**

Persian and Arabic-Indic numerals are normalised to ASCII, thousands separators are stripped, and — the important one — it asks whether prices are in toman or rial before it writes anything, rather than guessing. Guessing wrong is a silent 10x price error, and that is the mistake this tool works hardest to prevent.

**When a field comes out empty**

Press "Why is this field empty?" and it explains every blank column in plain language: you switched it off, the shop never published it, or something genuinely went wrong. The report carries no API keys and no page content, so it is safe to attach to a bug report.

**What it will not do**

It does not solve CAPTCHAs, spoof fingerprints, rotate proxies, or retry past a block. When a shop signals that it does not want to be read automatically, proc123 stops and says so. Requests are paced by default so as not to burden the shop's server.

There is no account, no server, and no analytics. Nothing you scan reaches anyone but the shop you are scanning — and your own AI provider, if you chose to switch that on with your own key.

Descriptions and photographs are someone's authored content. By default proc123 copies the structured data and leaves description columns empty; you can opt into including them with attribution, or into rewriting them.

Open source, MIT licensed: https://github.com/hami9/proc123
```

### The two checkboxes under the description

Both stay **unticked**, and both are wrong for this add-on rather than merely
optional:

- **"This add-on is experimental"** — it ships tested and versioned. Ticking it
  puts a warning banner on the listing and suppresses it from search results.
- **"This add-on requires payment, non-free services or software, or additional
  hardware"** — it requires none. Layer D is off by default and needs nothing;
  a key the user may optionally supply is not a requirement, and AMO's field
  means a paywall.

### Privacy policy, as AMO wants it

AMO's field is a textarea, so [`privacy-policy.md`](privacy-policy.md) goes in
with its Markdown removed — no `##`, no `**`, because that field renders none of
it and the raw punctuation shows. Paste **only** what is between the fences.

```
proc123 has no account, no server, and no analytics. Nothing you scan is sent to
the people who wrote it, because there is nowhere for it to be sent to. The only
outbound requests it makes are to the shop you pointed it at — and, if you have
chosen to switch that on and supplied your own key, to your own AI provider.

WHAT IS COLLECTED

Nothing. proc123 has no backend. There is no telemetry, no usage analytics, no
crash reporting, and no update ping beyond the browser's own extension-update
check, which is the browser's and not ours.

WHAT IS STORED, AND WHERE

Everything proc123 stores stays in your browser profile, in local extension
storage. None of it is synced, and none of it leaves the device unless you
export it yourself:

- Settings — the options you set in the popup: export format, currency unit, limits
- Site profiles — the layouts you taught it, per domain, in readable JSON you can edit
- In-progress scan state — so a scan survives the background worker being shut down, and can resume
- Your AI API key — only if you enter one; kept under its own storage key, never synced

Removing the add-on removes all of it. Individual profiles and the API key can
be cleared from the popup at any time.

WHAT IS SENT, AND TO WHOM

To the shop you are scanning. proc123 reads the page you already have open. If a
category runs across several pages and you grant permission for that site, it
fetches the remaining pages of that same category. Requests are paced
deliberately — by default one at a time with a delay — so as not to burden the
shop's server. If a site signals that it does not want to be read automatically,
proc123 stops and tells you, rather than trying to get around it.

To your AI provider, only if you turn it on. The AI extraction layer is off by
default and does nothing until you paste an API key for your own account with
OpenAI, Anthropic or Google. When it is on and a field could not be read any
other way, a trimmed fragment of the page's HTML — not the whole page — is sent
to that provider under your account and their terms. proc123 has no key of its
own and no relationship with any of them.

To nobody else. There is no third party in the middle.

PERMISSIONS, AND WHY EACH EXISTS

- activeTab — to read the page you have open, and only after you click the
  toolbar button and start a scan.
- scripting — to read the product cards out of that page's rendered DOM. It only
  reads; it never modifies the page.
- storage — for the list above. Local only.
- Access to a website's data (optional) — never granted at install. When a
  category paginates, the popup asks for permission for that one site, at that
  moment, so the remaining pages can be fetched. Declining is a supported
  answer: the scan covers the page you have open and the result says so.

FILES proc123 WRITES

Exports — CSV or JSON — are written by you, to your own machine, through the
browser's normal download flow. They are never uploaded anywhere.

The troubleshooting report ("Why is this field empty?") is written the same way.
It is designed to be safe to attach to a bug report: API keys and page HTML are
never written to it.

CHILDREN

proc123 is a tool for shop operators and developers. It is not directed at
children and collects nothing from anyone, of any age.

CONTACT

Questions, or anything here that does not match what you observe: open an issue
at https://github.com/hami9/proc123/issues

The source is MIT-licensed and public, and the shipped bundles are not minified,
so every claim above can be checked against the code — including in the browser.
```

### Notes to reviewer

```
Build is reproducible: `npm install && npm run build:zip -w @proc123/extension`
produces a byte-identical zip. Bundles are intentionally not minified. No remote
code. No analytics and no backend of any kind.

The optional host permission is requested per-site at runtime, only when a
category turns out to paginate, and only from a click in the popup. Declining is
a supported path: the scan then covers the open page and the result says so.

Source: https://github.com/hami9/proc123 (MIT), tag v1.4.3
```

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
