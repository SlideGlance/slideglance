//! Binary entry point for the `SlideGlance` Tauri 2 desktop shell.
//!
//! All real wiring lives in the `slideglance_viewer_lib` library crate so
//! integration tests can exercise it without spawning a webview.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    slideglance_viewer_lib::run();
}
