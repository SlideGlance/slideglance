//! Tauri 2 desktop shell for `@slideglance/viewer`.
//!
//! Hosts native Rust file IO and exposes rendered slide bytes to the
//! `WebView` via a custom `pptx://` URI scheme. The frontend embeds the
//! existing `<pptx-presentation>` web component and swaps in a
//! Tauri-aware `SlideController` implementation.
//!
//! # Module layout
//!
//! - [`state`]    — in-process [`state::AppState`] holding the open document.
//! - [`commands`] — Tauri IPC commands (open / close / count / meta / outline).
//! - [`protocol`] — `pptx://` custom URI scheme handler that streams rendered SVG/PNG.
//! - [`recent`]   — recent-files persistence and ordering.
//! - [`menu`]     — cross-platform menu glue plus the macOS / non-macOS bridges.
//!
//! Module bodies past [`state`] are wired up in subsequent plan tasks
//! (Phase D / E / F). They exist now only so `cargo build` succeeds and
//! the rest of the workspace can take a dependency on this crate.

pub mod commands;
pub mod menu;
pub mod menu_macos;
pub mod menu_other;
pub mod protocol;
pub mod recent;
pub mod state;

/// Run the Tauri 2 desktop application.
///
/// Builds the `tauri::Builder`, registers the shared [`state::AppState`]
/// as a managed resource so IPC commands can borrow it, and wires the
/// `tauri-plugin-dialog` plugin used by the open-file flow.
///
/// # Panics
///
/// Panics if Tauri fails to initialise the `WebView` runtime — there is
/// no graceful recovery from a missing webview, so a panic surfaces the
/// failure to the OS crash reporter rather than silently exiting.
pub fn run() {
    tauri::Builder::default()
        .manage(state::AppState::new())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::open_pptx_dialog,
            commands::open_pptx_path,
            commands::close_pptx,
            commands::slide_count,
            commands::slide_meta,
            commands::render_slide_svg,
            commands::outline,
            commands::recent_list,
            commands::add_recent,
            commands::clear_recent,
        ])
        .register_uri_scheme_protocol("pptx", handle_pptx_uri)
        .setup(|app| {
            // Per-OS menubar install. Dispatches at compile time to
            // either `menu_macos::install` (Apple HIG) or
            // `menu_other::install` (Win32 / GTK with `&` mnemonics).
            // E1 ships the dispatcher only — the concrete menu trees
            // are filled in by Task E2 / E3.
            crate::menu::install(app)?;

            // CLI-arg open: when the binary is invoked as
            // `slideglance-viewer path/to/deck.pptx`, forward the first
            // positional argument to the frontend through the same
            // `menu://open-path` channel that the menu / recent-files
            // flows use. The frontend's `firstUpdated` listener calls
            // `openPath(payload)` which in turn drives the existing
            // `open_pptx_path` IPC.
            //
            // The emit must run on the async runtime: `setup` itself
            // executes on the main thread before the webview is fully
            // ready to receive events, but `Emitter::emit` is sync. We
            // hand the work to `tauri::async_runtime::spawn` so the
            // emission happens once Tauri has finished bootstrapping.
            let args: Vec<String> = std::env::args().skip(1).collect();
            if let Some(path) = args.first() {
                let p = path.clone();
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    use tauri::Emitter;
                    let _ = handle.emit("menu://open-path", p);
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running SlideGlance");
}

/// `pptx://` URI scheme handler.
///
/// Routes by URI host:
/// - `pptx://slide/{n}` → SVG bytes (`Content-Type: image/svg+xml`).
/// - `pptx://media/{hash}` → raw media bytes with the original MIME.
/// - anything else → `400 Bad Request`.
///
/// Why route on **host** rather than the path: `http::Uri` parses
/// `pptx://slide/1` as `scheme=pptx, host=slide, path=/1`, not as a
/// flat URL with the leading `slide/` in the path. Same shape applies
/// to `pptx://media/{hash}`. The handler therefore matches
/// `request.uri().host()` and pulls the `{n}` / `{hash}` from the path.
///
/// Tauri also rewrites browser-fetched URLs to a platform-specific form
/// (`pptx://localhost/slide/1` on macOS/Linux, `http://pptx.localhost/slide/1`
/// on Windows). When a host of `localhost` arrives, we fall back to the
/// first path segment for the route key, which makes both the literal
/// `pptx://slide/1` form (used inside the SVG for media URLs) and the
/// browser-rewritten form work uniformly.
///
/// The Tauri 2.x stable signature is
/// `Fn(UriSchemeContext<'_, R>, http::Request<Vec<u8>>) -> http::Response<T>`
/// where `T: Into<Cow<'static, [u8]>>`. We use `Vec<u8>` for the body so
/// every branch returns an owned buffer.
///
/// `Response::builder()` is documented as infallible for the field
/// combinations we use here (status + one header + Vec body), so the
/// `expect()` calls flag a true unreachable invariant rather than a real
/// fallible path. Using `expect` over `unwrap` so a future builder change
/// surfaces a meaningful message in the panic.
#[allow(clippy::needless_pass_by_value)]
fn handle_pptx_uri(
    ctx: tauri::UriSchemeContext<'_, tauri::Wry>,
    request: tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    use tauri::http::{
        header::{ACCESS_CONTROL_ALLOW_ORIGIN, CONTENT_TYPE},
        Response, StatusCode,
    };
    use tauri::Manager;

    // Debug breadcrumb so a runtime "Load failed" can be diagnosed without
    // attaching DevTools. The path is in `/tmp` and rewritten on every
    // request — non-fatal if the write fails.
    let uri_dbg = request.uri().to_string();
    let _ = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open("/tmp/pptx-viewer-protocol.log")
        .and_then(|mut f| {
            use std::io::Write;
            writeln!(f, "[{}] {}", chrono_now(), uri_dbg)
        });

    let (route, rest) = parse_pptx_route(request.uri());
    let state = ctx.app_handle().state::<state::AppState>();

    // The WebView origin (`tauri://localhost` or `http://tauri.localhost`)
    // differs from the custom-scheme origin, so every response is treated
    // as cross-origin by WebKit/CSP. `Access-Control-Allow-Origin: *` is
    // safe here because the protocol handler only serves the locally-open
    // document — there is no remote attacker who could request it.
    fn ok(mime: &'static str, bytes: Vec<u8>) -> Response<Vec<u8>> {
        Response::builder()
            .status(StatusCode::OK)
            .header(CONTENT_TYPE, mime)
            .header(ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .body(bytes)
            .expect("static OK response always builds")
    }
    fn err_text(status: StatusCode, body: Vec<u8>) -> Response<Vec<u8>> {
        Response::builder()
            .status(status)
            .header(CONTENT_TYPE, "text/plain; charset=utf-8")
            .header(ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .body(body)
            .expect("static error response always builds")
    }

    match route.as_deref() {
        Some("slide") => {
            let n = rest.parse::<u32>().unwrap_or(0);
            match protocol::render_slide_bytes(&state, n) {
                Ok(bytes) => ok("image/svg+xml", bytes),
                Err(e) => err_text(StatusCode::NOT_FOUND, e.into_bytes()),
            }
        }
        Some("media") => match protocol::fetch_media_bytes(&state, &rest) {
            Some((bytes, mime)) => Response::builder()
                .status(StatusCode::OK)
                .header(CONTENT_TYPE, mime)
                .header(ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                .body(bytes)
                .expect("static OK media response always builds"),
            None => err_text(StatusCode::NOT_FOUND, Vec::new()),
        },
        _ => err_text(StatusCode::BAD_REQUEST, Vec::new()),
    }
}

fn chrono_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or_else(|_| "?".to_string(), |d| d.as_millis().to_string())
}

/// Resolve the route key (`slide` / `media`) and remainder from a
/// `pptx://` request URI.
///
/// Three shapes need to map to the same `(route, rest)`:
/// 1. `pptx://slide/1` — `Uri::host = "slide"`, `Uri::path = "/1"`.
/// 2. `pptx://localhost/slide/1` — `Uri::host = "localhost"`,
///    `Uri::path = "/slide/1"`. (Tauri's macOS/Linux rewrite.)
/// 3. `http://pptx.localhost/slide/1` — `Uri::host =
///    "pptx.localhost"`, `Uri::path = "/slide/1"`. (Tauri's Windows
///    rewrite.)
///
/// We pick the route key from the host when it isn't `localhost` /
/// `pptx.localhost`; otherwise we peel the first path segment.
fn parse_pptx_route(uri: &tauri::http::Uri) -> (Option<String>, String) {
    let host = uri.host().unwrap_or_default();
    let path = uri.path().trim_start_matches('/');

    let host_is_route_alias = matches!(host, "localhost" | "pptx.localhost" | "");
    if host_is_route_alias {
        // First segment is the route key, the remainder is the value.
        let mut parts = path.splitn(2, '/');
        let route = parts.next().filter(|s| !s.is_empty()).map(str::to_owned);
        let rest = parts.next().unwrap_or_default().to_owned();
        (route, rest)
    } else {
        // `host` carries the route key; the path is the value.
        (Some(host.to_owned()), path.to_owned())
    }
}

#[cfg(test)]
mod uri_tests {
    use super::parse_pptx_route;

    fn case(input: &str) -> (Option<String>, String) {
        let uri: tauri::http::Uri = input.parse().expect("parse uri");
        parse_pptx_route(&uri)
    }

    #[test]
    fn flat_pptx_slide_uri_routes_via_host() {
        // SVG fetch from inside a slide-rendered document: the URL is
        // emitted literally, no host rewrite. `Uri` parses host=slide.
        assert_eq!(case("pptx://slide/1"), (Some("slide".into()), "1".into()));
    }

    #[test]
    fn flat_pptx_media_uri_routes_via_host() {
        assert_eq!(
            case("pptx://media/abc123"),
            (Some("media".into()), "abc123".into())
        );
    }

    #[test]
    fn macos_linux_localhost_uri_routes_via_path() {
        // Tauri's macOS / Linux URL rewrite. host=localhost, route is
        // the first path segment.
        assert_eq!(
            case("pptx://localhost/slide/1"),
            (Some("slide".into()), "1".into())
        );
        assert_eq!(
            case("pptx://localhost/media/abc123"),
            (Some("media".into()), "abc123".into())
        );
    }

    #[test]
    fn windows_pptx_dot_localhost_uri_routes_via_path() {
        // Tauri's Windows URL rewrite uses `http://pptx.localhost/...`.
        assert_eq!(
            case("http://pptx.localhost/slide/1"),
            (Some("slide".into()), "1".into())
        );
        assert_eq!(
            case("http://pptx.localhost/media/abc123"),
            (Some("media".into()), "abc123".into())
        );
    }

    #[test]
    fn unknown_route_returns_unknown_key() {
        // Bogus top-level segment must fail the route match upstream
        // (handler emits 400). Here we just verify the parser surfaces
        // the bogus key rather than masking it as None.
        assert_eq!(
            case("pptx://garbage/1"),
            (Some("garbage".into()), "1".into())
        );
    }
}
