//! Tauri build script — generates the platform-specific application
//! manifests (Info.plist, .rc, etc.) and embeds `tauri.conf.json`
//! at compile time via `tauri::generate_context!`.

fn main() {
    tauri_build::build();
}
