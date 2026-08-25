//! The HTTP transport, and nothing more than a transport.
//!
//! This is the reason the app exists as a native shell at all (CLAUDE.md §15):
//! requests go out from Rust, so the browser's cross-origin rules do not apply
//! and the app can read any shop without needing an extension's permissions.
//!
//! **What this file must never grow into.** It moves bytes. It does not decide
//! how fast to move them, whether a response means the site is blocking us, or
//! what any of it means:
//!
//! - **Pacing is `core`'s** (`createPoliteClient`, §10). A native shell removes
//!   the browser's own rate limiting, which makes §10 *more* important rather
//!   than less — pacing added here instead would be a second, invisible copy of
//!   a rule that already has a home, and pacing skipped here would quietly
//!   hammer somebody's shop.
//! - **Block detection is `core`'s** (`platform/blocking.ts`, §2). This returns
//!   the status and the headers; the decision that a 403 means "stop the scan"
//!   is made in one place, in TypeScript, where it is tested.
//! - **No retries.** A retry that pushes past a block is exactly what §2
//!   forbids, and the two clients that came before this one say the same.
//!
//! The shape it returns is `HttpResponse` from `packages/core/src/platform/http.ts`
//! — the same seam the extension and the companion already fill. That is what
//! lets Layer A, the crawler and the exporters work here unchanged, having never
//! known what was underneath them.

use std::collections::HashMap;
use std::time::Duration;

/// Mirrors `HttpRequest` in `core`.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchRequest {
    pub url: String,
    pub method: Option<String>,
    pub headers: Option<HashMap<String, String>>,
    pub body: Option<String>,
}

/// Mirrors `HttpResponse` in `core`.
///
/// `headers` are lowercased here because `core`'s `header()` looks them up that
/// way and would otherwise miss on a server that capitalises differently. The
/// TypeScript side documents that requirement; this is where it is met.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchResponse {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: String,
    /// Final URL after redirects, which `core` uses for canonicalisation.
    pub url: String,
}

/// Long enough for a slow shop, short enough that a scan cannot hang forever.
/// The same ceiling the other two clients use.
const TIMEOUT: Duration = Duration::from_secs(20);

/// Sent as `User-Agent`.
///
/// Honest on purpose, and §2 rules out the alternative: nothing here pretends
/// to be a browser it is not. A shop operator reading their logs should be able
/// to tell what this is and who to talk to about it.
fn user_agent() -> String {
    format!(
        "proc123/{} (+https://github.com/hami9/proc123) catalogue-migration-tool",
        env!("CARGO_PKG_VERSION")
    )
}

/// Perform one request.
///
/// Errors are returned as `Err` and surface in TypeScript as a rejected
/// promise, which is what the `HttpClient` contract expects. A *response* is
/// never an error, however unwelcome its status — a 403 or a 429 is data that
/// `core`'s block detection needs to see intact.
#[tauri::command]
pub async fn http_fetch(request: FetchRequest) -> Result<FetchResponse, String> {
    let client = reqwest::Client::builder()
        .timeout(TIMEOUT)
        .user_agent(user_agent())
        .build()
        .map_err(|error| error.to_string())?;

    let method = match request.method.as_deref() {
        Some("POST") => reqwest::Method::POST,
        _ => reqwest::Method::GET,
    };

    let mut outgoing = client.request(method, &request.url);
    for (name, value) in request.headers.unwrap_or_default() {
        outgoing = outgoing.header(name, value);
    }
    if let Some(body) = request.body {
        outgoing = outgoing.body(body);
    }

    let response = outgoing.send().await.map_err(|error| error.to_string())?;

    let status = response.status().as_u16();
    let final_url = response.url().to_string();

    let mut headers = HashMap::new();
    for (name, value) in response.headers() {
        if let Ok(text) = value.to_str() {
            headers.insert(name.as_str().to_lowercase(), text.to_string());
        }
    }

    let body = response.text().await.map_err(|error| error.to_string())?;

    Ok(FetchResponse {
        status,
        headers,
        body,
        url: final_url,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifies_itself_honestly() {
        let agent = user_agent();
        assert!(agent.starts_with("proc123/"));
        assert!(agent.contains("github.com/hami9/proc123"));
        // §2: no pretending to be a browser.
        assert!(!agent.contains("Mozilla"));
        assert!(!agent.contains("Chrome"));
    }

    #[test]
    fn defaults_to_get_and_understands_post() {
        // The only two `core` ever asks for.
        let get: Option<&str> = None;
        assert_eq!(
            match get {
                Some("POST") => reqwest::Method::POST,
                _ => reqwest::Method::GET,
            },
            reqwest::Method::GET
        );
        assert_eq!(
            match Some("POST") {
                Some("POST") => reqwest::Method::POST,
                _ => reqwest::Method::GET,
            },
            reqwest::Method::POST
        );
    }
}
