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
//! Phase 16 adds HTTP (`http.rs`) — a transport and nothing more. The bridge is
//! still phase 17.

mod files;
mod http;

use tauri::Manager;

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
        .setup(|app| {
            let _ = app.get_webview_window("main");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            host_info,
            http::http_fetch,
            files::save_text_file
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
