//! Writing a file to disk.
//!
//! One of the four things §15 gives Rust, and one of the two capabilities the
//! extension cannot have: the popup has to go through a download prompt for
//! every export, and a service worker cannot even make a blob URL. Here the
//! user picks a place once and the bytes are written.
//!
//! The front end decides *what* to write — the exporter is `packages/exporters`,
//! shared with the other two surfaces. This decides nothing about the content.

use std::path::PathBuf;

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
    let picked: Option<PathBuf> = app
        .dialog()
        .file()
        .set_file_name(&suggested_name)
        .blocking_save_file()
        .and_then(|path| path.into_path().ok());

    let Some(path) = picked else {
        return Ok(SaveOutcome {
            saved: false,
            path: None,
        });
    };

    std::fs::write(&path, contents).map_err(|error| error.to_string())?;

    Ok(SaveOutcome {
        saved: true,
        path: Some(path.to_string_lossy().into_owned()),
    })
}
