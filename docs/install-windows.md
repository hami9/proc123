# Installing proc123 on Windows

Two ways in. Pick one — you do not need both.

|                                                                    | Best for                                                | Needs Node? |
| ------------------------------------------------------------------ | ------------------------------------------------------- | ----------- |
| **[A. The browser extension](#a-the-browser-extension)**           | Most people. Any shop, including JavaScript-built ones. | No          |
| **[B. The command-line companion](#b-the-command-line-companion)** | Scripting, batches, no clicking                         | No          |

Both are free downloads from the
**[latest release](https://github.com/hami9/proc123/releases/latest)**. Nothing
is installed system-wide, nothing runs in the background, and nothing is sent
anywhere — the scan happens in your own browser session, on pages you open.

---

## A. The browser extension

> **Why is this not just an "Add to Chrome" button?** Because proc123 is not in
> the Chrome Web Store yet. Chrome only offers a one-click install to extensions
> that are, and it blocks `.crx` files from anywhere else — the **Pack
> extension** button on the extensions page produces a file Chrome will then
> refuse to install, so it is not a shortcut around this. Loading the folder is
> the supported way to run an extension that is not in the store, and
> [`publishing.md`](publishing.md) is what getting the button would take.

### 1. Download

Go to the **[latest release](https://github.com/hami9/proc123/releases/latest)**
and, under **Assets**, download:

- **Chrome, Edge or Brave** → `proc123-chrome-<version>.zip`
- **Firefox** → `proc123-firefox-<version>.zip`

### 2. Unzip it

Right-click the file → **Extract All…** → **Extract**.

Put the extracted folder somewhere you will not delete it — for example
`C:\Users\<you>\proc123`. **The browser loads it from that folder every time it
starts, so moving or deleting the folder uninstalls the extension.**

You should see `manifest.json`, `popup.html`, `background.js`, `popup.js` and an
`icons` folder directly inside the folder. If instead you see a single folder
inside a folder, go one level deeper — the folder holding `manifest.json` is the
one to pick in step 3.

> Do not skip the unzip. Browsers cannot load a `.zip` directly.

### 3. Load it

**Chrome / Edge / Brave**

1. Open a new tab and go to the extensions page:
   - Chrome — `chrome://extensions`
   - Edge — `edge://extensions`
   - Brave — `brave://extensions`
2. Turn on **Developer mode** (top-right in Chrome and Brave, bottom-left in Edge).
3. Click **Load unpacked**.
4. Select the folder from step 2 — the one containing `manifest.json`.

proc123 now appears in the list. Click the puzzle-piece icon in the toolbar and
pin it so the button is always visible.

**Firefox**

1. Go to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…**.
3. Select `manifest.json` inside the folder from step 2.

Firefox forgets temporary add-ons when it closes, so this is per-session. A
permanent install needs a Mozilla-signed build, which this project does not
publish yet — on Windows, Chrome or Edge is the smoother path. Unlike Chrome,
though, Firefox does allow a normal one-click install of a signed build without
listing it publicly; [`publishing.md`](publishing.md) covers the signing step,
and the manifest already carries everything it requires.

### 4. Scan a category

1. Open the shop and navigate to a **category or collection page** — the page
   listing many products, not one product's own page.
2. Click the **proc123** toolbar button.
3. Press **Scan this category**.

If the shop paginates, proc123 asks for permission to read the rest of that
site. Allowing it fetches the remaining pages of the same category; declining
scans only the page you have open and says so.

### 5. Download the file

When the scan finishes the popup shows what it found. Before writing anything:

- **Check the currency line.** If prices were tagged `IRR` without the page
  saying toman or rial, proc123 asks which they are rather than picking one.
  Answering wrong is a silent 10× price error — ask the shop if you are unsure.
- Pick the export format: **WooCommerce CSV**, **Shopify CSV**, or **JSON**.
- Press **Download**. The file lands in your normal Downloads folder.

**Why is this field empty?** writes a plain-language report explaining every
blank column — whether you switched it off, the shop never published it, or
something actually went wrong. It carries no API keys and no page content, so
it is safe to attach to an issue.

### Updating

Download the new zip, extract it **over** the same folder (replace the files),
then press the reload arrow on the proc123 card in `chrome://extensions`.

---

## B. The command-line companion

A single `.exe` with Node built into it. Nothing to install.

### 1. Download

From the **[latest release](https://github.com/hami9/proc123/releases/latest)**,
download **`proc123-win32-x64.exe`** and put it in a folder you can find, e.g.
`C:\Users\<you>\proc123\`.

The file is around 90 MB — that is the Node runtime travelling inside it, not a
mistake.

### 2. Let Windows run it

The binary is not code-signed, so the first run shows **"Windows protected your
PC"**. Click **More info** → **Run anyway**. You can also unblock it up front:
right-click the file → **Properties** → tick **Unblock** → **OK**.

### 3. Run it

Open the folder in File Explorer, type `powershell` in the address bar, press
Enter, then:

```powershell
.\proc123-win32-x64.exe https://shop.example/category -o products.csv
```

`products.csv` appears next to the exe. Useful options:

```powershell
# Shopify instead of WooCommerce
.\proc123-win32-x64.exe https://shop.example/category --format shopify-csv -o products.csv

# Answer the toman/rial question up front
.\proc123-win32-x64.exe https://shop.example/category --unit toman -o products.csv

# Stop after 5 pages, and write the troubleshooting report
.\proc123-win32-x64.exe https://shop.example/category --max-pages 5 --report why.txt

# Everything it supports
.\proc123-win32-x64.exe --help
```

Ctrl-C stops a scan; running the same command again **resumes** where it
stopped rather than starting over.

Rename it to `proc123.exe` if the long name annoys you — nothing depends on the
filename.

### When the companion reports zero products

The companion reads the HTML a server sends. A shop that builds its catalogue
in the browser looks empty to it, and it says so rather than reporting a bare
zero. Use the extension for those shops — that is what it is for.

---

## C. Building from source (optional)

Only needed if you want to change the code.

1. Install **[Node.js 20.11 or newer](https://nodejs.org/en/download)** (the LTS
   installer; accept the defaults).
2. Install **[Git for Windows](https://git-scm.com/download/win)**.
3. Open **PowerShell** and run:

```powershell
git clone https://github.com/hami9/proc123.git
cd proc123
npm install
npm run build -w @proc123/extension
```

That builds both browsers at once. Load `packages\extension\dist\chrome`
following step 3 above.

```powershell
npm run build -w @proc123/companion          # dist\proc123.js, run with node
npm run build:binary -w @proc123/companion   # your own proc123-win32-x64.exe
npm run check                                # format, lint, typecheck, tests
```

If `npm install` fails with a script-execution error, PowerShell is blocking
npm's shim. Either use **Command Prompt** instead, or run once:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

---

## Troubleshooting

| What you see                                                   | What it means                                                                                                                                                                 |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Load unpacked** is greyed out or missing                     | Developer mode is off. Toggle it on the extensions page and reload the tab.                                                                                                   |
| "Manifest file is missing or unreadable"                       | You picked the zip, or a folder one level too high. Pick the folder that directly contains `manifest.json`.                                                                   |
| **Pack extension** asks for a root directory and a private key | That button is for signing an upload to the Chrome Web Store, not for installing. The `.crx` it produces is one Chrome will refuse to install. Use **Load unpacked** instead. |
| Nothing happens when you open a `.crx`                         | Chrome blocks extension files from outside its store. There is no setting for it — see [publishing.md](publishing.md).                                                        |
| The extension vanished after restarting Firefox                | Expected — Firefox temporary add-ons are per-session. Use Chrome or Edge for a persistent install.                                                                            |
| The extension vanished after restarting Chrome                 | The folder you loaded it from was moved, renamed or deleted. Put it back, or load it again from its new location.                                                             |
| The scan stops and says the site blocked it                    | Working as intended. proc123 does not solve CAPTCHAs, rotate proxies, or retry past a block — see [the README](../README.md#what-proc123-will-not-do).                        |
| "Windows protected your PC"                                    | The binary is unsigned. **More info** → **Run anyway**, or Properties → **Unblock**.                                                                                          |
| Prices are exactly 10× off                                     | The toman/rial answer was wrong. Re-export with the other setting — the raw scan is unaffected.                                                                               |
| Excel mangles the Persian/Arabic text                          | Open the CSV in LibreOffice, or use Excel's **Data → From Text/CSV** import rather than double-clicking the file.                                                             |
| The scan says a category is incomplete                         | The shop paginates with a "load more" button or infinite scroll and published no next-page link. proc123 says so rather than pretending the category ended.                   |

Still stuck? [Open an issue](https://github.com/hami9/proc123/issues/new/choose)
and attach the report from **Why is this field empty?**.
