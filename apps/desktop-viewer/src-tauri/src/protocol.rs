//! `pptx://` custom URI scheme handler.
//!
//! Streams rendered SVG and media bytes for the currently-open document
//! straight from native memory into the `WebView`, avoiding base64
//! round-trips through IPC.
//!
//! Two URL shapes are served:
//!
//! - `pptx://slide/{n}` — renders slide `n` (1-based) as a self-contained
//!   SVG. The renderer's `pptx-media://{hash}` URLs are rewritten to
//!   `pptx://media/{hash}` so every `<image>` tag fetches through this
//!   same protocol.
//! - `pptx://media/{hash}` — returns the raw bytes (and MIME) of one
//!   media blob the slide handler stashed in
//!   [`crate::state::OpenedDocument::media_cache`].
//!
//! The `WebView`'s request order is: slide first, then media for each
//! `<image>` it finds. By the time `fetch_media_bytes` runs, the cache
//! is already populated by `render_slide_bytes` for that slide.
//!
//! See `.plans/04-native-viewer/plan.md` Task D5.

use slideglance::SlideRenderOptions;

use crate::state::AppState;

/// Render slide `slide` (1-based) as SVG bytes.
///
/// Side effect: every media blob in the rendered SVG is merged into the
/// document's [`crate::state::OpenedDocument::media_cache`] so that
/// subsequent `pptx://media/{hash}` requests resolve.
///
/// The renderer-emitted `pptx-media://` URI scheme is rewritten to
/// `pptx://media/` in the returned bytes. This is a string substitution
/// on the SVG output — every URI in our renderer is inside a
/// double-quoted attribute, so the scheme prefix is unambiguous.
///
/// # Errors
///
/// - Returns `"no document open"` when no PPTX is loaded.
/// - Returns `"slide {n} out of range"` when the slide number does not
///   exist in the deck.
/// - Forwards the stringified `slideglance::ConvertError` when rendering
///   fails.
pub fn render_slide_bytes(state: &AppState, slide: u32) -> Result<Vec<u8>, String> {
    let result = state.with_doc(|d| {
        // `external_media: true` — return media as a separate map so we
        // can serve it through `pptx://media/{hash}` instead of inlining
        // base64 into the SVG.
        // `include_font_defs: false` — `PptxDocument::render_slide`
        // injects `embedded_defs` into every slide it renders (no
        // first-slide gate, unlike `convert_to_svg`). With a deck
        // carrying tens of MB of `<p:embeddedFontLst>` faces, replicating
        // that block per slide multiplies the IPC payload by N (e.g.
        // 132 slides × ~15 MB = ~2 GB held in WebView state) and pegs
        // the loading overlay forever as JSON-encoded SVG strings stack
        // up. Browser hosts already pass the equivalent `false` (see
        // `pptx-worker.ts` `doc.renderSlide(slide, true, false)`); the
        // tradeoff is the same — embedded faces fall back to system
        // fonts in the WebView, matching browser fidelity.
        let opts = SlideRenderOptions {
            external_media: true,
            include_font_defs: false,
            ..SlideRenderOptions::default()
        };
        let rendered = d
            .doc
            .render_slide(slide, &opts)
            .map_err(|e| e.to_string())?;
        let Some(rendered) = rendered else {
            return Err(format!("slide {slide} out of range"));
        };
        // Merge the media this render produced into the document-wide
        // cache. Identical content across slides hashes to the same key
        // so later renders just no-op for already-known blobs.
        {
            let mut cache = d.media_cache.lock();
            for (hash, blob) in rendered.media {
                cache.entry(hash).or_insert(blob);
            }
        }
        // Rewrite the renderer's URL scheme to ours. Only `pptx-media://`
        // appears inside `href` / `xlink:href` attributes in the SVG, so
        // a literal substring replace is safe.
        //
        // The `localhost` host is the canonical Tauri 2 form for custom
        // schemes — without it, WebKit treats the URL's first path
        // segment as a hostname (`pptx://media/abc` → host=`media`)
        // which it then refuses to dispatch as a malformed remote host.
        // The protocol handler's `parse_pptx_route` accepts both the
        // hostless and `localhost` shapes, but we always emit the
        // explicit form so embedded `<image>` fetches actually resolve.
        let svg = rendered
            .svg
            .replace("pptx-media://", "pptx://localhost/media/");
        Ok(svg.into_bytes())
    });
    match result {
        Some(inner) => inner,
        None => Err("no document open".to_string()),
    }
}

/// Look up a media blob (raw bytes + MIME) by its `hash` key.
///
/// Returns `None` when no document is open or no blob with that hash has
/// been rendered yet. The handler maps `None` to `404`.
#[must_use]
pub fn fetch_media_bytes(state: &AppState, hash: &str) -> Option<(Vec<u8>, String)> {
    state.with_doc(|d| {
        d.media_cache
            .lock()
            .get(hash)
            .map(|blob| (blob.bytes.clone(), blob.mime.clone()))
    })?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// Resolve the workspace fixture relative to this crate's manifest
    /// directory — matches the convention used in `commands::tests`.
    fn fixture_path() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../testing/fixtures/sample.pptx")
    }

    /// Run `body` on a worker thread with an 8 MiB stack.
    ///
    /// The PPTX renderer recursion depth on real fixtures exceeds the
    /// macOS default test-thread stack (2 MiB). Other crates that
    /// render fixtures suffer the same way; isolating the heavy work
    /// in a sized thread keeps the test reliable across CI runners and
    /// local dev machines without needing `RUST_MIN_STACK` plumbing.
    fn with_big_stack<F, R>(body: F) -> R
    where
        F: FnOnce() -> R + Send + 'static,
        R: Send + 'static,
    {
        std::thread::Builder::new()
            .stack_size(8 * 1024 * 1024)
            .spawn(body)
            .expect("spawn test worker")
            .join()
            .expect("test worker panicked")
    }

    #[test]
    #[ignore = "needs testing/fixtures/* — drop fixtures into testing/fixtures/ to enable"]
    fn pptx_slide_returns_svg_bytes() {
        let path = fixture_path();
        assert!(
            path.exists(),
            "fixture missing at {path:?} — adjust CARGO_MANIFEST_DIR-relative path"
        );

        with_big_stack(move || {
            let state = AppState::new();
            crate::commands::open_pptx_path_inner(&state, &path).expect("open");

            let bytes = render_slide_bytes(&state, 1).expect("svg");
            let head = String::from_utf8_lossy(&bytes[..bytes.len().min(40)]);
            assert!(
                head.starts_with("<svg") || head.starts_with("<?xml"),
                "expected SVG/XML preamble, got {head:?}"
            );
            // The renderer's URL scheme must not leak into the response —
            // only the canonical `pptx://localhost/media/` form may appear.
            let body = String::from_utf8_lossy(&bytes);
            assert!(
                !body.contains("pptx-media://"),
                "renderer scheme should be rewritten to pptx://localhost/media/"
            );
        });
    }

    #[test]
    fn render_slide_bytes_errors_when_no_document_open() {
        let state = AppState::new();
        let err = render_slide_bytes(&state, 1).expect_err("must fail without open doc");
        assert!(err.contains("no document"), "{err}");
    }

    #[test]
    #[ignore = "needs testing/fixtures/* — drop fixtures into testing/fixtures/ to enable"]
    fn render_slide_bytes_errors_on_out_of_range_slide() {
        let path = fixture_path();
        assert!(path.exists());

        with_big_stack(move || {
            let state = AppState::new();
            crate::commands::open_pptx_path_inner(&state, &path).expect("open");
            let count = u32::try_from(state.slide_count()).unwrap();
            let err = render_slide_bytes(&state, count + 1).expect_err("out of range");
            assert!(err.contains("out of range"), "{err}");
        });
    }

    #[test]
    fn fetch_media_bytes_returns_none_for_unknown_hash() {
        let state = AppState::new();
        assert!(fetch_media_bytes(&state, "deadbeef").is_none());

        let path = fixture_path();
        if path.exists() {
            with_big_stack(move || {
                let state = AppState::new();
                crate::commands::open_pptx_path_inner(&state, &path).expect("open");
                // No slide rendered yet -> cache empty -> still None for
                // any arbitrary hash.
                assert!(fetch_media_bytes(&state, "deadbeef").is_none());
            });
        }
    }

    #[test]
    #[ignore = "needs testing/fixtures/* — drop fixtures into testing/fixtures/ to enable"]
    fn render_slide_populates_media_cache_for_subsequent_fetch() {
        let path = fixture_path();
        assert!(path.exists());

        with_big_stack(move || {
            let state = AppState::new();
            crate::commands::open_pptx_path_inner(&state, &path).expect("open");

            // Render every slide so any media in the deck lands in the
            // cache. We don't know which slides carry images, so probing
            // all of them keeps the assertion deck-agnostic.
            let count = u32::try_from(state.slide_count()).unwrap();
            for n in 1..=count {
                let bytes = render_slide_bytes(&state, n).expect("svg");
                let body = String::from_utf8_lossy(&bytes);
                // For any media URL that appears in the SVG, the cache
                // must serve it back. Iterate every `pptx://media/{h}` in
                // the body.
                let mut cursor = 0;
                let needle = "pptx://localhost/media/";
                while let Some(rel) = body[cursor..].find(needle) {
                    let start = cursor + rel + needle.len();
                    let end = body[start..]
                        .find(['"', '\''])
                        .map_or(body.len(), |e| start + e);
                    let hash = &body[start..end];
                    let blob = fetch_media_bytes(&state, hash);
                    assert!(
                        blob.is_some(),
                        "cache should resolve {hash:?} from slide {n}"
                    );
                    cursor = end;
                }
            }
        });
    }
}
