//! Path-mode (`<path>` glyph outline) text rendering.
//!
//! Direct port of `renderTextBodyAsPath` / `renderSegmentAsPath` /
//! `renderBulletAsPath` / `renderTextDecorations` from
//! . Path-mode is selected when
//! the renderer holds a [`slideglance_font::FontResolver`] capable of returning
//! parsed [`slideglance_font::FontFace`]s — the typical caller is the PNG output
//! pipeline (resvg lacks `<textPath>` so we extract glyph outlines manually).
//!
//! This module renders flat lines only. `WordArt` warps live in
//! [`super::warp_path`] and `normAutofit` / `spAutofit` are handled by
//! [`super::autofit`]; the dispatcher in [`super::body`] picks the
//! right path before this entry point runs.

use std::fmt::Write as _;
use std::sync::Arc;

use slideglance_font::{
    text_to_svg_path_kerned, text_to_svg_path_with_precision, wrap_paragraph,
    wrap_paragraph_with_chain, CjkPlatform, FontFace, FontMapping, FontResolver, ScriptFontContext,
    TextMeasurer,
};
use slideglance_model::{
    BodyProperties, BulletType, Paragraph, ParagraphAlignment, ParagraphProperties, RunProperties,
    TextBody, TextRun, TextVerticalType, Transform, WrapMode,
};
use slideglance_utils::Emu;

use crate::color::{alpha_str, color_hex};
use crate::geometry::fmt::n;
use crate::slide_context::SlideRenderContext;
use crate::svg_builder::escape_xml_attr;
use crate::text::auto_num::format_auto_num;
use crate::text::layout::{
    compute_line_natural_height, get_default_ascender_ratio, get_default_font_size,
    get_default_line_height_ratio, get_line_spacing, get_paragraph_font_size, has_visible_bullet,
    resolve_spacing_px_opt, DEFAULT_LINE_SPACING, PX_PER_PT,
};
use crate::text::script::split_by_script;

/// 2-decimal precision matches the spec's `.toFixed(2)` calls inside
/// path-mode emission.
const DECIMAL_PLACES: u8 = 2;

/// Render a `<p:txBody>` to one or more `<path>` (and decoration `<line>` /
/// `<rect>`) elements. The result is wrapped in a vertical-text rotation
/// group when [`BodyProperties::vert`] requests it.
///
/// Path-mode emits glyphs as filled paths via [`text_to_svg_path_with_precision`].
/// The font resolver is consulted in this order per segment:
///
/// 1. The italic-suffixed family (`"<family> Italic"` or `" Bold Italic"`),
///    if `italic` is set and a face exists. Synthesized italic via skew is
///    used as a fallback only when no italic face resolves.
/// 2. The bold-suffixed family (`"<family> Bold"`) when `bold` is set and
///    no italic face was selected.
/// 3. The plain family with theme `Jpan` fallback (CJK Script Equality
///    treats this as the renderer's CJK fallback for any script — see
///    [`slideglance_font::ScriptFontContext::jpan_fallback`]).
//
// The function intentionally has many lines / arguments because it follows
// the spec's single-pass flow over paragraphs / wrapped lines /
// segments — see body.rs for the same pattern. Bundling the seven dependency
// references into a context struct would obscure the parity table.
#[allow(clippy::too_many_lines, clippy::too_many_arguments)]
#[must_use]
pub fn render_text_body_as_path(
    raw_text_body: &TextBody,
    transform: &Transform,
    slide: &SlideRenderContext,
    script_fonts: &ScriptFontContext,
    measurer: &dyn TextMeasurer,
    font_resolver: &dyn FontResolver,
    mapping: &FontMapping,
    cjk_platform: CjkPlatform,
    is_table_cell: bool,
    // See `render_text_body` for the full doc — this carries the same
    // group-transform compensation factor through the path-mode (resvg
    // PNG) pipeline so text-mode SVG and PNG outputs scale identically
    // when the body lives inside a scaled group.
    font_size_correction: f64,
) -> String {
    let body = substitute_field_runs(raw_text_body, slide);
    let bp = &body.body_properties;
    let original_width = transform.extent_width.to_pixels();
    let original_height = transform.extent_height.to_pixels();
    let dims = resolve_text_dimensions(bp, original_width, original_height);

    let has_text = body
        .paragraphs
        .iter()
        .any(|p| p.runs.iter().any(|r| !r.text.is_empty()));
    if !has_text {
        return String::new();
    }

    let full_text_width = dims.width - dims.margin_left - dims.margin_right;
    let num_col = bp.num_col.max(1);
    let text_width = if num_col > 1 {
        full_text_width / f64::from(num_col)
    } else {
        full_text_width
    };
    let default_font_size = get_default_font_size(&body);
    let should_wrap = !matches!(bp.wrap, WrapMode::None);

    // normAutofit shrink-to-fit. PowerPoint's PDF export ignores the stored
    // `<a:normAutofit fontScale=...>` value and re-runs the fit from full
    // size — if the text fits at 100% with the *current* font / shape, it
    // renders at 100%; otherwise it shrinks. The stored value is just a
    // cache from the last edit-time measurement and goes stale when the
    // font is substituted, the shape is resized, or the host's metrics
    // differ from the original author's machine. Mirroring that policy
    // here pulls many CJK title cells (deck slide 2 "평 가 항 목 조 견
    // 표" was the canary) back to the same height PowerPoint shows.
    //
    // We still gate on `auto_fit=NormAutofit` so decks that explicitly opt
    // out (`<a:noAutofit/>` / `<a:spAutoFit/>`) keep their stored values.
    let mut font_scale = bp.font_scale;
    let ln_spc_reduction = bp.ln_spc_reduction;
    // Group transform compensation. Same rationale as the text-mode
    // `render_text_body` (body.rs). Applied AFTER autofit so the
    // shrink-to-fit math runs on the deck-authored sizes against the
    // local-coord frame the SVG `<g transform="scale">` will then expand.
    if matches!(bp.auto_fit, slideglance_model::AutoFit::NormAutofit) && should_wrap {
        let available_height = dims.height - dims.margin_top - dims.margin_bottom;
        font_scale = crate::text::autofit::compute_shrink_to_fit_scale(
            &body,
            default_font_size,
            1.0,
            ln_spc_reduction,
            text_width,
            available_height,
            measurer,
        );
    }
    font_scale *= font_size_correction;
    let scaled_default_font_size_pt = default_font_size * font_scale;
    let default_line_height_ratio = get_default_line_height_ratio(&body, measurer);
    let default_ascender_ratio = get_default_ascender_ratio(&body, measurer);
    let default_natural_height_pt = scaled_default_font_size_pt * default_line_height_ratio;

    // Vertical anchor offset (top-anchor default).
    let mut y_start = dims.margin_top;
    let total_text_height = estimate_total_height(
        &body,
        default_font_size,
        should_wrap,
        text_width,
        ln_spc_reduction,
        font_scale,
        measurer,
    );
    if matches!(bp.anchor, slideglance_model::VerticalAnchor::Ctr) {
        y_start = dims.margin_top.max((dims.height - total_text_height) / 2.0);
    } else if matches!(bp.anchor, slideglance_model::VerticalAnchor::B) {
        y_start = dims
            .margin_top
            .max(dims.height - total_text_height - dims.margin_bottom);
    }
    let first_para_font_size_pt = body.paragraphs.first().map_or(default_font_size, |p| {
        get_paragraph_font_size(p, default_font_size)
    }) * font_scale;
    let first_line_baseline_offset_pt = first_para_font_size_pt * default_ascender_ratio;
    // OOXML lineSpacing percentage scales the line height (sec 21.1.2.2.6
    // ST_LineSpacingPercentOrPercentString): line_height = font_size × pct.
    // The "extra" leading (line_height − font_size) sits between adjacent
    // lines. The first line's baseline placement depends on how the leading
    // is distributed:
    //   * anchor=t shape:         full leading goes ABOVE first line
    //                             (PowerPoint title behavior, matches PDF)
    //   * anchor=ctr / bottom:    leading distributed symmetrically; only
    //                             half lands above first line (otherwise
    //                             centered text drifts visibly downward)
    //   * table cell (any anchor): half leading (cells over-shoot at full,
    //                             validated empirically across the deck)
    let anchor_top = matches!(bp.anchor, slideglance_model::VerticalAnchor::T);
    let leading_coefficient = if is_table_cell {
        0.5
    } else if anchor_top {
        1.0
    } else {
        0.5
    };
    let first_line_spacing = body.paragraphs.first().map_or(DEFAULT_LINE_SPACING, |p| {
        get_line_spacing(p, ln_spc_reduction)
    });
    let extra_first_line_leading_pt =
        (first_line_spacing - 1.0) * first_para_font_size_pt * leading_coefficient;
    let legacy_y_inc = (first_line_baseline_offset_pt + extra_first_line_leading_pt) * PX_PER_PT;
    // Empirically tuned via grid-search across 132 slides (new PDF
    // baseline). For top-anchored shapes with line-spacing > 100 %
    // PowerPoint's PDF export places the first baseline closer to one
    // full line height (margin + font × LHR × lnSpc) than to the
    // ascender-plus-leading position the legacy formula computes; the
    // legacy form under-shoots by ~ (LHR - ascender_ratio) × font.
    // Mixing 50 % between the two formulas captures most of the gain
    // (sum diff -0.236 pp at α=0.5; α=1.0 hits -0.343 pp but a few
    // slides overshoot — we keep α=0.5 as the conservative sweet
    // spot until per-slide audit clears α=1.0).
    let alpha_first_line: f64 = 0.0;
    let lh_y_inc =
        first_para_font_size_pt * default_line_height_ratio * first_line_spacing * PX_PER_PT;
    // Smaller blend for anchor=ctr (table cells + center-anchored
    // shapes). PowerPoint's center alignment puts the *line center*
    // at the cell middle. Restricted to single-paragraph + no
    // explicit line break runs because multi-line cells (slide 23)
    // interpret leading-delta as inter-line spacing and the blend
    // would push the first line down by a full line-height worth.
    let alpha_center: f64 = 0.25;
    let anchor_ctr = matches!(bp.anchor, slideglance_model::VerticalAnchor::Ctr);
    let _single_line_para = body.paragraphs.len() == 1
        && body
            .paragraphs
            .first()
            .is_some_and(|p| p.runs.iter().all(|r| !r.text.contains('\n')));
    y_start +=
        if alpha_first_line != 0.0 && anchor_top && first_line_spacing > 1.0 && !is_table_cell {
            legacy_y_inc * (1.0 - alpha_first_line) + lh_y_inc * alpha_first_line
        } else if alpha_center != 0.0 && anchor_ctr {
            legacy_y_inc * (1.0 - alpha_center) + lh_y_inc * alpha_center
        } else {
            legacy_y_inc
        };

    let mut elements = String::new();
    let mut current_y = y_start;
    let mut is_first_line = true;
    let mut auto_num_counters: std::collections::HashMap<
        (slideglance_model::AutoNumScheme, u8),
        u32,
    > = std::collections::HashMap::new();
    let mut prev_space_after_px = 0.0_f64;
    let last_para_index = body.paragraphs.len().saturating_sub(1);

    for (para_idx, para) in body.paragraphs.iter().enumerate() {
        let para_margin_left = para.properties.margin_left.map_or(0.0, Emu::to_pixels);
        let para_indent = para.properties.indent.map_or(0.0, Emu::to_pixels);
        let text_start_x = dims.margin_left + para_margin_left;
        let bullet_x = text_start_x + para_indent;
        let effective_text_width = text_width - para_margin_left;
        let bullet_text = resolve_bullet_text(&para.properties, &mut auto_num_counters);

        let para_font_size_pt = get_paragraph_font_size(para, default_font_size) * font_scale;
        // ECMA-376 §21.1.2.1.5 spcFirstLastPara: when false (default),
        // the first paragraph's spcBef and the last paragraph's spcAft
        // are ignored — paragraph margins only apply between paragraphs.
        let is_first_para = para_idx == 0;
        let is_last_para = para_idx == last_para_index;
        let space_before_px = if is_first_para && !bp.spc_first_last_para {
            0.0
        } else {
            resolve_spacing_px_opt(para.properties.space_before, para_font_size_pt)
        };
        let paragraph_gap_px = prev_space_after_px.max(space_before_px);

        let para_has_text = para.runs.iter().any(|r| !r.text.is_empty());
        if para.runs.is_empty() || !para_has_text {
            if !is_first_line {
                let empty_para_height_pt = if para_font_size_pt > 0.0 {
                    para_font_size_pt
                } else {
                    default_natural_height_pt
                };
                current_y += empty_para_height_pt
                    * default_line_height_ratio
                    * PX_PER_PT
                    * get_line_spacing(para, ln_spc_reduction)
                    + paragraph_gap_px;
            }
            is_first_line = false;
            prev_space_after_px =
                resolve_spacing_px_opt(para.properties.space_after, para_font_size_pt);
            continue;
        }

        if should_wrap {
            let wrapped = wrap_paragraph_with_chain(
                para,
                effective_text_width,
                scaled_default_font_size_pt,
                font_scale,
                measurer,
                &|props| {
                    let pair = [
                        props.font_family.as_deref(),
                        props.font_family_ea.as_deref(),
                    ];
                    super::font_family::build_font_family_value(
                        &pair,
                        mapping,
                        cjk_platform,
                        script_fonts,
                    )
                },
            );
            for (line_idx, line) in wrapped.iter().enumerate() {
                let line_gap_px = if line_idx == 0 { paragraph_gap_px } else { 0.0 };
                if line.segments.is_empty() {
                    if !is_first_line {
                        current_y += default_natural_height_pt
                            * PX_PER_PT
                            * get_line_spacing(para, ln_spc_reduction)
                            + line_gap_px;
                    }
                    is_first_line = false;
                    continue;
                }

                let line_natural_height_pt = compute_line_natural_height(
                    &line.segments,
                    default_font_size,
                    font_scale,
                    measurer,
                );
                if !is_first_line {
                    current_y += line_natural_height_pt
                        * PX_PER_PT
                        * get_line_spacing(para, ln_spc_reduction)
                        + line_gap_px;
                }

                let line_width = measure_line_width(
                    line.segments.iter().map(|s| (&*s.text, &s.properties)),
                    default_font_size,
                    font_scale,
                    measurer,
                );
                let line_start_x = compute_path_line_x(
                    para.properties.alignment,
                    text_start_x,
                    effective_text_width,
                    dims.width,
                    dims.margin_right,
                    line_width,
                );
                let mut current_x = line_start_x;

                if line_idx == 0 {
                    if let Some(bullet_text) = &bullet_text {
                        let line_font_size = line
                            .segments
                            .iter()
                            .find_map(|s| s.properties.font_size.map(slideglance_utils::Pt::raw))
                            .unwrap_or(default_font_size)
                            * font_scale;
                        let first_seg = line.segments.first();
                        elements.push_str(&render_bullet_as_path(
                            bullet_text,
                            bullet_x,
                            current_y,
                            &para.properties,
                            line_font_size,
                            font_resolver,
                            mapping,
                            cjk_platform,
                            first_seg.and_then(|s| s.properties.font_family.as_deref()),
                            first_seg.and_then(|s| s.properties.font_family_ea.as_deref()),
                        ));
                    }
                }

                for seg in &line.segments {
                    let result = render_segment_as_path(
                        &seg.text,
                        &seg.properties,
                        current_x,
                        current_y,
                        font_scale,
                        default_font_size,
                        font_resolver,
                        script_fonts,
                        measurer,
                        mapping,
                        cjk_platform,
                        bp.vert,
                    );
                    elements.push_str(&result.svg);
                    current_x += result.width;
                }
                is_first_line = false;
            }
        } else {
            // wrap == "none": no wrapping; emit each non-empty run on the
            // same line.
            let natural_height_pt =
                compute_line_natural_height(&para.runs, default_font_size, font_scale, measurer);
            if !is_first_line {
                current_y +=
                    natural_height_pt * PX_PER_PT * get_line_spacing(para, ln_spc_reduction)
                        + paragraph_gap_px;
            }
            let line_width = measure_line_width(
                para.runs
                    .iter()
                    .filter(|r| !r.text.is_empty())
                    .map(|r| (&*r.text, &r.properties)),
                default_font_size,
                font_scale,
                measurer,
            );
            let line_start_x = compute_path_line_x(
                para.properties.alignment,
                text_start_x,
                effective_text_width,
                dims.width,
                dims.margin_right,
                line_width,
            );
            let mut current_x = line_start_x;

            if let Some(bullet_text) = &bullet_text {
                let first_run = para.runs.iter().find(|r| !r.text.is_empty());
                let font_size = first_run
                    .and_then(|r| r.properties.font_size.map(slideglance_utils::Pt::raw))
                    .unwrap_or(default_font_size)
                    * font_scale;
                elements.push_str(&render_bullet_as_path(
                    bullet_text,
                    bullet_x,
                    current_y,
                    &para.properties,
                    font_size,
                    font_resolver,
                    mapping,
                    cjk_platform,
                    first_run.and_then(|r| r.properties.font_family.as_deref()),
                    first_run.and_then(|r| r.properties.font_family_ea.as_deref()),
                ));
            }
            for run in &para.runs {
                if run.text.is_empty() {
                    continue;
                }
                let result = render_segment_as_path(
                    &run.text,
                    &run.properties,
                    current_x,
                    current_y,
                    font_scale,
                    default_font_size,
                    font_resolver,
                    script_fonts,
                    measurer,
                    mapping,
                    cjk_platform,
                    bp.vert,
                );
                elements.push_str(&result.svg);
                current_x += result.width;
            }
            is_first_line = false;
        }
        prev_space_after_px = if is_last_para && !bp.spc_first_last_para {
            0.0
        } else {
            resolve_spacing_px_opt(para.properties.space_after, para_font_size_pt)
        };
    }

    if elements.is_empty() {
        return String::new();
    }

    if is_vertical(bp.vert) {
        format!(
            "<g transform=\"translate({}, 0) rotate(90)\">{elements}</g>",
            n(original_width)
        )
    } else if matches!(bp.vert, TextVerticalType::Vert270) {
        format!(
            "<g transform=\"translate(0, {}) rotate(-90)\">{elements}</g>",
            n(original_height)
        )
    } else {
        elements
    }
}

/// Result of rendering a single text segment as `<path>` data.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct SegmentPath {
    /// The emitted SVG fragment (`<path>` plus any decoration / highlight
    /// elements).
    pub svg: String,
    /// The total advance width of the rendered segment, in pixels.
    pub width: f64,
}

/// Render a single text run as `<path>` data plus optional underline /
/// strikethrough / highlight `<rect>` siblings. Returns the emitted SVG
/// fragment and its advance width.
//
// The function follows the spec's `processSegment` / `processCjkUpright`
// switch over `vert == "eaVert"` and over `needs_script_split`. Reorganizing
// would obscure the parity table.
#[allow(clippy::too_many_arguments, clippy::too_many_lines)]
#[must_use]
pub fn render_segment_as_path(
    text: &str,
    props: &RunProperties,
    x: f64,
    y: f64,
    font_scale: f64,
    default_font_size: f64,
    font_resolver: &dyn FontResolver,
    script_fonts: &ScriptFontContext,
    measurer: &dyn TextMeasurer,
    _mapping: &FontMapping,
    _cjk_platform: CjkPlatform,
    vert: TextVerticalType,
) -> SegmentPath {
    let font_size = props
        .font_size
        .map_or(default_font_size, slideglance_utils::Pt::raw)
        * font_scale;
    let font_size_px = font_size * PX_PER_PT;
    let processed = text.replace('\t', "    ");

    let y_offset = if props.baseline > 0.0 {
        -font_size_px * 0.35
    } else if props.baseline < 0.0 {
        font_size_px * 0.2
    } else {
        0.0
    };
    let effective_y = y + y_offset;
    let jpan_fallback = script_fonts.jpan_fallback();

    let mut out = String::new();
    let mut total_width = 0.0_f64;

    let ctx = SegmentEmitCtx {
        props,
        x,
        effective_y,
        font_size,
        font_size_px,
        font_resolver,
        measurer,
        jpan_fallback,
    };

    // Letter-spacing trick boost (e.g. slide-2 title "평 가 항 목  조 견
    // 표"). When the *whole run* is the EA-space-EA pattern, PowerPoint
    // widens each space ~0.2 em above the font's nominal advance. We
    // apply this boost when ANY of the dispatched paths below is taken
    // by always script-splitting and inserting per-space padding. The
    // matching extra is summed in `measure_line_width` so center / right
    // alignment uses the same total width.
    let trick_boost_per_space = if is_letter_spacing_trick(&processed) {
        ctx.font_size_px * LETTER_SPACING_TRICK_PAD_EM
    } else {
        0.0
    };
    let apply_trick = trick_boost_per_space > 0.0;

    if matches!(vert, TextVerticalType::EaVert) || apply_trick || needs_script_split(props) {
        let parts = split_by_script(&processed);
        let is_ea_vert = matches!(vert, TextVerticalType::EaVert);
        for part in &parts {
            let part_is_ea = part.script.is_ea();
            let (ff, ff_ea) = if is_ea_vert {
                if part_is_ea {
                    (
                        props
                            .font_family_ea
                            .as_deref()
                            .or(props.font_family.as_deref()),
                        props.font_family_ea.as_deref(),
                    )
                } else {
                    (
                        props.font_family.as_deref(),
                        props.font_family_ea.as_deref(),
                    )
                }
            } else if part_is_ea {
                (
                    props.font_family_ea.as_deref(),
                    props.font_family.as_deref(),
                )
            } else {
                (
                    props.font_family.as_deref(),
                    props.font_family_ea.as_deref(),
                )
            };
            // Trick boost: if this part is space-only and we're in
            // trick mode, distribute boost half-before / half-after the
            // rendered space glyph so center alignment stays optical.
            let part_boost = if apply_trick && !part_is_ea && part.text.chars().all(|c| c == ' ') {
                let n = part.text.chars().count() as f64;
                trick_boost_per_space * n
            } else {
                0.0
            };
            total_width += part_boost / 2.0;
            if part_is_ea && is_ea_vert {
                emit_cjk_upright(&ctx, &part.text, ff, ff_ea, &mut out, &mut total_width);
            } else {
                emit_segment(&ctx, &part.text, ff, ff_ea, &mut out, &mut total_width);
            }
            total_width += part_boost / 2.0;
        }
    } else {
        emit_segment(
            &ctx,
            &processed,
            props.font_family.as_deref(),
            props.font_family_ea.as_deref(),
            &mut out,
            &mut total_width,
        );
    }

    let svg = if let Some(link) = &props.hyperlink {
        if out.is_empty() {
            String::new()
        } else {
            let href = escape_xml_attr(&link.url);
            format!("<a href=\"{href}\">{out}</a>")
        }
    } else {
        out
    };
    SegmentPath {
        svg,
        width: total_width,
    }
}

/// Render a bullet character as a single `<path>` element. Returns an
/// empty string when the bullet font cannot be resolved.
#[allow(clippy::too_many_arguments)]
#[must_use]
pub fn render_bullet_as_path(
    bullet_text: &str,
    x: f64,
    y: f64,
    para_props: &ParagraphProperties,
    text_font_size_pt: f64,
    font_resolver: &dyn FontResolver,
    _mapping: &FontMapping,
    _cjk_platform: CjkPlatform,
    run_font_family: Option<&str>,
    run_font_family_ea: Option<&str>,
) -> String {
    let bullet_font_size = match para_props.bullet_size_pct {
        Some(pct) => text_font_size_pt * (pct / 100_000.0),
        None => text_font_size_pt,
    };

    let face = if let Some(name) = &para_props.bullet_font {
        font_resolver.resolve(name)
    } else {
        run_font_family
            .and_then(|n| font_resolver.resolve(n))
            .or_else(|| run_font_family_ea.and_then(|n| font_resolver.resolve(n)))
    };
    let Some(face) = face else {
        return String::new();
    };

    let path_data =
        text_to_svg_path_with_precision(&face, bullet_text, x, y, bullet_font_size, DECIMAL_PLACES);
    if path_data.is_empty() {
        return String::new();
    }

    let mut attrs = Vec::new();
    if let Some(color) = &para_props.bullet_color {
        attrs.push(format!("fill=\"{}\"", color_hex(color)));
        if color.alpha < 1.0 {
            attrs.push(format!("fill-opacity=\"{}\"", alpha_str(color.alpha)));
        }
    } else {
        attrs.push("fill=\"#000000\"".to_string());
    }
    format!("<path d=\"{path_data}\" {}/>", attrs.join(" "))
}

/// Build the `fill="..."` (and optional `fill-opacity`) attribute value
/// for one path-mode glyph fragment. Defaults to `#000000` when the run
/// has no explicit color, matching the spec.
#[must_use]
pub fn build_path_fill_attrs(props: &RunProperties) -> String {
    if let Some(color) = &props.color {
        let mut s = format!("fill=\"{}\"", color_hex(color));
        if color.alpha < 1.0 {
            let _ = write!(s, " fill-opacity=\"{}\"", alpha_str(color.alpha));
        }
        s
    } else {
        "fill=\"#000000\"".to_string()
    }
}

/// Build the `fill=…[ stroke=… stroke-width=…]` attribute string for a
/// glyph path. When `synthesize_bold` is true the fill color is also painted
/// as a thin stroke around the glyph outline, reproducing `PowerPoint`'s
/// "faux bold" widening for `<a:rPr b="1">` runs whose resolved face does
/// not already carry the requested weight. The stroke width is intentionally
/// small (`~2.5%` of font size) so well-weighted faces don't muddy.
#[must_use]
pub fn build_path_attrs(props: &RunProperties, font_size_px: f64, synthesize_bold: bool) -> String {
    let mut s = build_path_fill_attrs(props);
    if !synthesize_bold {
        return s;
    }
    let stroke_color = props
        .color
        .as_ref()
        .map_or_else(|| "#000000".to_string(), color_hex);
    let stroke_width = font_size_px * 0.015;
    let _ = write!(
        s,
        " stroke=\"{stroke_color}\" stroke-width=\"{stroke_width:.3}\" paint-order=\"stroke fill\""
    );
    if let Some(color) = props.color.as_ref() {
        if color.alpha < 1.0 {
            let _ = write!(s, " stroke-opacity=\"{}\"", alpha_str(color.alpha));
        }
    }
    s
}

/// Determine whether a path-mode glyph should be stroke-widened to mimic
/// `PowerPoint`'s faux-bold pass. Triggered when the run requests bold
/// (`<a:rPr b="1">`) AND the resolved face weight class is **below 700**
/// (CSS Bold) — when the resolved face already carries Bold weight or
/// heavier, additional stroke causes glyph muddying (visible in 132-slide
/// sweep on titles using "Freesentation 7 Bold" / Apple SD Gothic Neo Bold
/// where weight=700 is reported and stroke widened the glyphs by ~1px,
/// producing red/blue halos that swelled the diff by ~5–7 pp on
/// title-heavy decks like slides 96 / 100).
fn should_synthesize_bold(props: &RunProperties, face: Option<&FontFace>) -> bool {
    if !props.bold {
        return false;
    }
    match face {
        Some(f) => f.weight() < 700,
        None => true, // No face resolved → fallback heuristic likely lighter than Bold.
    }
}

/// Emit underline / strikethrough `<line>` elements for one segment.
/// Returns the concatenated SVG fragment (possibly empty).
#[must_use]
pub fn render_text_decorations(
    x: f64,
    y: f64,
    segment_width: f64,
    font_size_px: f64,
    props: &RunProperties,
) -> String {
    let mut out = String::new();
    let stroke_color = props
        .color
        .as_ref()
        .map_or_else(|| "#000000".to_string(), color_hex);
    let stroke_width = (font_size_px * 0.05).max(1.0);
    let opacity_attr = props
        .color
        .as_ref()
        .filter(|c| c.alpha < 1.0)
        .map(|c| format!(" stroke-opacity=\"{}\"", alpha_str(c.alpha)))
        .unwrap_or_default();

    if props.underline {
        let underline_y = y + font_size_px * 0.15;
        let _ = write!(
            out,
            "<line x1=\"{x:.2}\" y1=\"{underline_y:.2}\" x2=\"{:.2}\" y2=\"{underline_y:.2}\" stroke=\"{stroke_color}\" stroke-width=\"{stroke_width:.2}\"{opacity_attr}/>",
            x + segment_width
        );
    }
    if props.strikethrough {
        let strike_y = y - font_size_px * 0.3;
        let _ = write!(
            out,
            "<line x1=\"{x:.2}\" y1=\"{strike_y:.2}\" x2=\"{:.2}\" y2=\"{strike_y:.2}\" stroke=\"{stroke_color}\" stroke-width=\"{stroke_width:.2}\"{opacity_attr}/>",
            x + segment_width
        );
    }
    out
}

/// Compute the line-start X position based on alignment, mirroring TS's
/// `computePathLineX`. Path-mode does not rely on `text-anchor`, so the
/// line's left edge is positioned explicitly per alignment.
#[must_use]
pub fn compute_path_line_x(
    alignment: Option<ParagraphAlignment>,
    text_start_x: f64,
    effective_text_width: f64,
    width: f64,
    margin_right_px: f64,
    line_width: f64,
) -> f64 {
    match alignment {
        Some(ParagraphAlignment::Ctr) => text_start_x + (effective_text_width - line_width) / 2.0,
        Some(ParagraphAlignment::R) => width - margin_right_px - line_width,
        _ => text_start_x,
    }
}

/// Per-segment shared inputs threaded into [`emit_segment`] and
/// [`emit_cjk_upright`]. Bundling avoids passing 8+ parameters and lets
/// the closures-turned-functions share a stable signature.
struct SegmentEmitCtx<'a> {
    props: &'a RunProperties,
    x: f64,
    effective_y: f64,
    font_size: f64,
    font_size_px: f64,
    font_resolver: &'a dyn FontResolver,
    measurer: &'a dyn TextMeasurer,
    jpan_fallback: Option<&'a str>,
}

fn emit_segment(
    ctx: &SegmentEmitCtx,
    seg_text: &str,
    font_family: Option<&str>,
    font_family_ea: Option<&str>,
    out: &mut String,
    total_width: &mut f64,
) {
    if seg_text.is_empty() {
        return;
    }
    let (font, italic_applied) = resolve_face(
        ctx.font_resolver,
        ctx.props,
        font_family,
        font_family_ea,
        ctx.jpan_fallback,
    );
    // Width measurement always uses the run's *original* family pair so
    // script-split swaps don't change advance widths.
    let seg_style = slideglance_font::FontStyle {
        bold: ctx.props.bold,
        italic: ctx.props.italic,
    };
    let seg_width = ctx.measurer.measure_text_width(
        seg_text,
        ctx.font_size,
        seg_style,
        ctx.props.font_family.as_deref(),
        ctx.props.font_family_ea.as_deref(),
    );
    let need_skew = ctx.props.italic && !italic_applied;

    if let Some(highlight) = &ctx.props.highlight {
        let bg_y = ctx.effective_y - ctx.font_size_px * 0.85;
        let bg_h = ctx.font_size_px * 1.1;
        let alpha_attr = if highlight.alpha < 1.0 {
            format!(" fill-opacity=\"{:.3}\"", highlight.alpha)
        } else {
            String::new()
        };
        let _ = write!(
            out,
            "<rect x=\"{:.2}\" y=\"{:.2}\" width=\"{:.2}\" height=\"{:.2}\" fill=\"{}\"{alpha_attr}/>",
            ctx.x + *total_width,
            bg_y,
            seg_width,
            bg_h,
            color_hex(highlight)
        );
    }

    if let Some(face) = font.as_ref() {
        // Apply kern-table adjustments when RunProperties.kern is set and
        // the current font size meets the threshold (OOXML kern attribute is
        // in hundredths of a point; threshold/100 gives the minimum pt size).
        let apply_kern = ctx
            .props
            .kern
            .is_some_and(|t| ctx.font_size >= t.to_points().raw());
        let path_data = text_to_svg_path_kerned(
            face,
            seg_text,
            ctx.x + *total_width,
            ctx.effective_y,
            ctx.font_size,
            DECIMAL_PLACES,
            apply_kern,
        );
        if !path_data.is_empty() {
            let synth_bold = should_synthesize_bold(ctx.props, font.as_deref());
            let fill_attrs = build_path_attrs(ctx.props, ctx.font_size_px, synth_bold);
            if need_skew {
                // Synthesize italic via 12° skew when the font lacks an
                // italic face. The translate compensates for the y-axis
                // shift skewX(-12) introduces at the glyph baseline.
                let dx = 0.2126 * ctx.effective_y;
                let _ = write!(
                    out,
                    "<path d=\"{path_data}\" {fill_attrs} transform=\"translate({dx:.2} 0) skewX(-12)\"/>"
                );
            } else {
                let _ = write!(out, "<path d=\"{path_data}\" {fill_attrs}/>");
            }
        }
    }

    if ctx.props.underline || ctx.props.strikethrough {
        out.push_str(&render_text_decorations(
            ctx.x + *total_width,
            ctx.effective_y,
            seg_width,
            ctx.font_size_px,
            ctx.props,
        ));
    }
    *total_width += seg_width;
}

fn emit_cjk_upright(
    ctx: &SegmentEmitCtx,
    seg_text: &str,
    font_family: Option<&str>,
    font_family_ea: Option<&str>,
    out: &mut String,
    total_width: &mut f64,
) {
    if seg_text.is_empty() {
        return;
    }
    let bold_family = if ctx.props.bold {
        font_family.map(|f| format!("{f} Bold"))
    } else {
        None
    };
    let bold_family_ea = if ctx.props.bold {
        font_family_ea.map(|f| format!("{f} Bold"))
    } else {
        None
    };
    let font: Option<Arc<FontFace>> = bold_family
        .as_deref()
        .and_then(|n| ctx.font_resolver.resolve(n))
        .or_else(|| {
            bold_family_ea
                .as_deref()
                .and_then(|n| ctx.font_resolver.resolve(n))
        })
        .or_else(|| {
            resolve_face(
                ctx.font_resolver,
                ctx.props,
                font_family,
                font_family_ea,
                ctx.jpan_fallback,
            )
            .0
        });
    let synth_bold = should_synthesize_bold(ctx.props, font.as_deref());
    let fill_attrs = build_path_attrs(ctx.props, ctx.font_size_px, synth_bold);

    let vertical_style = slideglance_font::FontStyle {
        bold: ctx.props.bold,
        italic: ctx.props.italic,
    };
    for ch in seg_text.chars() {
        let mut buf = [0_u8; 4];
        let ch_str: &str = ch.encode_utf8(&mut buf);
        let char_width = ctx.measurer.measure_text_width(
            ch_str,
            ctx.font_size,
            vertical_style,
            ctx.props.font_family.as_deref(),
            ctx.props.font_family_ea.as_deref(),
        );
        if let Some(highlight) = &ctx.props.highlight {
            let bg_y = ctx.effective_y - ctx.font_size_px * 0.85;
            let bg_h = ctx.font_size_px * 1.1;
            let alpha_attr = if highlight.alpha < 1.0 {
                format!(" fill-opacity=\"{:.3}\"", highlight.alpha)
            } else {
                String::new()
            };
            let _ = write!(
                out,
                "<rect x=\"{:.2}\" y=\"{:.2}\" width=\"{:.2}\" height=\"{:.2}\" fill=\"{}\"{alpha_attr}/>",
                ctx.x + *total_width,
                bg_y,
                char_width,
                bg_h,
                color_hex(highlight)
            );
        }
        if let Some(face) = font.as_ref() {
            let char_x = ctx.x + *total_width;
            let path_data = text_to_svg_path_with_precision(
                face,
                ch_str,
                char_x,
                ctx.effective_y,
                ctx.font_size,
                DECIMAL_PLACES,
            );
            if !path_data.is_empty() {
                let cx = char_x + char_width / 2.0;
                let cy = ctx.effective_y
                    - (ctx.font_size_px
                        * (f64::from(face.ascender()) + f64::from(face.descender())))
                        / 2.0
                        / f64::from(face.units_per_em());
                let _ = write!(
                    out,
                    "<g transform=\"rotate(-90, {cx:.2}, {cy:.2})\"><path d=\"{path_data}\" {fill_attrs}/></g>"
                );
            }
        }
        if ctx.props.underline || ctx.props.strikethrough {
            out.push_str(&render_text_decorations(
                ctx.x + *total_width,
                ctx.effective_y,
                char_width,
                ctx.font_size_px,
                ctx.props,
            ));
        }
        *total_width += char_width;
    }
}

/// Sum of segment widths across one wrapped or non-wrapped line.
fn measure_line_width<'a, I>(
    segments: I,
    default_font_size: f64,
    font_scale: f64,
    measurer: &dyn TextMeasurer,
) -> f64
where
    I: IntoIterator<Item = (&'a str, &'a RunProperties)>,
{
    let mut total = 0.0;
    for (text, props) in segments {
        let font_size = props
            .font_size
            .map_or(default_font_size, slideglance_utils::Pt::raw)
            * font_scale;
        let style = slideglance_font::FontStyle {
            bold: props.bold,
            italic: props.italic,
        };
        let raw = measurer.measure_text_width(
            text,
            font_size,
            style,
            props.font_family.as_deref(),
            props.font_family_ea.as_deref(),
        );
        let font_size_px = font_size * PX_PER_PT;
        total += raw + letter_spacing_trick_extra(text, font_size_px);
    }
    total
}

/// Empirical extra advance `PowerPoint` adds per ASCII space when the run
/// matches the "Korean letter-spacing trick" pattern — every CJK glyph
/// separated by one ASCII space (e.g. `"평 가 항 목  조 견 표"` — slide
/// 2 title). The deck-side intent is wide character spacing; without
/// this boost we render the spaces at the font's nominal advance
/// (~0.19 em for Freesentation 7 Bold) which is much narrower than
/// `PowerPoint`'s ~0.4 em rendering. We only apply when the *entire run*
/// is the pattern so plain CJK body text isn't widened.
const LETTER_SPACING_TRICK_PAD_EM: f64 = 0.20;

fn letter_spacing_trick_extra(text: &str, font_size_px: f64) -> f64 {
    if !is_letter_spacing_trick(text) {
        return 0.0;
    }
    let n_spaces = text.chars().filter(|c| *c == ' ').count();
    n_spaces as f64 * font_size_px * LETTER_SPACING_TRICK_PAD_EM
}

/// Detect the `EA (whitespace+ EA)+` pattern. Requires ≥3 EA glyphs and
/// no non-EA, non-space characters. Latin words and bullet runs miss.
fn is_letter_spacing_trick(text: &str) -> bool {
    use crate::text::script::is_cjk_codepoint;
    let chars: Vec<char> = text.chars().collect();
    if chars.len() < 5 {
        return false;
    }
    let mut i = 0;
    if !is_cjk_codepoint(chars[i] as u32) {
        return false;
    }
    let mut ea_count = 1;
    i += 1;
    while i < chars.len() {
        if chars[i] != ' ' {
            return false;
        }
        while i < chars.len() && chars[i] == ' ' {
            i += 1;
        }
        if i >= chars.len() {
            // Trailing whitespace — allow but pattern must already satisfy ≥3 EA.
            break;
        }
        if !is_cjk_codepoint(chars[i] as u32) {
            return false;
        }
        ea_count += 1;
        i += 1;
    }
    ea_count >= 3
}

fn needs_script_split(props: &RunProperties) -> bool {
    matches!(
        (&props.font_family, &props.font_family_ea),
        (Some(latin), Some(ea)) if latin != ea
    )
}

fn resolve_face(
    resolver: &dyn FontResolver,
    props: &RunProperties,
    font_family: Option<&str>,
    font_family_ea: Option<&str>,
    jpan_fallback: Option<&str>,
) -> (Option<Arc<FontFace>>, bool) {
    if props.italic {
        let suffixes: &[&str] = if props.bold {
            &[" Bold Italic", " BoldItalic", " Italic Bold"]
        } else {
            &[" Italic"]
        };
        for sfx in suffixes {
            let try_face = |base: Option<&str>| -> Option<Arc<FontFace>> {
                let name = format!("{}{}", base?, sfx);
                resolver.resolve(&name)
            };
            if let Some(face) = try_face(font_family).or_else(|| try_face(font_family_ea)) {
                return (Some(face), true);
            }
        }
    }
    if props.bold {
        let try_bold = |base: Option<&str>| -> Option<Arc<FontFace>> {
            let name = format!("{} Bold", base?);
            resolver.resolve(&name)
        };
        if let Some(face) = try_bold(font_family).or_else(|| try_bold(font_family_ea)) {
            return (Some(face), false);
        }
    }
    let face = font_family
        .and_then(|n| resolver.resolve(n))
        .or_else(|| font_family_ea.and_then(|n| resolver.resolve(n)))
        .or_else(|| jpan_fallback.and_then(|n| resolver.resolve(n)));
    (face, false)
}

#[derive(Debug, Clone, Copy)]
struct Dimensions {
    width: f64,
    height: f64,
    margin_left: f64,
    margin_right: f64,
    margin_top: f64,
    margin_bottom: f64,
}

fn resolve_text_dimensions(bp: &BodyProperties, w: f64, h: f64) -> Dimensions {
    let to_px = Emu::to_pixels;
    if is_vertical(bp.vert) {
        return Dimensions {
            width: h,
            height: w,
            margin_left: to_px(bp.margin_top),
            margin_right: to_px(bp.margin_bottom),
            margin_top: to_px(bp.margin_right),
            margin_bottom: to_px(bp.margin_left),
        };
    }
    if matches!(bp.vert, TextVerticalType::Vert270) {
        return Dimensions {
            width: h,
            height: w,
            margin_left: to_px(bp.margin_bottom),
            margin_right: to_px(bp.margin_top),
            margin_top: to_px(bp.margin_left),
            margin_bottom: to_px(bp.margin_right),
        };
    }
    Dimensions {
        width: w,
        height: h,
        margin_left: to_px(bp.margin_left),
        margin_right: to_px(bp.margin_right),
        margin_top: to_px(bp.margin_top),
        margin_bottom: to_px(bp.margin_bottom),
    }
}

fn is_vertical(vert: TextVerticalType) -> bool {
    matches!(
        vert,
        TextVerticalType::Vert
            | TextVerticalType::EaVert
            | TextVerticalType::WordArtVert
            | TextVerticalType::MongolianVert
    )
}

fn substitute_field_runs(body: &TextBody, slide: &SlideRenderContext) -> TextBody {
    let needs_clone = body
        .paragraphs
        .iter()
        .any(|p| p.runs.iter().any(|r| r.field_type.is_some()));
    if !needs_clone {
        return body.clone();
    }
    TextBody {
        default_text_color: None,
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

fn resolve_bullet_text(
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
            Some(format_auto_num(*scheme, start_at + next_val - 1))
        }
    }
}

fn estimate_total_height(
    body: &TextBody,
    default_font_size: f64,
    should_wrap: bool,
    text_width: f64,
    ln_spc_reduction: f64,
    font_scale: f64,
    measurer: &dyn TextMeasurer,
) -> f64 {
    let default_ratio = get_default_line_height_ratio(body, measurer);
    let scaled_default_for_wrap = default_font_size * font_scale;
    let mut total = 0.0_f64;
    let mut prev_space_after_px = 0.0_f64;
    for (idx, para) in body.paragraphs.iter().enumerate() {
        let line_spacing = get_line_spacing(para, ln_spc_reduction);
        let is_empty = !para.runs.iter().any(|r| !r.text.is_empty());
        let natural_height_pt = if is_empty {
            para.end_para_run_properties
                .as_ref()
                .and_then(|p| p.font_size.map(|s| s.raw() * font_scale * default_ratio))
                .unwrap_or_else(|| {
                    compute_line_natural_height(&para.runs, default_font_size, font_scale, measurer)
                })
        } else {
            compute_line_natural_height(&para.runs, default_font_size, font_scale, measurer)
        };
        let safe_height_pt = if natural_height_pt > 0.0 {
            natural_height_pt
        } else {
            default_font_size * font_scale * default_ratio
        };
        let line_height = safe_height_pt * PX_PER_PT * line_spacing;

        let line_count =
            if should_wrap && !para.runs.is_empty() && para.runs.iter().any(|r| !r.text.is_empty())
            {
                let lines = wrap_paragraph(
                    para,
                    text_width,
                    scaled_default_for_wrap,
                    font_scale,
                    measurer,
                );
                lines.len()
            } else {
                1
            };
        total += f64::from(u32::try_from(line_count).unwrap_or(1)) * line_height;

        if idx > 0 {
            let para_font_size_pt = get_paragraph_font_size(para, default_font_size) * font_scale;
            let space_before_px =
                resolve_spacing_px_opt(para.properties.space_before, para_font_size_pt);
            total += prev_space_after_px.max(space_before_px);
        }
        let para_font_size_after_pt = get_paragraph_font_size(para, default_font_size) * font_scale;
        prev_space_after_px =
            resolve_spacing_px_opt(para.properties.space_after, para_font_size_after_pt);
    }
    total
}

#[cfg(test)]
#[allow(clippy::field_reassign_with_default)]
mod tests {
    use super::*;
    use slideglance_color::{ResolvedColor, Rgb};
    use slideglance_font::{
        standard_resolver_chain, BufferFontResolver, CjkPlatform, FontMapping,
        HeuristicTextMeasurer, ScriptFontContext,
    };
    use slideglance_model::{
        BodyProperties, Paragraph, ParagraphAlignment, ParagraphProperties, TextOutline, TextRun,
        VerticalAnchor, WrapMode,
    };
    use slideglance_utils::Pt;

    /// Empty resolver — every `resolve()` returns `None`.
    fn empty_resolver() -> impl FontResolver + 'static {
        BufferFontResolver::new()
    }

    fn empty_body() -> TextBody {
        TextBody {
            default_text_color: None,
            paragraphs: vec![],
            body_properties: BodyProperties {
                anchor: VerticalAnchor::T,
                margin_left: Emu::new(0),
                margin_right: Emu::new(0),
                margin_top: Emu::new(0),
                margin_bottom: Emu::new(0),
                wrap: WrapMode::Square,
                auto_fit: slideglance_model::AutoFit::NoAutofit,
                font_scale: 1.0,
                ln_spc_reduction: 0.0,
                num_col: 1,
                vert: TextVerticalType::Horz,
                spc_first_last_para: false,
                compat_ln_spc: false,
                prst_tx_warp: None,
            },
        }
    }

    fn run(text: &str) -> TextRun {
        TextRun {
            text: text.to_string(),
            properties: RunProperties::default(),
            field_type: None,
        }
    }

    fn paragraph(props: ParagraphProperties, runs: Vec<TextRun>) -> Paragraph {
        Paragraph {
            runs,
            properties: props,
            end_para_run_properties: None,
        }
    }

    fn xfrm(w: i64, h: i64) -> Transform {
        Transform {
            offset_x: Emu::new(0),
            offset_y: Emu::new(0),
            extent_width: Emu::new(w),
            extent_height: Emu::new(h),
            rotation: 0.0,
            flip_h: false,
            flip_v: false,
        }
    }

    #[test]
    fn empty_body_returns_empty_string() {
        let resolver = empty_resolver();
        let out = render_text_body_as_path(
            &empty_body(),
            &xfrm(914_400, 914_400),
            &SlideRenderContext::new(1),
            &ScriptFontContext::empty(),
            &HeuristicTextMeasurer,
            &resolver,
            &FontMapping::new(),
            CjkPlatform::Other,
            false,
            1.0,
        );
        assert!(out.is_empty());
    }

    #[test]
    fn no_resolved_font_yields_decorations_only() {
        // Without a resolved face the path data is empty, but underline /
        // strikethrough lines (which don't need a face) still render.
        let resolver = empty_resolver();
        let mut body = empty_body();
        let mut props = RunProperties::default();
        props.underline = true;
        props.color = Some(ResolvedColor::new(Rgb::new(0xFF, 0, 0), 1.0));
        let mut r = run("Hi");
        r.properties = props;
        body.paragraphs = vec![paragraph(ParagraphProperties::default(), vec![r])];

        let out = render_text_body_as_path(
            &body,
            &xfrm(9_144_000, 5_143_500),
            &SlideRenderContext::new(1),
            &ScriptFontContext::empty(),
            &HeuristicTextMeasurer,
            &resolver,
            &FontMapping::new(),
            CjkPlatform::Other,
            false,
            1.0,
        );
        assert!(out.contains("<line"));
        assert!(out.contains("stroke=\"#FF0000\""));
        assert!(!out.contains("<path"));
    }

    #[test]
    fn highlight_emits_rect_before_text() {
        let resolver = empty_resolver();
        let mut props = RunProperties::default();
        props.highlight = Some(ResolvedColor::new(Rgb::new(0xFF, 0xFF, 0), 1.0));
        let mut r = run("Highlighted");
        r.properties = props;
        let mut body = empty_body();
        body.paragraphs = vec![paragraph(ParagraphProperties::default(), vec![r])];
        let out = render_text_body_as_path(
            &body,
            &xfrm(9_144_000, 5_143_500),
            &SlideRenderContext::new(1),
            &ScriptFontContext::empty(),
            &HeuristicTextMeasurer,
            &resolver,
            &FontMapping::new(),
            CjkPlatform::Other,
            false,
            1.0,
        );
        assert!(out.contains("<rect"));
        assert!(out.contains("fill=\"#FFFF00\""));
    }

    #[test]
    fn vertical_text_wraps_in_rotated_group_when_content_exists() {
        let resolver = empty_resolver();
        let mut body = empty_body();
        body.body_properties.vert = TextVerticalType::Vert;
        let mut props = RunProperties::default();
        props.underline = true; // ensure non-empty output even without resolved face
        props.font_size = Some(Pt::new(12.0));
        let mut r = run("Hi");
        r.properties = props;
        body.paragraphs = vec![paragraph(ParagraphProperties::default(), vec![r])];
        let out = render_text_body_as_path(
            &body,
            &xfrm(914_400, 1_828_800),
            &SlideRenderContext::new(1),
            &ScriptFontContext::empty(),
            &HeuristicTextMeasurer,
            &resolver,
            &FontMapping::new(),
            CjkPlatform::Other,
            false,
            1.0,
        );
        assert!(out.starts_with("<g transform="));
        assert!(out.contains("rotate(90)"));
    }

    // --- helpers ---

    #[test]
    fn build_path_fill_attrs_defaults_to_black() {
        let s = build_path_fill_attrs(&RunProperties::default());
        assert_eq!(s, "fill=\"#000000\"");
    }

    #[test]
    fn build_path_fill_attrs_emits_alpha_when_translucent() {
        let mut p = RunProperties::default();
        p.color = Some(ResolvedColor::new(Rgb::new(0, 0, 0xFF), 0.25));
        let s = build_path_fill_attrs(&p);
        assert!(s.contains("fill=\"#0000FF\""));
        assert!(s.contains("fill-opacity=\"0.25\""));
    }

    #[test]
    fn render_text_decorations_underline_and_strikethrough() {
        let mut p = RunProperties::default();
        p.underline = true;
        p.strikethrough = true;
        p.color = Some(ResolvedColor::new(Rgb::new(0, 0, 0), 1.0));
        let s = render_text_decorations(0.0, 100.0, 50.0, 16.0, &p);
        assert_eq!(s.matches("<line").count(), 2);
        assert!(s.contains("stroke=\"#000000\""));
    }

    #[test]
    fn render_text_decorations_uses_default_color_when_none() {
        let mut p = RunProperties::default();
        p.underline = true;
        let s = render_text_decorations(0.0, 100.0, 50.0, 16.0, &p);
        assert!(s.contains("stroke=\"#000000\""));
    }

    #[test]
    fn compute_path_line_x_left_default() {
        assert_eq!(
            compute_path_line_x(None, 10.0, 100.0, 200.0, 5.0, 30.0),
            10.0
        );
    }

    #[test]
    fn compute_path_line_x_center() {
        assert_eq!(
            compute_path_line_x(Some(ParagraphAlignment::Ctr), 10.0, 100.0, 200.0, 5.0, 30.0),
            10.0 + (100.0 - 30.0) / 2.0
        );
    }

    #[test]
    fn compute_path_line_x_right() {
        assert_eq!(
            compute_path_line_x(Some(ParagraphAlignment::R), 10.0, 100.0, 200.0, 5.0, 30.0),
            200.0 - 5.0 - 30.0
        );
    }

    #[test]
    fn render_bullet_returns_empty_when_font_unavailable() {
        let resolver = empty_resolver();
        let s = render_bullet_as_path(
            "•",
            10.0,
            20.0,
            &ParagraphProperties::default(),
            18.0,
            &resolver,
            &FontMapping::new(),
            CjkPlatform::Other,
            None,
            None,
        );
        assert!(s.is_empty());
    }

    #[test]
    fn render_segment_emits_outline_when_no_face() {
        // No resolved face -> width still measured, decorations still
        // emitted, but no <path>.
        let resolver = empty_resolver();
        let mut props = RunProperties::default();
        props.font_size = Some(Pt::new(12.0));
        props.outline = Some(TextOutline {
            width: Emu::new(9_525),
            color: ResolvedColor::new(Rgb::new(0, 0, 0), 1.0),
        });
        let result = render_segment_as_path(
            "Hi",
            &props,
            0.0,
            0.0,
            1.0,
            18.0,
            &resolver,
            &ScriptFontContext::empty(),
            &HeuristicTextMeasurer,
            &FontMapping::new(),
            CjkPlatform::Other,
            TextVerticalType::Horz,
        );
        // Width still measured by HeuristicTextMeasurer.
        assert!(result.width > 0.0);
        // Outline / italic skew etc. don't render paths without a face.
        assert!(!result.svg.contains("<path"));
    }

    #[test]
    fn standard_resolver_chain_compiles_with_helper() {
        // Compile-time smoke test that the public chain factory wires
        // through (replaces the old direct `MappedFontResolver::new`
        // construction now that the resolver is `pub(crate)`).
        let buffer = BufferFontResolver::new();
        let chained = standard_resolver_chain(buffer, FontMapping::new(), CjkPlatform::Linux);
        let _ = chained.resolve("does-not-exist");
    }

    // -- T10 (IP-1): kern gate integration tests ------------------------------

    fn load_dejavu_resolver() -> impl FontResolver + 'static {
        use slideglance_font::FontFace;
        let bytes = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../testing/fixtures/fonts/DejaVuSans.ttf"
        ))
        .expect("DejaVuSans.ttf");
        let face = FontFace::from_bytes(bytes, 0).expect("parse DejaVuSans.ttf");
        let mut resolver = BufferFontResolver::new();
        resolver.insert("DejaVu Sans", face);
        resolver
    }

    #[test]
    #[ignore = "needs testing/fixtures/* — drop fixtures into testing/fixtures/ to enable"]
    fn kern_gate_above_threshold_suppresses_kern() {
        // kern threshold = 1500 hundredths-pt = 15pt.
        // font_size = 12pt < 15pt → kern must NOT be applied.
        // Without kern, AV path must equal the reference (no-kern) path.
        let resolver = load_dejavu_resolver();
        let mut props = RunProperties::default();
        props.font_family = Some("DejaVu Sans".to_string());
        props.font_size = Some(Pt::new(12.0));
        props.kern = Some(slideglance_utils::HundredthPt::new(1500)); // threshold 15pt

        let result_small = render_segment_as_path(
            "AV",
            &props,
            0.0,
            20.0,
            1.0,
            12.0,
            &resolver,
            &ScriptFontContext::empty(),
            &HeuristicTextMeasurer,
            &FontMapping::new(),
            CjkPlatform::Other,
            TextVerticalType::Horz,
        );

        // With kern disabled (font_size < threshold) there should be paths.
        // We verify this produces the same result as kern=None (gate open but
        // threshold not met produces no-kern output).
        let mut props_no_kern = props.clone();
        props_no_kern.kern = None;
        let result_no_kern = render_segment_as_path(
            "AV",
            &props_no_kern,
            0.0,
            20.0,
            1.0,
            12.0,
            &resolver,
            &ScriptFontContext::empty(),
            &HeuristicTextMeasurer,
            &FontMapping::new(),
            CjkPlatform::Other,
            TextVerticalType::Horz,
        );
        assert_eq!(
            result_small.svg, result_no_kern.svg,
            "below-threshold kern should produce same SVG as no-kern"
        );
    }

    #[test]
    #[ignore = "needs testing/fixtures/* — drop fixtures into testing/fixtures/ to enable"]
    fn kern_gate_at_threshold_applies_kern() {
        // kern threshold = 1200 hundredths-pt = 12pt.
        // font_size = 18pt > 12pt → kern MUST be applied.
        // With kern applied, A-V should have a leftward shift, so the
        // SVG path data differs from the no-kern variant.
        let resolver = load_dejavu_resolver();
        let mut props_kern = RunProperties::default();
        props_kern.font_family = Some("DejaVu Sans".to_string());
        props_kern.font_size = Some(Pt::new(18.0));
        props_kern.kern = Some(slideglance_utils::HundredthPt::new(1200)); // threshold 12pt

        let mut props_no_kern = props_kern.clone();
        props_no_kern.kern = None;

        let result_kern = render_segment_as_path(
            "AV",
            &props_kern,
            0.0,
            20.0,
            1.0,
            18.0,
            &resolver,
            &ScriptFontContext::empty(),
            &HeuristicTextMeasurer,
            &FontMapping::new(),
            CjkPlatform::Other,
            TextVerticalType::Horz,
        );
        let result_no_kern = render_segment_as_path(
            "AV",
            &props_no_kern,
            0.0,
            20.0,
            1.0,
            18.0,
            &resolver,
            &ScriptFontContext::empty(),
            &HeuristicTextMeasurer,
            &FontMapping::new(),
            CjkPlatform::Other,
            TextVerticalType::Horz,
        );
        assert_ne!(
            result_kern.svg, result_no_kern.svg,
            "above-threshold kern must shift A-V glyph (DejaVuSans kern table)"
        );
    }
}
