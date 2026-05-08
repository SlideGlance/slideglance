//! `<p:sld>` slide-XML parser — turns a slide part body into a [`Slide`]
//! together with all of its shapes, pictures, connectors, groups, charts, and
//! tables.
//!
//! Mirrors (and its
//! `parseShapeTree` / `parseShape` / `parseImage` / `parseConnector` /
//! `parseGroup` / `parseGraphicFrame` / `parseSmartArt` helpers). Geometry,
//! text body, fill, outline, effect, blip-effect, table, chart, and style
//! reference parsing are delegated to dedicated modules and called via their
//! `build_*` helpers, so this module only handles slide-level structural
//! orchestration.

use std::collections::BTreeMap;

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine as _;
use serde::Deserialize;
use slideglance_color::ColorResolver;
use slideglance_model::{
    Background, ChartElement, ConnectorElement, FontScheme, FormatScheme, Geometry, GroupElement,
    ImageElement, ImageFlip, PlaceholderStyleInfo, PresetGeometry, Slide, SlideElement,
    SlideHeaderFooter, SrcRect, StretchFillRect, TableElement, TileInfo, Transform,
};
use slideglance_utils::Emu;

use crate::archive::PptxArchive;
use crate::blip_effect::{build_blip_effects, RawBlip};
use crate::chart::{build_chart, RawChartSpace};
use crate::effect::{build_effect_list, RawEffectLst};
use crate::fill::{
    build_fill, build_outline, EmptyMarker, FillParseContext, RawFillContainer, RawOutline,
};
use crate::relationships::{
    build_rels_path, parse_relationships, resolve_relationship_target, Relationship,
};
use crate::shape_geometry::{build_geometry_parts, build_transform, RawXfrm};
use crate::style_reference::{build_resolved_style, RawStyle};
use crate::table::{build_table, RawTbl};
use crate::text_body::{build_hyperlink, build_text_body, RawHlinkClick, RawTextBody};
use crate::xml::{parse_xml, XmlError};

const FRACTION_DIVISOR: f64 = 100_000.0;
const TILE_DEFAULT_SCALE: i64 = 100_000;

/// Parses a `<p:sld>` slide XML body into a [`Slide`] model.
///
/// `slide_path` is the archive-relative path of the slide part (e.g.
/// `"ppt/slides/slide1.xml"`); it is used both to locate the part-level
/// `.rels` file and to resolve relative relationship targets when the slide
/// references media or charts.
///
/// `placeholder_styles` carries the master+layout placeholder inheritance map
/// (resolved by the higher-level slide-master/slide-layout parsers). When the
/// slide has placeholder shapes whose `<p:spPr>` block omits `xfrm` or
/// geometry, the parser falls back to the matching entry in this list.
///
/// # Errors
///
/// Returns [`XmlError`] when either the slide XML or its `.rels` file is not
/// well-formed XML.
#[allow(clippy::too_many_arguments)]
pub fn parse_slide(
    slide_xml: &str,
    slide_path: &str,
    slide_number: u32,
    archive: &mut PptxArchive,
    resolver: &ColorResolver,
    font_scheme: Option<&FontScheme>,
    fmt_scheme: Option<&FormatScheme>,
    placeholder_styles: &[PlaceholderStyleInfo],
) -> Result<Slide, XmlError> {
    let raw: RawSlide = parse_xml(slide_xml)?;
    let rels_path = build_rels_path(slide_path);
    let rels = match archive.xml(&rels_path) {
        Some(rels_xml) => parse_relationships(rels_xml)?,
        None => BTreeMap::new(),
    };

    let empty_children: Vec<SpTreeChild> = Vec::new();
    let children_slice: &[SpTreeChild] = raw
        .c_sld
        .as_ref()
        .and_then(|c| c.sp_tree.as_ref())
        .map_or(empty_children.as_slice(), |t| t.children.as_slice());
    let elements = build_sp_tree_elements(
        children_slice,
        &rels,
        slide_path,
        archive,
        resolver,
        font_scheme,
        fmt_scheme,
        Some(placeholder_styles),
        None,
    );

    let background = raw
        .c_sld
        .as_ref()
        .and_then(|c| c.bg.as_ref())
        .and_then(|bg| build_background(bg, resolver, &rels, slide_path, archive));

    let show_master_sp = parse_optional_truthy(raw.show_master_sp.as_deref()).unwrap_or(true);
    let header_footer = raw.hf.as_ref().map(build_slide_header_footer);

    Ok(Slide {
        slide_number,
        background,
        elements,
        show_master_sp,
        header_footer,
        notes: None,
        layout_name: None,
    })
}

// === Background / HeaderFooter ===========================================

pub(crate) fn build_background(
    bg: &RawBg,
    resolver: &ColorResolver,
    rels: &BTreeMap<String, Relationship>,
    base_path: &str,
    archive: &mut PptxArchive,
) -> Option<Background> {
    let bg_pr = bg.bg_pr.as_ref()?;
    let mut ctx = FillParseContext {
        rels,
        archive,
        base_path,
        group_fill: None,
    };
    let fill = bg_pr
        .fill
        .as_ref()
        .and_then(|f| build_fill(f, resolver, Some(&mut ctx)));
    Some(Background { fill })
}

fn build_slide_header_footer(hf: &RawSlideHf) -> SlideHeaderFooter {
    // OOXML default for these attrs is `true` per the schema.
    SlideHeaderFooter {
        show_slide_number: parse_optional_truthy(hf.sld_num.as_deref()).unwrap_or(true),
        show_date_time: parse_optional_truthy(hf.dt.as_deref()).unwrap_or(true),
        show_footer: parse_optional_truthy(hf.ftr.as_deref()).unwrap_or(true),
        footer_text: None,
        datetime_text: None,
    }
}

// === Shape tree =========================================================

#[allow(clippy::too_many_arguments)]
pub(crate) fn build_sp_tree_elements(
    children: &[SpTreeChild],
    rels: &BTreeMap<String, Relationship>,
    base_path: &str,
    archive: &mut PptxArchive,
    resolver: &ColorResolver,
    font_scheme: Option<&FontScheme>,
    fmt_scheme: Option<&FormatScheme>,
    placeholder_styles: Option<&[PlaceholderStyleInfo]>,
    parent_group_fill: Option<&slideglance_model::Fill>,
) -> Vec<SlideElement> {
    let mut elements: Vec<SlideElement> = Vec::new();
    for child in children {
        push_sp_tree_child(
            child,
            &mut elements,
            rels,
            base_path,
            archive,
            resolver,
            font_scheme,
            fmt_scheme,
            placeholder_styles,
            parent_group_fill,
        );
    }
    elements
}

#[allow(clippy::too_many_arguments)]
fn push_sp_tree_child(
    child: &SpTreeChild,
    elements: &mut Vec<SlideElement>,
    rels: &BTreeMap<String, Relationship>,
    base_path: &str,
    archive: &mut PptxArchive,
    resolver: &ColorResolver,
    font_scheme: Option<&FontScheme>,
    fmt_scheme: Option<&FormatScheme>,
    placeholder_styles: Option<&[PlaceholderStyleInfo]>,
    parent_group_fill: Option<&slideglance_model::Fill>,
) {
    match child {
        SpTreeChild::Sp(sp) => {
            if let Some(shape) = build_shape(
                sp,
                resolver,
                rels,
                base_path,
                archive,
                font_scheme,
                fmt_scheme,
                placeholder_styles,
                parent_group_fill,
            ) {
                elements.push(SlideElement::Shape(shape));
            }
        }
        SpTreeChild::Pic(pic) => {
            if let Some(image) = build_image(pic, rels, base_path, archive, resolver) {
                elements.push(SlideElement::Image(image));
            }
        }
        SpTreeChild::CxnSp(cxn) => {
            if let Some(connector) = build_connector(cxn, resolver, fmt_scheme) {
                elements.push(SlideElement::Connector(connector));
            }
        }
        SpTreeChild::GrpSp(grp) => {
            if let Some(group) = build_group(
                grp,
                rels,
                base_path,
                archive,
                resolver,
                font_scheme,
                fmt_scheme,
                placeholder_styles,
                parent_group_fill,
            ) {
                elements.push(SlideElement::Group(group));
            }
        }
        SpTreeChild::GraphicFrame(gf) => {
            if let Some(element) = build_graphic_frame(
                gf,
                rels,
                base_path,
                archive,
                resolver,
                font_scheme,
                fmt_scheme,
            ) {
                elements.push(element);
            }
        }
        SpTreeChild::AlternateContent(ac) => {
            // mc:AlternateContent: pick the first <Choice> and process its
            // children in source order — TS.
            if let Some(choice) = ac.choice.first() {
                for sub in &choice.children {
                    push_sp_tree_child(
                        sub,
                        elements,
                        rels,
                        base_path,
                        archive,
                        resolver,
                        font_scheme,
                        fmt_scheme,
                        placeholder_styles,
                        parent_group_fill,
                    );
                }
            }
        }
    }
}

// === Shape (sp) =========================================================

#[allow(clippy::too_many_arguments, clippy::too_many_lines)]
fn build_shape(
    sp: &RawSp,
    resolver: &ColorResolver,
    rels: &BTreeMap<String, Relationship>,
    base_path: &str,
    archive: &mut PptxArchive,
    font_scheme: Option<&FontScheme>,
    fmt_scheme: Option<&FormatScheme>,
    placeholder_styles: Option<&[PlaceholderStyleInfo]>,
    parent_group_fill: Option<&slideglance_model::Fill>,
) -> Option<slideglance_model::ShapeElement> {
    let sp_pr_present = sp.sp_pr.is_some();
    let placeholder = sp
        .nv_sp_pr
        .as_ref()
        .and_then(|n| n.nv_pr.as_ref())
        .and_then(|n| n.ph.as_ref());
    let placeholder_type = placeholder.map(|ph| ph.ty.clone().unwrap_or_else(|| "body".to_owned()));
    let placeholder_idx = placeholder
        .and_then(|ph| ph.idx.as_deref())
        .and_then(|s| s.parse::<u32>().ok());

    let mut transform = sp
        .sp_pr
        .as_ref()
        .and_then(|sp_pr| sp_pr.xfrm.as_ref())
        .and_then(build_transform);
    let mut geometry: Geometry = if let Some(sp_pr) = sp.sp_pr.as_ref() {
        build_shape_spr_geometry(sp_pr)
    } else {
        rect_geometry()
    };

    if transform.is_none() {
        if let (Some(ph_type), Some(styles)) = (placeholder_type.as_deref(), placeholder_styles) {
            if let Some(inherited) = find_matching_placeholder(ph_type, placeholder_idx, styles) {
                if let Some(t) = inherited.transform {
                    transform = Some(t);
                }
                if !sp_pr_present {
                    if let Some(g) = inherited.geometry.clone() {
                        geometry = g;
                    }
                }
            }
        }
    }

    let transform = transform?;

    let style_ref = sp
        .style
        .as_ref()
        .and_then(|s| build_resolved_style(s, fmt_scheme, resolver));

    let direct_fill = sp.sp_pr.as_ref().and_then(|sp_pr| {
        if !sp_pr.has_fill_choice() {
            return None;
        }
        let fill_container = sp_pr.fill_container();
        let mut ctx = FillParseContext {
            rels,
            archive,
            base_path,
            group_fill: parent_group_fill,
        };
        build_fill(&fill_container, resolver, Some(&mut ctx))
    });
    let fill = direct_fill.or_else(|| style_ref.as_ref().and_then(|s| s.fill.clone()));

    // OOXML cascade rule: an explicit `<a:ln><a:noFill/></a:ln>` on
    // the shape opts out of the outline entirely, *blocking* the
    // `<p:style>/<a:lnRef>` fallback. Without this guard, every
    // sysDot rounded-rect card (test deck slide 9) inherits the
    // theme line and grows a four-sided dotted border that the
    // reference doesn't have.
    let outline_explicit_none = sp
        .sp_pr
        .as_ref()
        .and_then(|sp_pr| sp_pr.ln.as_ref())
        .is_some_and(|ln| ln.no_fill.is_some());
    let direct_outline = sp
        .sp_pr
        .as_ref()
        .and_then(|sp_pr| sp_pr.ln.as_ref())
        .and_then(|ln| build_outline(ln, resolver));
    let style_outline = style_ref.as_ref().and_then(|s| s.outline.clone());
    // Same merge rule as build_connector: a partial inline `<a:ln>` (e.g.
    // dash-only) keeps its overrides but pulls a missing fill from the
    // shape's `<p:style><a:lnRef>` template instead of stranding the
    // outline as `stroke="none"`.
    let outline = if outline_explicit_none {
        None
    } else {
        match (direct_outline, style_outline) {
            (Some(mut direct), Some(style)) => {
                if direct.fill.is_none() {
                    direct.fill = style.fill;
                }
                Some(direct)
            }
            (Some(direct), None) => Some(direct),
            (None, Some(style)) => Some(style),
            (None, None) => None,
        }
    };

    let direct_effects = sp
        .sp_pr
        .as_ref()
        .and_then(|sp_pr| sp_pr.effect_lst.as_ref())
        .and_then(|e| build_effect_list(e, resolver));
    let effects = direct_effects.or_else(|| style_ref.as_ref().and_then(|s| s.effects.clone()));

    // The shape's `<p:style>/<a:fontRef>` carries the default text
    // color (e.g. `lt1` -> white) that `<a:rPr>`-less runs should
    // inherit. PowerPoint applies this whenever the run, layout
    // lstStyle, and master textStyles all leave the color unset.
    let font_ref_color = style_ref
        .as_ref()
        .and_then(|s| s.font_ref.as_ref())
        .and_then(|fr| fr.color);
    let mut text_body = sp.tx_body.as_ref().and_then(|tb| {
        build_text_body(tb, resolver, Some(rels), font_scheme, None, font_ref_color)
    });
    // Field-wise merge of layout/master placeholder bodyPr explicit
    // attributes into this slide shape's text body. Only attributes the
    // slide left absent in its own `<a:bodyPr>` adopt the inherited
    // value — explicit slide attributes always win. This implements
    // MS-OE376 §5.1.5.1.1's "applicable ancestor element" walk for
    // bodyPr without overriding spec-default fields, which the earlier
    // attempt regressed by transmitting parser defaults.
    if let (Some(body), Some(ph_type), Some(styles)) = (
        text_body.as_mut(),
        placeholder_type.as_deref(),
        placeholder_styles,
    ) {
        let raw = sp.tx_body.as_ref().and_then(|tb| tb.body_pr.as_ref());
        let slide_set =
            |attr: fn(&crate::text_body::RawBodyPr) -> bool| -> bool { raw.is_some_and(&attr) };
        let has_anchor = slide_set(|n| n.anchor.is_some());
        let has_lins = slide_set(|n| n.l_ins.is_some());
        let has_rins = slide_set(|n| n.r_ins.is_some());
        let has_tins = slide_set(|n| n.t_ins.is_some());
        let has_bins = slide_set(|n| n.b_ins.is_some());
        let has_wrap = slide_set(|n| n.wrap.is_some());
        let has_vert = slide_set(|n| n.vert.is_some());
        let has_num_col = slide_set(|n| n.num_col.is_some());
        let has_spc_flp = slide_set(|n| n.spc_first_last_para.is_some());
        let has_compat = slide_set(|n| n.compat_ln_spc.is_some());
        // `<a:normAutofit/>` / `<a:spAutoFit/>` are bodyPr children, not
        // attributes — slide-50 right-header (`ph type="body" idx=16`)
        // leaves bodyPr empty and inherits `<a:normAutofit/>` from
        // slideLayout5. Without this fallback the wrap behaviour
        // diverges (single-line vs PowerPoint's two-line layout).
        let has_autofit = slide_set(|n| n.norm_autofit.is_some() || n.sp_auto_fit.is_some());

        if let Some(inherited) = find_matching_placeholder(ph_type, placeholder_idx, styles) {
            if let Some(pbp) = inherited.body_properties.as_ref() {
                if !has_anchor {
                    if let Some(v) = pbp.anchor {
                        body.body_properties.anchor = v;
                    }
                }
                if !has_lins {
                    if let Some(v) = pbp.margin_left {
                        body.body_properties.margin_left = v;
                    }
                }
                if !has_rins {
                    if let Some(v) = pbp.margin_right {
                        body.body_properties.margin_right = v;
                    }
                }
                if !has_tins {
                    if let Some(v) = pbp.margin_top {
                        body.body_properties.margin_top = v;
                    }
                }
                if !has_bins {
                    if let Some(v) = pbp.margin_bottom {
                        body.body_properties.margin_bottom = v;
                    }
                }
                if !has_wrap {
                    if let Some(v) = pbp.wrap {
                        body.body_properties.wrap = v;
                    }
                }
                if !has_vert {
                    if let Some(v) = pbp.vert {
                        body.body_properties.vert = v;
                    }
                }
                if !has_num_col {
                    if let Some(v) = pbp.num_col {
                        body.body_properties.num_col = v;
                    }
                }
                if !has_spc_flp {
                    if let Some(v) = pbp.spc_first_last_para {
                        body.body_properties.spc_first_last_para = v;
                    }
                }
                if !has_compat {
                    if let Some(v) = pbp.compat_ln_spc {
                        body.body_properties.compat_ln_spc = v;
                    }
                }
                // auto_fit + companions inherit as a group — they all
                // come from the same `<a:normAutofit/>` / `<a:spAutoFit/>`
                // child node. Slide-50 ph=body idx=16 is the test case.
                if !has_autofit {
                    if let Some(v) = pbp.auto_fit {
                        body.body_properties.auto_fit = v;
                        if let Some(fs) = pbp.font_scale {
                            body.body_properties.font_scale = fs;
                        }
                        if let Some(lr) = pbp.ln_spc_reduction {
                            body.body_properties.ln_spc_reduction = lr;
                        }
                    }
                }
            }
        }
    }

    let cnv_pr = sp.nv_sp_pr.as_ref().and_then(|n| n.c_nv_pr.as_ref());
    let sp_id = parse_sp_id(cnv_pr);
    let alt_text = cnv_pr
        .and_then(|c| c.descr.clone())
        .filter(|s| !s.is_empty());
    let object_name = cnv_pr
        .and_then(|c| c.name.clone())
        .filter(|s| !s.is_empty());
    let hidden = cnv_pr
        .and_then(|c| c.hidden.as_deref())
        .is_some_and(parse_truthy);
    let hyperlink = build_hyperlink(cnv_pr.and_then(|c| c.hlink_click.as_ref()), Some(rels));

    Some(slideglance_model::ShapeElement {
        sp_id,
        transform,
        geometry,
        fill,
        outline,
        text_body,
        effects,
        placeholder_type,
        placeholder_idx,
        alt_text,
        object_name,
        hidden,
        hyperlink,
    })
}

fn build_shape_spr_geometry(sp_pr: &RawShapeSpPr) -> Geometry {
    build_geometry_parts(sp_pr.prst_geom.as_ref(), sp_pr.cust_geom.as_ref())
}

// === Image (pic) ========================================================

fn build_image(
    pic: &RawPic,
    rels: &BTreeMap<String, Relationship>,
    base_path: &str,
    archive: &mut PptxArchive,
    resolver: &ColorResolver,
) -> Option<ImageElement> {
    let sp_pr = pic.sp_pr.as_ref()?;
    let transform = sp_pr.xfrm.as_ref().and_then(build_transform)?;

    let blip_fill = pic.blip_fill.as_ref()?;
    let blip = blip_fill.blip.as_ref()?;
    // PowerPoint stores Office 2016+ SVG icons with the SVG vector data
    // inside `<a:blip><a:extLst><a:ext><asvg:svgBlip r:embed="rIdN"/></a:ext></a:extLst></a:blip>`
    // and a PNG fallback in the regular `r:embed`. Prefer the SVG so
    // resvg renders crisp vectors; fall back to the raster otherwise.
    let r_id = blip.svg_embed().or(blip.embed.as_deref())?;
    let rel = rels.get(r_id)?;
    let media_path = resolve_relationship_target(base_path, &rel.target);
    let mime_type = mime_for_path(&media_path);
    let media_bytes = archive.media(&media_path).ok().flatten()?;
    let image_data = BASE64_STANDARD.encode(media_bytes);

    let effects = sp_pr
        .effect_lst
        .as_ref()
        .and_then(|e| build_effect_list(e, resolver));
    let blip_effects = build_blip_effects(blip, resolver);
    let src_rect = blip_fill.src_rect.as_ref().and_then(build_src_rect);
    let stretch = blip_fill.stretch.as_ref().and_then(build_stretch_fill_rect);
    let tile = blip_fill.tile.as_ref().map(build_tile_info);

    let cnv_pr = pic.nv_pic_pr.as_ref().and_then(|n| n.c_nv_pr.as_ref());
    let sp_id = parse_sp_id(cnv_pr);
    let alt_text = cnv_pr
        .and_then(|c| c.descr.clone())
        .filter(|s| !s.is_empty());
    let object_name = cnv_pr
        .and_then(|c| c.name.clone())
        .filter(|s| !s.is_empty());
    let hidden = cnv_pr
        .and_then(|c| c.hidden.as_deref())
        .is_some_and(parse_truthy);

    Some(ImageElement {
        sp_id,
        transform,
        image_data,
        mime_type,
        effects,
        blip_effects,
        src_rect,
        alt_text,
        object_name,
        hidden,
        stretch,
        tile,
        alpha: blip.alpha(),
    })
}

fn mime_for_path(path: &str) -> String {
    let ext = path
        .rsplit('.')
        .next()
        .map_or_else(|| "png".to_owned(), str::to_ascii_lowercase);
    // OOXML's image/png fallback covers both unknown extensions and the
    // canonical `.png` case, so we collapse them onto one arm.
    let mime = match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "emf" => "image/emf",
        "wmf" => "image/wmf",
        _ => "image/png",
    };
    mime.to_owned()
}

fn build_src_rect(node: &RawSrcRect) -> Option<SrcRect> {
    let l = parse_attr_i64(node.l.as_deref(), 0) as f64 / FRACTION_DIVISOR;
    let t = parse_attr_i64(node.t.as_deref(), 0) as f64 / FRACTION_DIVISOR;
    let r = parse_attr_i64(node.r.as_deref(), 0) as f64 / FRACTION_DIVISOR;
    let b = parse_attr_i64(node.b.as_deref(), 0) as f64 / FRACTION_DIVISOR;
    if l == 0.0 && t == 0.0 && r == 0.0 && b == 0.0 {
        return None;
    }
    Some(SrcRect {
        left: l,
        top: t,
        right: r,
        bottom: b,
    })
}

fn build_stretch_fill_rect(node: &RawStretch) -> Option<StretchFillRect> {
    let fill_rect = node.fill_rect.as_ref()?;
    let l = parse_attr_i64(fill_rect.l.as_deref(), 0) as f64 / FRACTION_DIVISOR;
    let t = parse_attr_i64(fill_rect.t.as_deref(), 0) as f64 / FRACTION_DIVISOR;
    let r = parse_attr_i64(fill_rect.r.as_deref(), 0) as f64 / FRACTION_DIVISOR;
    let b = parse_attr_i64(fill_rect.b.as_deref(), 0) as f64 / FRACTION_DIVISOR;
    if l == 0.0 && t == 0.0 && r == 0.0 && b == 0.0 {
        return None;
    }
    Some(StretchFillRect {
        left: l,
        top: t,
        right: r,
        bottom: b,
    })
}

fn build_tile_info(node: &RawTile) -> TileInfo {
    let sx = parse_attr_i64(node.sx.as_deref(), TILE_DEFAULT_SCALE) as f64 / FRACTION_DIVISOR;
    let sy = parse_attr_i64(node.sy.as_deref(), TILE_DEFAULT_SCALE) as f64 / FRACTION_DIVISOR;
    let flip = match node.flip.as_deref() {
        Some("x") => ImageFlip::X,
        Some("y") => ImageFlip::Y,
        Some("xy") => ImageFlip::Xy,
        _ => ImageFlip::None,
    };
    let align = node.align.clone().unwrap_or_else(|| "tl".to_owned());
    TileInfo {
        tx: Emu::new(parse_attr_i64(node.tx.as_deref(), 0)),
        ty: Emu::new(parse_attr_i64(node.ty.as_deref(), 0)),
        sx,
        sy,
        flip,
        align,
    }
}

// === Connector (cxnSp) ==================================================

fn build_connector(
    cxn: &RawCxnSp,
    resolver: &ColorResolver,
    fmt_scheme: Option<&FormatScheme>,
) -> Option<ConnectorElement> {
    let sp_pr = cxn.sp_pr.as_ref()?;
    let transform = sp_pr.xfrm.as_ref().and_then(build_transform)?;
    let geometry = build_shape_spr_geometry(sp_pr);

    let style_ref = cxn
        .style
        .as_ref()
        .and_then(|s| build_resolved_style(s, fmt_scheme, resolver));
    let outline_explicit_none = sp_pr.ln.as_ref().is_some_and(|ln| ln.no_fill.is_some());
    let direct_outline = sp_pr.ln.as_ref().and_then(|ln| build_outline(ln, resolver));
    let style_outline = style_ref.as_ref().and_then(|s| s.outline.clone());
    // OOXML outline merging: an inline `<a:ln>` may carry partial properties
    // (dash style, end caps, width) but omit the fill, in which case the
    // missing pieces fall back to the connector's `<p:style><a:lnRef>`
    // template. Slide 9's `직선 화살표 연결선` family illustrates the case —
    // `<a:ln><a:prstDash val="sysDot"/><a:tailEnd type="none"/></a:ln>` has
    // no `<a:solidFill>` and used to render as `stroke="none"` because the
    // direct outline replaced the style reference outright. Merging keeps
    // the inline dash style / arrow ends while picking up the accent1
    // colour from the lnRef template.
    let outline = if outline_explicit_none {
        None
    } else {
        match (direct_outline, style_outline) {
            (Some(mut direct), Some(style)) => {
                if direct.fill.is_none() {
                    direct.fill = style.fill;
                }
                Some(direct)
            }
            (Some(direct), None) => Some(direct),
            (None, Some(style)) => Some(style),
            (None, None) => None,
        }
    };
    let direct_effects = sp_pr
        .effect_lst
        .as_ref()
        .and_then(|e| build_effect_list(e, resolver));
    let effects = direct_effects.or_else(|| style_ref.as_ref().and_then(|s| s.effects.clone()));

    let cnv_pr = cxn.nv_cxn_sp_pr.as_ref().and_then(|n| n.c_nv_pr.as_ref());
    let sp_id = parse_sp_id(cnv_pr);
    let alt_text = cnv_pr
        .and_then(|c| c.descr.clone())
        .filter(|s| !s.is_empty());
    let object_name = cnv_pr
        .and_then(|c| c.name.clone())
        .filter(|s| !s.is_empty());
    let hidden = cnv_pr
        .and_then(|c| c.hidden.as_deref())
        .is_some_and(parse_truthy);

    Some(ConnectorElement {
        sp_id,
        transform,
        geometry,
        outline,
        effects,
        alt_text,
        object_name,
        hidden,
    })
}

// === Group (grpSp) ======================================================

#[allow(clippy::too_many_arguments)]
fn build_group(
    grp: &RawGrpSp,
    rels: &BTreeMap<String, Relationship>,
    base_path: &str,
    archive: &mut PptxArchive,
    resolver: &ColorResolver,
    font_scheme: Option<&FontScheme>,
    fmt_scheme: Option<&FormatScheme>,
    placeholder_styles: Option<&[PlaceholderStyleInfo]>,
    parent_group_fill: Option<&slideglance_model::Fill>,
) -> Option<GroupElement> {
    let grp_sp_pr = grp.grp_sp_pr.as_ref()?;
    let xfrm = grp_sp_pr.xfrm.as_ref()?;
    let transform = build_grp_transform(xfrm)?;

    let child_off_x = xfrm
        .ch_off
        .as_ref()
        .map_or(0, |n| parse_attr_i64(n.x.as_deref(), 0));
    let child_off_y = xfrm
        .ch_off
        .as_ref()
        .map_or(0, |n| parse_attr_i64(n.y.as_deref(), 0));
    let child_ext_w = xfrm
        .ch_ext
        .as_ref()
        .map_or(transform.extent_width.raw(), |n| {
            parse_attr_i64(n.cx.as_deref(), transform.extent_width.raw())
        });
    let child_ext_h = xfrm
        .ch_ext
        .as_ref()
        .map_or(transform.extent_height.raw(), |n| {
            parse_attr_i64(n.cy.as_deref(), transform.extent_height.raw())
        });
    let child_transform = Transform {
        offset_x: Emu::new(child_off_x),
        offset_y: Emu::new(child_off_y),
        extent_width: Emu::new(child_ext_w),
        extent_height: Emu::new(child_ext_h),
        rotation: 0.0,
        flip_h: false,
        flip_v: false,
    };

    let group_fill = grp_sp_pr.fill.as_ref().and_then(|f| {
        let mut ctx = FillParseContext {
            rels,
            archive,
            base_path,
            group_fill: parent_group_fill,
        };
        build_fill(f, resolver, Some(&mut ctx))
    });

    let children = build_sp_tree_elements(
        &grp.children,
        rels,
        base_path,
        archive,
        resolver,
        font_scheme,
        fmt_scheme,
        placeholder_styles,
        group_fill.as_ref(),
    );

    let effects = grp_sp_pr
        .effect_lst
        .as_ref()
        .and_then(|e| build_effect_list(e, resolver));

    let cnv_pr = grp.nv_grp_sp_pr.as_ref().and_then(|n| n.c_nv_pr.as_ref());
    let sp_id = parse_sp_id(cnv_pr);
    let alt_text = cnv_pr
        .and_then(|c| c.descr.clone())
        .filter(|s| !s.is_empty());
    let object_name = cnv_pr
        .and_then(|c| c.name.clone())
        .filter(|s| !s.is_empty());
    let hidden = cnv_pr
        .and_then(|c| c.hidden.as_deref())
        .is_some_and(parse_truthy);

    Some(GroupElement {
        sp_id,
        transform,
        child_transform,
        children,
        effects,
        alt_text,
        object_name,
        hidden,
    })
}

// === GraphicFrame (chart / table / smartArt) ============================

fn build_graphic_frame(
    gf: &RawGraphicFrame,
    rels: &BTreeMap<String, Relationship>,
    base_path: &str,
    archive: &mut PptxArchive,
    resolver: &ColorResolver,
    font_scheme: Option<&FontScheme>,
    fmt_scheme: Option<&FormatScheme>,
) -> Option<SlideElement> {
    let xfrm = gf.xfrm.as_ref()?;
    let transform = build_transform(xfrm)?;
    let graphic = gf.graphic.as_ref()?;
    let graphic_data = graphic.graphic_data.as_ref()?;

    let cnv_pr = gf
        .nv_graphic_frame_pr
        .as_ref()
        .and_then(|n| n.c_nv_pr.as_ref());
    let sp_id = parse_sp_id(cnv_pr);
    let object_name = cnv_pr
        .and_then(|c| c.name.clone())
        .filter(|s| !s.is_empty());
    let hidden = cnv_pr
        .and_then(|c| c.hidden.as_deref())
        .is_some_and(parse_truthy);

    if let Some(chart_ref) = graphic_data.chart.as_ref() {
        let r_id = chart_ref.id.as_deref()?;
        let rel = rels.get(r_id)?;
        let chart_path = resolve_relationship_target(base_path, &rel.target);
        let chart_xml = archive.xml(&chart_path)?.to_owned();
        let raw_chart: RawChartSpace = parse_xml(&chart_xml).ok()?;
        let chart = build_chart(&raw_chart, resolver)?;
        return Some(SlideElement::Chart(ChartElement {
            sp_id,
            transform,
            chart,
            object_name,
            hidden,
        }));
    }

    if let Some(tbl) = graphic_data.tbl.as_ref() {
        let table = build_table(tbl, resolver, Some(rels), font_scheme)?;
        return Some(SlideElement::Table(TableElement {
            sp_id,
            transform,
            table,
            object_name,
            hidden,
        }));
    }

    if graphic_data
        .uri
        .as_deref()
        .is_some_and(|uri| uri == "http://schemas.openxmlformats.org/drawingml/2006/diagram")
    {
        return build_smart_art(
            graphic_data,
            transform,
            rels,
            base_path,
            archive,
            resolver,
            font_scheme,
            fmt_scheme,
            object_name,
            hidden,
        )
        .map(SlideElement::Group);
    }

    None
}

#[allow(clippy::too_many_arguments)]
fn build_smart_art(
    graphic_data: &RawGraphicData,
    transform: Transform,
    rels: &BTreeMap<String, Relationship>,
    base_path: &str,
    archive: &mut PptxArchive,
    resolver: &ColorResolver,
    font_scheme: Option<&FontScheme>,
    fmt_scheme: Option<&FormatScheme>,
    object_name: Option<String>,
    hidden: bool,
) -> Option<GroupElement> {
    let rel_ids = graphic_data.rel_ids.as_ref()?;
    let dm_id = rel_ids.dm.as_deref()?;
    let dm_rel = rels.get(dm_id)?;
    let data_path = resolve_relationship_target(base_path, &dm_rel.target);

    let drawing_path = resolve_drawing_path(&data_path, archive, rels, base_path)?;
    let drawing_xml = archive.xml(&drawing_path)?.to_owned();
    let raw_drawing: RawDrawing = parse_xml(&drawing_xml).ok()?;

    let drawing_rels_path = build_rels_path(&drawing_path);
    let drawing_rels = match archive.xml(&drawing_rels_path) {
        Some(rels_xml) => parse_relationships(rels_xml).ok()?,
        None => BTreeMap::new(),
    };

    let sp_tree = raw_drawing.sp_tree.as_ref()?;

    // Group child transform comes from the drawing's <a:grpSpPr><a:xfrm>...
    let grp_xfrm = sp_tree.grp_sp_pr.as_ref().and_then(|n| n.xfrm.as_ref());
    let child_off_x = grp_xfrm
        .and_then(|x| x.ch_off.as_ref())
        .map_or(0, |n| parse_attr_i64(n.x.as_deref(), 0));
    let child_off_y = grp_xfrm
        .and_then(|x| x.ch_off.as_ref())
        .map_or(0, |n| parse_attr_i64(n.y.as_deref(), 0));
    let child_ext_w = grp_xfrm
        .and_then(|x| x.ch_ext.as_ref())
        .map_or(transform.extent_width.raw(), |n| {
            parse_attr_i64(n.cx.as_deref(), transform.extent_width.raw())
        });
    let child_ext_h = grp_xfrm
        .and_then(|x| x.ch_ext.as_ref())
        .map_or(transform.extent_height.raw(), |n| {
            parse_attr_i64(n.cy.as_deref(), transform.extent_height.raw())
        });
    let child_transform = Transform {
        offset_x: Emu::new(child_off_x),
        offset_y: Emu::new(child_off_y),
        extent_width: Emu::new(child_ext_w),
        extent_height: Emu::new(child_ext_h),
        rotation: 0.0,
        flip_h: false,
        flip_v: false,
    };

    let children = build_sp_tree_elements(
        &sp_tree.children,
        &drawing_rels,
        &drawing_path,
        archive,
        resolver,
        font_scheme,
        fmt_scheme,
        None,
        None,
    );
    if children.is_empty() {
        return None;
    }

    Some(GroupElement {
        sp_id: None,
        transform,
        child_transform,
        children,
        effects: None,
        alt_text: None,
        object_name,
        hidden,
    })
}

fn resolve_drawing_path(
    data_path: &str,
    archive: &PptxArchive,
    slide_rels: &BTreeMap<String, Relationship>,
    slide_path: &str,
) -> Option<String> {
    let data_rels_path = build_rels_path(data_path);
    if let Some(rels_xml) = archive.xml(&data_rels_path) {
        if let Ok(data_rels) = parse_relationships(rels_xml) {
            for rel in data_rels.values() {
                if rel.ty.contains("diagramDrawing") {
                    return Some(resolve_relationship_target(data_path, &rel.target));
                }
            }
        }
    }
    // Fallback: look for diagramDrawing in the slide's own rels.
    for rel in slide_rels.values() {
        if rel.ty.contains("diagramDrawing") {
            return Some(resolve_relationship_target(slide_path, &rel.target));
        }
    }
    None
}

// === Placeholder fallback ===============================================

fn find_matching_placeholder<'a>(
    ph_type: &str,
    ph_idx: Option<u32>,
    styles: &'a [PlaceholderStyleInfo],
) -> Option<&'a PlaceholderStyleInfo> {
    if let Some(idx) = ph_idx {
        if let Some(found) = styles
            .iter()
            .find(|s| s.placeholder_idx == Some(idx) && s.transform.is_some())
        {
            return Some(found);
        }
        if let Some(found) = styles.iter().find(|s| s.placeholder_idx == Some(idx)) {
            return Some(found);
        }
    }

    if let Some(found) = styles
        .iter()
        .find(|s| s.placeholder_type == ph_type && s.transform.is_some())
    {
        return Some(found);
    }

    let fallback = match ph_type {
        "ctrTitle" => Some("title"),
        "subTitle" => Some("body"),
        _ => None,
    };
    if let Some(ft) = fallback {
        if let Some(found) = styles
            .iter()
            .find(|s| s.placeholder_type == ft && s.transform.is_some())
        {
            return Some(found);
        }
    }

    if let Some(found) = styles.iter().find(|s| s.placeholder_type == ph_type) {
        return Some(found);
    }
    if let Some(ft) = fallback {
        return styles.iter().find(|s| s.placeholder_type == ft);
    }
    None
}

// === small parsers ======================================================

fn rect_geometry() -> Geometry {
    Geometry::Preset(PresetGeometry {
        preset: "rect".to_owned(),
        adjust_values: BTreeMap::new(),
    })
}

fn parse_attr_i64(s: Option<&str>, default: i64) -> i64 {
    s.and_then(|v| v.parse::<i64>().ok()).unwrap_or(default)
}

fn parse_truthy(s: &str) -> bool {
    s == "1" || s == "true"
}

/// Extract the `cNvPr/@id` attribute as `u32`. Returns `None` when the
/// `cNvPr` element is missing, the `@id` attribute is absent, or the
/// value cannot be parsed as a non-negative 32-bit integer (per
/// ECMA-376, `cNvPr/@id` is `xsd:unsignedInt`).
fn parse_sp_id(cnv_pr: Option<&RawCNvPr>) -> Option<u32> {
    cnv_pr
        .and_then(|c| c.id.as_deref())
        .and_then(|s| s.parse::<u32>().ok())
}

fn parse_optional_truthy(s: Option<&str>) -> Option<bool> {
    match s? {
        "1" | "true" => Some(true),
        "0" | "false" => Some(false),
        _ => None,
    }
}

// === Raw XML types ======================================================

#[derive(Debug, Default, Deserialize)]
pub(crate) struct RawSlide {
    #[serde(rename = "@showMasterSp")]
    pub show_master_sp: Option<String>,
    #[serde(rename = "cSld")]
    pub c_sld: Option<RawCSld>,
    pub hf: Option<RawSlideHf>,
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct RawCSld {
    /// `<p:cSld @name>` — only meaningful for slide layouts; slides
    /// themselves do not surface it through their model. Kept on the raw
    /// type so the same struct can be reused by slide-layout-parser.
    #[serde(rename = "@name")]
    #[allow(dead_code)]
    pub name: Option<String>,
    pub bg: Option<RawBg>,
    #[serde(rename = "spTree")]
    pub sp_tree: Option<RawSpTree>,
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct RawBg {
    #[serde(rename = "bgPr")]
    pub bg_pr: Option<RawBgPr>,
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct RawBgPr {
    #[serde(flatten)]
    pub fill: Option<RawFillContainer>,
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct RawSlideHf {
    #[serde(rename = "@sldNum")]
    pub sld_num: Option<String>,
    #[serde(rename = "@dt")]
    pub dt: Option<String>,
    #[serde(rename = "@ftr")]
    pub ftr: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct RawSpTree {
    /// `<p:nvGrpSpPr>` — only meaningful for slide masters / layouts where
    /// the spTree's own `cNvPr.name` is preserved. Slides do not consume it.
    #[serde(rename = "nvGrpSpPr")]
    #[allow(dead_code)]
    pub nv_grp_sp_pr: Option<RawNvGrpSpPr>,
    #[serde(rename = "grpSpPr")]
    pub grp_sp_pr: Option<RawGrpSpPr>,
    #[serde(rename = "$value", default)]
    pub children: Vec<SpTreeChild>,
}

/// Source-order children of `<p:spTree>` / `<a:grpSp>`. Mirrors the TS
/// reference's preserveOrder parsing — quick-xml's `$value` enum collects
/// every shape variant in document order.
#[allow(clippy::large_enum_variant)]
#[derive(Debug, Deserialize)]
pub(crate) enum SpTreeChild {
    #[serde(rename = "sp")]
    Sp(RawSp),
    #[serde(rename = "pic")]
    Pic(RawPic),
    #[serde(rename = "cxnSp")]
    CxnSp(RawCxnSp),
    /// `<p:grpSp>` is recursive; it carries children of the same enum so we
    /// box it to break the cycle.
    #[serde(rename = "grpSp")]
    GrpSp(Box<RawGrpSp>),
    #[serde(rename = "graphicFrame")]
    GraphicFrame(RawGraphicFrame),
    #[serde(rename = "AlternateContent")]
    AlternateContent(RawAlternateContent),
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct RawAlternateContent {
    #[serde(rename = "Choice", default)]
    pub choice: Vec<RawAlternateChoice>,
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct RawAlternateChoice {
    #[serde(rename = "$value", default)]
    pub children: Vec<SpTreeChild>,
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct RawSp {
    #[serde(rename = "nvSpPr")]
    pub nv_sp_pr: Option<RawNvSpPr>,
    #[serde(rename = "spPr")]
    pub sp_pr: Option<RawShapeSpPr>,
    pub style: Option<RawStyle>,
    #[serde(rename = "txBody")]
    pub tx_body: Option<RawTextBody>,
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct RawNvSpPr {
    #[serde(rename = "cNvPr")]
    pub c_nv_pr: Option<RawCNvPr>,
    #[serde(rename = "nvPr")]
    pub nv_pr: Option<RawNvPr>,
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct RawNvPr {
    pub ph: Option<RawPh>,
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct RawPh {
    #[serde(rename = "@type")]
    pub ty: Option<String>,
    #[serde(rename = "@idx")]
    pub idx: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct RawCNvPr {
    /// `cNvPr/@id` (ECMA-376 `xsd:unsignedInt`). Threaded into the model
    /// via `parse_sp_id` at every `build_*` site so renderers can emit
    /// stable per-element identifiers (e.g. `data-sp-id`).
    #[serde(rename = "@id")]
    pub id: Option<String>,
    #[serde(rename = "@descr")]
    pub descr: Option<String>,
    #[serde(rename = "@name")]
    pub name: Option<String>,
    #[serde(rename = "@hidden")]
    pub hidden: Option<String>,
    #[serde(rename = "hlinkClick")]
    pub hlink_click: Option<RawHlinkClick>,
}

/// `<a:spPr>` with the union of fields used by shapes / connectors:
/// transform, geometry, fills (flattened — same pattern as table.rs:tcPr),
/// outline, and effect list. `scene3d` / `sp3d` are accepted but currently
/// unused (see TS warn fallback).
#[allow(clippy::struct_field_names)]
#[derive(Debug, Default, Deserialize)]
pub(crate) struct RawShapeSpPr {
    pub xfrm: Option<RawXfrm>,
    #[serde(rename = "prstGeom")]
    pub prst_geom: Option<crate::shape_geometry::RawPrstGeom>,
    #[serde(rename = "custGeom")]
    pub cust_geom: Option<crate::custom_geometry::RawCustGeom>,
    // Fill choice — quick-xml's serde flatten over Option<RawFillContainer>
    // silently drops `gradFill` on slide-level <p:spPr> (verified by
    // `gradient_flatten_repro::gradfill_under_sppr_via_flatten`). Inline each
    // child explicitly so the deserializer doesn't lose gradient/blip/pattern
    // children. The companion `fill_container()` helper recombines them into
    // a `RawFillContainer` for `build_fill`.
    #[serde(rename = "noFill")]
    pub no_fill: Option<EmptyMarker>,
    #[serde(rename = "solidFill")]
    pub solid_fill: Option<crate::fill::RawSolidFill>,
    #[serde(rename = "gradFill")]
    pub grad_fill: Option<crate::fill::RawGradFill>,
    #[serde(rename = "blipFill")]
    pub blip_fill: Option<crate::fill::RawBlipFill>,
    #[serde(rename = "pattFill")]
    pub patt_fill: Option<crate::fill::RawPattFill>,
    #[serde(rename = "grpFill")]
    pub grp_fill: Option<EmptyMarker>,
    pub ln: Option<RawOutline>,
    #[serde(rename = "effectLst")]
    pub effect_lst: Option<RawEffectLst>,
    /// Currently unused — scene3d is not yet implemented; we only accept the
    /// element so the deserializer tolerates fixtures that include it.
    #[allow(dead_code)]
    pub scene3d: Option<EmptyMarker>,
    /// Currently unused — sp3d is not yet implemented.
    #[allow(dead_code)]
    pub sp3d: Option<EmptyMarker>,
}

impl RawShapeSpPr {
    /// Recombine the inlined fill-choice fields into a `RawFillContainer` for
    /// `build_fill` consumption. Exists because `#[serde(flatten)]` over
    /// `Option<RawFillContainer>` silently drops `gradFill` on slide-level
    /// `<p:spPr>` (see `gradient_flatten_repro` test).
    pub(crate) fn fill_container(&self) -> RawFillContainer {
        RawFillContainer {
            no_fill: self.no_fill.clone(),
            solid_fill: self.solid_fill.clone(),
            grad_fill: self.grad_fill.clone(),
            blip_fill: self.blip_fill.clone(),
            patt_fill: self.patt_fill.clone(),
            grp_fill: self.grp_fill.clone(),
        }
    }

    /// `true` when at least one fill choice element was present.
    pub(crate) fn has_fill_choice(&self) -> bool {
        self.no_fill.is_some()
            || self.solid_fill.is_some()
            || self.grad_fill.is_some()
            || self.blip_fill.is_some()
            || self.patt_fill.is_some()
            || self.grp_fill.is_some()
    }
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct RawPic {
    #[serde(rename = "nvPicPr")]
    pub nv_pic_pr: Option<RawNvPicPr>,
    #[serde(rename = "blipFill")]
    pub blip_fill: Option<RawPicBlipFill>,
    #[serde(rename = "spPr")]
    pub sp_pr: Option<RawShapeSpPr>,
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct RawNvPicPr {
    #[serde(rename = "cNvPr")]
    pub c_nv_pr: Option<RawCNvPr>,
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct RawPicBlipFill {
    pub blip: Option<RawBlip>,
    #[serde(rename = "srcRect")]
    pub src_rect: Option<RawSrcRect>,
    pub stretch: Option<RawStretch>,
    pub tile: Option<RawTile>,
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct RawSrcRect {
    #[serde(rename = "@l")]
    pub l: Option<String>,
    #[serde(rename = "@t")]
    pub t: Option<String>,
    #[serde(rename = "@r")]
    pub r: Option<String>,
    #[serde(rename = "@b")]
    pub b: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct RawStretch {
    #[serde(rename = "fillRect")]
    pub fill_rect: Option<RawSrcRect>,
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct RawTile {
    #[serde(rename = "@tx")]
    pub tx: Option<String>,
    #[serde(rename = "@ty")]
    pub ty: Option<String>,
    #[serde(rename = "@sx")]
    pub sx: Option<String>,
    #[serde(rename = "@sy")]
    pub sy: Option<String>,
    #[serde(rename = "@flip")]
    pub flip: Option<String>,
    #[serde(rename = "@algn")]
    pub align: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct RawCxnSp {
    #[serde(rename = "nvCxnSpPr")]
    pub nv_cxn_sp_pr: Option<RawNvCxnSpPr>,
    #[serde(rename = "spPr")]
    pub sp_pr: Option<RawShapeSpPr>,
    pub style: Option<RawStyle>,
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct RawNvCxnSpPr {
    #[serde(rename = "cNvPr")]
    pub c_nv_pr: Option<RawCNvPr>,
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct RawGrpSp {
    #[serde(rename = "nvGrpSpPr")]
    pub nv_grp_sp_pr: Option<RawNvGrpSpPr>,
    #[serde(rename = "grpSpPr")]
    pub grp_sp_pr: Option<RawGrpSpPr>,
    #[serde(rename = "$value", default)]
    pub children: Vec<SpTreeChild>,
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct RawNvGrpSpPr {
    #[serde(rename = "cNvPr")]
    pub c_nv_pr: Option<RawCNvPr>,
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct RawGrpSpPr {
    pub xfrm: Option<RawGrpXfrm>,
    #[serde(flatten)]
    pub fill: Option<RawFillContainer>,
    #[serde(rename = "effectLst")]
    pub effect_lst: Option<RawEffectLst>,
}

#[derive(Debug, Default, Deserialize, Clone)]
pub(crate) struct RawGrpXfrm {
    #[serde(rename = "@rot")]
    pub rot: Option<String>,
    #[serde(rename = "@flipH")]
    pub flip_h: Option<String>,
    #[serde(rename = "@flipV")]
    pub flip_v: Option<String>,
    pub off: Option<RawXY>,
    pub ext: Option<RawCxCy>,
    #[serde(rename = "chOff")]
    pub ch_off: Option<RawXY>,
    #[serde(rename = "chExt")]
    pub ch_ext: Option<RawCxCy>,
}

#[derive(Debug, Default, Deserialize, Clone)]
pub(crate) struct RawXY {
    #[serde(rename = "@x")]
    pub x: Option<String>,
    #[serde(rename = "@y")]
    pub y: Option<String>,
}

#[derive(Debug, Default, Deserialize, Clone)]
pub(crate) struct RawCxCy {
    #[serde(rename = "@cx")]
    pub cx: Option<String>,
    #[serde(rename = "@cy")]
    pub cy: Option<String>,
}

fn build_grp_transform(xfrm: &RawGrpXfrm) -> Option<Transform> {
    let off = xfrm.off.as_ref()?;
    let ext = xfrm.ext.as_ref()?;
    Some(Transform {
        offset_x: Emu::new(parse_attr_i64(off.x.as_deref(), 0)),
        offset_y: Emu::new(parse_attr_i64(off.y.as_deref(), 0)),
        extent_width: Emu::new(parse_attr_i64(ext.cx.as_deref(), 0)),
        extent_height: Emu::new(parse_attr_i64(ext.cy.as_deref(), 0)),
        rotation: parse_attr_i64(xfrm.rot.as_deref(), 0) as f64 / 60_000.0,
        flip_h: xfrm.flip_h.as_deref().is_some_and(parse_truthy),
        flip_v: xfrm.flip_v.as_deref().is_some_and(parse_truthy),
    })
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct RawGraphicFrame {
    #[serde(rename = "nvGraphicFramePr")]
    pub nv_graphic_frame_pr: Option<RawNvGraphicFramePr>,
    pub xfrm: Option<RawXfrm>,
    pub graphic: Option<RawGraphic>,
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct RawNvGraphicFramePr {
    #[serde(rename = "cNvPr")]
    pub c_nv_pr: Option<RawCNvPr>,
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct RawGraphic {
    #[serde(rename = "graphicData")]
    pub graphic_data: Option<RawGraphicData>,
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct RawGraphicData {
    #[serde(rename = "@uri")]
    pub uri: Option<String>,
    pub chart: Option<RawChartRef>,
    pub tbl: Option<RawTbl>,
    #[serde(rename = "relIds")]
    pub rel_ids: Option<RawRelIds>,
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct RawChartRef {
    #[serde(rename = "@id")]
    pub id: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
pub(crate) struct RawRelIds {
    #[serde(rename = "@dm")]
    pub dm: Option<String>,
}

// Diagram drawing wrapper: `<dgm:drawing>` (after namespace strip → `drawing`).
#[derive(Debug, Default, Deserialize)]
struct RawDrawing {
    #[serde(rename = "spTree")]
    sp_tree: Option<RawSpTree>,
}

#[cfg(test)]
mod tests {
    #[test]
    fn raw_cnvpr_parses_id_attribute() {
        let xml = r#"<cNvPr id="42" name="Title 1"/>"#;
        let parsed: super::RawCNvPr = quick_xml::de::from_str(xml).unwrap();
        assert_eq!(parsed.id.as_deref(), Some("42"));
        assert_eq!(parsed.name.as_deref(), Some("Title 1"));
    }
}

#[cfg(test)]
mod gradient_flatten_repro {
    use super::*;
    use crate::xml::{parse_xml, strip_namespaces};

    #[test]
    fn gradfill_under_sppr_via_flatten() {
        let xml = r#"<spPr bwMode="auto">
<xfrm><off x="0" y="1612915"/><ext cx="7559675" cy="1637179"/></xfrm>
<prstGeom prst="rect"><avLst/></prstGeom>
<gradFill>
<gsLst>
<gs pos="0"><schemeClr val="accent1"><lumMod val="5000"/><lumOff val="95000"/><alpha val="0"/></schemeClr></gs>
<gs pos="100000"><schemeClr val="bg1"/></gs>
</gsLst>
<lin ang="16200000" scaled="0"/>
</gradFill>
<ln><noFill/></ln>
</spPr>"#;
        let stripped = strip_namespaces(xml).expect("strip");
        let parsed: RawShapeSpPr = parse_xml(&stripped).expect("parse");
        // gradFill should be detected via the inlined fill-choice fields.
        assert!(parsed.has_fill_choice(), "no fill choice captured");
        assert!(
            parsed.grad_fill.is_some(),
            "gradFill should be parsed; got {parsed:#?}"
        );
        let stops = parsed
            .grad_fill
            .as_ref()
            .and_then(|g| g.gs_lst.as_ref())
            .map_or(0, |l| l.gs.len());
        assert_eq!(stops, 2, "two stops expected");
    }
}
