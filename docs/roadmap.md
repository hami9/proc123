# Roadmap — phases 13 onward

Phases 0–12 built the engine and the extension, and are done. This plan adds an
inspector, and an application for Windows, Linux and Android, without taking
anything away: the extension stays and gets better, and the CLI stays for
scripting.

[`CLAUDE.md`](../CLAUDE.md) §15–§18 is the design. This file is the order of
work. [`prompts/`](prompts/) is what a single session is handed.

---

## The shape of it

```
                         packages/core  +  packages/exporters
                                      │
              ┌───────────────────────┼───────────────────────┐
              │                       │                       │
      packages/extension        packages/app            packages/companion
      the browser session       Windows · Linux         scripting, batches
      (stays, gains §16)        Android · no CORS       (stays as-is)
              │                       │
              └────── §17 bridge ─────┘
                 127.0.0.1 + per-run token
                 both work alone; together they work better
```

One engine, three surfaces. Every phase below either widens the engine or adds
a surface to it — none of them forks the logic.

---

## Why this order

The same reason Layer B came before the extension UI in phase 2: **build the
part that can be tested without a UI first, and prove it on the surface that
already exists before building a new one.**

So the inspector engine (13) lands before the inspector UI (14), and both land
before the app (15+) — which means by the time the app shell exists there is
something real to put in it, and the engine has already been used in anger by
a surface that ships today.

The bridge (17) comes after the app can stand alone, so that "both work alone"
is a property the code has from the start rather than one retrofitted onto a
dependency.

**Android (18) is deferred until Windows and Linux are finished** — so the
working order is 16, 17, 20, then 18. The phase numbers do not move, because
they are cited from commits, prompt files and `phases.json`; only the order they
are worked in does. The reasoning is on phase 18 below.

---

## Phases

### 13 · Inspector engine

`packages/core`. No UI, no requests of its own, fixture-driven.

Technology detection widened from the seven storefront platforms
`platform/detect.ts` knows to frameworks, analytics, CDNs, tag managers,
payment and chat widgets — keeping its weighted-signal model and its
every-signal-recorded rule. Font inventory and image inventory as new modules.

**Done when** a fixture page yields its technologies with confidences and
signals, its font families with weights and sources, and its complete image
list — and `explain.ts` can already account for each answer. Licence recorded
for every rule not written here.

### 14 · Inspector in the extension

`packages/extension`. The popup gains the three read-only views. Ships user
value on the surface that already works, and shakes out the engine before the
app depends on it.

**Done when** all three views work on a real shop, image download goes through
the service worker, and the popup at 360px is not cramped by them.

### 15 · App shell — Windows and Linux

`packages/app`, Tauri v2. Rust confined to HTTP, filesystem and the WebView
host. Routing, the design system in §18, dark/light, Persian/English with RTL.

The first Rust in the repository, so this phase also settles how it is built
and tested in CI, and whether the release workflow can cross-compile or needs a
matrix.

**Done when** it builds on both, opens, and renders a real scan result handed
to it from a fixture — no live network yet.

### 16 · The app scans on its own

Wire `core` in behind Rust's HTTP client, with no CORS to work around. Embed a
WebView so client-rendered shops resolve — the failure the CLI has always had.
Politeness (§10) is the app's obligation exactly as it is the extension's, and
a native shell is not a licence to hit a server harder.

**Done when** the app scans a static shop and a JS-built one end to end and
writes a CSV directly to disk, with no browser involved.

### 16.5 · Design pass — the desktop app

**A half phase, and numbered like one on purpose.** It does not add a
capability; it decides what the thing looks like once there is something real to
look at. Slotting it between 16 and 17 rather than appending it keeps the whole
numbering below it untouched, which matters because phase numbers are cited from
commits, prompt files and `phases.json`.

It comes **after** 16 rather than before, because designing against a fixture
means designing against invented content. Once the app scans for real there are
real screens — a long scan reporting progress, a shop with eighty products, a
result with nothing in it, an error — and those are what the design has to hold.

The scaffold in `packages/app/src/styles.css` is a working neutral, not a
proposal. It exists so the app is legible while the engine is built, and it is
meant to be replaced. What makes replacing it cheap is already in place: every
colour, radius and spacing step is a custom property in one `:root` block, and
`main.ts` hard-codes none of them — it sets class names and lets the stylesheet
decide.

**Two things a redesign may not drop**, because they are §18 requirements rather
than taste:

- **The currency confirmation keeps its own visual weight.** §7.8's toman/rial
  question is the worst silent failure this project can produce, and §18 is
  explicit that it must never become a checkbox someone can skip past. It may
  look like anything; it may not become quiet.
- **Directional rules stay logical properties** — `inline-start`, never `left`.
  This is what makes the Persian layout correct rather than approximately
  mirrored, and it fails silently when it is got wrong.

Both languages and both themes are part of the deliverable, not a follow-up.

**Done when** the desktop app has a settled visual design, in Persian and
English, light and dark, and `styles.css` is that design rather than a
placeholder.

> The Android design pass is a separate half phase after 18, and is deliberately
> not specified here — the phone is a different form factor and deserves its own
> decisions rather than a shrunk desktop.

### 17 · The bridge

`127.0.0.1`, per-run token, service worker on the extension side. The extension
lends its authenticated rendered page; the app lends disk, fetching and a
process that outlives a popup.

**Done when** a scan started in the extension finishes in the app with the
popup closed — and both still work with the other uninstalled, under test.

### 18 · Android — **deferred until the desktop targets are finished**

Same codebase, same UI. WebView-based scanning, share-sheet entry so a URL
shared from a browser opens a scan. Touch targets and layout that were designed
for this in §18 rather than patched for it now.

**Done when** a debug APK scans a shop on a real device and exports to storage.

> **Sequencing, decided after phase 15 shipped.** Windows and Linux get finished
> first — 16, 17 and 20 — and Android starts after them. Two reasons, and the
> second is the real one.
>
> Android brings a whole second toolchain (the SDK, the NDK, a signing story)
> and a distribution question that is genuinely unresolved, so starting it now
> means two half-finished platforms instead of one finished one.
>
> More importantly, the desktop UI is about to be worked on directly rather than
> scaffolded. Designing once against a shipped desktop app and then porting is a
> different job from designing for two form factors at once with neither
> settled. What phase 15 already put in — the 44px touch target, the single
> phone breakpoint, the logical properties — is what keeps this a deferral
> rather than a decision to un-make later.
>
> Nothing here is cancelled. §15 still has Android as a first-class target, and
> the constraint that keeps it one is that no desktop-only shortcut gets taken
> in 16, 17 or 20 on the grounds that Android is far away.

> **Distribution risk, worth knowing now:** a general-purpose extraction tool
> may not survive Google Play review. A sideloaded APK and F-Droid are the
> routes that do not depend on that verdict. Plan for them; treat Play as a
> bonus. This is the same lesson [`publishing.md`](publishing.md) records for
> Chrome — find out what a store will accept before building for it.

### 19 · Visual picker for any field

Generalise Layer C from title/price/image to any value the user points at, so
the tool extracts a spec table or a listing site and not only a product grid.
Profiles stay human-readable, exportable JSON.

**Done when** a user teaches a non-product page and the export carries the
fields they picked, with the profile still readable and hand-editable.

### 20 · Packaging and distribution

MSI and AppImage, APK, signing where signing is possible, auto-update. Folded
into the release workflow that already cuts versions and uploads assets.

**Done when** a tagged release produces installable artefacts for all three
targets without a manual step.

> **This phase also owns the first real Windows build.** Phase 15 shipped the
> shell verified on Linux only; rather than hold it open for a check that a
> build matrix performs anyway, the Windows verification moved here. Two
> concrete things it has to do, both already known:
>
> - Make the CI job a matrix over `ubuntu-latest` and `windows-latest`. The npm
>   scripts are already platform-neutral, so this is the `runs-on` line.
> - Generate `src-tauri/icons/icon.ico`. The MSI bundle will not build without
>   it and the directory has PNGs only. `npx tauri icon <square png>` produces
>   the whole set.
>
> If the Windows build turns out to need more than that, it is a finding for
> this phase to record rather than one phase 15 should have caught — nothing
> about the shell is Linux-specific by design.

**Partially done.** The desktop half is wired; the rest waits on things this
phase cannot decide for itself.

Landed:

- CI is a matrix over `ubuntu-latest` and `windows-latest`, for the npm checks
  and for the Rust job — the first real Windows build.
- `src-tauri/icons/icon.ico`, generated from `docs/logo.png`. `tauri icon` also
  emits macOS and iOS sets; those are not committed, because §15 rules both out
  and a half-present icon set invites a half-built target.
- An `installers` job builds the MSI, `.deb` and AppImage and attaches them to
  the GitHub Release. It runs *after* `release` and checks out the tag that
  semantic-release just created, which is the first tree carrying the new
  version. A failure leaves the release published and merely un-attached.

Three findings the Windows build turned up, exactly as this phase was told to
expect:

- **`tauri.conf.json` carried `"version": "0.0.0"` and nothing synced it.**
  Every MSI would have installed as version 0.0.0, and Windows reads that as
  the installed version — so no later release would ever look like an upgrade.
  It is in `sync-version.mjs`'s file list now, and in the release commit's
  assets so the tag states it.
- **`.gitattributes` was missing.** With Git's Windows default
  (`core.autocrlf=true`) every text file checks out as CRLF, and
  `release:check` compares the README it reads against text Prettier generates,
  which is LF. It failed on a drift that did not exist. Pinning `eol=lf` fixes
  it and renormalises nothing — every committed blob was already LF.
- **One test asserted a POSIX path literal**, so `defaultStateDir` failed on
  Windows while the implementation was correct. Fixed alongside this.

Still open, and none of it is a matter of writing more YAML:

- **APK** waits on phase 18. Android is not started, so there is nothing to
  package.
- **Signing** needs a certificate that costs money and is issued to a person.
  Until then both installers are unsigned, and Windows will show SmartScreen on
  first run. That is the project owner's call, not CI's.
- **Auto-update** needs a signing keypair and an endpoint to serve the manifest.
  The keypair is the same decision as signing; the endpoint would be the GitHub
  release itself, so this unblocks as soon as signing does.

---

## What is deliberately not here

- **macOS and iOS.** §15 gives the reasoning. Half-building either is worse
  than not starting.
- **Any account, server or telemetry.** §15 — this is a principle, not a
  default awaiting a business case.
- **Anything in §2's hard constraint.** A native shell lifts the browser's
  restrictions, which makes CAPTCHA solving, fingerprint spoofing and proxy
  rotation easier to build and no more acceptable. A phase that seems to need
  one of them has been specified wrong.
