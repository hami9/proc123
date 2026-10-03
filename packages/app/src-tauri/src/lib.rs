//! The native layer, and it is meant to stay small.
//!
//! CLAUDE.md §15 draws the line: Rust owns HTTP, the filesystem, the bridge
//! server and the WebView host. Everything else — what a product is, how a
//! price is normalised, which layer answered, what a CSV row looks like — is
//! TypeScript in `core`, shared with the extension and the companion.
//!
//! That is not a style preference. A rule implemented here cannot be shared
//! with the other two surfaces, so it gets written a second time, and the two
//! copies drift. The one failure this project is most afraid of — reading a
//! toman price as rial (§7.8) — is exactly the kind of rule that would be
//! tempting to "just handle" natively and must not be.
//!
//! Phase 16 adds HTTP (`http.rs`) — a transport and nothing more. Phase 17 adds
//! `bridge.rs`, which is a socket and nothing more: it carries a page from the
//! extension and emits it, and `core` decides what the page means.
//!
//! **Phase 18: two modules are desktop-only, and both for a reason that is not
//! "Android is far away".**
//!
//! - `render.rs` opens a hidden second WebView window. Tauri's mobile runtime
//!   supports exactly one window, so the extra one this needs cannot be opened
//!   there — a platform limit rather than a feature skipped. On Android the front
//!   end's `canRender()` answers false and a scan that finds nothing says so,
//!   which is the same honest answer the CLI gives.
//! - `bridge.rs` listens for the browser extension on loopback (§17), and §17
//!   is written about a desktop: Android browsers do not run the extension, so
//!   there is nothing to listen for. Opening a socket nobody can use would be
//!   attack surface bought for no feature.
//!
//! Everything else — HTTP, the files, the scan itself in `core` — is the same
//! code on every platform, which is the whole argument for one codebase (§15).

#[cfg(desktop)]
mod bridge;
mod files;
mod http;
#[cfg(desktop)]
mod render;

#[cfg(desktop)]
use tauri::{Emitter, Manager};

/// What the front end is told about the machine it is running on.
///
/// Small on purpose. The app has no account, no server and no telemetry (§15),
/// so this exists to let the UI say "Linux" in an about box and to let phase 20
/// tell an AppImage from a `.deb` — not to profile anyone. It is read on
/// request by the front end and never sent anywhere.
#[derive(serde::Serialize)]
pub struct HostInfo {
    /// `linux`, `windows`, `android`. Compile-time, not sniffed.
    pub platform: &'static str,
    /// The app's version, from `Cargo.toml`, so one number governs.
    pub version: &'static str,
    /// Whether this build can render a page in a hidden WebView (`render.rs`).
    ///
    /// Reported rather than inferred by the front end: the native side is the
    /// one that knows which commands it compiled in, and a guess made from the
    /// user agent would be wrong the day anyone sets one.
    pub render: bool,
    /// Whether this build runs the extension bridge (§17).
    pub bridge: bool,
}

#[tauri::command]
fn host_info() -> HostInfo {
    HostInfo {
        platform: std::env::consts::OS,
        version: env!("CARGO_PKG_VERSION"),
        render: cfg!(desktop),
        bridge: cfg!(desktop),
    }
}

/// Where the bridge is listening and the code that pairs with it (§17).
///
/// Held in a Tauri managed state rather than a global, so its lifetime is the
/// application's and there is no static to forget to clear. It is handed to the
/// front end on request so the UI can show the pairing code — and to nothing
/// else. `None` means the listener could not bind, which is not fatal: the app
/// is required to work with no extension at all, so a bridge that failed to
/// start costs the handoff and nothing more.
#[cfg(desktop)]
struct BridgeHandle(std::sync::Mutex<Option<bridge::BridgeInfo>>);

/// The pairing details, for the UI to display.
///
/// The token leaves this process exactly twice: into the app's own window, and
/// back in on a request that proves the user typed it. It is never written to
/// disk and never sent anywhere.
#[cfg(desktop)]
#[tauri::command]
fn bridge_info(state: tauri::State<'_, BridgeHandle>) -> Option<bridge::BridgeInfo> {
    state.0.lock().ok()?.clone()
}

/// Start the bridge listener, if a port is free.
///
/// Failure is deliberately soft. CLAUDE.md §17 requires the app to be fully
/// usable with the extension uninstalled, and a machine where every port in the
/// range is taken is indistinguishable, from the app's point of view, from a
/// machine with no extension on it.
#[cfg(desktop)]
async fn start_bridge(app: tauri::AppHandle) {
    let Ok((listener, port)) = bridge::bind().await else {
        return;
    };

    let token = bridge::generate_token();
    let version = env!("CARGO_PKG_VERSION").to_owned();

    if let Some(state) = app.try_state::<BridgeHandle>() {
        if let Ok(mut held) = state.0.lock() {
            *held = Some(bridge::BridgeInfo {
                port,
                token: token.clone(),
                protocol: bridge::PROTOCOL_VERSION,
            });
        }
    }

    // The handoff leaves Rust here and is not looked at again. What arrives is
    // a URL, a title and some HTML; whether that is a shop, what its prices are
    // and which unit they are quoted in are all decisions `core` makes in
    // TypeScript, where they are tested and shared with the other two surfaces.
    let emitter = app.clone();
    bridge::serve(listener, token, version, move |handoff| {
        let _ = emitter.emit("bridge://handoff", handoff);
    })
    .await;
}

/// Build and run the application.
///
/// `run` rather than `main` because phase 18's Android entry point calls this
/// too — the mobile target has no `main` of its own, it hands control here.
/// Keeping the setup in one function is what stops the two platforms drifting
/// into two different applications.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().plugin(tauri_plugin_dialog::init());

    // On Android the save dialog hands back a `content://` URI rather than a
    // path, and only the fs plugin can open one for writing (`files.rs`).
    // Gated on Android exactly as the dependency and `files.rs` are. `mobile`
    // would also match iOS, where the crate is not a dependency at all.
    #[cfg(target_os = "android")]
    let builder = builder.plugin(tauri_plugin_fs::init());

    #[cfg(desktop)]
    let builder = builder
        .manage(BridgeHandle(std::sync::Mutex::new(None)))
        .setup(|app| {
            let _ = app.get_webview_window("main");
            // Spawned rather than awaited: the bridge serves for the life of the
            // process, so blocking setup on it would mean the window never
            // opens. An app whose bridge never starts is still an app (§17).
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(start_bridge(handle));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            host_info,
            bridge_info,
            http::http_fetch,
            files::save_text_file,
            render::rendered_html,
            render::evaluate
        ]);

    // The same commands minus the three that have no mobile meaning:
    // `bridge_info`, `rendered_html` and `evaluate`. The front end does not call
    // them here, because `host_info` says which exist (`HostInfo::render`,
    // `HostInfo::bridge`) — it does not find out by being refused.
    #[cfg(mobile)]
    let builder = builder.invoke_handler(tauri::generate_handler![
        host_info,
        http::http_fetch,
        files::save_text_file
    ]);

    builder
        .run(tauri::generate_context!())
        .expect("the proc123 window could not be created");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_a_platform_and_a_version() {
        let info = host_info();
        assert!(!info.platform.is_empty());
        assert_eq!(info.version, env!("CARGO_PKG_VERSION"));
    }

    /// The targets this project builds for (§15). macOS and iOS are out, and a
    /// half-built target is worse than an absent one — so if this ever fires on
    /// a platform nobody chose, that is the signal to decide deliberately
    /// rather than discover it in a bug report.
    #[test]
    fn runs_only_on_a_platform_the_project_supports() {
        assert!(
            matches!(std::env::consts::OS, "linux" | "windows" | "android"),
            "unsupported platform: {}",
            std::env::consts::OS
        );
    }
}
