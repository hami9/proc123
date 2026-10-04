//! Android's share inbox. The front end pulls only after it is ready and idle.
use tauri::{plugin::PluginHandle, Manager};

pub struct ShareHandle(PluginHandle<tauri::Wry>);

#[derive(serde::Deserialize, serde::Serialize)]
pub struct SharedText {
    text: Option<String>,
}

pub fn init() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("share")
        .setup(|app, api| {
            let handle = api.register_android_plugin("com.github.hami9.proc123", "SharePlugin")?;
            app.manage(ShareHandle(handle));
            Ok(())
        })
        .build()
}

#[tauri::command]
pub async fn take_shared_text(state: tauri::State<'_, ShareHandle>) -> Result<SharedText, String> {
    state
        .0
        .run_mobile_plugin_async("take", serde_json::json!({}))
        .await
        .map_err(|error| error.to_string())
}
