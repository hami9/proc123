# @proc123/app

The desktop and mobile application — **Windows, Linux and Android from one
codebase**, built on Tauri v2. It is the third surface over the same engine, not
a replacement for either of the other two: the extension stays, because it is
the only thing that can read a page you are logged in to, and the CLI stays for
scripting.

`CLAUDE.md` §15 and §18 are the design. This file is how to build it.

> **The app scans for real as of phase 16.** It fetches through Rust, runs
> `core`'s pipeline, renders client-rendered shops in an embedded WebView, and
> writes a CSV to disk — no browser involved. The bridge to the extension is
> phase 17, and Android is deferred until Windows and Linux are finished.

> **The visual design is not settled here, and should not be settled here.**
> What is in `styles.css` is a working neutral: the popup's palette so the three
> surfaces read as one product, a spacing scale, and a plain table. The actual
> design is being done separately.
>
> The structure exists to make that cheap. Every colour, radius and gap is a CSS
> custom property in one `:root` block, and `main.ts` hard-codes no colour and
> no spacing at all — it sets class names and lets the stylesheet decide. So a
> redesign is a change to one file rather than a rewrite of the views.
>
> Two things a redesign must not quietly drop, because they are §18 requirements
> rather than taste: the currency step has to keep its own visual weight and
> never become a checkbox someone can skip past (§7.8), and every directional
> rule has to stay a logical property — `inline-start`, not `left` — or the
> Persian layout silently stops being right.

---

## What is Rust and what is not

§15 draws the line and it is worth repeating, because the temptation runs one
way:

| Rust (`src-tauri/`)                                | TypeScript (`src/`, and `core`)                        |
| -------------------------------------------------- | ------------------------------------------------------ |
| HTTP, the filesystem, the bridge, the WebView host | Everything else — the model, prices, layers, exporters |

A rule implemented in Rust cannot be shared with the extension or the
companion, so it gets written a second time and the two copies drift. The
failure this project is most afraid of — reading a toman price as rial (§7.8) —
is exactly the kind of rule that would be convenient to "just handle" natively
and must not be.

---

## Toolchain

- **Node 20.11+** and the repository's `npm ci`, as everywhere else.
- **Rust, stable.** `rustup` is the supported route; on Arch that is
  `pacman -S rustup && rustup default stable`.
- **System libraries**, only on Linux. Tauri links against the platform WebView
  rather than shipping one, which is why the binary is small and why these are
  needed:

| Distribution  | Packages                                                                     |
| ------------- | ---------------------------------------------------------------------------- |
| Arch          | `webkit2gtk-4.1 gtk3 libayatana-appindicator librsvg`                        |
| Debian/Ubuntu | `libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev` |

Windows needs no equivalent step: WebView2 ships with Windows 11 and with
current Windows 10.

---

## Running it

```bash
npm run dev -w @proc123/app
```

That builds the front end in watch mode and starts the app against it, so a
change to `src/` reloads without restarting the shell. A change to `src-tauri/`
recompiles, which is slower — that is Rust, not the setup.

To build the front end alone, without the native shell:

```bash
npm run build -w @proc123/app
```

The output lands in `dist/` and is what `tauri.conf.json` points `frontendDist`
at. It is also openable directly in a browser, which is a genuinely useful way
to work on the UI — the one thing that will not work is the host line in
Settings, which needs the native side and says so rather than failing.

---

## Building a release

```bash
npm run app:build -w @proc123/app
```

**Build each target on its own platform.** Cross-compiling a Tauri app from
Linux to Windows means cross-compiling its WebView bindings and its bundler, and
it is the single most common way to lose a day to this stack. The release
workflow uses a build matrix for the same reason. Linux produces `.deb` and
`.AppImage`; Windows produces `.msi`.

Windows also needs an `.ico` before its bundle will build. There is not one in
`src-tauri/icons/` yet — `npx tauri icon path/to/icon.png` generates the full
set from a single square PNG, and that is a phase 20 task rather than a phase 15
one.

---

## The WebView, and five bugs it took to make it work

`src-tauri/src/render.rs` renders a page in a real WebView so a client-rendered
shop stops reading as zero products. Getting there cost five distinct bugs and
**every one of them was ours, not the platform's** — which is worth recording,
because each looked exactly like "this site does not render".

1. **wry drops the callback while the page is loading.** `webkitgtk/mod.rs`
   pushes the script onto `pending_scripts` and returns `Ok(())` without ever
   calling back. So an unanswered `eval` means _not loaded yet_, never _broken_ —
   treating it as a failure and giving up returned the pre-JS shell every time.
2. **A window that is never mapped never runs its webview.** `visible(false)` is
   the obvious choice and it silently prevents the page from loading at all. The
   render windows are shown, then moved off-screen.
3. **A time budget has to measure time.** Adding `POLL_MS` per iteration counts
   poll _turns_; an iteration that waits on an unanswered eval takes far longer,
   so a "15 second" ceiling kept a window on screen for minutes.
4. **Probe and payload need different timeouts.** `outerHTML.length` answers
   instantly; `outerHTML` is hundreds of kilobytes through a JSON boundary. One
   shared two-second timeout made the real read come back **empty**, which reads
   exactly like a page that rendered nothing.
5. **Loading and settling need separate budgets.** Sharing one meant a slow first
   load spent the whole allowance before a single useful measurement — the same
   page returned 415 KB when it loaded fast and nothing when it did not.

### Rendering is not extraction

Proven on real Persian shops: technolife renders **1.25 MB** and yields **zero**
products, because the rendered page carries `ld+json=2` (Organization and
Breadcrumb), `itemtype=0` and `schema.org/Product=0`. The grid is there; the
markup is not.

So the WebView fixes "the HTML was empty". It does not fix "this shop publishes
no structured data" — that is Layer C's job (phase 19), and the two are meant to
work together: render first, then extract from the rendered DOM.

The app logs what it found (`markup in rendered page: …`) precisely so those two
failures are never confused again.

---

## Two things that fail silently

Both of these cost real time to find, because neither produces an error — the
app builds, runs, and simply does the wrong thing.

**`npm run build` alone does not change the running app.** Tauri embeds
`frontendDist` into the binary at _Rust_ compile time, via
`generate_context!()`. So after editing anything in `src/` you must rebuild the
binary too, or you will be looking at the previous front end and concluding your
change did nothing:

```bash
npm run build -w @proc123/app && cargo build --manifest-path packages/app/src-tauri/Cargo.toml
```

`npm run dev` does not have this problem — it watches — but a hand-built binary
does.

**`window.__TAURI__` does not exist unless `withGlobalTauri` is on.** Tauri v2
does not expose the global API by default; without `"withGlobalTauri": true` in
`tauri.conf.json` there is no `invoke`, so every native call fails at runtime
with nothing at build time to warn you. The symptom is an app that looks
completely fine and cannot fetch or save. Settings reports **Running on** as
`browser (no native host)` when this is the case, which is deliberately the
first place to look.

---

## Checks

The TypeScript side is covered by the repository's `npm run check` exactly as
every other package is. Rust has three of its own:

```bash
npm run rust:fmt  -w @proc123/app   # cargo fmt --check
npm run rust:lint -w @proc123/app   # cargo clippy -D warnings
npm run rust:test -w @proc123/app   # cargo test
```

**These are a separate CI job rather than part of `npm run check`, deliberately.**
`npm run check` is what somebody runs on every save; putting a ten-minute cold
`cargo build` and a hard dependency on rustup plus three system libraries in
front of a typo fix in an exporter would be the wrong trade, and most changes to
this repository never touch `packages/app`. A Rust failure still blocks a merge,
because the CI workflow is the gate rather than any one npm script.

---

## Layout

```
packages/app/
  src/                  the front end — vanilla TypeScript, same idiom as the popup
    main.ts             routing and rendering; decides nothing on its own
    currency.ts         §7.8's toman/rial rule, which is the one safety-critical file here
    i18n.ts             Persian and English, and the digits question
    scan.ts             hands core the two things that differ: a client and a store
    http.ts             core's HttpClient seam, filled by a call into Rust
    save.ts             writing a file, through the native side
    styles.css          §18's design system — the popup's palette, with room
  src-tauri/            the native layer, kept thin
    src/lib.rs          setup and commands; Android calls run() from here too
    src/http.rs         the HTTP transport — a transport and nothing more
    src/files.rs        the save dialog and the write
    src/main.rs         the desktop entry point and nothing else
  scripts/build.mjs     esbuild, mirroring packages/extension
```

`Cargo.lock` is committed. This is a binary rather than a library, so the
lockfile is what makes a build reproducible.
