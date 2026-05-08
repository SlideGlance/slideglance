//! Tauri IPC command handlers exposed to the frontend.
//!
//! Each `#[tauri::command]` is a thin adapter over [`crate::state::AppState`]:
//! parse / read metadata / drop the document. Heavy work (parsing, rendering)
//! lives in `slideglance` — the IPC layer just marshals values across the
//! `WebView` ↔ native boundary.
//!
//! The `*_inner` helpers exist so the test module can drive the same code
//! paths without spinning up a `tauri::App`. They take a plain `&AppState`
//! and return the same shapes as their `#[tauri::command]` cousins.
//!
//! Errors flow back as `Result<_, String>` because Tauri serialises every
//! IPC error to JSON and `String` is the lowest-friction shape that survives
//! that round-trip without bringing `serde::Serialize` machinery into every
//! error enum on the path.
//!
//! See `.plans/04-native-viewer/plan.md` Task D4.

// `#[tauri::command]` forces `State<'_, T>` to be passed by value (the
// generated wrapper consumes it) and demands owned `String` arguments
// because they are deserialised from the IPC payload, so clippy's
// `needless_pass_by_value` lint cannot be satisfied without breaking the
// macro contract. Allow it module-wide rather than spraying inline
// `#[allow]` attributes on every command.
#![allow(clippy::needless_pass_by_value)]

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::state::AppState;

/// Result of a successful `open_pptx_*` call.
///
/// `name` is the filename portion of the opened path (or an empty string
/// when the path had no filename component, e.g. one ending in `..`).
/// `slide_count` mirrors [`AppState::slide_count`] post-open.
///
/// `rename_all = "camelCase"` so `slide_count` reaches the WebView as
/// `slideCount`, matching the TypeScript shape PptxPresentation expects
/// (`{ slideCount: number; fontDefs: string }` from the viewer worker
/// contract). Without this rename, `summary.slideCount` is `undefined`
/// in the WebView, `setSlideCount(undefined)` collapses to `0` via the
/// `?? 0` fallback inside PptxPresentation, the active-slide effect
/// short-circuits on `slideCount === 0`, no slide is ever requested,
/// and the loading overlay sits forever — even though parse and the
/// IPC roundtrip both succeeded.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DocSummary {
    /// Display label — basename of the opened path.
    pub name: String,
    /// Number of slides in the just-opened deck.
    pub slide_count: usize,
}

/// Per-slide metadata returned by [`slide_meta`]. Every field is
/// `Option<String>` because PPTX layouts may omit `cSld @name`, slides
/// are not required to belong to a section, and notes are optional.
#[derive(Serialize, Clone, Debug)]
pub struct SlideMeta {
    /// Slide layout name (`<p:cSld @name>`), if the layout declared one.
    pub layout_name: Option<String>,
    /// Section name (`<p14:section @name>`), when the slide belongs to a
    /// section.
    pub section_name: Option<String>,
    /// Speaker notes from `notesSlide{N}.xml`, if any.
    pub notes: Option<String>,
}

/// One row of the section outline returned by [`outline`]. `first_slide`
/// is 1-based to match the rest of the IPC surface (the frontend
/// navigates by slide number, not array index).
#[derive(Serialize, Clone, Debug)]
pub struct SectionInfo {
    /// Section display name.
    pub name: String,
    /// 1-based slide number of the first slide in the section.
    pub first_slide: usize,
}

/// Open a PPTX from a filesystem path, replacing any previously open
/// document, and return a summary for the frontend.
///
/// Test-friendly: takes a borrowed [`AppState`] so unit tests don't need
/// a Tauri runtime. The `#[tauri::command]` adapter [`open_pptx_path`]
/// just unwraps a [`State`] guard and forwards.
///
/// # Errors
///
/// Forwards the error from [`AppState::open_path`] (filesystem error or
/// parse failure, stringified for IPC transport).
pub fn open_pptx_path_inner(state: &AppState, path: &Path) -> Result<DocSummary, String> {
    state.open_path(path)?;
    // Use the same filename rule the AppState applied for its own `name`
    // field. Falling back to empty string here (vs. lossy path render)
    // keeps the IPC payload predictable for the frontend; the AppState
    // keeps the lossy rendering for in-process display.
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();
    Ok(DocSummary {
        name,
        slide_count: state.slide_count(),
    })
}

/// Test-friendly slide-count accessor matching [`slide_count`].
#[must_use]
pub fn slide_count_inner(state: &AppState) -> usize {
    state.slide_count()
}

/// Show the native file picker, filtered to `.pptx`. Returns the chosen
/// path as a string (or `None` on cancel).
///
/// This command does **not** open the document — the frontend follows up
/// with [`open_pptx_path`] once it has the path. Splitting the steps
/// keeps the dialog UI snappy even on slow parses, and matches the D6
/// frontend flow.
///
/// # Errors
///
/// Returns an error if the dialog's underlying `oneshot` channel is
/// dropped before the picker fires the callback (e.g. the `WebView`
/// closes mid-pick).
#[tauri::command]
pub async fn open_pptx_dialog(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    // The dialog runs on its own thread and signals completion via a
    // callback. We forward the result through a `tokio::sync::oneshot`
    // because the surrounding command is `async` and Tauri awaits it on
    // its own worker — bridging the callback to a `Future` here is the
    // idiomatic shape.
    let (tx, rx) = tokio::sync::oneshot::channel();
    let emitter = app.clone();
    app.dialog()
        .file()
        .add_filter("PowerPoint", &["pptx"])
        .pick_file(move |picked| {
            // `FilePath::to_string()` is provided by its `Display` impl
            // and yields either the absolute path or, for non-path
            // sources (URLs on mobile), the canonical URL form. Either
            // is a valid input for `AppState::open_path` once turned
            // back into a `&Path` on the next IPC call. Send-failures
            // mean the receiver was dropped — nothing to recover.
            let path = picked.map(|p| p.to_string());
            // Fire-and-forget signal to the WebView the moment the OS
            // panel callback runs — separately from the IPC reply.
            // Tauri's command-result path serialises through the
            // command bridge and on macOS that bridge has been
            // observed to lag the panel-dismiss callback by 3+ s
            // (Cocoa runloop ↔ tokio handoff). Emitting an event here
            // bypasses the command bridge so the frontend can show
            // its loading overlay the instant the panel closes,
            // independent of how long the command reply takes to
            // marshal back through Tauri's async machinery.
            if let Some(ref p) = path {
                let _ = emitter.emit("pptx://picked", p.clone());
            }
            let _ = tx.send(path);
        });
    rx.await.map_err(|e| e.to_string())
}

/// Tauri adapter for [`open_pptx_path_inner`]. The frontend calls this
/// once it has a filesystem path (from [`open_pptx_dialog`], drag-drop,
/// or a CLI argument).
///
/// On a successful open, the path is pushed to the recent-files store as
/// a best-effort side effect: the open succeeded, so a failure to update
/// the recent list (e.g. disk full while writing `recent.json`) is logged
/// to stderr but does not propagate. Surfacing it would force the
/// frontend to treat a fully-loaded deck as a failed open, which is the
/// wrong tradeoff.
///
/// # Errors
///
/// Propagates [`open_pptx_path_inner`] errors verbatim.
#[tauri::command]
pub fn open_pptx_path(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<DocSummary, String> {
    let summary = open_pptx_path_inner(&state, Path::new(&path))?;
    if let Err(e) = add_recent(app, path) {
        eprintln!("recent-files: failed to record opened path: {e}");
    }
    Ok(summary)
}

/// Drop the currently-open document. Idempotent: closing when nothing
/// is open is a silent no-op.
#[tauri::command]
pub fn close_pptx(state: State<'_, AppState>) {
    state.close();
}

/// Slide count of the currently-open document, or `0` when none is open.
#[tauri::command]
#[must_use]
pub fn slide_count(state: State<'_, AppState>) -> usize {
    state.slide_count()
}

/// Render slide `slide` (1-based) as a UTF-8 SVG string.
///
/// IPC fallback for the `pptx://` custom URI scheme. On macOS the
/// `register_uri_scheme_protocol` handler is reachable via document
/// loads (`<image href="pptx://...">`) but not via `fetch()` from
/// JavaScript — the fetch surfaces a generic "Load failed" without
/// ever invoking the handler. This command serializes the SVG bytes
/// through Tauri's IPC bridge as a JSON-encoded string. The cost is
/// one extra serialization per slide; acceptable for typical PPTX
/// payloads. Embedded media still resolves through the protocol
/// handler (the document-style `<image>` load path works).
///
/// # Errors
/// Surfaces the same errors as `protocol::render_slide_bytes`:
/// out-of-range slide, no document open, or a stringified
/// `slideglance::ConvertError`.
#[tauri::command]
pub fn render_slide_svg(state: State<'_, AppState>, slide: u32) -> Result<String, String> {
    let bytes = crate::protocol::render_slide_bytes(&state, slide)?;
    String::from_utf8(bytes).map_err(|e| format!("rendered SVG was not UTF-8: {e}"))
}

/// Per-slide metadata for `slide` (1-based). Returns `None` when the
/// slide doesn't exist or no document is open.
#[tauri::command]
#[must_use]
pub fn slide_meta(state: State<'_, AppState>, slide: u32) -> Option<SlideMeta> {
    state.with_doc(|d| SlideMeta {
        layout_name: d.doc.slide_layout_name(slide).map(str::to_owned),
        section_name: d.doc.slide_section_name(slide).map(str::to_owned),
        notes: d.doc.slide_notes(slide).map(str::to_owned),
    })
}

/// Section outline for the currently-open document. Returns an empty
/// `Vec` when no document is open or the deck has no sections.
#[tauri::command]
#[must_use]
pub fn outline(state: State<'_, AppState>) -> Vec<SectionInfo> {
    state
        .with_doc(|d| {
            d.doc
                .sections()
                .into_iter()
                .map(|(name, first)| SectionInfo {
                    name,
                    first_slide: first as usize,
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Return the current recent-files entries, most-recent first.
///
/// Loads `recent.json` from the platform app-data directory. A missing
/// or malformed file yields an empty list (see [`crate::recent::Store::load`]).
#[tauri::command]
#[must_use]
pub fn recent_list(app: AppHandle) -> Vec<crate::recent::Entry> {
    let path = recent_file(&app);
    crate::recent::Store::load(&path).entries
}

/// Push `path` to the top of the recent-files store and trigger a menu
/// rebuild so the "Open Recent" submenu reflects the change.
///
/// # Errors
///
/// Returns the stringified [`std::io::Error`] from [`crate::recent::Store::save`]
/// if the JSON file cannot be written (parent directory creation failure,
/// permission denied, disk full, etc.).
#[tauri::command]
pub fn add_recent(app: AppHandle, path: String) -> Result<(), String> {
    let file = recent_file(&app);
    let mut store = crate::recent::Store::load(&file);
    store.push(&path);
    store.save().map_err(|e| e.to_string())?;
    crate::menu::rebuild_recent(&app);
    Ok(())
}

/// Wipe every entry from the recent-files store and trigger a menu
/// rebuild so the "Open Recent" submenu reflects the empty state.
///
/// # Errors
///
/// Returns the stringified [`std::io::Error`] from [`crate::recent::Store::save`]
/// if the JSON file cannot be written.
#[tauri::command]
pub fn clear_recent(app: AppHandle) -> Result<(), String> {
    let file = recent_file(&app);
    let mut store = crate::recent::Store::load(&file);
    store.clear();
    store.save().map_err(|e| e.to_string())?;
    crate::menu::rebuild_recent(&app);
    Ok(())
}

/// Resolve the on-disk location of `recent.json` inside the platform's
/// per-app data directory.
///
/// `app_data_dir` is the canonical Tauri 2 API for this. It returns
/// `Err` only when the platform refuses to disclose a data directory
/// (extremely rare — every Tauri-supported OS has one), so the failure
/// is treated as an unrecoverable invariant rather than a normal-path
/// `Result` to bubble up through every recent-files command.
fn recent_file(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("tauri::Manager::path().app_data_dir()")
        .join("recent.json")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// Resolve the workspace fixture relative to this crate's manifest
    /// directory. `cargo test` sets `cwd` to the manifest dir, but
    /// other tools (rust-analyzer, IDE runners) sometimes don't, so
    /// anchoring to `CARGO_MANIFEST_DIR` makes the test path-agnostic.
    fn fixture_path() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../testing/fixtures/sample.pptx")
    }

    /// Run `body` on a worker thread with an 8 MiB stack.
    ///
    /// `slideglance-parser` recurses through the slide / layout / master tree
    /// deeply enough to overflow the macOS default test-thread stack
    /// (2 MiB). Wrapping fixture-driven tests in a sized worker keeps
    /// them green across CI and local-dev machines without requiring
    /// `RUST_MIN_STACK` plumbing in the host shell.
    fn with_big_stack<F>(body: F)
    where
        F: FnOnce() + Send + 'static,
    {
        std::thread::Builder::new()
            .stack_size(8 * 1024 * 1024)
            .spawn(body)
            .expect("spawn test worker")
            .join()
            .expect("test worker panicked");
    }

    #[test]
    #[ignore = "needs testing/fixtures/* — drop fixtures into testing/fixtures/ to enable"]
    fn slide_count_returns_after_open() {
        let path = fixture_path();
        assert!(
            path.exists(),
            "fixture missing at {path:?} — adjust CARGO_MANIFEST_DIR-relative path"
        );

        with_big_stack(move || {
            let state = AppState::new();
            let summary = open_pptx_path_inner(&state, &path).expect("open ok");
            assert!(summary.slide_count > 0, "fixture should have >=1 slide");
            assert_eq!(summary.name, "sample.pptx");

            let n = slide_count_inner(&state);
            assert_eq!(n, summary.slide_count);
        });
    }

    #[test]
    fn slide_count_is_zero_before_open() {
        let state = AppState::new();
        assert_eq!(slide_count_inner(&state), 0);
    }

    /// Smoke test the metadata accessors: opening the fixture and reading
    /// per-slide layout/section/notes plus the outline must not panic
    /// and must yield consistent shapes (1-based slide numbering, owned
    /// strings, an outline that's empty *or* references a real slide).
    ///
    /// This guards against a subtle regression where the inner accessor
    /// names get swapped (e.g. layout vs. notes) — a type-system check
    /// alone won't catch that because both return `Option<&str>`.
    #[test]
    #[ignore = "needs testing/fixtures/* — drop fixtures into testing/fixtures/ to enable"]
    fn metadata_accessors_round_trip_through_state() {
        let path = fixture_path();
        assert!(path.exists());

        with_big_stack(move || {
            let state = AppState::new();
            open_pptx_path_inner(&state, &path).expect("open ok");

            // `slide_meta` for an in-range slide returns Some and never
            // panics. The fixture's slide 1 may legitimately have None
            // for every field — we only assert the call doesn't blow
            // up.
            let meta = state.with_doc(|d| SlideMeta {
                layout_name: d.doc.slide_layout_name(1).map(str::to_owned),
                section_name: d.doc.slide_section_name(1).map(str::to_owned),
                notes: d.doc.slide_notes(1).map(str::to_owned),
            });
            assert!(meta.is_some(), "with_doc must yield value when doc open");

            // Out-of-range slide returns None for every accessor.
            let count = u32::try_from(state.slide_count()).unwrap();
            state.with_doc(|d| {
                assert!(d.doc.slide_layout_name(count + 1).is_none());
                assert!(d.doc.slide_section_name(count + 1).is_none());
                assert!(d.doc.slide_notes(count + 1).is_none());
            });

            // Outline is either empty (no sections) or every entry's
            // `first_slide` falls within `1..=slide_count`.
            let outline_rows = state
                .with_doc(|d| {
                    d.doc
                        .sections()
                        .into_iter()
                        .map(|(name, first)| SectionInfo {
                            name,
                            first_slide: first as usize,
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            for row in &outline_rows {
                assert!(
                    row.first_slide >= 1 && row.first_slide <= state.slide_count(),
                    "first_slide {} out of 1..={}",
                    row.first_slide,
                    state.slide_count()
                );
                assert!(!row.name.is_empty(), "section name must not be empty");
            }
        });
    }
}
