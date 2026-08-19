# Publishing proc123 to the browser stores

This is the only route to the install everyone expects — a button that says
**Add to Chrome**, no developer mode, no folder to keep forever, and automatic
updates. Everything in this document that could be done in the repository has
been done; what is left needs a store account, which is a person with a credit
card, not a commit.

---

## Why the current download is not that

The releases ship an unpacked directory in a zip, and the install is
`chrome://extensions` → Developer mode → **Load unpacked**. That is not a
packaging mistake that can be fixed here — it is the only route Chrome leaves
open to an extension that is not in its store:

| Route                        | Works?                                                                                                                                                               |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Load unpacked** (a folder) | Yes. Needs Developer mode, and the folder has to stay where it is — deleting it uninstalls the extension.                                                            |
| **Drag a `.crx` in**         | **No.** Chrome removed this on Windows and macOS. The file downloads and nothing happens, or it reports that extensions can only be added from the Chrome Web Store. |
| **Pack extension** button    | Produces a `.crx` and a `.pem` — and Chrome then refuses to install that `.crx` for the reason above. The button is for signing an upload, not for distributing one. |
| **Enterprise policy**        | Yes, and it is the only off-store install that survives. Needs admin rights on the machine and a registry or policy file per device.                                 |
| **Chrome Web Store**         | Yes — the normal one. Everything below is about getting there.                                                                                                       |

So: the `.crx` path is a dead end, and no change to this repository can revive
it. Firefox is friendlier — see [Firefox](#firefox-addonsmozillaorg), where a
signed build does install normally and does survive a restart.

---

## Chrome Web Store

### What it costs

A **one-time US$5** registration fee for the developer account, not per
extension. Review is usually a few days; a small Manifest V3 extension with
narrow permissions is often much faster. Budget for one rejection — the first
submission of anything that asks for host permissions usually draws a question.

### What to upload

```bash
npm run build:zip -w @proc123/extension
```

Upload `packages/extension/dist/proc123-chrome-<version>.zip`. It contains
`manifest.json`, `popup.html`, the two bundles and `icons/`, with no source maps
and nothing minified — a reviewer can read every line, which is deliberate.

### The listing

| Field               | What to put                                                                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Name                | proc123                                                                                                                                                                                          |
| Summary (132 chars) | Scan a store's category page and export a CSV another store can import.                                                                                                                          |
| Category            | Workflow & Planning                                                                                                                                                                              |
| Single purpose      | Extract the products listed on a category page the user has open, and export them as a CSV or JSON file for another shop.                                                                        |
| Icon                | `packages/extension/icons/icon-128.png` (already the right size)                                                                                                                                 |
| Screenshots         | 1280×800 or 640×400, at least one. The popup mid-scan and the popup after a scan, with the currency line visible, are the two that explain it.                                                   |
| Privacy policy URL  | Required, because the listing declares a permission. [`SECURITY.md`](../SECURITY.md) is not one — a short page stating that nothing leaves the browser except the fetches the user permitted is. |

### Permission justifications

The review form asks for one per permission. These are accurate to the code —
do not embellish them, a justification that overstates what the extension does
is worse than a terse one:

**`activeTab`** — proc123 reads the category page the user already has open, and
only after they click the toolbar button and press Scan. It is the narrowest
permission that allows reading the page the user pointed at.

**`scripting`** — the product cards are read out of the rendered DOM of that
tab. `scripting.executeScript` injects that reader. It only ever reads; it does
not modify the page.

**`storage`** — stores the user's own settings, the site layouts they taught it,
and the resumable state of a crawl in progress. All local, via
`chrome.storage.local`. Nothing is synced and nothing is sent anywhere.

**`optional_host_permissions: *://*/*`** — this one draws the question, so
answer it fully. It is **optional** and never granted at install. When a
category spans several pages, the popup asks for permission for that one site,
at that moment, so the service worker can fetch the remaining pages of the same
category. Declining is a supported answer: the scan covers the open page and the
result says so. The wildcard is there because the extension cannot know in
advance which shop the user will open; the grant the user actually makes is
per-site.

**Remote code** — none. Everything executed is in the package. Answer "No, I am
not using remote code."

**Data usage** — the extension collects nothing and transmits nothing by
default. Layer D (AI) is off until the user pastes their own API key for their
own provider account; when they do, page HTML fragments go to that provider and
nowhere else. Declare _Website content_, tick that it is not sold, not used for
creditworthiness, and not used for anything unrelated to the single purpose.

---

## Firefox (addons.mozilla.org)

Worth doing even if Chrome is the main target, because it is the one store where
this project can get a normal install without waiting on a review: AMO's
**self-distribution** signing returns a signed `.xpi` that installs in one click
and survives a restart, and it does not require the add-on to be listed
publicly.

Signing is **free** and, on the unlisted channel, **automatic** — no review
queue, no fee, usually under a minute. That makes it the only route this project
has today to an install that behaves the way people expect.

### Why the zip is refused before signing

Firefox has required signed add-ons since version 48, and on **release builds
the `xpinstall.signatures.required` preference is ignored** — it is not a
setting that can be flipped. So `about:addons` → **Install Add-on From File**
rejects the zip with "could not be verified", and will keep rejecting it until
the file has been signed. Nothing about the package causes this and no change to
it can avoid it.

Until then, `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on**
installs the same build in one step (it accepts the `.zip` directly — no need to
unzip), for the current session.

### Signing it

Get an API key and secret from
[the AMO credentials page](https://addons.mozilla.org/developers/addon/api/key/),
then:

```bash
export WEB_EXT_API_KEY=user:12345678:123
export WEB_EXT_API_SECRET=<the secret>
npm run sign -w @proc123/extension
```

That builds the store bundles and submits the Firefox one on the **unlisted**
channel, leaving a signed `.xpi` in `packages/extension/dist/`. That file
installs permanently through **Install Add-on From File**, and survives
restarts.

Drop `--channel unlisted` from the script to list it publicly instead — that
path does go through review.

The manifest already carries what AMO requires:

- `browser_specific_settings.gecko.id` — without it the add-on cannot be signed
  at all.
- `data_collection_permissions` — mandatory for new extensions since November 2025. It declares `required: ["none"]`, because proc123 collects nothing on
  its own, and `optional: ["websiteContent"]`, because Layer D sends page HTML
  to the provider whose key the user supplied.

`npm run lint:firefox -w @proc123/extension` runs AMO's own validator over the
built directory and currently reports **zero errors and zero warnings**. Run it
before signing; it catches what the submission would reject, locally and in a
second.

---

## What is already done

- Icons at every size both stores ask for, and a 128 for the listing.
- Store zips with no source maps and no minification.
- An add-on id and a data-collection declaration for AMO.
- A manifest whose permissions are already the narrow ones, so the
  justifications above are short because there is little to justify.

## What only an account holder can do

- Pay the US$5 and register the Chrome developer account.
- Host a privacy policy page and put its URL in the listing.
- Take the two screenshots.
- Press submit, and answer whatever the reviewer asks about the host permission.
