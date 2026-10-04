# Android tests

Validation date: 2026-10-04 (Asia/Tehran). Change: [PR 23](https://github.com/hami9/proc123/pull/23).
This report separates build checks, physical-device results and checks still pending.
Merging the change does not close phase 18 or publish a signed Android release.

## Environment

- Samsung Galaxy S9, SM-G960F, Android 10 / API 29, arm64.
- Android System WebView `81.0.4044.138`, unchanged during testing.
- Authorized USB debugging. No root access or OS configuration changes were used.
- Local checkout: Windows, `E:/proc123`. APKs, reports and temporary files stayed on E:.
- No Rust, Android SDK or NDK was installed locally. Native builds and Rust checks ran in GitHub Actions.
- Different CI debug signing keys required replacing only the test proc123 install. Other apps and Downloads were preserved.
- The owned Persian fixture used `127.0.0.1:18123` over USB port forwarding. Its server and forwarding were removed after testing.

## Automated checks

On app-source commit `7f442f8d1d9f3cdba6b963d3202b7288b67f8ccd`:

- Local `npm run check`: formatting, lint, typecheck and **900 tests in 43 files** passed.
- Local app front-end build and `npm run release:check` passed.
- [CI run 37211170092](https://github.com/hami9/proc123/actions/runs/37211170092): all five jobs passed. These cover Windows/Linux TypeScript checks, Windows/Linux Rust lint and tests, and the Android APK build.
- Android JVM reports: six `SharePluginTest` tests and three `ShareActivityTest` tests passed, with zero failures, errors or skips. These are Robolectric tests, not nine physical-phone tests.

Regression coverage includes:

- Cold/warm shared text, styled `CharSequence`, MIME normalization, replay prevention, unsupported extras, inbox limits and arrival order.
- Receiver task flags, bounded text-only forwarding, no browser URI/stream forwarding and no restored-receiver replay. Android's automatic plain-text clip migration is checked separately from the prepared intent.
- Delaying shares while a scan/export is busy, retaining a share when a manual scan starts during IPC, invalid URL input and native failure handling.
- Reproducible Android source/manifest/test overlays, idempotent preparation and fail-closed template drift checks.
- Final-URL crawl lookup after native HTTP and rendered-page redirects.
- Session-only extension pairing codes, removal of old disk-backed codes and behavior without session storage.
- ES2020 bundle parsing with a WebView 81 target; CSV behavior without `replaceAll` or `Array.at`; no `replaceChildren` calls; narrowly scoped internal IPC CSP access.
- Seven app-export tests: both CSV formats, source/destination unit separation, known/mixed units, sale prices, unchanged scan data, unanswered-unit rejection, non-Iranian prices, fractional toman and JSON source-unit annotations.

## Physical results

The product scans below used an owned Persian fixture, not a successful extraction from Digikala.

| Check                         | Result                   | Tested build and evidence                                                                                                                                                                                                      |
| ----------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Install and cold Chrome Share | Passed                   | `434de5f`, repeated on `7f442f8`; actual Chrome Share menu opened the previously unopened app and read one product.                                                                                                            |
| Warm Chrome Share             | Passed after fix         | `8847404`; same process, one MainActivity in the app task, one new walnut scan. A later URL share on `7f442f8` also retained the existing process and host.                                                                    |
| Share during a scan           | Passed                   | `8847404`; the slow scan finished before the queued walnut request started, with no lost share, duplicate fixture request or overlapping crawl.                                                                                |
| Rotation replay               | Passed                   | `8847404`; the user reported preserved results and no replay. The landscape hierarchy still showed one product, the fixture received no new request, and portrait was subsequently verified. This is not a process-death test. |
| Persian scan and saved CSV    | Passed                   | `434de5f`; one Layer B product, native HTTP 200, actual file pulled from Downloads and parsed.                                                                                                                                 |
| Currency gate                 | Passed                   | `434de5f` and `7f442f8`; export disabled before an explicit source-unit answer.                                                                                                                                                |
| Rial source to toman export   | Passed after fix         | `7f442f8`; `240000` rial became `24000` in preview, table and the saved CSV.                                                                                                                                                   |
| Toman source to toman export  | Passed                   | `7f442f8`; preview, table and saved CSV agreed on `240000`.                                                                                                                                                                    |
| Persian UI                    | Passed for sampled views | `434de5f`; language switch, RTL navigation and Persian count digits. Not full visual QA.                                                                                                                                       |
| Large native response         | Passed after CSP fix     | `7c05d6c`; 50,901-byte fixture response produced one product without JavaScript or IPC CSP errors.                                                                                                                             |
| Active rate limit             | Passed                   | `7c05d6c`; owned HTTP 429 fixture stopped after one request, explained the block and offered no retry or export.                                                                                                               |
| Digikala category             | No products extracted    | `434de5f`; one bounded scan returned HTTP 200, 13,866 bytes and Next.js signals, but zero products. No bypass, spoofing, proxy or scan retry was used.                                                                         |
| Plain text without a URL      | Not physically verified  | Unit coverage passes. The attempted user-assisted share contained a page URL, so it was not a negative test.                                                                                                                   |

Queued-share timing on `8847404`, recorded in UTC:

- Slow request started at `14:42:40.764Z`.
- Browser Share arrived at `14:42:48.241Z`, while that request was running.
- Slow response completed at `14:42:56.768Z`.
- Queued walnut request started at `14:42:57.064Z`.

## Fix history

- `6c6fcb0`: the APK installed, but WebView 81 rejected ES2022 `??=` syntax before the scan UI started.
- `fc7a268`: lowered syntax and replaced newer CSV runtime APIs. Device testing then found unsupported DOM `replaceChildren`.
- `434de5f`: replaced view clearing with `textContent = ''`; cold Share, scan and export worked.
- `7c05d6c`: allowed only Tauri's internal response channel in `connect-src`. Warm Chrome Share then exposed a second, blank MainActivity in the browser task.
- `af438b5`: added a separate ShareActivity. One native test failed because Android automatically migrates text into a plain-text clip at launch.
- `8847404`: corrected that assertion without weakening URI/stream checks. All nine native tests and warm/queued phone shares passed. A saved rial-source CSV still contained `240000` despite the `24000` preview.
- `7f442f8`: separated source confirmation from destination units using shared core conversion. Both actual phone CSV choices now agree with the preview and table.

The failed rial file was renamed on the phone to
`Download/proc123-s9-final-2026-10-04.invalid.txt`. It is diagnostic evidence,
not an import file. Its old `.csv` path was checked and no longer exists.

## Artifact identity

Tested APK from [CI run 37211170092](https://github.com/hami9/proc123/actions/runs/37211170092), artifact `proc123-android-debug`:

```text
Commit: 7f442f8d1d9f3cdba6b963d3202b7288b67f8ccd
APK SHA-256: 6182541cb72dc7aecd8e7485971760ab4aa51d0f7cacca17093efd6f65d7ab0c
```

Files were saved through Android's Storage Access Framework and pulled only
after writing completed. Each has one product, canonical English headers,
UTF-8 BOM, name `گردو آزمایشی`, SKU `P123-hlz4zh8i`, category `آجیل > مغزها`
and empty description columns under the default structured-only mode.

| Phone file in Downloads              | Source / destination | Regular price | Bytes | SHA-256                                                            |
| ------------------------------------ | -------------------- | ------------- | ----- | ------------------------------------------------------------------ |
| `proc123-s9-verified-2026-10-04.csv` | Rial / toman         | `24000`       | 354   | `d0d6e3aa99baae2a2fc100a5bc7fdf0457549d6741a514c890fd8ad15f1950bc` |
| `proc123-s9-toman-2026-10-04.csv`    | Toman / toman        | `240000`      | 355   | `39b167c05184b66303bd3d88a20c3314ea852fc650ceae42d0efd9221fe91ff4` |

Detailed local XML/screenshot/JVM reports and pulled files are retained in
`E:/proc123-artifacts/device-s9` and `E:/proc123-artifacts/pr-23/7f442f8`.
They are local evidence, not public download links. Personal browser URLs and
unrelated phone content are not included in this report.

## Review and limits

The final code check covered the receiver/inbox, scan scheduling, export conversion,
WebView compatibility, redirect lookup, source overlay and pairing storage.
The bot's MIME-normalization finding is fixed and its inline thread is resolved.
The CodeRabbit check also reported that automatic reviews were paused; a green
status does not mean the bot reviewed every later commit.

The bot also raised a destination-policy concern outside the diff. Native
`http_fetch` already supports user-selected loopback/private-network URLs and
ordinary HTTP redirects; this PR does not change that policy. The owned phone
fixture used that capability. This is a local app, not a remotely hosted fetch
service, but shared URLs remain untrusted and network-destination isolation is
not enforced or claimed. A stricter policy needs a separate design decision,
including how intentional local-store scans should work.

Phase 18 stays **partial**:

- Complete the plain-text/no-URL share check on the physical phone.
- Correct the observed status/navigation-bar overlap and finish mobile visual QA.
- Broader Android/WebView coverage and background/process-death scenarios remain unverified.

No WooCommerce/Shopify import on a live target store, successful Digikala
extraction, local Rust test, WebView update or public owner-signed APK is claimed.
Android release signing/distribution remains phase 20 work.
