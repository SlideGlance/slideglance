use slideglance_viewer_lib::protocol::render_slide_bytes;
use slideglance_viewer_lib::state::AppState;
use std::path::Path;
use std::time::Instant;
fn main() {
    let path = std::env::args().nth(1).expect("path arg");
    let state = AppState::new();
    let t0 = Instant::now();
    state.open_path(Path::new(&path)).expect("open");
    let parse_ms = t0.elapsed().as_millis();
    let count = state.slide_count();
    println!("open_path: {parse_ms} ms, slide_count={count}");
    let t_all = Instant::now();
    for n in 1..=count as u32 {
        let t1 = Instant::now();
        let bytes = render_slide_bytes(&state, n).expect("render");
        let ms = t1.elapsed().as_millis();
        println!("  slide {n}: {ms} ms ({} bytes)", bytes.len());
    }
    println!("total render: {} ms", t_all.elapsed().as_millis());
}
