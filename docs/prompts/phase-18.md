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

### 18b — share-sheet entry (next)

A URL shared from a browser opens a scan. This needs an `ACTION_SEND` intent
filter in `AndroidManifest.xml` and a few lines of Kotlin in `MainActivity` to
pass the shared text into the WebView — which means **committing
`src-tauri/gen/android`** (and taking it out of `.gitignore`), because those
edits are hand-made and cannot be regenerated.

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
- [ ] A URL shared from a browser opens a scan.
- [ ] Scanned and exported on a real device (needs a person and a phone).
- [ ] `scripts/release/phases.json` says `done` for phase 18.
