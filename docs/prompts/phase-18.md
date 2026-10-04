# Phase 18 · Android

**Package:** `packages/app`
**Depends on:** phases 15, 16, 16.5
**Roadmap:** [`../roadmap.md`](../roadmap.md) — phase 18
**Design:** `CLAUDE.md` §15, §18

## Goal

The same app, on a phone. One codebase (§15): nothing here may fork the scan
logic, and nothing desktop-only may be faked on mobile.

**Done when** a debug APK scans a shop on a real device and exports to storage.

## Split in two, on purpose

This phase is two pieces of work with a hard line between them, and running them
as one session would be the "two phases in a file" the prompt README warns
about.

### 18a — the APK exists and the core path works (landed)

- `bridge.rs` and `render.rs` are `#[cfg(desktop)]`. Neither is skipped for
  convenience: Tauri mobile has one window and no `WebviewWindowBuilder`, and
  Android browsers do not run the extension, so §17 has nobody to talk to.
- `files.rs` writes to the `content://` URI Android's save dialog returns,
  through `tauri-plugin-fs`. The desktop code path turned that URI into
  "the user cancelled", so every export on a phone silently wrote nothing.
- `canRender()` answers false on Android, so the UI never promises a render.
- CI builds an arm64 debug APK on every pull request and uploads it.

### 18b — share-sheet entry

A URL shared from a browser opens the ordinary scan path. A small native
`ShareActivity` accepts `ACTION_SEND` with `text/plain`, forwards bounded text
to the existing app task, then finishes. It drops browser result flags and URI
grants: a physical S9 showed that sharing directly to the Tauri host can create
a second, blank host inside Chrome's task, even with `singleTask`.
A Kotlin plugin handles the launch intent
and `onNewIntent`, keeping shares in memory until the UI is ready and idle.
Only one HTTP(S) URL is accepted; credentials and ambiguous shares are rejected.
The normal currency confirmation still applies before export.

Hand-written Android sources live in `packages/app/android`, not in ignored
generated files. `scripts/android-share.mjs` applies this versioned overlay
after `tauri android init`; CI runs the same step and fails if the generated
template or identifier changes. This keeps the edits reproducible without
committing the SDK-generated project.

CI also runs native Kotlin regression tests with Robolectric after building the
APK. They cover cold/warm delivery, styled `CharSequence` text, normalized MIME
types, replay prevention, invalid extras and inbox limits. Receiver tests also
check task flags, text-only forwarding and no replay on restoration. Test dependencies
are JVM-only and are not bundled in the app. These tests do not prove browser
share-sheet routing or scan/export on a physical phone.

The front end targets ES2020 and Chromium/WebView 81. Android's WebView is a
device component, not a runtime bundled by Tauri. A Galaxy S9 on Android 10
exposed an ES2022 parse failure; bundle syntax and CSV APIs without `replaceAll`
or `Array.at`, and DOM updates without `replaceChildren`, have regression coverage. Physical-device validation remains
separate from these build checks.

From the repository root, with the Android toolchain installed:

```powershell
npm exec -w @proc123/app -- tauri android init --ci
npm run android:prepare -w @proc123/app
npm exec -w @proc123/app -- tauri android build --debug --apk --target aarch64
```

## What 18a learned

- **The Android SDK host is blocked from Claude's cloud sessions**
  (`dl.google.com` → 403 at the egress proxy). Build the APK in CI; the runner
  has the SDK and NDK. A session can still _type-check_ for Android without the
  NDK — see the command below — and that check is worth running before every
  push, because it is the only Android signal available before CI.
- **`ring` builds for Android without an NDK, for a check.** It needs only
  freestanding headers:

  ```bash
  rustup target add aarch64-linux-android
  RD=$(clang -print-resource-dir)
  CC_aarch64_linux_android=clang \
  CFLAGS_aarch64_linux_android="--target=aarch64-linux-android24 -ffreestanding -nostdinc -isystem $RD/include -DRING_CORE_NOSTDLIBINC" \
  AR_aarch64_linux_android=llvm-ar \
  cargo check --manifest-path packages/app/src-tauri/Cargo.toml --target aarch64-linux-android
  ```

  `RING_CORE_NOSTDLIBINC` is ring's own switch for cross-building. This checks;
  it does not link, and it is not an APK.

- **`mobile` and `desktop` cfgs come from `tauri-build`**, and on Android
  `mobile` is set and `desktop` is not — verified with a `compile_error!` probe,
  because a `cfg` that is silently neither compiles both branches away.

## Do not

- Do not add an Android code path to `core`. If a scan behaves differently on a
  phone, the difference belongs in the native layer or the surface.
- Do not commit a signing key or keystore. Debug APKs use the throwaway debug
  key; release signing is phase 20 and belongs to a person.
- Do not ship to Google Play without reading the distribution note on phase 18
  in the roadmap first.

## Done when (18b closes the phase)

- [x] CI builds an installable debug APK on every pull request.
- [x] Export on Android writes the file the user chose.
- [x] A cold URL shared from Chrome opens a scan (Galaxy S9, Android 10, WebView 81).
- [x] Scanned a Persian fixture and saved a verified CSV to Downloads on that phone.
- [ ] Warm and queued browser shares pass the physical-device checks below.
- [ ] `scripts/release/phases.json` says `done` for phase 18.

## Device checks

Download `proc123-android-debug` from the PR's successful CI run. It is an arm64
debug APK, not a signed public release. Install it on a test phone, then:

1. Close the app. Share a category URL from the browser to proc123. Check that
   the app opens that URL and scans it.
2. Keep the app open. Share a second category URL. Check that one new scan runs.
3. Share while a scan is running. Check that the current scan finishes before
   the next starts, with no lost link or overlapping crawl.
4. Share text without a URL. Check that it reports the problem without fetching.
5. Scan a Persian shop. Confirm toman/rial explicitly, export to Downloads, then
   open the CSV and verify its prices and UTF-8 text.
6. Rotate or background the app. Check that the consumed launch share does not
   start the scan again.

An APK build does not prove these device checks. Keep phase 18 `partial` until
scan, share and export have been verified on a real phone.
