//! `<p:txBody>` / `<a:txBody>` parser — paragraphs, runs, and
//! body-frame properties.
//!
//! Mirrors and the
//! surrounding `parseParagraph` / `parseRunProperties` helpers (~500 lines
//! of TS), now extracted into its own Rust module so table-parser /
//! chart-parser / slide-master / slide-layout can pull text bodies without
//! pulling in the full slide-parser.

use std::collections::BTreeMap;

use serde::Deserialize;
use slideglance_color::ColorResolver;
use slideglance_model::{
    AutoFit, BodyProperties, DefaultRunProperties, DefaultTextStyle, FontScheme, Hyperlink,
    Paragraph, ParagraphAlignment, ParagraphProperties, RunProperties, SpacingValue, TabStop,
    TabStopAlignment, TextBody, TextOutline, TextRun, TextVerticalType, VerticalAnchor, WrapMode,
};
use slideglance_utils::{Emu, HundredthPt};

use crate::raw_color::RawColorChoice;
use crate::relationships::Relationship;
use crate::text_style::{
    build_default_run_properties, build_paragraph_level_properties, RawDefRPr, RawListStyle,
    RawParagraphLevel,
};
use crate::xml::{parse_xml, XmlError};

/// Parses a `<p:txBody>` (or any equivalent text-body block) into a
/// [`TextBody`] model.
///
/// Returns `Ok(None)` when the input has no paragraph content.
///
/// # Errors
///
/// Returns [`XmlError`] when the XML is malformed.
pub fn parse_text_body(
    xml: &str,
    resolver: &ColorResolver,
    rels: Option<&BTreeMap<String, Relationship>>,
    font_scheme: Option<&FontScheme>,
    lst_style_override: Option<&DefaultTextStyle>,
) -> Result<Option<TextBody>, XmlError> {
    let raw: RawTextBody = parse_xml(xml)?;
    Ok(build_text_body(
        &raw,
        resolver,
        rels,
        font_scheme,
        lst_style_override,
        None,
    ))
}

pub(crate) fn build_text_body(
    raw: &RawTextBody,
    resolver: &ColorResolver,
    rels: Option<&BTreeMap<String, Relationship>>,
    font_scheme: Option<&FontScheme>,
    lst_style_override: Option<&DefaultTextStyle>,
    default_text_color: Option<slideglance_color::ResolvedColor>,
) -> Option<TextBody> {
    let body_properties = build_body_properties(raw.body_pr.as_ref());
    let lst_style_owned = raw
        .lst_style
        .as_ref()
        .and_then(|n| crate::text_style::build_list_style(n, Some(resolver)));
    let lst_style = lst_style_override.or(lst_style_owned.as_ref());

    let paragraphs: Vec<Paragraph> = raw
        .p
        .iter()
        .map(|p| build_paragraph(p, resolver, rels, font_scheme, lst_style))
        .collect();

    if paragraphs.is_empty() {
        return None;
    }
    Some(TextBody {
        paragraphs,
        body_properties,
        default_text_color,
    })
}

/// Public shim so `slide_master.rs` can populate `PlaceholderStyleInfo
/// .body_properties` for the layout/master inheritance chain. Same body
/// as the private [`build_body_properties`].
#[allow(dead_code)]
pub(crate) fn build_body_properties_pub(raw: Option<&RawBodyPr>) -> BodyProperties {
    build_body_properties(raw)
}

/// Build a sparse [`slideglance_model::PlaceholderBodyPr`] from a raw `<a:bodyPr>`
/// — only fields that the source XML carried explicitly are populated.
/// Returned `None` when no attribute appears at all (so the inheritance
/// walk can skip this layer entirely without producing fake "default"
/// overrides).
pub(crate) fn build_placeholder_body_pr(
    raw: Option<&RawBodyPr>,
) -> Option<slideglance_model::PlaceholderBodyPr> {
    let node = raw?;
    let pp = slideglance_model::PlaceholderBodyPr {
        anchor: node.anchor.as_deref().and_then(parse_anchor),
        margin_left: node
            .l_ins
            .as_deref()
            .and_then(|v| v.parse::<i64>().ok())
            .map(slideglance_utils::Emu::new),
        margin_right: node
            .r_ins
            .as_deref()
            .and_then(|v| v.parse::<i64>().ok())
            .map(slideglance_utils::Emu::new),
        margin_top: node
            .t_ins
            .as_deref()
            .and_then(|v| v.parse::<i64>().ok())
            .map(slideglance_utils::Emu::new),
        margin_bottom: node
            .b_ins
            .as_deref()
            .and_then(|v| v.parse::<i64>().ok())
            .map(slideglance_utils::Emu::new),
        wrap: node.wrap.as_deref().and_then(parse_wrap),
        vert: node.vert.as_deref().and_then(parse_vert),
        num_col: node.num_col.as_deref().and_then(|v| v.parse::<u32>().ok()),
        spc_first_last_para: node
            .spc_first_last_para
            .as_deref()
            .map(|s| matches!(s, "1" | "true")),
        compat_ln_spc: node
            .compat_ln_spc
            .as_deref()
            .map(|s| matches!(s, "1" | "true")),
        // `<a:normAutofit>` / `<a:spAutoFit>` children — populate
        // auto_fit only when one is authored. font_scale and
        // ln_spc_reduction default to 1.0 / 0.0 when normAutofit
        // exists without those attributes (per OOXML spec).
        auto_fit: if let Some(norm) = node.norm_autofit.as_ref() {
            let _ = norm;
            Some(slideglance_model::AutoFit::NormAutofit)
        } else if node.sp_auto_fit.is_some() {
            Some(slideglance_model::AutoFit::SpAutofit)
        } else {
            None
        },
        font_scale: node
            .norm_autofit
            .as_ref()
            .and_then(|n| n.font_scale.as_deref())
            .and_then(|v| v.parse::<f64>().ok())
            .map(|v| v / 100_000.0),
        ln_spc_reduction: node
            .norm_autofit
            .as_ref()
            .and_then(|n| n.ln_spc_reduction.as_deref())
            .and_then(|v| v.parse::<f64>().ok())
            .map(|v| v / 100_000.0),
    };
    let any_set = pp.anchor.is_some()
        || pp.margin_left.is_some()
        || pp.margin_right.is_some()
        || pp.margin_top.is_some()
        || pp.margin_bottom.is_some()
        || pp.wrap.is_some()
        || pp.vert.is_some()
        || pp.num_col.is_some()
        || pp.spc_first_last_para.is_some()
        || pp.compat_ln_spc.is_some()
        || pp.auto_fit.is_some()
        || pp.font_scale.is_some()
        || pp.ln_spc_reduction.is_some();
    if any_set {
        Some(pp)
    } else {
        None
    }
}

fn build_body_properties(raw: Option<&RawBodyPr>) -> BodyProperties {
    let Some(node) = raw else {
        return default_body_properties();
    };
    let anchor = node
        .anchor
        .as_deref()
        .and_then(parse_anchor)
        .unwrap_or(VerticalAnchor::T);
    let wrap = node
        .wrap
        .as_deref()
        .and_then(parse_wrap)
        .unwrap_or(WrapMode::Square);
    let vert = node
        .vert
        .as_deref()
        .and_then(parse_vert)
        .unwrap_or(TextVerticalType::Horz);
    let num_col = node
        .num_col
        .as_deref()
        .and_then(|v| v.parse::<u32>().ok())
        .unwrap_or(1)
        .max(1);

    let (auto_fit, font_scale, ln_spc_reduction) = if let Some(norm) = node.norm_autofit.as_ref() {
        let fs = norm
            .font_scale
            .as_deref()
            .and_then(|v| v.parse::<f64>().ok())
            .map_or(1.0, |v| v / 100_000.0);
        let lr = norm
            .ln_spc_reduction
            .as_deref()
            .and_then(|v| v.parse::<f64>().ok())
            .map_or(0.0, |v| v / 100_000.0);
        (AutoFit::NormAutofit, fs, lr)
    } else if node.sp_auto_fit.is_some() {
        (AutoFit::SpAutofit, 1.0, 0.0)
    } else {
        (AutoFit::NoAutofit, 1.0, 0.0)
    };

    let prst_tx_warp = node
        .prst_tx_warp
        .as_ref()
        .and_then(|n| n.prst.clone())
        .filter(|p| !p.is_empty() && p != "textNoShape");

    let spc_first_last_para = node
        .spc_first_last_para
        .as_deref()
        .is_some_and(|s| matches!(s, "1" | "true"));
    let compat_ln_spc = node
        .compat_ln_spc
        .as_deref()
        .is_some_and(|s| matches!(s, "1" | "true"));

    BodyProperties {
        anchor,
        margin_left: Emu::new(parse_attr_i64(node.l_ins.as_deref(), 91_440)),
        margin_right: Emu::new(parse_attr_i64(node.r_ins.as_deref(), 91_440)),
        margin_top: Emu::new(parse_attr_i64(node.t_ins.as_deref(), 45_720)),
        margin_bottom: Emu::new(parse_attr_i64(node.b_ins.as_deref(), 45_720)),
        wrap,
        auto_fit,
        font_scale,
        ln_spc_reduction,
        num_col,
        vert,
        spc_first_last_para,
        compat_ln_spc,
        prst_tx_warp,
    }
}

fn default_body_properties() -> BodyProperties {
    BodyProperties {
        anchor: VerticalAnchor::T,
        margin_left: Emu::new(91_440),
        margin_right: Emu::new(91_440),
        margin_top: Emu::new(45_720),
        margin_bottom: Emu::new(45_720),
        wrap: WrapMode::Square,
        auto_fit: AutoFit::NoAutofit,
        font_scale: 1.0,
        ln_spc_reduction: 0.0,
        num_col: 1,
        vert: TextVerticalType::Horz,
        spc_first_last_para: false,
        compat_ln_spc: false,
        prst_tx_warp: None,
    }
}

// Same rationale as `build_run_properties`: this is a long, attribute-by-
// attribute fold over `<a:pPr>` plus the source-order children, mirroring
// the spec. Splitting into smaller helpers would add noise without
// improving readability.
#[allow(clippy::too_many_lines)]
fn build_paragraph(
    raw: &RawParagraph,
    resolver: &ColorResolver,
    rels: Option<&BTreeMap<String, Relationship>>,
    font_scheme: Option<&FontScheme>,
    lst_style: Option<&DefaultTextStyle>,
) -> Paragraph {
    // The `pPr` and `endParaRPr` are folded out of the same `$value` stream
    // because quick-xml's serde de cannot mix a Vec<$value enum> with sibling
    // named fields. Take the first occurrence of each.
    let mut p_pr: Option<&RawParagraphLevel> = None;
    let mut end_para_r_pr: Option<&RawRunProperties> = None;
    for child in &raw.children {
        match child {
            ParagraphChild::PPr(node) if p_pr.is_none() => p_pr = Some(node),
            ParagraphChild::EndParaRPr(node) if end_para_r_pr.is_none() => {
                end_para_r_pr = Some(node);
            }
            _ => {}
        }
    }

    // The OOXML `@lvl` lives on the `<a:p>` itself, not inside `<a:pPr>`.
    let level = raw.level.unwrap_or(0);

    let lst_level_props = lst_style
        .and_then(|s| s.levels.get(usize::from(level)))
        .and_then(|opt| opt.as_ref());

    // Bullet: explicit pPr overrides everything; otherwise fall back to the
    // matching list-style level. text_style::build_paragraph_level_properties
    // already handles the same fields, so we lift its result into the
    // paragraph's own properties.
    let p_pr_props = p_pr.and_then(|n| build_paragraph_level_properties(n, Some(resolver)));

    let alignment = p_pr_props
        .as_ref()
        .and_then(|p| p.alignment)
        .or_else(|| lst_level_props.and_then(|p| p.alignment));
    let bullet = p_pr_props
        .as_ref()
        .and_then(|p| p.bullet.clone())
        .or_else(|| lst_level_props.and_then(|p| p.bullet.clone()));
    let bullet_font = p_pr_props
        .as_ref()
        .and_then(|p| p.bullet_font.clone())
        .or_else(|| lst_level_props.and_then(|p| p.bullet_font.clone()));
    // Theme-resolve `+mj-lt` / `+mn-ea` placeholders. Without this the
    // renderer's `font_resolver.resolve("+mj-lt")` returns None and the
    // bullet text (auto-numbered list markers, custom glyphs) silently
    // disappears — observed on slide 4's TOC where every item lost its
    // numbering.
    let bullet_font = crate::text_style::resolve_theme_font(bullet_font.as_deref(), font_scheme);
    let bullet_color = p_pr_props
        .as_ref()
        .and_then(|p| p.bullet_color)
        .or_else(|| lst_level_props.and_then(|p| p.bullet_color));
    let bullet_size_pct = p_pr_props
        .as_ref()
        .and_then(|p| p.bullet_size_pct)
        .or_else(|| lst_level_props.and_then(|p| p.bullet_size_pct));
    let margin_left = p_pr_props
        .as_ref()
        .and_then(|p| p.margin_left)
        .or_else(|| lst_level_props.and_then(|p| p.margin_left));
    let indent = p_pr_props
        .as_ref()
        .and_then(|p| p.indent)
        .or_else(|| lst_level_props.and_then(|p| p.indent));

    // OOXML paragraph-level spacing falls back to the matching `lstStyle` /
    // `bodyStyle` level in the slide's effective text style chain when the
    // explicit `<a:pPr>` doesn't override. Without this fallback the
    // master's `spcBef` / `lnSpc` (~120 % spacing on title decks, 90 %
    // tight spacing for bulleted body lists) was silently dropped, causing
    // bulleted lists to pack 2-3× tighter than PowerPoint produces (most
    // visible on the slide-105 ToC). The bullet / margin / indent fields
    // already chained through `lst_level_props` above; spacing fields use
    // the same fallback.
    //
    // The line_spacing fallback in particular fixes slide-002 title
    // ("평 가 항 목  조 견 표"): the title's lstStyle/lvl1pPr declares
    // `<a:lnSpc spcPct="90000"/>` but the paragraph itself has no lnSpc.
    // Without inheritance, get_line_spacing() defaults to 1.0 → estimated
    // line height overflows the title cell → normAutofit shrinks the
    // text by ~4 % → final font ends up at 21.95pt instead of the 23.43pt
    // PowerPoint actually renders. With inheritance the line height fits
    // and no shrink fires.
    let line_spacing = p_pr
        .and_then(|n| n.ln_spc.as_ref())
        .and_then(|n| n.spc_pct.as_ref())
        .and_then(|n| n.val.as_deref())
        .and_then(|v| v.parse::<f64>().ok())
        .or_else(|| lst_level_props.and_then(|p| p.line_spacing));
    let space_before = parse_spacing_node_optional(p_pr.and_then(|n| n.spc_bef.as_ref()))
        .or_else(|| lst_level_props.and_then(|p| p.space_before));
    let space_after = parse_spacing_node_optional(p_pr.and_then(|n| n.spc_aft.as_ref()))
        .or_else(|| lst_level_props.and_then(|p| p.space_after));
    let tab_stops = parse_tab_stops_node(p_pr.and_then(|n| n.tab_lst.as_ref()));

    let properties = ParagraphProperties {
        alignment,
        line_spacing,
        space_before,
        space_after,
        level,
        bullet,
        bullet_font,
        bullet_color,
        bullet_size_pct,
        margin_left,
        indent,
        tab_stops,
    };

    // Merge defRPr from pPr (primary) and lstStyle level (secondary).
    let p_pr_def_r_pr = p_pr
        .and_then(|n| n.def_r_pr.as_ref())
        .and_then(|n| build_default_run_properties(n, Some(resolver)));
    let lst_def_r_pr = lst_level_props.and_then(|p| p.default_run_properties.clone());
    let merged_defaults = merge_default_run_properties(p_pr_def_r_pr, lst_def_r_pr);

    // Walk the source-order children for runs / fields / breaks.
    let mut runs: Vec<TextRun> = Vec::new();
    for child in &raw.children {
        match child {
            ParagraphChild::R(run) => {
                runs.push(build_run(
                    run.r_pr.as_ref(),
                    extract_text(run.t.as_ref()),
                    None,
                    resolver,
                    rels,
                    font_scheme,
                    merged_defaults.as_ref(),
                ));
            }
            ParagraphChild::Fld(fld) => {
                runs.push(build_run(
                    fld.r_pr.as_ref(),
                    extract_text(fld.t.as_ref()),
                    fld.ty.clone(),
                    resolver,
                    rels,
                    font_scheme,
                    merged_defaults.as_ref(),
                ));
            }
            ParagraphChild::Br(br) => {
                runs.push(build_run(
                    br.r_pr.as_ref(),
                    "\n".to_owned(),
                    None,
                    resolver,
                    rels,
                    font_scheme,
                    merged_defaults.as_ref(),
                ));
            }
            ParagraphChild::PPr(_) | ParagraphChild::EndParaRPr(_) => {}
        }
    }

    let end_para_run_properties = end_para_r_pr.map(|n| {
        build_run_properties(
            Some(n),
            resolver,
            rels,
            font_scheme,
            merged_defaults.as_ref(),
        )
    });

    Paragraph {
        runs,
        properties,
        end_para_run_properties,
    }
}

fn build_run(
    r_pr: Option<&RawRunProperties>,
    text: String,
    field_type: Option<String>,
    resolver: &ColorResolver,
    rels: Option<&BTreeMap<String, Relationship>>,
    font_scheme: Option<&FontScheme>,
    defaults: Option<&DefaultRunProperties>,
) -> TextRun {
    let properties = build_run_properties(r_pr, resolver, rels, font_scheme, defaults);
    TextRun {
        text,
        properties,
        field_type,
    }
}

// Long, attribute-by-attribute build-up of the OOXML `<a:rPr>` schema; the
// straight-line shape is intentional (each block reads one attribute and
// mirrors a TS branch) so the body is over the default 100-line clippy
// threshold.
#[allow(clippy::too_many_lines)]
fn build_run_properties(
    r_pr: Option<&RawRunProperties>,
    resolver: &ColorResolver,
    rels: Option<&BTreeMap<String, Relationship>>,
    font_scheme: Option<&FontScheme>,
    defaults: Option<&DefaultRunProperties>,
) -> RunProperties {
    use crate::text_style::resolve_theme_font;

    let Some(node) = r_pr else {
        return RunProperties {
            font_size: defaults.and_then(|d| d.font_size),
            font_family: resolve_theme_font(
                defaults.and_then(|d| d.font_family.as_deref()),
                font_scheme,
            ),
            font_family_ea: resolve_theme_font(
                defaults.and_then(|d| d.font_family_ea.as_deref()),
                font_scheme,
            ),
            font_family_cs: resolve_theme_font(
                defaults.and_then(|d| d.font_family_cs.as_deref()),
                font_scheme,
            ),
            bold: defaults.and_then(|d| d.bold).unwrap_or(false),
            italic: defaults.and_then(|d| d.italic).unwrap_or(false),
            underline: defaults.and_then(|d| d.underline).unwrap_or(false),
            strikethrough: defaults.and_then(|d| d.strikethrough).unwrap_or(false),
            color: None,
            baseline: 0.0,
            hyperlink: None,
            outline: None,
            highlight: defaults.and_then(|d| d.highlight),
            font_family_sym: None,
            kern: None,
            char_spacing: None,
        };
    };

    let highlight_override = node
        .highlight
        .as_ref()
        .and_then(|n| n.color.to_color_ref())
        .map(|cr| resolver.resolve(&cr));
    let highlight = highlight_override.or_else(|| defaults.and_then(|d| d.highlight));

    let font_size = node
        .sz
        .as_deref()
        .and_then(|v| v.parse::<i64>().ok())
        .map(|v| HundredthPt::new(v).to_points())
        .or_else(|| defaults.and_then(|d| d.font_size));
    let latin_typeface = node
        .latin
        .as_ref()
        .and_then(|n| n.typeface.as_deref())
        .or_else(|| defaults.and_then(|d| d.font_family.as_deref()));
    let ea_typeface = node
        .ea
        .as_ref()
        .and_then(|n| n.typeface.as_deref())
        .or_else(|| defaults.and_then(|d| d.font_family_ea.as_deref()));
    let cs_typeface = node
        .cs
        .as_ref()
        .and_then(|n| n.typeface.as_deref())
        .or_else(|| defaults.and_then(|d| d.font_family_cs.as_deref()));
    let sym_typeface = node.sym.as_ref().and_then(|n| n.typeface.as_deref());
    let font_family = resolve_theme_font(latin_typeface, font_scheme);
    let font_family_ea = resolve_theme_font(ea_typeface, font_scheme);
    let font_family_cs = resolve_theme_font(cs_typeface, font_scheme);
    let font_family_sym = sym_typeface.map(str::to_owned);

    let bold = parse_optional_bool(node.b.as_deref())
        .or_else(|| defaults.and_then(|d| d.bold))
        .unwrap_or(false);
    let italic = parse_optional_bool(node.i.as_deref())
        .or_else(|| defaults.and_then(|d| d.italic))
        .unwrap_or(false);
    let has_explicit_underline = node.u.is_some();
    let mut underline = node
        .u
        .as_deref()
        .map(|v| v != "none")
        .or_else(|| defaults.and_then(|d| d.underline))
        .unwrap_or(false);
    let strikethrough = node
        .strike
        .as_deref()
        .map(|v| v != "noStrike")
        .or_else(|| defaults.and_then(|d| d.strikethrough))
        .unwrap_or(false);
    let baseline = node
        .baseline
        .as_deref()
        .and_then(|v| v.parse::<f64>().ok())
        .map_or(0.0, |v| v / 1000.0);

    // @kern is in half-points; store as HundredthPt (1 half-pt = 50 hundredths-pt).
    let kern = node
        .kern
        .as_deref()
        .and_then(|v| v.parse::<i64>().ok())
        .map(|hp| HundredthPt::new(hp * 50));
    // @spc is already in hundredths of a point.
    let char_spacing = node
        .spc
        .as_deref()
        .and_then(|v| v.parse::<i64>().ok())
        .map(HundredthPt::new);

    // Color: <a:solidFill> takes precedence over a direct color child on rPr.
    let mut color = node
        .solid_fill
        .as_ref()
        .and_then(|fill| fill.color.to_color_ref())
        .or_else(|| node.color.to_color_ref())
        .map(|cr| resolver.resolve(&cr));

    let hyperlink = build_hyperlink(node.hlink_click.as_ref(), rels);
    if hyperlink.is_some() {
        if color.is_none() {
            color = Some(resolver.resolve(&slideglance_color::ColorRef::Scheme {
                name: "hlink".to_owned(),
                transform: slideglance_color::ColorTransform::default(),
            }));
        }
        if !has_explicit_underline {
            underline = true;
        }
    }

    let outline = node.ln.as_ref().and_then(|ln| {
        let width = parse_attr_i64(ln.w.as_deref(), 12_700);
        let lc = ln
            .solid_fill
            .as_ref()
            .and_then(|fill| fill.color.to_color_ref())
            .map(|cr| resolver.resolve(&cr))?;
        Some(TextOutline {
            width: Emu::new(width),
            color: lc,
        })
    });

    RunProperties {
        font_size,
        font_family,
        font_family_ea,
        font_family_cs,
        bold,
        italic,
        underline,
        strikethrough,
        color,
        baseline,
        hyperlink,
        outline,
        highlight,
        font_family_sym,
        kern,
        char_spacing,
    }
}

pub(crate) fn build_hyperlink(
    node: Option<&RawHlinkClick>,
    rels: Option<&BTreeMap<String, Relationship>>,
) -> Option<Hyperlink> {
    let click = node?;
    let r_id = click.id.as_deref()?;
    let rel = rels?.get(r_id)?;
    let tooltip = click.tooltip.clone().filter(|t| !t.is_empty());
    Some(Hyperlink {
        url: rel.target.clone(),
        tooltip,
    })
}

fn merge_default_run_properties(
    primary: Option<DefaultRunProperties>,
    secondary: Option<DefaultRunProperties>,
) -> Option<DefaultRunProperties> {
    match (primary, secondary) {
        (None, None) => None,
        (Some(p), None) => Some(p),
        (None, Some(s)) => Some(s),
        (Some(p), Some(s)) => Some(DefaultRunProperties {
            font_size: p.font_size.or(s.font_size),
            font_family: p.font_family.or(s.font_family),
            font_family_ea: p.font_family_ea.or(s.font_family_ea),
            font_family_cs: p.font_family_cs.or(s.font_family_cs),
            bold: p.bold.or(s.bold),
            italic: p.italic.or(s.italic),
            underline: p.underline.or(s.underline),
            strikethrough: p.strikethrough.or(s.strikethrough),
            color: p.color.or(s.color),
            highlight: p.highlight.or(s.highlight),
        }),
    }
}

fn extract_text(node: Option<&RawText>) -> String {
    let raw = node.and_then(|t| t.text.clone()).unwrap_or_default();
    // strip_namespaces guards ASCII spaces with U+F0E1 to defeat
    // quick-xml-de's reader-level text trim. Reverse it here so the
    // downstream model carries normal " " characters again.
    crate::xml::unguard_spaces(&raw)
}

fn parse_anchor(s: &str) -> Option<VerticalAnchor> {
    match s {
        "t" => Some(VerticalAnchor::T),
        "ctr" => Some(VerticalAnchor::Ctr),
        "b" => Some(VerticalAnchor::B),
        _ => None,
    }
}

fn parse_wrap(s: &str) -> Option<WrapMode> {
    match s {
        "square" => Some(WrapMode::Square),
        "none" => Some(WrapMode::None),
        _ => None,
    }
}

fn parse_vert(s: &str) -> Option<TextVerticalType> {
    match s {
        "horz" => Some(TextVerticalType::Horz),
        "vert" => Some(TextVerticalType::Vert),
        "vert270" => Some(TextVerticalType::Vert270),
        "eaVert" => Some(TextVerticalType::EaVert),
        "wordArtVert" => Some(TextVerticalType::WordArtVert),
        "mongolianVert" => Some(TextVerticalType::MongolianVert),
        _ => None,
    }
}

fn parse_optional_bool(s: Option<&str>) -> Option<bool> {
    s.map(|v| v == "1" || v == "true")
}

fn parse_attr_i64(s: Option<&str>, default: i64) -> i64 {
    s.and_then(|v| v.parse::<i64>().ok()).unwrap_or(default)
}

/// Pubic shim for `text_style.rs`'s level-properties parser. Same body
/// as the private [`parse_spacing_node`] but returns `Option` directly
/// so inheritance fallback chains (`.or_else(|| layer.space_before)`)
/// can compose without each level fabricating a default zero.
pub(crate) fn parse_spacing_node_pub(node: Option<&RawSpacing>) -> Option<SpacingValue> {
    parse_spacing_node_optional(node)
}

#[allow(dead_code)]
fn parse_spacing_node(node: Option<&RawSpacing>) -> SpacingValue {
    parse_spacing_node_optional(node).unwrap_or(SpacingValue::Pts {
        value: HundredthPt::new(0),
    })
}

fn parse_spacing_node_optional(node: Option<&RawSpacing>) -> Option<SpacingValue> {
    let spc = node?;
    if let Some(p) = spc.spc_pts.as_ref() {
        return Some(SpacingValue::Pts {
            value: HundredthPt::new(parse_attr_i64(p.val.as_deref(), 0)),
        });
    }
    if let Some(p) = spc.spc_pct.as_ref() {
        let v = p
            .val
            .as_deref()
            .and_then(|v| v.parse::<f64>().ok())
            .unwrap_or(0.0);
        return Some(SpacingValue::Pct { value: v });
    }
    None
}

fn parse_tab_stops_node(node: Option<&RawTabLst>) -> Vec<TabStop> {
    let Some(lst) = node else { return Vec::new() };
    lst.tab
        .iter()
        .map(|t| TabStop {
            position: Emu::new(parse_attr_i64(t.pos.as_deref(), 0)),
            alignment: t
                .algn
                .as_deref()
                .and_then(parse_tab_alignment)
                .unwrap_or(TabStopAlignment::L),
        })
        .collect()
}

fn parse_tab_alignment(s: &str) -> Option<TabStopAlignment> {
    match s {
        "l" => Some(TabStopAlignment::L),
        "ctr" => Some(TabStopAlignment::Ctr),
        "r" => Some(TabStopAlignment::R),
        "dec" => Some(TabStopAlignment::Dec),
        _ => None,
    }
}

// Re-borrow `ParagraphAlignment` so the test file can match it back.
#[allow(dead_code)]
const _PROOF_ALIGN: Option<ParagraphAlignment> = None;

// --- raw XML shapes ---

#[derive(Debug, Default, Deserialize)]
pub(crate) struct RawTextBody {
    #[serde(rename = "bodyPr")]
    pub body_pr: Option<RawBodyPr>,
    #[serde(rename = "lstStyle")]
    pub lst_style: Option<RawListStyle>,
    #[serde(default)]
    pub p: Vec<RawParagraph>,
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct RawBodyPr {
    #[serde(rename = "@anchor")]
    pub anchor: Option<String>,
    #[serde(rename = "@lIns")]
    pub l_ins: Option<String>,
    #[serde(rename = "@rIns")]
    pub r_ins: Option<String>,
    #[serde(rename = "@tIns")]
    pub t_ins: Option<String>,
    #[serde(rename = "@bIns")]
    pub b_ins: Option<String>,
    #[serde(rename = "@wrap")]
    pub wrap: Option<String>,
    #[serde(rename = "@vert")]
    pub vert: Option<String>,
    #[serde(rename = "@numCol")]
    pub num_col: Option<String>,
    #[serde(rename = "@spcFirstLastPara")]
    pub spc_first_last_para: Option<String>,
    #[serde(rename = "@compatLnSpc")]
    pub compat_ln_spc: Option<String>,
    #[serde(rename = "normAutofit")]
    pub norm_autofit: Option<RawNormAutofit>,
    #[serde(rename = "spAutoFit")]
    pub sp_auto_fit: Option<EmptyMarker>,
    #[serde(rename = "prstTxWarp")]
    pub prst_tx_warp: Option<RawPrstTxWarp>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct RawNormAutofit {
    #[serde(rename = "@fontScale")]
    pub font_scale: Option<String>,
    #[serde(rename = "@lnSpcReduction")]
    pub ln_spc_reduction: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct RawPrstTxWarp {
    #[serde(rename = "@prst")]
    pub prst: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct EmptyMarker {}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct RawParagraph {
    #[serde(rename = "@lvl", default)]
    pub level: Option<u8>,
    #[serde(rename = "$value", default)]
    pub children: Vec<ParagraphChild>,
}

/// Source-order paragraph children. quick-xml's `$value` collects every
/// child element into a Vec preserving document order.
#[derive(Debug, Deserialize)]
pub(crate) enum ParagraphChild {
    #[serde(rename = "pPr")]
    PPr(RawParagraphLevel),
    #[serde(rename = "r")]
    R(RawRun),
    #[serde(rename = "fld")]
    Fld(RawFld),
    #[serde(rename = "br")]
    Br(RawBr),
    #[serde(rename = "endParaRPr")]
    EndParaRPr(RawRunProperties),
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct RawRun {
    #[serde(rename = "rPr")]
    pub r_pr: Option<RawRunProperties>,
    pub t: Option<RawText>,
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct RawFld {
    #[serde(rename = "@type")]
    pub ty: Option<String>,
    #[serde(rename = "rPr")]
    pub r_pr: Option<RawRunProperties>,
    pub t: Option<RawText>,
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct RawBr {
    #[serde(rename = "rPr")]
    pub r_pr: Option<RawRunProperties>,
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct RawText {
    #[serde(rename = "$text", default)]
    pub text: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct RawRunProperties {
    #[serde(rename = "@sz")]
    pub sz: Option<String>,
    #[serde(rename = "@b")]
    pub b: Option<String>,
    #[serde(rename = "@i")]
    pub i: Option<String>,
    #[serde(rename = "@u")]
    pub u: Option<String>,
    #[serde(rename = "@strike")]
    pub strike: Option<String>,
    #[serde(rename = "@baseline")]
    pub baseline: Option<String>,
    /// `<a:rPr @kern>` — kern pair threshold (half-points).
    #[serde(rename = "@kern")]
    pub kern: Option<String>,
    /// `<a:rPr @spc>` — character spacing (hundredths of a point).
    #[serde(rename = "@spc")]
    pub spc: Option<String>,
    pub latin: Option<RawTypefaceAttr>,
    pub ea: Option<RawTypefaceAttr>,
    pub cs: Option<RawTypefaceAttr>,
    /// `<a:sym @typeface>` — symbol / PUA font.
    pub sym: Option<RawTypefaceAttr>,
    #[serde(rename = "solidFill")]
    pub solid_fill: Option<RawSolidFillNode>,
    /// Direct color choice on rPr (legacy / non-fillFrame cases).
    #[serde(flatten)]
    pub color: RawColorChoice,
    pub highlight: Option<RawSolidFillNode>,
    #[serde(rename = "hlinkClick")]
    pub hlink_click: Option<RawHlinkClick>,
    pub ln: Option<RawTextOutline>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct RawTypefaceAttr {
    #[serde(rename = "@typeface")]
    pub typeface: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct RawSolidFillNode {
    #[serde(flatten)]
    pub color: RawColorChoice,
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct RawHlinkClick {
    #[serde(rename = "@id")]
    pub id: Option<String>,
    #[serde(rename = "@tooltip")]
    pub tooltip: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct RawTextOutline {
    #[serde(rename = "@w")]
    pub w: Option<String>,
    #[serde(rename = "solidFill")]
    pub solid_fill: Option<RawSolidFillNode>,
}

// Re-export of internal helpers for use by text_style cross-references.
#[allow(dead_code)]
type _ProofRawDefRPr = RawDefRPr;

// --- spacing / tab list ---

#[derive(Debug, Default, Deserialize)]
pub(crate) struct RawSpacing {
    #[serde(rename = "spcPts")]
    pub spc_pts: Option<RawValAttrStr>,
    #[serde(rename = "spcPct")]
    pub spc_pct: Option<RawValAttrStr>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct RawValAttrStr {
    #[serde(rename = "@val")]
    pub val: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct RawTabLst {
    #[serde(default)]
    pub tab: Vec<RawTab>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct RawTab {
    #[serde(rename = "@pos")]
    pub pos: Option<String>,
    #[serde(rename = "@algn")]
    pub algn: Option<String>,
}
