//! The bridge, app side (CLAUDE.md §17).
//!
//! The extension has the one thing this app cannot get for itself: a page the
//! user is already logged in to, rendered by the browser they already trust.
//! The app has the things a popup cannot keep — a process that outlives it, a
//! real filesystem, and no CORS. The bridge lets each lend the other what it
//! has, and it is an *enhancement*: both surfaces are required to stay fully
//! usable with the other uninstalled, which is asserted on both sides.
//!
//! **The security model is three rules and none of them is optional.**
//!
//! - **Loopback only.** The listener binds `127.0.0.1`, never `0.0.0.0`. The
//!   bridge is for two programs on one machine and must not become a service
//!   on the network the laptop happens to be joined to.
//! - **A token generated per run, never persisted.** It lives in this process's
//!   memory and dies with it. Nothing writes it to disk, which is why there is
//!   no "forget this device" to get wrong and no stored secret to leak. The
//!   cost — pairing again after a restart — is the point, not an oversight.
//! - **Nothing here decides what a page means.** The bridge carries a URL, a
//!   title and some HTML. `core` decides whether that is a product, what a
//!   price is, and which unit it is quoted in. A rule implemented in Rust
//!   cannot be shared with the extension or the companion, so it would be
//!   written twice and the copies would drift (§2, §15).
//!
//! **Why this is hand-written rather than a web framework.** The surface is two
//! routes on loopback for one known client. Pulling in a server stack to serve
//! them would add far more code than it removes, and this file is one of the
//! places where a reader checking the project's privacy claims will actually
//! look. Everything it accepts is bounded and everything it does not recognise
//! is a 404.

use std::collections::HashMap;
use std::net::{Ipv4Addr, SocketAddr};
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

/// Bumped when the wire format changes in a way an older client cannot read.
///
/// The extension checks it on `/bridge/hello` and refuses to pair across a
/// mismatch, so a stale extension says "update one of these" rather than
/// failing later with a parse error nobody can place.
pub const PROTOCOL_VERSION: u32 = 1;

/// The ports tried, in order, until one binds.
///
/// A fixed, small range rather than an ephemeral port, because the extension
/// has to *find* the app: there is no discovery service and inventing one would
/// mean a broadcast, which is the opposite of loopback-only. Ten ports is
/// enough for a second instance and few enough to probe quickly.
pub const PORT_RANGE: std::ops::RangeInclusive<u16> = 8787..=8796;

/// No ambiguous glyphs: `I`, `L`, `O` and `U` are out, because this token is
/// read off one screen and typed into another. 32 symbols, so a random byte
/// maps onto it with `% 32` and no modulo bias — 256 divides exactly.
const ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/// 8 symbols over a 32-symbol alphabet: 40 bits.
///
/// Short enough to type by hand, which it has to be. 40 bits is not a password
/// — it is a one-session capability for a socket that only accepts connections
/// from this machine and that stops existing when the app closes.
const TOKEN_LEN: usize = 8;

/// Caps, so a malformed or hostile request cannot make the app allocate freely.
/// The body limit is generous because a rendered category page is genuinely
/// large; it is a ceiling, not a target.
const MAX_HEAD: usize = 16 * 1024;
const MAX_BODY: usize = 32 * 1024 * 1024;

/// A connection that opens and then says nothing must not hold a task forever.
const READ_TIMEOUT: Duration = Duration::from_secs(10);

/// What the extension hands over: a page it could reach and the app might not.
///
/// `html` is the *rendered* DOM, which is the whole point — the app can fetch
/// any URL, so a handoff that carried only a URL would be carrying nothing the
/// app did not already have.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Handoff {
    pub url: String,
    pub title: String,
    pub html: String,
}

/// What the front end is told so it can show the pairing details.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeInfo {
    pub port: u16,
    pub token: String,
    pub protocol: u32,
}

/// One HTTP response, before it becomes bytes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Response {
    pub status: u16,
    pub body: String,
    /// Echoed back when the caller is an extension; see `allowed_origin`.
    pub origin: Option<String>,
}

impl Response {
    fn json(status: u16, body: &str) -> Self {
        Response {
            status,
            body: body.to_owned(),
            origin: None,
        }
    }
}

/// A parsed request. Only what the two routes need.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Request {
    pub method: String,
    pub path: String,
    /// Lowercased keys, because header names are case-insensitive and a client
    /// that sends `AUTHORIZATION` is not making a mistake.
    pub headers: HashMap<String, String>,
    pub body: String,
}

/// What routing decided. Separated from doing it so the decision is a pure
/// function and can be tested without a Tauri app or a socket.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Routed {
    Respond(Response),
    /// Hand this to the front end, then send the response.
    Handoff(Box<Handoff>, Response),
}

/// A token for this run, from the OS's randomness.
///
/// Not seeded, not derived from anything about the machine, and not stored.
/// Two runs of the app never share one.
pub fn generate_token() -> String {
    let mut bytes = [0_u8; TOKEN_LEN];
    getrandom::fill(&mut bytes).expect("the operating system refused to provide randomness");
    bytes
        .iter()
        .map(|b| char::from(ALPHABET[usize::from(*b) % ALPHABET.len()]))
        .collect()
}

/// Strip the formatting a person sees from the token they typed.
///
/// The app shows `ABCD-EFGH` because that is easier to read off a screen; the
/// dash is presentation. Case is normalised for the same reason — someone
/// typing it in lower case has not got it wrong.
pub fn normalize_token(raw: &str) -> String {
    raw.chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_uppercase())
        .collect()
}

/// Compare without an early exit.
///
/// The timing signal here is small and the attacker has to be on this machine
/// already. It is still written this way because the alternative is explaining
/// in a security review why a token comparison short-circuits, and there is no
/// good answer to that.
pub fn tokens_match(expected: &str, offered: &str) -> bool {
    let offered = normalize_token(offered);
    if expected.len() != offered.len() {
        return false;
    }
    let mut diff = 0_u8;
    for (a, b) in expected.bytes().zip(offered.bytes()) {
        diff |= a ^ b;
    }
    diff == 0
}

/// The bearer token on a request, if it carries one.
fn bearer(headers: &HashMap<String, String>) -> Option<&str> {
    let value = headers.get("authorization")?;
    let rest = value
        .strip_prefix("Bearer ")
        .or_else(|| value.strip_prefix("bearer "))?;
    Some(rest.trim())
}

/// Which callers may use a browser's `fetch` against this server.
///
/// Only extension origins are echoed. A page on the open web is not one, and
/// this is a real limit rather than decoration: an `https://` page cannot reach
/// `http://127.0.0.1` at all — mixed content blocks it (§3) — but an `http://`
/// one can, and there is no reason to let it try. The token would still refuse
/// it; CORS means the browser refuses it first.
///
/// `null` is never echoed: it is what a sandboxed or `file://` document sends,
/// and it would match anything.
pub fn allowed_origin(origin: Option<&str>) -> Option<String> {
    let origin = origin?;
    let ok = origin.starts_with("chrome-extension://")
        || origin.starts_with("moz-extension://")
        || origin.starts_with("safari-web-extension://");
    if ok {
        Some(origin.to_owned())
    } else {
        None
    }
}

/// Decide what a request gets, without performing any of it.
///
/// `version` is the app's own version string, reported on `/bridge/hello` so a
/// user can see which app answered.
pub fn route(request: &Request, token: &str, version: &str) -> Routed {
    let origin = allowed_origin(request.headers.get("origin").map(String::as_str));

    // The preflight the browser sends before a cross-origin POST carrying an
    // `Authorization` header. Answering it is not optional — without it the
    // real request is never sent, and the failure shows up in the extension as
    // a bare network error with nothing in the app's log at all.
    if request.method == "OPTIONS" {
        return Routed::Respond(Response {
            status: 204,
            body: String::new(),
            origin,
        });
    }

    match (request.method.as_str(), request.path.as_str()) {
        // Discovery, and deliberately unauthenticated. It says only that a
        // proc123 is listening and which wire format it speaks — the extension
        // has to learn that before the user has typed a token, and neither fact
        // is a secret worth a round trip to protect.
        ("GET", "/bridge/hello") => {
            let body = format!(
                r#"{{"app":"proc123","protocol":{},"version":"{}"}}"#,
                PROTOCOL_VERSION,
                version.replace('"', "")
            );
            Routed::Respond(Response {
                status: 200,
                body,
                origin,
            })
        }

        ("POST", "/bridge/handoff") => {
            if !bearer(&request.headers).is_some_and(|offered| tokens_match(token, offered)) {
                return Routed::Respond(Response {
                    status: 401,
                    body: r#"{"error":"the pairing code does not match this run of the app"}"#
                        .to_owned(),
                    origin,
                });
            }
            match serde_json::from_str::<Handoff>(&request.body) {
                Ok(handoff) if !handoff.url.is_empty() => {
                    let body = r#"{"accepted":true}"#.to_owned();
                    Routed::Handoff(
                        Box::new(handoff),
                        Response {
                            status: 200,
                            body,
                            origin,
                        },
                    )
                }
                _ => Routed::Respond(Response {
                    status: 400,
                    body: r#"{"error":"expected an object with url, title and html"}"#.to_owned(),
                    origin,
                }),
            }
        }

        _ => Routed::Respond(Response {
            status: 404,
            body: r#"{"error":"no such route"}"#.to_owned(),
            origin,
        }),
    }
}

fn reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        401 => "Unauthorized",
        404 => "Not Found",
        408 => "Request Timeout",
        413 => "Payload Too Large",
        _ => "Error",
    }
}

/// Turn a response into the bytes on the wire.
///
/// `Connection: close` because every exchange here is one request and one
/// answer; keep-alive would mean tracking connection state for no gain.
pub fn render_response(response: &Response) -> Vec<u8> {
    let mut head = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n",
        response.status,
        reason(response.status),
        response.body.len()
    );
    if let Some(origin) = &response.origin {
        head.push_str(&format!("Access-Control-Allow-Origin: {origin}\r\n"));
        head.push_str("Access-Control-Allow-Headers: authorization, content-type\r\n");
        head.push_str("Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n");
        head.push_str("Access-Control-Max-Age: 600\r\n");
    }
    // Always, even when no origin was echoed: a cache that saw one response
    // must not reuse it for a caller whose `Origin` differs.
    head.push_str("Vary: Origin\r\n\r\n");

    let mut out = head.into_bytes();
    out.extend_from_slice(response.body.as_bytes());
    out
}

/// Parse a request head and body out of the bytes read from a socket.
///
/// Returns `None` for anything it does not understand, and the caller answers
/// 400. Being strict is cheap here: the only client is one we wrote.
pub fn parse_request(raw: &[u8]) -> Option<Request> {
    let text = std::str::from_utf8(raw).ok()?;
    let (head, body) = text.split_once("\r\n\r\n")?;
    let mut lines = head.split("\r\n");

    let mut start = lines.next()?.split(' ');
    let method = start.next()?.to_ascii_uppercase();
    let target = start.next()?;

    // The query string is not used by any route, and keeping it would mean two
    // spellings of `/bridge/hello` that a `match` would treat as different.
    let path = target.split('?').next().unwrap_or(target).to_owned();

    let mut headers = HashMap::new();
    for line in lines {
        if let Some((name, value)) = line.split_once(':') {
            headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_owned());
        }
    }

    Some(Request {
        method,
        path,
        headers,
        body: body.to_owned(),
    })
}

/// How many more bytes the body needs, given what has been read.
fn content_length(headers: &HashMap<String, String>) -> usize {
    headers
        .get("content-length")
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(0)
}

/// Read one request off a connection, bounded in both size and time.
async fn read_request(stream: &mut TcpStream) -> Result<Option<Request>, u16> {
    let mut buffer = Vec::new();
    let mut chunk = [0_u8; 8192];

    // Phase one: the head, which ends at the blank line.
    let head_end = loop {
        if let Some(at) = find_head_end(&buffer) {
            break at;
        }
        if buffer.len() > MAX_HEAD {
            return Err(413);
        }
        let read = tokio::time::timeout(READ_TIMEOUT, stream.read(&mut chunk))
            .await
            .map_err(|_| 408_u16)?
            .map_err(|_| 400_u16)?;
        if read == 0 {
            // The peer closed before finishing a request. Not an error worth
            // answering — there is nobody left to answer.
            return Ok(None);
        }
        buffer.extend_from_slice(&chunk[..read]);
    };

    let head_only = parse_request(&buffer[..head_end + 4]).ok_or(400_u16)?;
    let want = content_length(&head_only.headers);
    if want > MAX_BODY {
        return Err(413);
    }

    // Phase two: however much body the head promised.
    let body_start = head_end + 4;
    while buffer.len() - body_start < want {
        let read = tokio::time::timeout(READ_TIMEOUT, stream.read(&mut chunk))
            .await
            .map_err(|_| 408_u16)?
            .map_err(|_| 400_u16)?;
        if read == 0 {
            return Err(400);
        }
        buffer.extend_from_slice(&chunk[..read]);
    }

    parse_request(&buffer[..body_start + want])
        .map(Some)
        .ok_or(400_u16)
}

fn find_head_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|w| w == b"\r\n\r\n")
}

/// Bind the first free port in [`PORT_RANGE`], on loopback.
///
/// Returns the listener and the port, so the caller can tell the user which one
/// answered — the extension probes the range, but a person reading a support
/// thread should not have to.
pub async fn bind() -> std::io::Result<(TcpListener, u16)> {
    let mut last = None;
    for port in PORT_RANGE {
        let address = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
        match TcpListener::bind(address).await {
            Ok(listener) => return Ok((listener, port)),
            Err(error) => last = Some(error),
        }
    }
    Err(last.unwrap_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::AddrInUse, "no loopback port was free")
    }))
}

/// Serve until the listener dies.
///
/// `on_handoff` is how the decision leaves this file: the routing above is
/// pure, and everything that actually *happens* as a result happens in the
/// callback the caller supplies. That is what lets the whole server be tested
/// against a stub rather than against a running application.
pub async fn serve<F>(listener: TcpListener, token: String, version: String, on_handoff: F)
where
    F: Fn(Handoff) + Send + Sync + 'static,
{
    let on_handoff = std::sync::Arc::new(on_handoff);

    loop {
        let Ok((mut stream, peer)) = listener.accept().await else {
            // A listener that cannot accept is not going to recover.
            return;
        };

        // Belt and braces over the loopback bind. If this ever fires, the bind
        // above has been changed to something it must not be.
        if !peer.ip().is_loopback() {
            continue;
        }

        let token = token.clone();
        let version = version.clone();
        let on_handoff = std::sync::Arc::clone(&on_handoff);

        tauri::async_runtime::spawn(async move {
            let response = match read_request(&mut stream).await {
                Ok(Some(request)) => match route(&request, &token, &version) {
                    Routed::Respond(response) => response,
                    Routed::Handoff(handoff, response) => {
                        on_handoff(*handoff);
                        response
                    }
                },
                Ok(None) => return,
                Err(status) => {
                    Response::json(status, r#"{"error":"the request was not readable"}"#)
                }
            };

            let _ = stream.write_all(&render_response(&response)).await;
            let _ = stream.flush().await;
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(method: &str, path: &str, headers: &[(&str, &str)], body: &str) -> Request {
        Request {
            method: method.to_owned(),
            path: path.to_owned(),
            headers: headers
                .iter()
                .map(|(k, v)| ((*k).to_ascii_lowercase(), (*v).to_owned()))
                .collect(),
            body: body.to_owned(),
        }
    }

    #[test]
    fn a_token_is_eight_symbols_from_the_unambiguous_alphabet() {
        let token = generate_token();
        assert_eq!(token.len(), TOKEN_LEN);
        assert!(
            token.bytes().all(|b| ALPHABET.contains(&b)),
            "{token} left the alphabet"
        );
    }

    /// Not a randomness test — it cannot be one in a unit test. It catches the
    /// mistake that actually happens: a token derived from something constant,
    /// which would hand every run of the app the same credential.
    #[test]
    fn two_runs_do_not_share_a_token() {
        let tokens: std::collections::HashSet<String> = (0..32).map(|_| generate_token()).collect();
        assert!(
            tokens.len() > 24,
            "only {} distinct tokens in 32 draws",
            tokens.len()
        );
    }

    #[test]
    fn the_token_is_matched_past_the_formatting_a_person_sees() {
        let token = "ABCD1234";
        assert!(tokens_match(token, "ABCD-1234"));
        assert!(tokens_match(token, "abcd1234"));
        assert!(tokens_match(token, " abcd-1234 "));
        assert!(!tokens_match(token, "ABCD1235"));
        assert!(!tokens_match(token, "ABCD123"));
        assert!(!tokens_match(token, ""));
    }

    #[test]
    fn hello_needs_no_token_and_names_the_protocol() {
        let routed = route(
            &request("GET", "/bridge/hello", &[], ""),
            "ABCD1234",
            "1.10.0",
        );
        let Routed::Respond(response) = routed else {
            panic!("hello should not hand off")
        };
        assert_eq!(response.status, 200);
        assert!(response.body.contains(r#""protocol":1"#));
        assert!(response.body.contains("1.10.0"));
    }

    #[test]
    fn a_handoff_without_the_token_is_refused() {
        let body = r#"{"url":"https://shop.example/c","title":"c","html":"<html></html>"}"#;
        let routed = route(
            &request("POST", "/bridge/handoff", &[], body),
            "ABCD1234",
            "1.0.0",
        );
        let Routed::Respond(response) = routed else {
            panic!("an unauthorised handoff ran")
        };
        assert_eq!(response.status, 401);
    }

    #[test]
    fn a_handoff_with_the_wrong_token_is_refused() {
        let body = r#"{"url":"https://shop.example/c","title":"c","html":"<html></html>"}"#;
        let headers = [("authorization", "Bearer WRONG123")];
        let routed = route(
            &request("POST", "/bridge/handoff", &headers, body),
            "ABCD1234",
            "1.0.0",
        );
        let Routed::Respond(response) = routed else {
            panic!("an unauthorised handoff ran")
        };
        assert_eq!(response.status, 401);
    }

    #[test]
    fn a_handoff_with_the_token_carries_the_page_through() {
        let body = r#"{"url":"https://shop.example/c","title":"Shoes","html":"<html>x</html>"}"#;
        let headers = [("authorization", "Bearer abcd-1234")];
        let routed = route(
            &request("POST", "/bridge/handoff", &headers, body),
            "ABCD1234",
            "1.0.0",
        );
        let Routed::Handoff(handoff, response) = routed else {
            panic!("the handoff was refused")
        };
        assert_eq!(response.status, 200);
        assert_eq!(handoff.url, "https://shop.example/c");
        assert_eq!(handoff.title, "Shoes");
        assert_eq!(handoff.html, "<html>x</html>");
    }

    #[test]
    fn a_handoff_that_is_not_a_page_is_a_bad_request_not_a_crash() {
        let headers = [("authorization", "Bearer ABCD1234")];
        for body in ["", "{}", "null", r#"{"url":""}"#, "not json at all"] {
            let routed = route(
                &request("POST", "/bridge/handoff", &headers, body),
                "ABCD1234",
                "1.0.0",
            );
            let Routed::Respond(response) = routed else {
                panic!("{body} should not hand off")
            };
            assert_eq!(response.status, 400, "body was {body}");
        }
    }

    #[test]
    fn only_extension_origins_are_echoed() {
        assert_eq!(
            allowed_origin(Some("chrome-extension://abcdef")),
            Some("chrome-extension://abcdef".to_owned())
        );
        assert_eq!(
            allowed_origin(Some("moz-extension://1234")),
            Some("moz-extension://1234".to_owned())
        );
        assert_eq!(allowed_origin(Some("https://shop.example")), None);
        assert_eq!(allowed_origin(Some("http://localhost:3000")), None);
        assert_eq!(allowed_origin(Some("null")), None);
        assert_eq!(allowed_origin(None), None);
    }

    #[test]
    fn the_preflight_is_answered_so_the_real_request_is_sent() {
        let headers = [("origin", "chrome-extension://abcdef")];
        let routed = route(
            &request("OPTIONS", "/bridge/handoff", &headers, ""),
            "ABCD1234",
            "1.0.0",
        );
        let Routed::Respond(response) = routed else {
            panic!("a preflight handed off")
        };
        assert_eq!(response.status, 204);
        let wire = String::from_utf8(render_response(&response)).unwrap();
        assert!(wire.contains("Access-Control-Allow-Origin: chrome-extension://abcdef"));
        assert!(wire.to_lowercase().contains("authorization"));
    }

    #[test]
    fn a_web_page_gets_no_cors_headers() {
        let headers = [("origin", "http://shop.example")];
        let routed = route(
            &request("GET", "/bridge/hello", &headers, ""),
            "ABCD1234",
            "1.0.0",
        );
        let Routed::Respond(response) = routed else {
            panic!("hello handed off")
        };
        let wire = String::from_utf8(render_response(&response)).unwrap();
        assert!(!wire.contains("Access-Control-Allow-Origin"));
        assert!(wire.contains("Vary: Origin"));
    }

    #[test]
    fn an_unknown_route_is_a_404() {
        let routed = route(&request("GET", "/", &[], ""), "ABCD1234", "1.0.0");
        let Routed::Respond(response) = routed else {
            panic!("/ handed off")
        };
        assert_eq!(response.status, 404);
    }

    #[test]
    fn a_request_is_parsed_off_the_wire() {
        let raw = b"POST /bridge/handoff?x=1 HTTP/1.1\r\nHost: 127.0.0.1\r\nAUTHORIZATION: Bearer ABCD1234\r\nContent-Length: 2\r\n\r\n{}";
        let request = parse_request(raw).expect("a well-formed request did not parse");
        assert_eq!(request.method, "POST");
        // The query string is dropped so routing has one spelling to match.
        assert_eq!(request.path, "/bridge/handoff");
        assert_eq!(
            request.headers.get("authorization").map(String::as_str),
            Some("Bearer ABCD1234")
        );
        assert_eq!(request.body, "{}");
    }

    /// The one test that exercises the real socket: bind, accept, parse,
    /// authorise, emit, answer. Everything above it tests a pure function, and
    /// a bridge that passed all of those while failing to listen on loopback
    /// would still be broken in the only way that matters.
    #[test]
    fn the_listener_is_loopback_and_carries_a_real_handoff() {
        use std::sync::mpsc;

        tauri::async_runtime::block_on(async {
            let (listener, port) = bind().await.expect("no loopback port was free");

            // The binding is the security model, so it is asserted rather than
            // assumed: a change from `Ipv4Addr::LOCALHOST` to anything routable
            // has to fail a test, not a review.
            let bound = listener.local_addr().expect("the listener has no address");
            assert!(
                bound.ip().is_loopback(),
                "the bridge bound {bound}, which is not loopback"
            );
            assert!(PORT_RANGE.contains(&port));

            let (sender, received) = mpsc::channel();
            let token = "ABCD1234".to_owned();
            tauri::async_runtime::spawn(serve(listener, token, "1.10.0".to_owned(), move |h| {
                let _ = sender.send(h);
            }));

            let body = r#"{"url":"https://shop.example/c","title":"Shoes","html":"<b>x</b>"}"#;
            let request = format!(
                "POST /bridge/handoff HTTP/1.1\r\nHost: 127.0.0.1\r\nOrigin: chrome-extension://aa\r\nAuthorization: Bearer ABCD-1234\r\nContent-Length: {}\r\n\r\n{}",
                body.len(),
                body
            );

            let mut stream = TcpStream::connect(("127.0.0.1", port))
                .await
                .expect("connect failed");
            stream
                .write_all(request.as_bytes())
                .await
                .expect("write failed");

            let mut answer = Vec::new();
            stream.read_to_end(&mut answer).await.expect("read failed");
            let answer = String::from_utf8(answer).expect("the answer was not UTF-8");

            assert!(answer.starts_with("HTTP/1.1 200 OK"), "answer was {answer}");
            assert!(answer.contains("Access-Control-Allow-Origin: chrome-extension://aa"));
            assert!(answer.ends_with(r#"{"accepted":true}"#));

            let handoff = received
                .recv_timeout(std::time::Duration::from_secs(5))
                .expect("the handoff never reached the callback");
            assert_eq!(handoff.url, "https://shop.example/c");
            assert_eq!(handoff.html, "<b>x</b>");
        });
    }

    #[test]
    fn a_response_states_its_own_length() {
        let response = Response::json(200, r#"{"accepted":true}"#);
        let wire = String::from_utf8(render_response(&response)).unwrap();
        assert!(wire.starts_with("HTTP/1.1 200 OK\r\n"));
        assert!(wire.contains("Content-Length: 17\r\n"));
        assert!(wire.ends_with(r#"{"accepted":true}"#));
    }
}
