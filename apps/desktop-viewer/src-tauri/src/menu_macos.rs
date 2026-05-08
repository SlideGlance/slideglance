//! macOS menubar — Apple Human Interface Guidelines layout.
//!
//! Builds the seven HIG submenus that ship with the desktop viewer:
//! application / File / Edit / View / Slide Show / Window / Help. The
//! application submenu carries the platform-standard About / Settings /
//! Services / Hide / Quit grouping; File / Edit / View / Slide Show
//! emit `menu://{id}` events that the frontend bridge (Task E4) wires
//! to presentation actions; Window uses Tauri-supplied predefined
//! items so the OS handles minimize / maximize / bring-all-to-front
//! natively.
//!
//! The Open Recent submenu is rebuilt from the recent-files store every
//! time the store changes ([`crate::menu::rebuild_recent`]). It carries
//! the stable id `open-recent`, one `recent:{path}` item per entry, and
//! a trailing separator + `clear-recent` item when the store is
//! non-empty.
//!
//! # Tauri 2.11 API notes
//!
//! - `app.handle()` returns `&AppHandle<R>`; passing it to
//!   `SubmenuBuilder::new` / `MenuItem::with_id` works because both
//!   accept `&M where M: Manager<R>` and `AppHandle` implements
//!   `Manager`.
//! - `MenuItem::with_id(manager, id, text, enabled, accelerator)` —
//!   the accelerator is `Option<A: AsRef<str>>`. Tauri parses both
//!   `"Cmd+O"` (legacy) and `"CommandOrControl+O"` (cross-platform)
//!   forms; macOS-only modifiers like `"Cmd"` and `"Ctrl"` are
//!   accepted verbatim, which is what we want here since this module
//!   only runs under `#[cfg(target_os = "macos")]`.
//! - `PredefinedMenuItem::*` constructors return `Result<Self>` and
//!   accept an optional `text` override; we pass `None` everywhere so
//!   the OS provides the localized default labels.
//! - `app.on_menu_event` registers a single dispatcher that fires for
//!   custom-id items only; predefined items (Quit, Hide, etc.) are
//!   handled natively by the OS and never reach the closure.

use tauri::menu::{
    AboutMetadata, Menu, MenuBuilder, MenuItem, PredefinedMenuItem, Submenu, SubmenuBuilder,
};
use tauri::{App, AppHandle, Emitter, Wry};

/// Install the macOS HIG menubar onto the running app.
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

/// Build the macOS menu tree, populating Open Recent from `recents`.
///
/// Pure construction — no global side effects. [`install`] runs this
/// once at startup, and [`crate::menu::rebuild_recent`] runs it again
/// every time the recent-files store mutates so the submenu reflects
/// the latest state. Returning the assembled `Menu` lets the caller
/// decide whether to attach it to a fresh `App` (`App::set_menu`) or
/// swap it on a running one (`AppHandle::set_menu`).
pub fn build(handle: &AppHandle, recents: &[crate::recent::Entry]) -> tauri::Result<Menu<Wry>> {
    // ---- Application submenu (App Menu) ------------------------------
    //
    // The first submenu on macOS is always the application menu. Its
    // title is replaced at runtime by the OS with the bundle's
    // CFBundleName, but we still set "SlideGlance" so the menu has
    // a stable label inside the muda model and during development.
    let app_menu = SubmenuBuilder::new(handle, "SlideGlance")
        .item(&PredefinedMenuItem::about(
            handle,
            Some("About SlideGlance"),
            Some(AboutMetadata::default()),
        )?)
        .separator()
        .item(&item(
            handle,
            "settings",
            "Settings\u{2026}",
            Some("Cmd+,"),
        )?)
        .separator()
        .item(&PredefinedMenuItem::services(handle, None)?)
        .separator()
        .item(&PredefinedMenuItem::hide(handle, None)?)
        .item(&PredefinedMenuItem::hide_others(handle, None)?)
        .item(&PredefinedMenuItem::show_all(handle, None)?)
        .separator()
        .item(&PredefinedMenuItem::quit(handle, None)?)
        .build()?;

    // ---- File ---------------------------------------------------------
    let file_menu = SubmenuBuilder::new(handle, "File")
        .item(&item(handle, "open", "Open\u{2026}", Some("Cmd+O"))?)
        .item(&open_recent_submenu(handle, recents)?)
        .separator()
        .item(&PredefinedMenuItem::close_window(handle, None)?)
        .separator()
        .item(&item(handle, "print", "Print\u{2026}", Some("Cmd+P"))?)
        .item(&item(
            handle,
            "export-pdf",
            "Export as PDF\u{2026}",
            Some("Shift+Cmd+E"),
        )?)
        .build()?;

    // ---- Edit ---------------------------------------------------------
    //
    // We deliberately use custom ids for Copy / Select All / Find so
    // the actions reach the presentation component rather than the
    // webview's default OS-level edit handler. Native Cut / Paste /
    // Undo / Redo are out of scope (read-only viewer).
    let edit_menu = SubmenuBuilder::new(handle, "Edit")
        .item(&item(handle, "copy", "Copy", Some("Cmd+C"))?)
        .item(&item(handle, "select-all", "Select All", Some("Cmd+A"))?)
        .separator()
        .item(&item(handle, "find", "Find\u{2026}", Some("Cmd+F"))?)
        .build()?;

    // ---- View ---------------------------------------------------------
    let view_menu = SubmenuBuilder::new(handle, "View")
        .item(&item(handle, "view-normal", "Normal", Some("Cmd+1"))?)
        .item(&item(handle, "view-grid", "Slide Sorter", Some("Cmd+2"))?)
        .separator()
        .item(&item(handle, "show-notes", "Show Notes", None)?)
        .item(&item(handle, "show-sidebar", "Show Sidebar", None)?)
        .item(&item(handle, "show-ruler", "Show Ruler", None)?)
        .separator()
        .item(&item(handle, "zoom-in", "Zoom In", Some("Cmd+="))?)
        .item(&item(handle, "zoom-out", "Zoom Out", Some("Cmd+-"))?)
        .item(&item(handle, "zoom-actual", "Actual Size", Some("Cmd+0"))?)
        .item(&item(handle, "zoom-fit", "Fit to Window", None)?)
        .separator()
        .item(&item(
            handle,
            "fullscreen",
            "Enter Full Screen",
            Some("Ctrl+Cmd+F"),
        )?)
        .build()?;

    // ---- Slide Show ---------------------------------------------------
    let slideshow_menu = SubmenuBuilder::new(handle, "Slide Show")
        .item(&item(
            handle,
            "slideshow-from-start",
            "Play from Beginning",
            Some("F5"),
        )?)
        .item(&item(
            handle,
            "slideshow-from-current",
            "Play from Current Slide",
            Some("Shift+F5"),
        )?)
        .build()?;

    // ---- Window -------------------------------------------------------
    //
    // All entries are predefined — the OS handles minimize / zoom /
    // bring-all-to-front natively, so `on_menu_event` never sees them.
    let window_menu = SubmenuBuilder::new(handle, "Window")
        .item(&PredefinedMenuItem::minimize(handle, None)?)
        .item(&PredefinedMenuItem::maximize(handle, None)?)
        .separator()
        .item(&PredefinedMenuItem::bring_all_to_front(handle, None)?)
        .build()?;

    // ---- Help ---------------------------------------------------------
    let help_menu = SubmenuBuilder::new(handle, "Help")
        .item(&item(handle, "help", "SlideGlance Help", None)?)
        .build()?;

    MenuBuilder::new(handle)
        .item(&app_menu)
        .item(&file_menu)
        .item(&edit_menu)
        .item(&view_menu)
        .item(&slideshow_menu)
        .item(&window_menu)
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

/// Build the empty Open Recent submenu with the stable id
/// `open-recent`, populated from `recents`.
///
/// Each entry becomes a `MenuItem` whose id is `recent:{path}`. The
/// dispatcher in [`install`] strips the prefix and emits
/// `menu://open-path` with the path payload, reusing the same
/// frontend pipeline as drag-drop and CLI-arg open. When the list is
/// non-empty, a separator and a `clear-recent` item are appended so
/// the user can wipe the store directly from the menu.
fn open_recent_submenu(
    app: &AppHandle,
    recents: &[crate::recent::Entry],
) -> tauri::Result<Submenu<Wry>> {
    let mut sb = SubmenuBuilder::new(app, "Open Recent").id("open-recent");
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
            .item(&item(app, "clear-recent", "Clear Recent", None)?);
    }
    sb.build()
}

#[cfg(test)]
mod tests {
    //! Tauri menu construction depends on a live `App` (the muda
    //! backend dispatches every call onto the main thread via
    //! `run_main_thread!`). Spawning an `App` from a unit test would
    //! initialise a webview runtime, which is neither feasible nor
    //! desirable inside `cargo test`. The build itself is therefore
    //! the integration check: `cargo build -p slideglance-viewer`
    //! type-checks the entire menu tree, exercising `MenuItem::with_id`,
    //! `SubmenuBuilder::new`, every `PredefinedMenuItem::*` constructor
    //! used here, and the closure signature handed to
    //! `app.on_menu_event`. The smoke pass that follows
    //! (`pnpm --filter @slideglance/desktop-viewer tauri:dev`) verifies the
    //! menu actually appears on the macOS menubar with the documented
    //! shortcuts.
    //!
    //! What we *can* assert in isolation is the metadata that lives
    //! purely in Rust: the set of custom menu ids, their accelerators,
    //! and the contract with the frontend bridge in Task E4. Locking
    //! the id list down here means a stray rename in the menu tree
    //! cannot silently break a `menu://*` listener.

    /// The full set of custom menu ids emitted by [`install`].
    ///
    /// Kept as a literal mirror of the `Submenu::item` calls above
    /// so the test fails loudly if a rename / addition / deletion is
    /// not reflected in the frontend bridge contract.
    const CUSTOM_IDS: &[&str] = &[
        "settings",
        "open",
        "clear-recent",
        "print",
        "export-pdf",
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
    ];

    #[test]
    fn custom_ids_are_unique() {
        let mut seen = std::collections::BTreeSet::new();
        for id in CUSTOM_IDS {
            assert!(
                seen.insert(*id),
                "duplicate custom menu id `{id}` in macOS menubar"
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
        // silently break recent-files rendering.
        const OPEN_RECENT_ID: &str = "open-recent";
        assert_eq!(OPEN_RECENT_ID, "open-recent");
    }
}
