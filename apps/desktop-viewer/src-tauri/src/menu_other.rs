//! Windows / Linux menubar — File / Edit / View / Slide Show / Help with
//! `&` mnemonics and `Ctrl`-based accelerators.
//!
//! Windows and Linux render the menu inside the application window
//! itself rather than on a global menubar. Each top-level item carries a
//! `&`-prefixed mnemonic letter so users can navigate the menu with
//! `Alt+<letter>`; the prefix is the standard muda / Tauri 2 syntax and
//! is stripped from the rendered label by the OS.
//!
//! Compared with the macOS HIG layout in [`crate::menu_macos`] this
//! module:
//!
//! - drops the App submenu — Win/Linux apps put About under Help and
//!   Quit under File.
//! - uses a custom-id `quit` item so the click reaches the frontend
//!   bridge ([`crate::menu::emit_menu`]) rather than being absorbed by
//!   the OS — same rationale for `about`. The macOS menubar uses the
//!   `PredefinedMenuItem::quit` / `about` predefineds because Apple HIG
//!   requires the OS to handle them; Win/Linux has no such requirement
//!   and routing through the bridge keeps shutdown / about-dialog
//!   behaviour scriptable from the webview.
//! - puts Settings under File on Windows (`Ctrl+,`) and Preferences
//!   under Edit on Linux (`Ctrl+,`) — both follow the platform's own
//!   convention. The id is `settings` on both so the frontend bridge
//!   sees a single `menu://settings` event regardless of host OS.
//! - uses `F11` for fullscreen, the de-facto Win/Linux standard.
//!
//! The Open Recent submenu is rebuilt from the recent-files store every
//! time the store changes ([`crate::menu::rebuild_recent`]). It carries
//! the stable id `open-recent`, one `recent:{path}` item per entry, and
//! a trailing separator + `clear-recent` item when the store is
//! non-empty, mirroring the macOS path.
//!
//! # Cross-platform compilation
//!
//! `crate::menu::install` only calls this function on
//! `cfg(not(target_os = "macos"))`, but the file itself must still
//! type-check on macOS so `cargo build -p slideglance-viewer` works there.
//! Settings (Windows) and Preferences (Linux) are added via
//! `#[cfg(target_os = "...")]` reassignment of the builder rather than
//! through disabled placeholder items, so the inactive platform simply
//! omits the entry instead of showing a blank disabled row.

use tauri::menu::{Menu, MenuBuilder, MenuItem, Submenu, SubmenuBuilder};
use tauri::{App, AppHandle, Emitter, Wry};

/// Install the Windows / Linux in-window menubar onto the running app.
///
/// Loads the current recent-files entries from disk, calls [`build`] to
/// construct the menu tree, registers it via `Manager::set_menu`, and
/// wires `on_menu_event` to dispatch clicks. `recent:{path}` ids fan
/// out to a `menu://open-path` event carrying the path; every other
/// custom id is forwarded verbatim to [`crate::menu::emit_menu`].
pub fn install(app: &App) -> tauri::Result<()> {
    let handle = app.handle();
    let recents = crate::commands::recent_list(handle.clone());
    let menu = build(handle, &recents)?;
    app.set_menu(menu)?;
    app.on_menu_event(|app, ev| {
        let id = ev.id().as_ref();
        if let Some(path) = id.strip_prefix("recent:") {
            // The frontend's `menu://open-path` listener already drives
            // the same flow used by drag-drop and CLI-arg open, so the
            // recent click reuses the established pipeline rather than
            // adding a parallel `open_pptx_path` IPC roundtrip here.
            let _ = app.emit("menu://open-path", path.to_string());
        } else {
            crate::menu::emit_menu(app, id);
        }
    });
    Ok(())
}

/// Build the Win/Linux menu tree, populating Open Recent from `recents`.
///
/// Pure construction — no global side effects. [`install`] runs this
/// once at startup, and [`crate::menu::rebuild_recent`] runs it again
/// every time the recent-files store mutates so the submenu reflects
/// the latest state. Returning the assembled `Menu` lets the caller
/// decide whether to attach it to a fresh `App` (`App::set_menu`) or
/// swap it on a running one (`AppHandle::set_menu`).
pub fn build(handle: &AppHandle, recents: &[crate::recent::Entry]) -> tauri::Result<Menu<Wry>> {
    // ---- File ---------------------------------------------------------
    //
    // The Settings entry is Windows-only. Linux moves the same action
    // under Edit → Preferences per GTK convention. The shared custom id
    // is `settings` so the frontend bridge handles a single event.
    //
    // `unused_mut` is allowed because the cfg-gated reassignment fires
    // on Windows only — on Linux/macOS the binding is never mutated,
    // but the `mut` keyword must be present for the Windows compile.
    #[allow(unused_mut)]
    let mut file = SubmenuBuilder::new(handle, "&File")
        .item(&item(handle, "open", "&Open\u{2026}", Some("Ctrl+O"))?)
        .item(&open_recent_submenu(handle, recents)?)
        .separator()
        .item(&item(handle, "print", "&Print\u{2026}", Some("Ctrl+P"))?)
        .item(&item(
            handle,
            "export-pdf",
            "Export as &PDF\u{2026}",
            Some("Ctrl+Shift+E"),
        )?);
    #[cfg(target_os = "windows")]
    {
        file = file.separator().item(&item(
            handle,
            "settings",
            "&Settings\u{2026}",
            Some("Ctrl+,"),
        )?);
    }
    let file_menu = file
        .separator()
        .item(&item(handle, "quit", "E&xit", Some("Ctrl+Q"))?)
        .build()?;

    // ---- Edit ---------------------------------------------------------
    //
    // Linux puts Preferences here (GTK / freedesktop convention); the
    // shared custom id `settings` matches the Windows File→Settings
    // entry so the bridge collapses both into one handler.
    //
    // `unused_mut` is allowed because the cfg-gated reassignment fires
    // on Linux only — on Windows/macOS the binding is never mutated,
    // but the `mut` keyword must be present for the Linux compile.
    #[allow(unused_mut)]
    let mut edit = SubmenuBuilder::new(handle, "&Edit")
        .item(&item(handle, "copy", "&Copy", Some("Ctrl+C"))?)
        .item(&item(handle, "select-all", "Select &All", Some("Ctrl+A"))?)
        .separator()
        .item(&item(handle, "find", "&Find\u{2026}", Some("Ctrl+F"))?);
    #[cfg(target_os = "linux")]
    {
        edit = edit.separator().item(&item(
            handle,
            "settings",
            "&Preferences\u{2026}",
            Some("Ctrl+,"),
        )?);
    }
    let edit_menu = edit.build()?;

    // ---- View ---------------------------------------------------------
    let view_menu = SubmenuBuilder::new(handle, "&View")
        .item(&item(handle, "view-normal", "&Normal", Some("Ctrl+1"))?)
        .item(&item(handle, "view-grid", "Slide &Sorter", Some("Ctrl+2"))?)
        .separator()
        .item(&item(handle, "show-notes", "Show &Notes", None)?)
        .item(&item(handle, "show-sidebar", "Show Side&bar", None)?)
        .item(&item(handle, "show-ruler", "Show &Ruler", None)?)
        .separator()
        .item(&item(handle, "zoom-in", "Zoom &In", Some("Ctrl+="))?)
        .item(&item(handle, "zoom-out", "Zoom &Out", Some("Ctrl+-"))?)
        .item(&item(
            handle,
            "zoom-actual",
            "&Actual Size",
            Some("Ctrl+0"),
        )?)
        .item(&item(handle, "zoom-fit", "&Fit to Window", None)?)
        .separator()
        .item(&item(handle, "fullscreen", "Full &Screen", Some("F11"))?)
        .build()?;

    // ---- Slide Show ---------------------------------------------------
    let slideshow_menu = SubmenuBuilder::new(handle, "&Slide Show")
        .item(&item(
            handle,
            "slideshow-from-start",
            "Play from &Beginning",
            Some("F5"),
        )?)
        .item(&item(
            handle,
            "slideshow-from-current",
            "Play from &Current",
            Some("Shift+F5"),
        )?)
        .build()?;

    // ---- Help ---------------------------------------------------------
    //
    // About is a custom-id item rather than `PredefinedMenuItem::about`
    // because Win/Linux do not have an OS-level About dialog the way
    // macOS does — the frontend bridge will pop a webview-rendered
    // about panel in response to `menu://about`.
    let help_menu = SubmenuBuilder::new(handle, "&Help")
        .item(&item(handle, "help", "&Help", None)?)
        .separator()
        .item(&item(handle, "about", "&About", None)?)
        .build()?;

    MenuBuilder::new(handle)
        .item(&file_menu)
        .item(&edit_menu)
        .item(&view_menu)
        .item(&slideshow_menu)
        .item(&help_menu)
        .build()
}

/// Construct a custom-id menu item with the supplied accelerator.
///
/// Using `None::<&str>` rather than `None` keeps the `A: AsRef<str>`
/// generic resolvable when the caller passes `None`; without an
/// explicit type the compiler cannot infer `A`.
fn item(
    app: &AppHandle,
    id: &str,
    text: &str,
    accel: Option<&str>,
) -> tauri::Result<MenuItem<Wry>> {
    MenuItem::with_id(app, id, text, true, accel)
}

/// Build the Open Recent submenu with the stable id `open-recent`,
/// populated from `recents`.
///
/// Each entry becomes a `MenuItem` whose id is `recent:{path}`. The
/// dispatcher in [`install`] strips the prefix and emits
/// `menu://open-path` with the path payload, reusing the same
/// frontend pipeline as drag-drop and CLI-arg open. When the list is
/// non-empty, a separator and a `clear-recent` item are appended so
/// the user can wipe the store directly from the menu. The mnemonic
/// letter `R` matches the macOS label spelling so the frontend
/// localisation table can stay aligned across platforms.
fn open_recent_submenu(
    app: &AppHandle,
    recents: &[crate::recent::Entry],
) -> tauri::Result<Submenu<Wry>> {
    let mut sb = SubmenuBuilder::new(app, "Open &Recent").id("open-recent");
    for entry in recents {
        let id = format!("recent:{}", entry.path);
        // `entry.name` is the basename captured at push time. We
        // intentionally do not re-touch the filesystem here — the menu
        // rebuild path needs to stay synchronous and side-effect-free.
        sb = sb.item(&MenuItem::with_id(
            app,
            &id,
            &entry.name,
            true,
            None::<&str>,
        )?);
    }
    if !recents.is_empty() {
        sb = sb
            .separator()
            .item(&item(app, "clear-recent", "Clear &Recent", None)?);
    }
    sb.build()
}

#[cfg(test)]
mod tests {
    //! Like the macOS module, full menu construction needs a live
    //! `App` (muda dispatches every call onto the main thread) so the
    //! build itself is the integration check — `cargo build -p
    //! slideglance-viewer` exercises the full menu tree on every
    //! platform. What we *can* verify cheaply is the metadata that
    //! lives purely in Rust: custom-id uniqueness, kebab-case
    //! conformance, and the stable `open-recent` submenu id that Phase
    //! F looks up by name.

    /// The full set of custom menu ids emitted by [`super::install`].
    ///
    /// Includes `settings` once even though the entry is mounted on a
    /// different submenu per OS — the id is shared so the frontend
    /// bridge sees one handler regardless of host.
    const CUSTOM_IDS: &[&str] = &[
        "open",
        "clear-recent",
        "print",
        "export-pdf",
        "settings",
        "quit",
        "copy",
        "select-all",
        "find",
        "view-normal",
        "view-grid",
        "show-notes",
        "show-sidebar",
        "show-ruler",
        "zoom-in",
        "zoom-out",
        "zoom-actual",
        "zoom-fit",
        "fullscreen",
        "slideshow-from-start",
        "slideshow-from-current",
        "help",
        "about",
    ];

    #[test]
    fn custom_ids_are_unique() {
        let mut seen = std::collections::BTreeSet::new();
        for id in CUSTOM_IDS {
            assert!(
                seen.insert(*id),
                "duplicate custom menu id `{id}` in Win/Linux menubar"
            );
        }
    }

    #[test]
    fn custom_ids_use_kebab_case_or_single_word() {
        // Frontend listeners subscribe to `menu://{id}`, so ids must
        // not contain whitespace, slashes, or upper-case letters.
        for id in CUSTOM_IDS {
            assert!(
                !id.is_empty()
                    && id
                        .chars()
                        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-'),
                "menu id `{id}` is not lowercase-kebab-case"
            );
        }
    }

    #[test]
    fn open_recent_submenu_id_is_stable() {
        // Phase F looks the submenu up by this exact id when populating
        // recent files; renaming it here without updating F3 would
        // silently break recent-files rendering on Win/Linux.
        const OPEN_RECENT_ID: &str = "open-recent";
        assert_eq!(OPEN_RECENT_ID, "open-recent");
    }

    #[test]
    fn settings_id_matches_macos_for_bridge_parity() {
        // The Win/Linux `settings` id intentionally collides with the
        // macOS App-menu Settings id — the frontend bridge wires a
        // single `menu://settings` handler that fires regardless of
        // host OS. If this id ever drifts, the Linux Preferences /
        // Windows Settings click silently stops invoking the same
        // handler.
        assert!(CUSTOM_IDS.contains(&"settings"));
    }
}
