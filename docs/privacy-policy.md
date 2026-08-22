# proc123 — Privacy Policy

_Last updated: 19 August 2026. Applies to the proc123 browser extension and
command-line companion._

## The short version

proc123 has no account, no server, and no analytics. Nothing you scan is sent to
the people who wrote it, because there is nowhere for it to be sent to. The only
outbound requests it makes are to the shop you pointed it at — and, if you have
chosen to switch that on and supplied your own key, to your own AI provider.

## What is collected

**Nothing is collected.** proc123 has no backend. There is no telemetry, no
usage analytics, no crash reporting, and no update ping beyond the browser's own
extension-update check, which is the browser's and not ours.

## What is stored, and where

Everything proc123 stores stays in your browser profile, in
`chrome.storage.local` (or its Firefox equivalent). None of it is synced, and
none of it leaves the device unless you export it yourself.

| Stored                 | What it is                                                              |
| ---------------------- | ----------------------------------------------------------------------- |
| Settings               | The options you set in the popup — export format, currency unit, limits |
| Site profiles          | The layouts you taught it, per domain, in readable JSON you can edit    |
| In-progress scan state | So a scan survives the service worker being shut down, and can resume   |
| Your AI API key        | Only if you enter one. Kept under its own storage key, never synced     |

Removing the extension removes all of it. Individual profiles and the API key
can be cleared from the popup at any time.

## What is sent, and to whom

**To the shop you are scanning.** proc123 reads the page you already have open.
If a category runs across several pages and you grant permission for that site,
it fetches the remaining pages of that same category. Requests are paced
deliberately — by default one at a time with a delay — so as not to burden the
shop's server. If a site signals that it does not want to be read
automatically, proc123 stops and tells you, rather than trying to get around it.

**To your AI provider, only if you turn it on.** The AI extraction layer is
**off by default** and does nothing until you paste an API key for your own
account with OpenAI, Anthropic or Google. When it is on and a field could not
be read any other way, a trimmed fragment of the page's HTML — not the whole
page — is sent to that provider under your account and their terms. proc123 has
no key of its own and no relationship with any of them.

**To nobody else.** There is no third party in the middle.

## Permissions, and why each exists

- **`activeTab`** — to read the page you have open, and only after you click the
  toolbar button and start a scan.
- **`scripting`** — to read the product cards out of that page's rendered DOM.
  It only reads; it never modifies the page.
- **`storage`** — for the table above. Local only.
- **Access to a website's data (optional)** — never granted at install. When a
  category paginates, the popup asks for permission for that one site, at that
  moment, so the remaining pages can be fetched. Declining is a supported
  answer: the scan covers the page you have open and the result says so.

## Files proc123 writes

Exports — CSV or JSON — are written by you, to your own machine, through the
browser's normal download flow. They are never uploaded anywhere.

The troubleshooting report ("Why is this field empty?") is written the same way.
It is designed to be safe to attach to a bug report: **API keys and page HTML
are never written to it.** Redaction is applied centrally to every log record
rather than being left to each place that writes one, so it cannot be forgotten
at a call site.

## Children

proc123 is a tool for shop operators and developers. It is not directed at
children and collects nothing from anyone, of any age.

## Changes

Material changes to this policy will be noted in
[`CHANGELOG.md`](../CHANGELOG.md) alongside the release that makes them, and the
date at the top of this file will change.

## Contact

Questions, or anything here that does not match what you observe:
[open an issue](https://github.com/hami9/proc123/issues).

The source is [MIT-licensed and public](https://github.com/hami9/proc123) —
every claim above can be checked against it, and the shipped bundles are not
minified so they can be read in the browser too.
