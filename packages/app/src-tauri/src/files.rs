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
    let mut dialog = app.dialog().file().set_file_name(&suggested_name);
    // A filter gives the dialog a real type. Without one, Android's document
    // picker is asked for `*/*`, and a provider may then store the file with no
    // usable MIME type or rewrite its extension — a CSV that no longer opens as
    // a spreadsheet.
    if let Some((label, extension)) = filter_for(&suggested_name) {
        dialog = dialog.add_filter(label, &[extension]);
    }

    let Some(picked) = dialog.blocking_save_file() else {
        return Ok(SaveOutcome {
            saved: false,
            path: None,
        });
    };

    let shown = write_picked(&app, picked, &contents, &suggested_name)?;

    Ok(SaveOutcome {
        saved: true,
        path: Some(shown),
    })
}

/// The dialog filter for a file the exporter named.
fn filter_for(name: &str) -> Option<(&'static str, &'static str)> {
    let extension = name.rsplit_once('.')?.1.to_ascii_lowercase();
    match extension.as_str() {
        "csv" => Some(("CSV", "csv")),
        "json" => Some(("JSON", "json")),
        _ => None,
    }
}

/// Write to wherever the dialog pointed, on the desktop: a plain path.
///
/// Returns what to show the user — the path itself, which they can find again.
#[cfg(not(target_os = "android"))]
fn write_picked(
    _app: &tauri::AppHandle,
    picked: tauri_plugin_dialog::FilePath,
    contents: &str,
    _suggested_name: &str,
) -> Result<String, String> {
    let path: std::path::PathBuf = picked
        .into_path()
        .map_err(|_| "the chosen location is not a file path".to_owned())?;
    std::fs::write(&path, contents).map_err(|error| error.to_string())?;
    Ok(path.to_string_lossy().into_owned())
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
///
/// Returns the file's name rather than the URI: a percent-encoded document ID
/// tells nobody where the file went, and the name is what they will look for.
#[cfg(target_os = "android")]
fn write_picked(
    app: &tauri::AppHandle,
    picked: tauri_plugin_dialog::FilePath,
    contents: &str,
    suggested_name: &str,
) -> Result<String, String> {
    use std::io::Write;
    use tauri_plugin_fs::{FsExt, OpenOptions};

    // Mode `w` alone — no truncate, no create. `ACTION_CREATE_DOCUMENT` has just
    // made an empty document, so there is nothing to truncate, and plain `w` is
    // the mode every document provider supports. That matters more than it
    // looks: tauri-plugin-fs 2.5 hits `unimplemented!()` when a provider returns
    // no descriptor for the requested mode, and with `panic = "abort"` in the
    // release profile that would kill the app mid-export. `wt` is the mode some
    // cloud providers refuse.
    let mut options = OpenOptions::default();
    options.write(true);

    let mut file = app
        .fs()
        .open(picked, options)
        .map_err(|error| error.to_string())?;
    file.write_all(contents.as_bytes())
        .map_err(|error| error.to_string())?;
    Ok(suggested_name.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_export_gets_a_filter_for_its_own_type() {
        assert_eq!(filter_for("proc123-shop.csv"), Some(("CSV", "csv")));
        assert_eq!(filter_for("proc123-shop.JSON"), Some(("JSON", "json")));
        assert_eq!(filter_for("report.txt"), None);
        assert_eq!(filter_for("no-extension"), None);
    }
}
