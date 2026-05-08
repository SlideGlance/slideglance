//! Per-OS menubar construction. macOS uses the App Menu convention;
//! Windows and Linux use an in-window menubar with `&` mnemonics.
//!
//! `install` is the single entry point called from the Tauri `setup`
//! hook. It dispatches at compile time to either [`crate::menu_macos`]
//! (Apple HIG layout) or [`crate::menu_other`] (Win32 / GTK menubar
//! with mnemonics).
//!
//! Menu actions surface to the frontend over the IPC event bus. The
//! webview listens on `menu://{action}` channels and reacts via the
//! same handlers used by the recent-files / CLI-arg open flows.
//!
//! The "Open Recent" submenu is dynamic: every time the recent-files
//! store changes, [`rebuild_recent`] reconstructs the entire menu and
//! calls `app.set_menu(...)` to swap it. Tauri 2 does not expose a
//! stable cross-version API for mutating an existing `Submenu`'s
//! children, so a whole-menu rebuild is the supported path. Cost is
//! negligible — the menu has roughly thirty items and the rebuild fires
//! only on file open or Clear Recent.

use tauri::{App, AppHandle, Emitter};

/// Install the per-OS menubar onto the running app.
///
/// On macOS this attaches the application / File / Edit / View / Window
/// / Help menus to the global menubar. On Windows and Linux it attaches
/// the in-window menubar to every top-level window. Both paths return
/// `Ok(())` once the menus are registered.
pub fn install(app: &App) -> tauri::Result<()> {
    #[cfg(target_os = "macos")]
    return crate::menu_macos::install(app);
    #[cfg(not(target_os = "macos"))]
    return crate::menu_other::install(app);
}

/// Emit a `menu://{action}` event so the frontend can react to a menu
/// click. Failure to emit is logged-and-swallowed because a missing
/// listener is a frontend bug, not a recoverable runtime condition the
/// menu handler can act on.
pub(crate) fn emit_menu(app: &AppHandle, action: &str) {
    let _ = app.emit(&format!("menu://{action}"), ());
}

/// Rebuild the native menu so the "Open Recent" submenu reflects the
/// latest recent-files state. Called by [`crate::commands::add_recent`]
/// and [`crate::commands::clear_recent`] after the store changes.
///
/// The whole menu is reconstructed via [`crate::menu_macos::build`] (on
/// macOS) or [`crate::menu_other::build`] (Win/Linux) and swapped in via
/// `Manager::set_menu`. A failure to rebuild is logged-and-swallowed
/// rather than propagated: the recent-files store has already been
/// updated successfully, and surfacing a menu glitch as an IPC error
/// would force the frontend to roll back the open / clear it just
/// performed.
pub fn rebuild_recent(app: &AppHandle) {
    let recents = crate::commands::recent_list(app.clone());
    #[cfg(target_os = "macos")]
    let new_menu = crate::menu_macos::build(app, &recents);
    #[cfg(not(target_os = "macos"))]
    let new_menu = crate::menu_other::build(app, &recents);
    match new_menu {
        Ok(menu) => {
            if let Err(e) = app.set_menu(menu) {
                eprintln!("menu: failed to swap rebuilt menu: {e}");
            }
        }
        Err(e) => eprintln!("menu: failed to build new menu: {e}"),
    }
}
