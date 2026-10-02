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

mod bridge;
mod files;
mod http;
mod render;

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
}

#[tauri::command]
fn host_info() -> HostInfo {
    HostInfo {
        platform: std::env::consts::OS,
        version: env!("CARGO_PKG_VERSION"),
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
struct BridgeHandle(std::sync::Mutex<Option<bridge::BridgeInfo>>);

/// The pairing details, for the UI to display.
///
/// The token leaves this process exactly twice: into the app's own window, and
/// back in on a request that proves the user typed it. It is never written to
/// disk and never sent anywhere.
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
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
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
        ])
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
