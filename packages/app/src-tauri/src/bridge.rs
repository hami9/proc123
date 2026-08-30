//! The loopback bridge (CLAUDE.md §17).
//!
//! The extension has the one thing this app cannot get: a page in a session
//! the user is already logged in to. The app has the things a popup cannot
//! keep: no CORS, a real filesystem, and a process that outlives the popup
//! being closed. This module is the seam between them and carries nothing else.
//!
//! **The security model is three properties and none is optional.**
//!
//! - It binds `127.0.0.1` and only that. Not `0.0.0.0`, not a name that
//!   resolves — the literal, so nothing can repoint it.
//! - The port is chosen by the OS and reported to the user, who pairs by hand.
//! - The token is 16 bytes from the OS CSPRNG, generated once per run and held
//!   in memory. It is never written to disk, never logged, and there is no
//!   second scheme to fall back to.
//!
//! **What this file must never grow into.** It moves pages and results. It does
//! not extract, normalise, or decide anything — `runScan` lives in `core` and is
//! shared by all three surfaces, and a second copy of, say, `countCurrencyUnits`
//! is precisely how this project ships a ten-times price error (§7.8). So an
//! offer that arrives here is handed to the front end, which runs the same
//! TypeScript the extension and the companion run, and reports back.
//!
//! **Why the HTTP is written out by hand.** Three routes, one client, loopback
//! only. A framework would add a dependency tree and an API surface to this
//! project's most security-sensitive file in exchange for parsing that fits on
//! a screen. Small and auditable wins here.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Ipv4Addr, SocketAddrV4, TcpListener, TcpStream};
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Emitter};

/// Must match `BRIDGE_TOKEN_HEADER` in `core/src/bridge/protocol.ts`.
const TOKEN_HEADER: &str = "x-proc123-token";
/// Must match `BRIDGE_PATH_PREFIX`.
const PATH_PREFIX: &str = "/bridge";
/// Must match `BRIDGE_PROTOCOL_VERSION`.
const PROTOCOL: u32 = 1;

/// A rendered category page, not a file upload. Generous, but bounded: without
/// a limit a stuck or hostile client could ask this process to buffer forever.
const MAX_BODY: usize = 32 * 1024 * 1024;

/// Enough to hold a large page plus headers; anything longer is not a request
/// this service understands.
const MAX_HEADER_BYTES: usize = 16 * 1024;

/// What the front end needs to show a pairing code.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeInfo {
    pub port: u16,
    pub token: String,
}

/// Mirrors `BridgePageOffer`. No cookies: see the note on the TypeScript type.
#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageOffer {
    pub scan_id: String,
    pub url: String,
    pub title: String,
    pub html: String,
}

/// The bridge's whole mutable world.
pub struct Bridge {
    info: BridgeInfo,
    /// `scanId` to the last state the front end reported. Memory only: a scan
    /// that did not finish before the app closed did not finish.
    scans: Mutex<HashMap<String, serde_json::Value>>,
    counter: Mutex<u64>,
}

/// 16 bytes of OS randomness as lowercase hex.
///
/// `getrandom` rather than anything seeded from the clock or from
/// `RandomState`: a token an attacker can guess from when the app started is
/// not a token. This is the only randomness in the project and it is the piece
/// the whole model rests on.
fn generate_token() -> Result<String, getrandom::Error> {
    let mut bytes = [0u8; 16];
    getrandom::getrandom(&mut bytes)?;
    let mut out = String::with_capacity(32);
    for byte in bytes {
        out.push_str(&format!("{byte:02x}"));
    }
    Ok(out)
}

/// Compare without leaking where two tokens first differ.
///
/// Far-fetched over loopback, and cheap enough that arguing about it costs
/// more than doing it.
fn tokens_match(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

impl Bridge {
    /// Bind loopback on an OS-assigned port and take the token for this run.
    pub fn start(app: AppHandle) -> std::io::Result<Arc<Bridge>> {
        // Port 0 asks the OS for a free one. A fixed port would collide with
        // whatever else the user runs and would make the service findable
        // without the user ever having said it could be found.
        let listener = TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0))?;
        let port = listener.local_addr()?.port();
        let token = generate_token()
            .map_err(|error| std::io::Error::other(format!("no OS randomness: {error}")))?;

        let bridge = Arc::new(Bridge {
            info: BridgeInfo { port, token },
            scans: Mutex::new(HashMap::new()),
            counter: Mutex::new(0),
        });

        let serving = Arc::clone(&bridge);
        std::thread::Builder::new()
            .name("proc123-bridge".into())
            .spawn(move || {
                for stream in listener.incoming() {
                    let Ok(stream) = stream else { continue };
                    let bridge = Arc::clone(&serving);
                    let app = app.clone();
                    // One thread per connection. The only client is one
                    // extension on this machine, so a pool would be ceremony;
                    // a thread that panics must not take the listener with it.
                    let _ = std::thread::Builder::new()
                        .name("proc123-bridge-conn".into())
                        .spawn(move || handle(stream, &bridge, &app));
                }
            })?;

        Ok(bridge)
    }

    pub fn info(&self) -> BridgeInfo {
        self.info.clone()
    }

    fn next_scan_id(&self) -> String {
        let mut counter = self.counter.lock().unwrap_or_else(|e| e.into_inner());
        *counter += 1;
        format!("scan-{counter}")
    }

    /// Called by the front end as a scan progresses and when it ends.
    pub fn report(&self, scan_id: String, state: serde_json::Value) {
        let mut scans = self.scans.lock().unwrap_or_else(|e| e.into_inner());
        scans.insert(scan_id, state);
    }

    fn state_of(&self, scan_id: &str) -> Option<serde_json::Value> {
        let scans = self.scans.lock().unwrap_or_else(|e| e.into_inner());
        scans.get(scan_id).cloned()
    }
}

/// The pieces of a request this service cares about.
struct Request {
    method: String,
    path: String,
    query: String,
    token: Option<String>,
    origin: Option<String>,
    body: Vec<u8>,
}

/// Read one request. `None` for anything malformed — the connection is simply
/// answered with a 400 and closed rather than being interpreted generously.
fn read_request(stream: &mut BufReader<&TcpStream>) -> Option<Request> {
    let mut line = String::new();
    if stream.read_line(&mut line).ok()? == 0 {
        return None;
    }
    let mut header_bytes = line.len();
    if header_bytes > MAX_HEADER_BYTES {
        return None;
    }

    let mut parts = line.split_whitespace();
    let method = parts.next()?.to_owned();
    let target = parts.next()?.to_owned();
    let (path, query) = match target.split_once('?') {
        Some((path, query)) => (path.to_owned(), query.to_owned()),
        None => (target, String::new()),
    };

    let mut token = None;
    let mut origin = None;
    let mut length = 0usize;
    loop {
        let mut header = String::new();
        if stream.read_line(&mut header).ok()? == 0 {
            return None;
        }
        // A request whose headers never end is not one this service answers.
        header_bytes += header.len();
        if header_bytes > MAX_HEADER_BYTES {
            return None;
        }
        let header = header.trim_end();
        if header.is_empty() {
            break;
        }
        let (name, value) = header.split_once(':')?;
        // Header names are case-insensitive and browsers do not agree on case.
        let name = name.trim().to_ascii_lowercase();
        let value = value.trim().to_owned();
        match name.as_str() {
            TOKEN_HEADER => token = Some(value),
            "origin" => origin = Some(value),
            "content-length" => length = value.parse().ok()?,
            _ => {}
        }
    }

    if length > MAX_BODY {
        return None;
    }
    let mut body = vec![0u8; length];
    if length > 0 {
        stream.read_exact(&mut body).ok()?;
    }

    Some(Request { method, path, query, token, origin, body })
}

/// Is this an extension asking?
///
/// The reply is echoed back as `Access-Control-Allow-Origin`, so this decides
/// who the browser will let read a response. `*` would mean any page on any
/// site could read one, and while the token still gates every route, handing
/// that decision to a wildcard is not something a loopback service should do.
/// Only the two extension schemes are reflected; a page on the open web is
/// refused by the browser before this process is asked to care.
fn allowed_origin(origin: Option<&str>) -> Option<String> {
    let origin = origin?;
    let ok = origin.starts_with("chrome-extension://") || origin.starts_with("moz-extension://");
    ok.then(|| origin.to_owned())
}

fn write_response(
    stream: &mut TcpStream,
    status: &str,
    origin: Option<&String>,
    body: Option<&serde_json::Value>,
) {
    let payload = body.map(|value| value.to_string()).unwrap_or_default();
    let mut head = format!(
        "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n",
        payload.len()
    );
    if body.is_some() {
        head.push_str("Content-Type: application/json\r\n");
    }
    if let Some(origin) = origin {
        // Vary, because the answer genuinely depends on who asked, and a cache
        // that missed that would hand one extension another's response.
        head.push_str(&format!("Access-Control-Allow-Origin: {origin}\r\nVary: Origin\r\n"));
        head.push_str("Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n");
        head.push_str(&format!(
            "Access-Control-Allow-Headers: {TOKEN_HEADER}, content-type\r\n"
        ));
        head.push_str("Access-Control-Max-Age: 600\r\n");
    }
    head.push_str("\r\n");
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(payload.as_bytes());
    let _ = stream.flush();
}

fn error_body(message: &str) -> serde_json::Value {
    serde_json::json!({ "error": message })
}

fn handle(mut stream: TcpStream, bridge: &Arc<Bridge>, app: &AppHandle) {
    let request = {
        let mut reader = BufReader::new(&stream);
        read_request(&mut reader)
    };
    let Some(request) = request else {
        write_response(&mut stream, "400 Bad Request", None, None);
        return;
    };

    let origin = allowed_origin(request.origin.as_deref());

    // Preflight carries no custom headers by definition, so it cannot be token
    // checked and must not be. It reveals only that something is listening.
    if request.method == "OPTIONS" {
        write_response(&mut stream, "204 No Content", origin.as_ref(), None);
        return;
    }

    let authorised = request
        .token
        .as_deref()
        .is_some_and(|given| tokens_match(given, &bridge.info.token));
    if !authorised {
        write_response(
            &mut stream,
            "401 Unauthorized",
            origin.as_ref(),
            Some(&error_body("bad or missing token")),
        );
        return;
    }

    let Some(route) = request.path.strip_prefix(PATH_PREFIX) else {
        let body = error_body("no such route");
        write_response(&mut stream, "404 Not Found", origin.as_ref(), Some(&body));
        return;
    };

    match (request.method.as_str(), route) {
        ("GET", "/hello") => {
            let hello = serde_json::json!({
                "name": "proc123",
                "protocol": PROTOCOL,
                "version": env!("CARGO_PKG_VERSION"),
                "platform": std::env::consts::OS,
            });
            write_response(&mut stream, "200 OK", origin.as_ref(), Some(&hello));
        }

        ("POST", "/scan") => {
            let Ok(offer) = serde_json::from_slice::<serde_json::Value>(&request.body) else {
                let body = error_body("not JSON");
                write_response(&mut stream, "400 Bad Request", origin.as_ref(), Some(&body));
                return;
            };
            let (Some(url), Some(html)) = (
                offer.get("url").and_then(serde_json::Value::as_str),
                offer.get("html").and_then(serde_json::Value::as_str),
            ) else {
                write_response(
                    &mut stream,
                    "400 Bad Request",
                    origin.as_ref(),
                    Some(&error_body("an offer needs a url and html")),
                );
                return;
            };

            let scan_id = bridge.next_scan_id();
            bridge.report(
                scan_id.clone(),
                serde_json::json!({ "scanId": scan_id, "done": false }),
            );

            // The front end runs the scan, because `runScan` is TypeScript in
            // `core` and shared by all three surfaces. This process only
            // carries the page across and holds the answer.
            let handed = PageOffer {
                scan_id: scan_id.clone(),
                url: url.to_owned(),
                title: offer
                    .get("title")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or_default()
                    .to_owned(),
                html: html.to_owned(),
            };
            if app.emit("bridge://offer", handed).is_err() {
                write_response(
                    &mut stream,
                    "503 Service Unavailable",
                    origin.as_ref(),
                    Some(&error_body("the app window is not ready to scan")),
                );
                return;
            }

            write_response(
                &mut stream,
                "200 OK",
                origin.as_ref(),
                Some(&serde_json::json!({ "scanId": scan_id })),
            );
        }

        ("GET", "/status") => {
            let id = request
                .query
                .split('&')
                .find_map(|pair| pair.strip_prefix("id="))
                .unwrap_or_default();
            let id = percent_decode(id);
            match bridge.state_of(&id) {
                Some(state) => write_response(&mut stream, "200 OK", origin.as_ref(), Some(&state)),
                None => write_response(
                    &mut stream,
                    "404 Not Found",
                    origin.as_ref(),
                    Some(&error_body("no such scan")),
                ),
            }
        }

        _ => {
            let body = error_body("no such route");
            write_response(&mut stream, "404 Not Found", origin.as_ref(), Some(&body));
        }
    }
}

/// Just enough to undo `encodeURIComponent` on a scan id.
///
/// Scan ids are this process's own `scan-N`, so nothing exotic arrives here;
/// decoding at all is about not mangling an id if that format ever widens.
fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[index + 1..index + 3]).unwrap_or("");
            if let Ok(byte) = u8::from_str_radix(hex, 16) {
                out.push(byte);
                index += 3;
                continue;
            }
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// What the front end shows so the user can pair by hand.
///
/// The token leaves this process exactly twice: here, into the app's own
/// window, and in the header comparison above. It is never written to disk and
/// never logged.
#[tauri::command]
pub fn bridge_info(bridge: tauri::State<'_, Arc<Bridge>>) -> BridgeInfo {
    bridge.info()
}

/// The front end reporting where a scan has got to, or that it is done.
#[tauri::command]
pub fn bridge_report(
    bridge: tauri::State<'_, Arc<Bridge>>,
    scan_id: String,
    state: serde_json::Value,
) {
    bridge.report(scan_id, state);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_token_is_thirty_two_lowercase_hex_characters() {
        let token = generate_token().expect("the OS should have randomness");
        assert_eq!(token.len(), 32, "token was {token}");
        assert!(token.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
    }

    /// Per run, not per install. Two tokens from one process must already
    /// differ, or the value is derived from something predictable.
    #[test]
    fn tokens_differ_every_time() {
        let first = generate_token().expect("randomness");
        let second = generate_token().expect("randomness");
        assert_ne!(first, second);
    }

    #[test]
    fn token_comparison_accepts_only_an_exact_match() {
        let token = "0123456789abcdef0123456789abcdef";
        assert!(tokens_match(token, token));
        assert!(!tokens_match(token, "0123456789abcdef0123456789abcdee"));
        assert!(!tokens_match(token, ""));
        assert!(!tokens_match(token, &token[..31]));
    }

    /// §17: loopback and nothing else. If this ever binds a routable address,
    /// the app has become a service other machines can reach.
    #[test]
    fn binds_loopback_only() {
        let listener = TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0))
            .expect("loopback should bind");
        let address = listener.local_addr().expect("an address");
        assert!(address.ip().is_loopback(), "bound {address}");
        assert_ne!(address.port(), 0, "the OS should have assigned a port");
    }

    /// Only the extension schemes are reflected. A page on the open web must
    /// not be handed an `Access-Control-Allow-Origin` naming itself.
    #[test]
    fn only_extension_origins_are_reflected() {
        assert_eq!(
            allowed_origin(Some("chrome-extension://abcdef")),
            Some("chrome-extension://abcdef".to_owned())
        );
        assert_eq!(
            allowed_origin(Some("moz-extension://abcdef")),
            Some("moz-extension://abcdef".to_owned())
        );
        assert_eq!(allowed_origin(Some("https://shop.example")), None);
        assert_eq!(allowed_origin(Some("null")), None);
        assert_eq!(allowed_origin(None), None);
    }

    #[test]
    fn percent_decoding_survives_an_ordinary_id() {
        assert_eq!(percent_decode("scan-12"), "scan-12");
        assert_eq!(percent_decode("scan%2D12"), "scan-12");
        assert_eq!(percent_decode("%"), "%");
    }
}
