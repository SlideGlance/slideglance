//! `render_text_body` helpers — highlight filter, bullet text
//! resolution, default-color injection, vertical-text detection,
//! field-run substitution, font-size segmentation.
//!
//! Extracted from `body.rs` so the giant `render_text_body` entry
//! point can stay focused on the paragraph -> wrapped-line emission
//! flow.

//! `render_text_body` — text-mode entry point.
//!
//! Direct port of the text-mode branch of `renderTextBody` in
//! . Path-mode (glyph-
//! outline) rendering, `WordArt` warp curves (text- and path-mode),
//! `spAutofit` height computation, and `normAutofit` shrink-to-fit are
//! all wired up — this function dispatches to the path-mode helpers
//! when a `FontResolver` is supplied and emits `<text>` / `<tspan>`
//! markup otherwise.
//!
//! Vertical text (`vert`, `vert270`) is wrapped in a `<g rotate>` group as
//! the spec does. EA-vertical / Mongolian / `WordArt`-vertical share
//! the `vert` rotation since the renderer treats them as "90° CW" for the
//! group wrapper.

use slideglance_model::{
    BulletType, Paragraph, ParagraphProperties, TextBody, TextRun, TextVerticalType,
};

use std::fmt::Write as _;

use crate::slide_context::SlideRenderContext;

use super::super::auto_num::format_auto_num;
use super::super::layout::has_visible_bullet;
use super::super::segment::highlight_filter_id;
use crate::color::color_hex;

/// Walk every run of `body` and build the SVG `<defs>` block holding
/// one `<filter>` per distinct highlight color. Returns "" when no run
/// has a highlight set (the common case).
pub(super) fn build_highlight_filter_defs(body: &TextBody) -> String {
    use std::collections::BTreeSet;
    let mut hexes: BTreeSet<String> = BTreeSet::new();
    for para in &body.paragraphs {
        for run in &para.runs {
            if let Some(h) = &run.properties.highlight {
                let hex = color_hex(h);
                hexes.insert(hex.trim_start_matches('#').to_lowercase());
            }
        }
    }
    if hexes.is_empty() {
        return String::new();
    }
    let mut out = String::from("<defs>");
    for hex in &hexes {
        let id = highlight_filter_id(hex);
        // x/y/width/height: expand a few percent past the tspan's ink
        // box so the highlight doesn't clip glyph descenders or italic
        // overhangs. `feFlood` paints the filter region with the
        // highlight color, then `feMerge` stacks the original glyphs
        // on top so the text remains legible.
        let _ = write!(
            out,
            "<filter id=\"{id}\" x=\"-2%\" y=\"-15%\" width=\"104%\" height=\"130%\">\
             <feFlood flood-color=\"#{hex}\"/>\
             <feMerge><feMergeNode/><feMergeNode in=\"SourceGraphic\"/></feMerge>\
             </filter>"
        );
    }
    out.push_str("</defs>");
    out
}

/// Push the body's `default_text_color` (resolved from the parent
/// shape's `<p:style>/<a:fontRef>`) into every run that has no explicit
/// `<a:solidFill>`. `PowerPoint` cascades the color this way; without
/// the inject every "default-color" run hits the SVG `<text>` default
/// (black) and a white-on-blue layout badge becomes black-on-blue.
pub(super) fn inject_default_text_color(mut body: TextBody) -> TextBody {
    let Some(default_color) = body.default_text_color else {
        return body;
    };
    for para in &mut body.paragraphs {
        for run in &mut para.runs {
            if run.properties.color.is_none() {
                run.properties.color = Some(default_color);
            }
        }
    }
    body
}

pub(super) fn is_vertical(vert: TextVerticalType) -> bool {
    matches!(
        vert,
        TextVerticalType::Vert
            | TextVerticalType::EaVert
            | TextVerticalType::WordArtVert
            | TextVerticalType::MongolianVert
    )
}

pub(super) fn substitute_field_runs(body: &TextBody, slide: &SlideRenderContext) -> TextBody {
    let needs_clone = body
        .paragraphs
        .iter()
        .any(|p| p.runs.iter().any(|r| r.field_type.is_some()));
    if !needs_clone {
        return body.clone();
    }
    TextBody {
        default_text_color: body.default_text_color,
        paragraphs: body
            .paragraphs
            .iter()
            .map(|p| Paragraph {
                runs: p
                    .runs
                    .iter()
                    .map(|r| {
                        if let Some(field_type) = &r.field_type {
                            if let Some(value) =
                                crate::slide_context::format_field(field_type, slide)
                            {
                                return TextRun {
                                    text: value,
                                    properties: r.properties.clone(),
                                    field_type: r.field_type.clone(),
                                };
                            }
                        }
                        r.clone()
                    })
                    .collect(),
                properties: p.properties.clone(),
                end_para_run_properties: p.end_para_run_properties.clone(),
            })
            .collect(),
        body_properties: body.body_properties.clone(),
    }
}

pub(super) fn resolve_bullet_text(
    props: &ParagraphProperties,
    counters: &mut std::collections::HashMap<(slideglance_model::AutoNumScheme, u8), u32>,
) -> Option<String> {
    let bullet = props.bullet.as_ref()?;
    if !has_visible_bullet(props) {
        return None;
    }
    match bullet {
        BulletType::None => None,
        BulletType::Char { char } => Some(char.clone()),
        BulletType::AutoNum { scheme, start_at } => {
            let key = (*scheme, props.level);
            let current = counters.get(&key).copied().unwrap_or(0);
            let next_val = current + 1;
            counters.insert(key, next_val);
            let index = start_at + next_val - 1;
            Some(format_auto_num(*scheme, index))
        }
    }
}

pub(super) fn get_line_font_size_segments(
    line: &slideglance_font::WrappedLine,
    default_font_size: f64,
) -> f64 {
    for seg in &line.segments {
        if let Some(size) = seg.properties.font_size {
            return size.raw();
        }
    }
    default_font_size
}
