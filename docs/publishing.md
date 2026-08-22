# Publishing proc123 to the browser stores

proc123 is meant to be installed by anyone who finds it, not only by whoever
built it. That makes the stores the destination rather than an optional extra:
they are the only route to a one-button install, and the only route to shipping
a fix to people who already have it. A build distributed any other way reaches
whoever is willing to turn on developer mode, and then stays at that version
forever.

Everything in this document that could be done in the repository has been done.
What is left needs store accounts — **Firefox is free, Chrome is a one-time
US$5** — which is a person, not a commit.

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

| Field               | What to put                                                                                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Name                | proc123                                                                                                                                        |
| Summary (132 chars) | Scan a store's category page and export a CSV another store can import.                                                                        |
| Category            | Workflow & Planning                                                                                                                            |
| Single purpose      | Extract the products listed on a category page the user has open, and export them as a CSV or JSON file for another shop.                      |
| Icon                | `packages/extension/icons/icon-128.png` (already the right size)                                                                               |
| Screenshots         | 1280×800 or 640×400, at least one. The popup mid-scan and the popup after a scan, with the currency line visible, are the two that explain it. |
| Privacy policy URL  | [`privacy-policy.md`](privacy-policy.md), linked at its raw GitHub URL. Required by both stores from any extension declaring a permission.     |

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

Free, and the store this project should reach first — there is no fee, and a
listed add-on gets the install everyone recognises plus updates handled for us.

### Why the zip is refused before it is signed

Firefox has required signed add-ons since version 48, and on **release builds
the `xpinstall.signatures.required` preference is ignored** — it is not a
setting that can be flipped. So `about:addons` → **Install Add-on From File**
rejects the zip with "could not be verified", and will keep rejecting it until
the file has been signed. Nothing about the package causes this and no change to
it can avoid it.

Meanwhile `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on**
installs the same build in one step and accepts the `.zip` without unzipping.
That is a developer's route, not a user's: it lasts until the browser closes.

### Listed, for a public add-on

**This is the right channel for proc123.** Listed means the add-on lives on
addons.mozilla.org: people find it by searching, install it with one button, and
Mozilla ships every subsequent version to them automatically.

```bash
export WEB_EXT_API_KEY=user:12345678:123
export WEB_EXT_API_SECRET=<the secret>
npm run sign -w @proc123/extension
```

or upload `proc123-firefox-<version>.zip` by hand at
[the Developer Hub](https://addons.mozilla.org/developers/addon/submit/distribution)
and choose **On this site**.

It goes through review. A Manifest V3 add-on with these permissions and
unminified source is the easy case for a reviewer, but budget for one round of
questions about the optional host permission — the answer is in
[Permission justifications](#permission-justifications) above.

### Unlisted, and its three catches

Unlisted signing is automatic — no review, usually under a minute — which makes
it the right way to get a working build to a tester today, or to yourself before
a listing clears. `npm run sign:unlisted -w @proc123/extension` does it, leaving
a signed `.xpi` in `packages/extension/dist/`.

It is **not** a substitute for listing on a public project, for three reasons
that only show up after distribution starts:

- **The channel cannot be changed afterwards.** This is the one that costs
  time, because nothing warns you. A version uploaded unlisted stays unlisted
  for ever; there is no switch, and AMO will not accept the same version number
  again on the other channel. Getting onto the listed channel means **cutting a
  new version number** and uploading that. Choose the channel deliberately at
  the first upload.
- **A download link will not install it.** Firefox only installs an `.xpi`
  offered as `Content-Type: application/x-xpinstall`, and GitHub release assets
  are served as `application/octet-stream`. Users have to save the file and feed
  it to **Install Add-on From File** — which works, and is not what anyone
  expects from a link.
- **There are no updates.** A listed add-on updates through AMO. A
  self-distributed one updates only if the manifest carries an `update_url` and
  something keeps an update manifest hosted at it. Ship without that and every
  user stays on whatever version they first installed.

### Telling the two apart after the fact

An add-on whose versions are all unlisted looks _approved_ in the Developer Hub
— every version says `Approved`, with zero errors — while its public page says
"This is not a public listing" and "no versions have been published". The
Developer Hub does not spell out which channel a version went to, and it offers
**Edit Product Page** either way, so that is not the tell.

The reliable tell is on **Manage Status & Versions**: a listed add-on has a
**Visible / Invisible** control there. An add-on with no listed versions has no
such section at all, because there is nothing that could appear in the gallery.
If that control is absent, every version is unlisted.

The second tell is the clock. Unlisted signing completes in under a minute;
listed review does not.

The manifest already carries what AMO requires:

- `browser_specific_settings.gecko.id` — without it the add-on cannot be signed
  at all.

### Never press Delete Add-on

AMO's delete button says what it does, in a paragraph that is easy to skim past:

> The add-on ID cannot be restored and will forever be unusable for submission.

It means it. Deleting an add-on **permanently burns its `gecko.id`** — every
future upload carrying that id is rejected with "Duplicate add-on ID found", and
there is no appeal, no cooldown and no support request that undoes it. The
account keeps working; the id does not.

This has already happened once here. `proc123@hami9.github.io` is dead and the
current id is `proc123-addon@hami9.github.io`.

So: **there is no situation in which deleting is the fix.** A version on the
wrong channel, a listing that will not go public, a mistake in the metadata —
all of those are solved by uploading a new version or editing the product page.
Deleting solves none of them and costs the identity.

Changing the id also costs the users on the old one: to Firefox a new id is a
different add-on, so nobody updates across the change — they have to install
again. With the old id that was nearly free, since it never reached a public
listing. It will not be free a second time.

- `data_collection_permissions` — mandatory for new extensions since November 2025. It declares `required: ["none"]`, because proc123 collects nothing on
  its own, and `optional: ["websiteContent"]`, because Layer D sends page HTML
  to the provider whose key the user supplied.

`npm run lint:firefox -w @proc123/extension` runs `web-ext lint` over the built
directory in about a second, and catches most of what a submission would be
rejected for. Run it before signing.

**It is not the same checker AMO runs, and the two disagree.** On web-ext 8.10
the local lint is clean; AMO's server-side validation of the same package
reports zero errors and **two warnings**, both saying that
`data_collection_permissions` needs Firefox 140 (Android 142) while
`strict_min_version` is 128. Treat the local lint as a fast pre-flight, not as
the verdict — the verdict is on the validation results page after upload.

Those two warnings do not block anything: the add-on passes validation and can
be submitted with them. What they do mean is that on Firefox 128–139 the key is
ignored, so users there install without the data-consent prompt it exists to
show. Raising the floor to **142** would silence both and make the key work
everywhere it is declared, at the cost of dropping browsers roughly a year old —
Firefox 128 ESR having itself been end-of-life since 140 ESR replaced it. That
is a decision to take deliberately on some future version bump, not a reason to
re-cut a release that has already passed.

---

## What is already done

- Icons at every size both stores ask for, and a 128 for the listing.
- Store zips with no source maps and no minification.
- An add-on id and a data-collection declaration for AMO.
- A manifest whose permissions are already the narrow ones, so the
  justifications above are short because there is little to justify.

## What only an account holder can do

In the order that gets a working install into people's hands soonest:

1. **Submit to AMO, listed.** Free, and the shorter of the two paths. A Mozilla
   account and `npm run sign` is the whole of it.
2. **Fill in the product page.** Copy for every field is written out in
   [`store-listing.md`](store-listing.md), including the privacy policy URL —
   which points at [`privacy-policy.md`](privacy-policy.md) in this repository,
   so it needs no separate hosting.
3. **Take two screenshots** — 1280×800. The popup mid-scan, and the popup after
   a scan with the currency line showing. `store-listing.md` says why those two.
4. **Register the Chrome developer account** (one-time US$5) and submit, then
   answer whatever the reviewer asks about the optional host permission.

Until at least one listing clears, the honest thing to tell people is what
[`install-windows.md`](install-windows.md) already tells them: load the folder,
or load it temporarily in Firefox. Do not point users at a `.xpi` download link
and let them discover that clicking it does nothing.
