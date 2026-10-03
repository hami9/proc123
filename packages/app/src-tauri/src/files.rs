//! Writing a file to disk.
//!
//! One of the four things §15 gives Rust, and one of the two capabilities the
//! extension cannot have: the popup has to go through a download prompt for
//! every export, and a service worker cannot even make a blob URL. Here the
//! user picks a place once and the bytes are written.
//!
//! The front end decides *what* to write — the exporter is `packages/exporters`,
//! shared with the other two surfaces. This decides nothing about the content.

use tauri_plugin_dialog::DialogExt;

/// Where a file ended up, or that the user changed their mind.
///
/// Cancelling is an ordinary outcome and not an error: a save dialog exists to
/// be declined, and reporting that as a failure would put a red message in
/// front of somebody who simply pressed Escape.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveOutcome {
    pub saved: bool,
    pub path: Option<String>,
}

/// Ask where to put a file, then write it.
///
/// The text arrives already complete — headers, BOM and all — because §7.9's
/// UTF-8 BOM and every CSV rule live in the exporter where they are tested.
/// Writing the string verbatim is what keeps that true.
#[tauri::command]
pub async fn save_text_file(
    app: tauri::AppHandle,
    suggested_name: String,
    contents: String,
) -> Result<SaveOutcome, String> {
    let picked = app
        .dialog()
        .file()
        .set_file_name(&suggested_name)
        .blocking_save_file();

    let Some(picked) = picked else {
        return Ok(SaveOutcome {
            saved: false,
            path: None,
        });
    };

    let shown = picked.to_string();
    write_picked(&app, picked, &contents)?;

    Ok(SaveOutcome {
        saved: true,
        path: Some(shown),
    })
}

/// Write to wherever the dialog pointed, on the desktop: a plain path.
#[cfg(not(target_os = "android"))]
fn write_picked(
    _app: &tauri::AppHandle,
    picked: tauri_plugin_dialog::FilePath,
    contents: &str,
) -> Result<(), String> {
    let path: std::path::PathBuf = picked
        .into_path()
        .map_err(|_| "the chosen location is not a file path".to_owned())?;
    std::fs::write(&path, contents).map_err(|error| error.to_string())
}

/// Write to wherever the dialog pointed, on Android: a `content://` URI.
///
/// Android's save dialog is the Storage Access Framework, and it hands back a
/// document URI rather than a path — the app is granted that one document and
/// nothing else, which is exactly the right amount of access for an export.
///
/// The desktop branch cannot be reused here, and the way it fails is the reason
/// this is spelled out. `into_path()` on a `content://` URI is an error, and the
/// old code turned that error into `None` — which then read as the user
/// pressing Cancel. On a phone, every export reported "not saved" and wrote
/// nothing, with no error anywhere.
#[cfg(target_os = "android")]
fn write_picked(
    app: &tauri::AppHandle,
    picked: tauri_plugin_dialog::FilePath,
    contents: &str,
) -> Result<(), String> {
    use std::io::Write;
    use tauri_plugin_fs::{FsExt, OpenOptions};

    let mut options = OpenOptions::default();
    // `truncate` because a document the user picked to overwrite must not keep
    // the tail of a longer file it replaced — a CSV with a stale last row is a
    // corrupt import that looks fine.
    options.write(true).truncate(true).create(true);

    let mut file = app
        .fs()
        .open(picked, options)
        .map_err(|error| error.to_string())?;
    file.write_all(contents.as_bytes())
        .map_err(|error| error.to_string())
}
