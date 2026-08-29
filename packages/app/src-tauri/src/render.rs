//! Rendering a page in a real WebView.
//!
//! This is the failure the CLI has always had and the extension never has: a
//! shop that builds its product grid in JavaScript ships an empty shell to
//! anything that only reads HTML, and reads as zero products. The extension
//! escapes it by living inside a browser that already rendered the page. The
//! app escapes it by hosting a WebView of its own (CLAUDE.md §15).
//!
//! **Two capabilities, and the second is deliberate.** `rendered_html` is what
//! phase 16 needs. `evaluate` is what phase 27 needs to read Core Web Vitals out
//! of the Performance API, and it is written now because adding it later means
//! reopening this plumbing rather than writing one more command.
//!
//! ## The remote-page rule
//!
//! These windows load **somebody else's page**, so they get none of Tauri's IPC.
//! `WebviewWindowBuilder` does not inject the API unless asked, and it must
//! never be asked here — a scanned shop that could reach `invoke` would have the
//! filesystem and the HTTP client of this process. Results come back through
//! `eval_with_callback`, which is a one-way read and gives the page nothing.
//!
//! ## What this is not
//!
//! Not a way around a block. §2's hard constraint is permanent, and a WebView
//! makes it easier to violate rather than less binding: no CAPTCHA solving, no
//! fingerprint spoofing, no retrying past a refusal. This renders a page the way
//! a person opening it would, and when a site refuses, the refusal stands.
//!
//! Not a way around politeness. Rendering a page is a request to somebody's
//! server plus every subresource it pulls — *more* load than a plain fetch, not
//! less. The caller paces these exactly as it paces `http_fetch`; §10 does not
//! stop applying because the request came from a WebView.

use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{Duration, Instant};

use tauri::{WebviewUrl, WebviewWindowBuilder};

/// How long to wait before the first size check.
///
/// Not a correctness knob so much as a floor — nothing has painted before this.
const SETTLE_MS: u64 = 1_500;

/// How often to re-measure the document while waiting for it to stop growing.
const POLL_MS: u64 = 500;

/// How long to wait for the page to become responsive at all.
///
/// **Separate from the settle budget on purpose, and that separation is a bug
/// fix.** These are two different waits: "has this page loaded yet" and "has it
/// stopped changing". Sharing one budget meant a slow first load spent the
/// whole allowance before a single useful measurement — the same page rendered
/// 415KB when it loaded quickly and returned nothing when it did not, purely
/// because the unanswered probes ate the time the settling needed.
const MAX_LOAD_MS: u64 = 45_000;

/// How long to keep waiting, once responsive, for the document to stop growing.
const MAX_SETTLE_MS: u64 = 25_000;

/// How many consecutive unchanged measurements mean "finished".
///
/// Three rather than two. A hydrating app pauses between the shell and the
/// data, and two quiet polls was still eager enough to catch one of those
/// pauses — digikala settled at 17KB when its real page is far larger.
const STABLE_POLLS: u32 = 3;

/// How long to wait for a **probe** — a cheap question like `outerHTML.length`.
///
/// Short on purpose. A loaded page answers instantly; a page that has not
/// finished loading never answers at all, because wry queued the script and
/// dropped the callback. So this is not "how slow might a page be", it is "how
/// long before we conclude it is not ready yet", and a long value only makes
/// probing an unloaded page expensive.
const PROBE_TIMEOUT: Duration = Duration::from_secs(2);

/// How long to wait for the **payload** — the document itself.
///
/// Deliberately much longer than a probe, and the distinction is not cosmetic:
/// using one timeout for both was a real bug. Returning a few hundred kilobytes
/// of HTML means serialising it to JSON and carrying it across the callback
/// boundary, which takes far longer than answering `.length`. With a
/// two-second ceiling that read timed out and came back **empty**, which reads
/// exactly like a page that rendered nothing — the very failure this module
/// exists to distinguish from.
const PAYLOAD_TIMEOUT: Duration = Duration::from_secs(30);

/// The ceiling has to leave room for more than one measurement, or the settle
/// loop degrades into the fixed sleep it replaced. A compile-time guard rather
/// than a test, because these are constants and asserting on a constant at
/// runtime is a tautology clippy is right to reject.
const _: () = assert!(MAX_SETTLE_MS > POLL_MS * STABLE_POLLS as u64);

/// Window labels must be unique and a survey renders many pages in sequence.
static NEXT_ID: AtomicU32 = AtomicU32::new(0);

fn next_label() -> String {
    format!("proc123-render-{}", NEXT_ID.fetch_add(1, Ordering::Relaxed))
}

/// http(s) only.
///
/// A `file:` or `tauri:` URL reaching here would point the renderer at the local
/// disk or at the app's own origin. The caller is TypeScript handling URLs that
/// came off a scanned page, so this is validated where it is enforced rather
/// than where it is convenient.
fn checked_url(url: &str) -> Result<tauri::Url, String> {
    let parsed: tauri::Url = url.parse().map_err(|_| format!("not a URL: {url}"))?;
    match parsed.scheme() {
        "http" | "https" => Ok(parsed),
        other => Err(format!("refusing to render a {other} URL")),
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderedPage {
    /// The URL the window ended on, after any client-side redirect.
    pub url: String,
    /// A JSON string — `eval_with_callback` serialises whatever the script
    /// returned. For `rendered_html` that is the outer HTML as a JSON string.
    pub result: String,
}

/// Run one script in the window and wait for its JSON answer.
///
/// Fully async, and deliberately so. The first version parked a thread on a
/// blocking `recv_timeout`; the callback is delivered by the platform's own
/// event loop, and holding a thread hostage while waiting for it is the kind of
/// arrangement that deadlocks on one platform and not another. A tokio channel
/// awaits without occupying anything.
async fn eval_once(
    window: &tauri::WebviewWindow,
    script: &str,
    timeout: Duration,
) -> Result<String, String> {
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    window
        .eval_with_callback(script, move |value| {
            // A closed channel means the receiver already gave up. Nothing to
            // do and nothing worth reporting.
            let _ = tx.send(value);
        })
        .map_err(|error| error.to_string())?;

    match tokio::time::timeout(timeout, rx.recv()).await {
        Ok(Some(value)) => Ok(value),
        Ok(None) => Err("the page closed before answering".to_string()),
        Err(_) => Err("the page did not answer".to_string()),
    }
}

/// Wait until the page has loaded and its document has stopped growing.
///
/// **Why a failed `eval` here means "not yet" rather than "broken".** wry queues
/// a script when the webview is still loading and drops the callback on the
/// floor without calling it — `webkitgtk/mod.rs` pushes to `pending_scripts`
/// and returns `Ok(())`, so the caller waits for an answer that was never going
/// to come. Treating that as a failure and giving up was the bug: every render
/// returned the pre-JS shell, which is exactly what the renderer exists to
/// avoid, and it looked like "this page has no products".
///
/// So an unanswered poll is simply an unloaded page. Keep asking until it
/// answers, then keep asking until the answer stops changing.
async fn wait_for_settle(window: &tauri::WebviewWindow) -> u32 {
    tokio::time::sleep(Duration::from_millis(SETTLE_MS)).await;

    // Phase one: wait for the page to answer anything at all. Until wry stops
    // queueing scripts there is nothing to measure, and how long that takes
    // says nothing about how long settling will take.
    let loading = Instant::now();
    let load_ceiling = Duration::from_millis(MAX_LOAD_MS);
    let mut answered = 0u32;

    while loading.elapsed() < load_ceiling {
        if eval_once(window, "1", PROBE_TIMEOUT).await.is_ok() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(POLL_MS)).await;
    }

    // Phase two: it is responsive, so measure until the size holds still. This
    // budget starts now rather than at navigation, so a slow load no longer
    // steals the time the measuring needs.
    let settling = Instant::now();
    let settle_ceiling = Duration::from_millis(MAX_SETTLE_MS);
    let mut last = 0usize;
    let mut stable = 0u32;

    while settling.elapsed() < settle_ceiling {
        match eval_once(
            window,
            "document.documentElement.outerHTML.length",
            PROBE_TIMEOUT,
        )
        .await
        {
            Ok(value) => {
                answered += 1;
                let size = value.trim().trim_matches('"').parse::<usize>().unwrap_or(0);
                if size > 0 && size == last {
                    stable += 1;
                    if stable >= STABLE_POLLS {
                        break;
                    }
                } else {
                    stable = 0;
                }
                last = size;
            }
            // Went quiet again mid-render. Not a reason to stop.
            Err(_) => stable = 0,
        }

        tokio::time::sleep(Duration::from_millis(POLL_MS)).await;
    }
    answered
}

/// Run a script, retrying while the page is still loading.
///
/// Same reason as `wait_for_settle`: a queued script's callback never fires, so
/// the only way to tell "not loaded yet" from "will never answer" is to ask
/// again until the ceiling.
async fn eval_when_ready(window: &tauri::WebviewWindow, script: &str) -> Result<String, String> {
    let started = Instant::now();
    let ceiling = Duration::from_millis(MAX_LOAD_MS);
    loop {
        match eval_once(window, script, PAYLOAD_TIMEOUT).await {
            Ok(value) => return Ok(value),
            Err(error) if started.elapsed() >= ceiling => return Err(error),
            Err(_) => tokio::time::sleep(Duration::from_millis(POLL_MS)).await,
        }
    }
}

/// Open a hidden window on `url`, let it settle, run `script`, return its value.
///
/// The window is closed on every path. A leaked WebView per page would exhaust
/// the process during a site survey, which is precisely when it would hurt.
async fn render_and_eval(
    app: &tauri::AppHandle,
    url: &str,
    script: String,
) -> Result<RenderedPage, String> {
    let parsed = checked_url(url)?;
    let label = next_label();

    // **The window has to be realised, not merely created.** `visible(false)`
    // was the obvious choice and it is wrong on WebKitGTK: a GTK window that is
    // never mapped does not start its webview, so the page never loads, no
    // script ever runs, and every `eval` times out with "the page did not
    // answer" — which reads exactly like a slow site and is not one.
    //
    // So it is shown, and kept out of the way instead: undecorated, off the
    // taskbar, never focused, and small. Moved off-screen after building,
    // because a position given to the builder is advisory and several window
    // managers ignore it.
    let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::External(parsed))
        .visible(true)
        .focused(false)
        .decorations(false)
        .skip_taskbar(true)
        .inner_size(1024.0, 768.0)
        .build()
        .map_err(|error| error.to_string())?;

    // A viewport still has to be a plausible size — a 1x1 window makes a
    // responsive shop render its mobile layout, or nothing at all.
    let _ = window.set_position(tauri::PhysicalPosition::new(-20_000, -20_000));

    // Wait for the page to stop changing rather than for a fixed moment. The
    // load event fires on the empty shell, long before the grid exists.
    let polls = wait_for_settle(&window).await;

    let outcome = eval_when_ready(&window, &script).await;
    if let Err(error) = &outcome {
        eprintln!("[proc123] render eval failed: {error}");
    }

    // Once a page renders, the next question is whether it publishes anything
    // Layer B can read. A megabyte of rendered product grid with no schema.org
    // markup in it is not a rendering failure — it is a shop that needs Layer C
    // — and telling those two apart from the outside is guesswork without this.
    if let Ok(rendered) = &outcome {
        let count = |needle: &str| rendered.matches(needle).count();
        eprintln!(
            "[proc123] markup in rendered page: ld+json={} itemtype={} og:={} product-ish={}",
            count("application/ld+json"),
            count("itemtype"),
            count("og:"),
            count("schema.org/Product")
        );
    }

    // When a render comes back suspiciously small, say what the page actually
    // contained. "9 KB of nothing" and "9 KB saying please enable JavaScript"
    // are different findings and only one of them is our problem.
    if let Ok(value) = &outcome {
        if value.len() < 60_000 {
            if let Ok(text) = eval_once(
                &window,
                "(document.body?document.body.innerText:'').slice(0,300)",
                PROBE_TIMEOUT,
            )
            .await
            {
                eprintln!("[proc123] render text: {text}");
            }
        }
    }
    eprintln!(
        "[proc123] render {} settled after {} answered poll(s), {} bytes",
        url,
        polls,
        outcome.as_ref().map(String::len).unwrap_or(0)
    );

    let final_url = window
        .url()
        .map(|value| value.to_string())
        .unwrap_or_else(|_| url.to_string());

    // Best-effort: a cleanup failure must not be reported as a render failure.
    let _ = window.close();

    outcome.map(|result| RenderedPage {
        url: final_url,
        result,
    })
}

/// The rendered DOM of a page.
#[tauri::command]
pub async fn rendered_html(app: tauri::AppHandle, url: String) -> Result<RenderedPage, String> {
    render_and_eval(&app, &url, "document.documentElement.outerHTML".to_string()).await
}

/// Run a script in the page and return whatever it evaluated to, as JSON.
///
/// Phase 27 reads Core Web Vitals through this. It is a **read**: §16 says the
/// inspector never modifies the page it is looking at, and a script that did
/// would be a defect rather than a feature.
#[tauri::command]
pub async fn evaluate(
    app: tauri::AppHandle,
    url: String,
    script: String,
) -> Result<RenderedPage, String> {
    render_and_eval(&app, &url, script).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn window_labels_are_unique() {
        // Tauri requires a unique label per window and a survey renders many
        // pages in sequence. A collision would fail only the second render,
        // which is the kind of bug that reads as intermittent.
        let first = next_label();
        let second = next_label();
        assert_ne!(first, second);
        assert!(first.starts_with("proc123-render-"));
    }

    #[test]
    fn only_http_urls_are_rendered() {
        assert!(checked_url("https://shop.example/c/nuts").is_ok());
        assert!(checked_url("http://shop.example/").is_ok());

        // Each of these would point the renderer somewhere it has no business
        // being, and each could arrive from a scanned page's own markup.
        assert!(checked_url("file:///etc/passwd").is_err());
        assert!(checked_url("tauri://localhost").is_err());
        assert!(checked_url("javascript:alert(1)").is_err());
        assert!(checked_url("not a url at all").is_err());
    }
}
