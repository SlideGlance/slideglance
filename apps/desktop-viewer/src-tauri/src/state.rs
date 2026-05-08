//! In-process state holding the currently-open PPTX. Wrapped in a
//! [`parking_lot::Mutex`] so Tauri commands (which run on a thread pool)
//! can read and write safely from any worker.
//!
//! Surface kept intentionally small:
//!
//! - [`AppState::open_path`] / [`AppState::open_bytes`] swap in a freshly
//!   parsed document.
//! - [`AppState::slide_count`] returns `0` when no document is loaded.
//! - [`AppState::close`] drops the document.
//! - [`AppState::with_doc`] hands a borrow of the [`OpenedDocument`] to
//!   a closure without leaking the [`parking_lot::Mutex`] guard outside
//!   this module — used by D4 / D5 to read parsed content.
//!
//! See `.plans/04-native-viewer/plan.md` Task D3 / D5.

use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};

use parking_lot::Mutex;
use slideglance::{
    default_font_mapping, extract_referenced_font_families, get_cjk_fallback_fonts,
    get_mapped_font, load_system_font_bytes_for_families, CjkPlatform, MediaBlob, PptxDocument,
};

/// Expand a list of literal PPTX typeface names into the full set of
/// family names the renderer's resolver chain may reach for at paint
/// time. The unified CJK fallback table from `get_cjk_fallback_fonts`
/// already concatenates Windows / macOS / Linux entries, so a single
/// lookup per name covers Office-installed Korean fonts on macOS,
/// preinstalled OS fonts, and community OSS in one shot. The mapped
/// Noto family from `get_mapped_font` adds its own fallback chain on
/// top.
///
/// fontdb skips names it doesn't see on disk, so over-asking is free —
/// missing a name means measurement drifts from paint, which is the
/// "browser wraps fine, app overflows the box" symptom this function
/// exists to prevent.
fn expand_with_cjk_fallbacks(families: &[String]) -> Vec<String> {
    let platform = CjkPlatform::current();
    let mapping = default_font_mapping();
    let mut out: BTreeSet<String> = BTreeSet::new();
    for fam in families {
        out.insert(fam.clone());
        for fb in get_cjk_fallback_fonts(platform, fam) {
            out.insert(fb.to_string());
        }
        if let Some(mapped) = get_mapped_font(fam, &mapping) {
            for fb in get_cjk_fallback_fonts(platform, &mapped) {
                out.insert(fb.to_string());
            }
            out.insert(mapped);
        }
    }
    out.into_iter().collect()
}

/// Process-wide state shared by every Tauri IPC handler.
#[derive(Default)]
pub struct AppState {
    inner: Mutex<Option<OpenedDocument>>,
}

/// A parsed PPTX kept resident for the lifetime of the open session.
///
/// `source_path` is `None` when the document was opened from in-memory
/// bytes (drag-drop of a buffer, fixture in tests, or future "open from
/// URL" flows).
pub struct OpenedDocument {
    /// The parsed document. Borrow via [`AppState::with_doc`].
    pub doc: PptxDocument,
    /// Display name (basename for path opens, caller-supplied label for
    /// byte opens).
    pub name: String,
    /// Filesystem origin, when known. Set by [`AppState::open_path`].
    pub source_path: Option<PathBuf>,
    /// Hash → [`MediaBlob`] cache populated as slides are rendered.
    ///
    /// `PptxDocument::render_slide` with `external_media: true` returns
    /// the SVG plus a per-call media `HashMap`. The `pptx://` protocol
    /// handler renders a slide first, then the `WebView` fires follow-up
    /// `pptx://media/{hash}` requests for every `<image>` tag in that
    /// SVG. This cache holds the union of every render's media so those
    /// follow-up fetches resolve.
    ///
    /// Wrapped in a `Mutex` so the protocol handler — which sees only
    /// `&OpenedDocument` via [`AppState::with_doc`] — can extend the
    /// cache without changing the borrow signature.
    pub media_cache: Mutex<HashMap<String, MediaBlob>>,
}

impl AppState {
    /// Construct an empty [`AppState`].
    #[must_use]
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }

    /// Read a PPTX from disk, parse it, and replace any previously open
    /// document. Returns the new slide count.
    ///
    /// # Errors
    ///
    /// - Returns the stringified `io::Error` when the file cannot be read.
    /// - Returns the stringified [`slideglance::ConvertError`] when parsing
    ///   fails. Stringification is used because the surface here is
    ///   ultimately consumed by Tauri IPC commands which serialise errors
    ///   as `String` to the frontend.
    pub fn open_path(&self, path: &Path) -> Result<usize, String> {
        let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
        // Prefer the basename for display, falling back to a lossy render
        // of the full path so non-UTF-8 paths or paths without a basename
        // (e.g. ones ending in `..`) still produce a usable label rather
        // than a blank tab in the UI.
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .map_or_else(|| path.to_string_lossy().into_owned(), str::to_owned);
        self.open_inner(bytes, name, Some(path.to_path_buf()))
    }

    /// Parse PPTX from an in-memory buffer and replace any previously
    /// open document. Returns the new slide count.
    ///
    /// `name` is a display label only — it is *not* parsed and does not
    /// need to be a valid filename.
    ///
    /// # Errors
    ///
    /// Returns the stringified [`slideglance::ConvertError`] when parsing
    /// fails. See [`AppState::open_path`] for why we stringify here.
    pub fn open_bytes(&self, bytes: &[u8], name: &str) -> Result<usize, String> {
        self.open_inner(bytes.to_vec(), name.to_string(), None)
    }

    /// Slide count of the currently-open document, or `0` when no
    /// document is loaded.
    #[must_use]
    pub fn slide_count(&self) -> usize {
        self.inner.lock().as_ref().map_or(0, |d| {
            usize::try_from(d.doc.slide_count()).unwrap_or(usize::MAX)
        })
    }

    /// Drop the currently-open document. No-op when none is loaded.
    pub fn close(&self) {
        *self.inner.lock() = None;
    }

    /// Borrow the currently-open document for the duration of `f`.
    ///
    /// Returns `Some(f(&doc))` when a document is loaded, `None`
    /// otherwise. The [`parking_lot::Mutex`] guard is held for the
    /// duration of the closure but never escapes this module.
    pub fn with_doc<R>(&self, f: impl FnOnce(&OpenedDocument) -> R) -> Option<R> {
        self.inner.lock().as_ref().map(f)
    }

    /// Build a fully populated [`OpenedDocument`] and atomically swap it
    /// into `self.inner` under a single lock acquisition.
    ///
    /// Holding the lock for the entire write rules out a race where
    /// concurrent `open_path` and `open_bytes` calls — both legal under
    /// Tauri's command thread pool — interleave a `source_path` patch
    /// with a different document's bytes / name. Parsing happens before
    /// the lock is taken so a slow parse on one thread doesn't block
    /// readers (`slide_count`, `with_doc`) on another.
    fn open_inner(
        &self,
        bytes: Vec<u8>,
        name: String,
        source_path: Option<PathBuf>,
    ) -> Result<usize, String> {
        // `PptxDocument::parse` signature:
        //   parse(bytes, additional_fonts, measurement_fonts, embed_fonts)
        //
        // `embed_fonts = true` mirrors `convert_to_svg`'s default: any
        // `<a:font>` blobs in the archive are extracted into the per-
        // document `<defs>` so the SVG renders consistently in the
        // WebView.
        //
        // `measurement_fonts` feeds the auto-built `OpentypeTextMeasurer`
        // so wrap positions match what the WebView eventually paints.
        // To keep open-time fast we scan the deck for the small set of
        // typefaces it actually references (regex over `ppt/*.xml`),
        // expand each name with its unified CJK fallback chain, and
        // ask fontdb for only those bytes.
        let referenced = extract_referenced_font_families(&bytes);
        let expanded = expand_with_cjk_fallbacks(&referenced);
        let needles: Vec<&str> = expanded.iter().map(String::as_str).collect();
        let measurement_fonts = load_system_font_bytes_for_families(&needles);
        let doc =
            PptxDocument::parse(bytes, &[], &measurement_fonts, true).map_err(|e| e.to_string())?;
        let count = usize::try_from(doc.slide_count()).unwrap_or(usize::MAX);
        *self.inner.lock() = Some(OpenedDocument {
            doc,
            name,
            source_path,
            media_cache: Mutex::new(HashMap::new()),
        });
        Ok(count)
    }
}

// Tests for this module previously embedded a `.pptx` fixture via
// `include_bytes!`; the fixture is no longer shipped with the repo
// (see `testing/fixtures/README.md`). Add a fixture and reinstate
// the open/close/reset test from git history (commit before this
// note) when re-running parse-driven tests becomes worthwhile.
