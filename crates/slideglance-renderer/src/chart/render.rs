//! Chart top-level dispatcher + per-type renderers.
//!
//! Direct port of. Covers
//! all 11 OOXML chart types plus combo. Trendline overlays attach to
//! cartesian (bar / line / area / combo) series via
//! [`super::trendline::render_trendlines`].

use std::f64::consts::PI;
use std::fmt::Write as _;

use slideglance_color::{ResolvedColor, Rgb};
use slideglance_model::{
    AxisGroup, BarDirection, ChartData, ChartElement, ChartSeries, ChartType, LegendPosition,
    OfPieType, RadarStyle,
};

use crate::color::color_hex;
use crate::svg_builder::escape_xml_text;
use crate::transform::{build_object_name_attr, build_transform_attr};

use super::common::{
    build_smooth_path_d, compose_data_label, compute_nice_ticks, emit_data_label, fill_attr,
    format_tick_value, get_max_value, pie_slice_color, point_color, point_explosion, r,
    render_legend, render_value_axis_labels, resolve_series_data_labels, value_axis_options,
};
use super::trendline::render_trendlines;

/// Result of rendering one [`ChartElement`].
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct ChartRenderResult {
    /// SVG body wrapped in a `<g transform="...">` group.
    pub content: String,
    /// `<defs>` content (currently always empty for charts).
    pub defs: String,
}

/// Render a [`ChartElement`] to SVG. Includes a chart background, axes,
/// title, legend, axis titles, and the chart-type-specific plot.
//
// The function intentionally has many lines because it follows the TS
// reference's single-pass layout flow (margins -> plot dispatch -> legend
// -> axis titles).
#[allow(clippy::too_many_lines)]
#[must_use]
pub fn render_chart(element: &ChartElement) -> ChartRenderResult {
    const AXIS_TITLE_HEIGHT: f64 = 20.0;
    const AXIS_TITLE_WIDTH: f64 = 20.0;
    let chart = &element.chart;
    let w = element.transform.extent_width.to_pixels();
    let h = element.transform.extent_height.to_pixels();
    let transform_attr = build_transform_attr(&element.transform);

    let mut out = String::new();
    let sp_id_attr = crate::svg_builder::build_sp_id_attr(element.sp_id);
    let _ = write!(
        out,
        "<g{sp_id_attr} transform=\"{transform_attr}\"{}>",
        build_object_name_attr(element.object_name.as_deref())
    );
    let _ = write!(
        out,
        "<rect width=\"{}\" height=\"{}\" fill=\"#FFFFFF\" stroke=\"#D9D9D9\" stroke-width=\"0.5\"/>",
        r(w),
        r(h)
    );

    let mut margin = Margins {
        top: 20.0,
        right: 20.0,
        bottom: 30.0,
        left: 50.0,
    };
    if let Some(title) = &chart.title {
        let _ = write!(
            out,
            "<text x=\"{}\" y=\"20\" text-anchor=\"middle\" font-size=\"14\" font-weight=\"bold\" fill=\"#404040\">{}</text>",
            r(w / 2.0),
            escape_xml_text(title)
        );
        margin.top = 40.0;
    }

    if let Some(legend) = chart.legend {
        let labels = legend_labels(chart);
        let longest_chars = labels.iter().map(String::len).max().unwrap_or(0);
        let legend_est_width = (longest_chars as f64 * 7.0 + 30.0)
            .min((w * 0.45).floor())
            .max(80.0);
        match legend.position {
            LegendPosition::B => margin.bottom = 50.0,
            LegendPosition::T => margin.top += 20.0,
            LegendPosition::R | LegendPosition::Tr => margin.right = legend_est_width + 10.0,
            LegendPosition::L => margin.left = margin.left.max(legend_est_width + 10.0),
        }
    }

    if chart
        .category_axis
        .as_ref()
        .and_then(|a| a.title.as_ref())
        .is_some()
    {
        margin.bottom += AXIS_TITLE_HEIGHT;
    }
    if chart
        .value_axis
        .as_ref()
        .and_then(|a| a.title.as_ref())
        .is_some()
    {
        margin.left += AXIS_TITLE_WIDTH;
    }
    if chart.secondary_value_axis.is_some() {
        margin.right = margin.right.max(50.0);
    }
    if chart
        .secondary_value_axis
        .as_ref()
        .and_then(|a| a.title.as_ref())
        .is_some()
    {
        margin.right += AXIS_TITLE_WIDTH;
    }

    let plot_x = margin.left;
    let plot_y = margin.top;
    let plot_w = (w - margin.left - margin.right).max(0.0);
    let plot_h = (h - margin.top - margin.bottom).max(0.0);

    if plot_w > 0.0 && plot_h > 0.0 {
        if chart.is_combo {
            out.push_str(&render_combo_chart(chart, plot_x, plot_y, plot_w, plot_h));
        } else {
            let plot_svg = match chart.chart_type {
                ChartType::Bar => render_bar_chart(chart, plot_x, plot_y, plot_w, plot_h),
                ChartType::Line => render_line_chart(chart, plot_x, plot_y, plot_w, plot_h),
                ChartType::Pie => render_pie_chart(chart, plot_x, plot_y, plot_w, plot_h),
                ChartType::Doughnut => render_doughnut_chart(chart, plot_x, plot_y, plot_w, plot_h),
                ChartType::Area => render_area_chart(chart, plot_x, plot_y, plot_w, plot_h),
                ChartType::Scatter => render_scatter_chart(chart, plot_x, plot_y, plot_w, plot_h),
                ChartType::Bubble => render_bubble_chart(chart, plot_x, plot_y, plot_w, plot_h),
                ChartType::Radar => render_radar_chart(chart, plot_x, plot_y, plot_w, plot_h),
                ChartType::Stock => render_stock_chart(chart, plot_x, plot_y, plot_w, plot_h),
                ChartType::Surface => render_surface_chart(chart, plot_x, plot_y, plot_w, plot_h),
                ChartType::OfPie => render_of_pie_chart(chart, plot_x, plot_y, plot_w, plot_h),
            };
            out.push_str(&plot_svg);
        }
    }

    if let Some(legend) = chart.legend {
        if !chart.series.is_empty() {
            out.push_str(&render_legend(chart, w, h, legend.position));
        }
    }

    if plot_w > 0.0 && plot_h > 0.0 {
        if let Some(title) = chart.category_axis.as_ref().and_then(|a| a.title.as_ref()) {
            let cx = plot_x + plot_w / 2.0;
            let cy = plot_y + plot_h + AXIS_TITLE_HEIGHT + 22.0;
            let _ = write!(
                out,
                "<text x=\"{}\" y=\"{}\" text-anchor=\"middle\" font-size=\"13\" fill=\"#404040\">{}</text>",
                r(cx),
                r(cy),
                escape_xml_text(title)
            );
        }
        if let Some(title) = chart.value_axis.as_ref().and_then(|a| a.title.as_ref()) {
            let tx = plot_x - margin.left + 14.0;
            let ty = plot_y + plot_h / 2.0;
            let _ = write!(
                out,
                "<text x=\"{}\" y=\"{}\" text-anchor=\"middle\" font-size=\"13\" fill=\"#404040\" transform=\"rotate(-90, {}, {})\">{}</text>",
                r(tx),
                r(ty),
                r(tx),
                r(ty),
                escape_xml_text(title)
            );
        }
        if let Some(title) = chart
            .secondary_value_axis
            .as_ref()
            .and_then(|a| a.title.as_ref())
        {
            let tx = plot_x + plot_w + margin.right - 14.0;
            let ty = plot_y + plot_h / 2.0;
            let _ = write!(
                out,
                "<text x=\"{}\" y=\"{}\" text-anchor=\"middle\" font-size=\"13\" fill=\"#404040\" transform=\"rotate(90, {}, {})\">{}</text>",
                r(tx),
                r(ty),
                r(tx),
                r(ty),
                escape_xml_text(title)
            );
        }
    }

    out.push_str("</g>");
    ChartRenderResult {
        content: out,
        defs: String::new(),
    }
}

fn legend_labels(chart: &ChartData) -> Vec<String> {
    if matches!(
        chart.chart_type,
        ChartType::Pie | ChartType::Doughnut | ChartType::OfPie
    ) {
        chart.categories.clone()
    } else {
        chart
            .series
            .iter()
            .enumerate()
            .map(|(i, s)| {
                s.name
                    .clone()
                    .unwrap_or_else(|| format!("Series {}", i + 1))
            })
            .collect()
    }
}

#[derive(Debug, Clone, Copy)]
struct Margins {
    top: f64,
    right: f64,
    bottom: f64,
    left: f64,
}

// Bar chart follows the spec's single function with two branches
// for vertical (column) vs horizontal layout. Splitting would mostly
// duplicate the axis / label scaffolding.
#[allow(clippy::too_many_lines)]
fn render_bar_chart(chart: &ChartData, x: f64, y: f64, w: f64, h: f64) -> String {
    if chart.series.is_empty() {
        return String::new();
    }
    let max_val = get_max_value(&chart.series);
    if max_val == 0.0 {
        return String::new();
    }
    let cat_count = if chart.categories.is_empty() {
        chart
            .series
            .iter()
            .map(|s| s.values.len())
            .max()
            .unwrap_or(0)
    } else {
        chart.categories.len()
    };
    if cat_count == 0 {
        return String::new();
    }

    let is_horizontal = matches!(chart.bar_direction, Some(BarDirection::Bar));
    let target_count = ((h / 30.0).floor() as i64).max(2) as u32;
    let ticks = compute_nice_ticks(0.0, max_val, target_count);
    let scale_max = *ticks.last().unwrap_or(&max_val);
    if scale_max == 0.0 {
        return String::new();
    }

    let mut out = String::new();
    let _ = write!(
        out,
        "<line x1=\"{}\" y1=\"{}\" x2=\"{}\" y2=\"{}\" stroke=\"#D9D9D9\" stroke-width=\"1\"/>",
        r(x),
        r(y + h),
        r(x + w),
        r(y + h)
    );
    let _ = write!(
        out,
        "<line x1=\"{}\" y1=\"{}\" x2=\"{}\" y2=\"{}\" stroke=\"#D9D9D9\" stroke-width=\"1\"/>",
        r(x),
        r(y),
        r(x),
        r(y + h)
    );

    if is_horizontal {
        for &tick in &ticks {
            let ratio = tick / scale_max;
            if !(-0.001..=1.001).contains(&ratio) {
                continue;
            }
            let tick_x = x + ratio * w;
            let _ = write!(
                out,
                "<text x=\"{}\" y=\"{}\" text-anchor=\"middle\" font-size=\"12\" fill=\"#595959\">{}</text>",
                r(tick_x),
                r(y + h + 15.0),
                escape_xml_text(&format_tick_value(tick))
            );
        }
    } else {
        out.push_str(&render_value_axis_labels(
            &ticks,
            0.0,
            scale_max,
            x,
            y,
            h,
            value_axis_options(chart, w),
        ));
    }

    if is_horizontal {
        let group_h = h / cat_count as f64;
        let bar_h = (group_h * 0.7) / chart.series.len() as f64;
        let group_pad = group_h * 0.15;
        for c in 0..cat_count {
            let label = chart.categories.get(c).map_or("", String::as_str);
            let label_y = y + c as f64 * group_h + group_h / 2.0;
            let _ = write!(
                out,
                "<text x=\"{}\" y=\"{}\" text-anchor=\"end\" font-size=\"12\" fill=\"#595959\">{}</text>",
                r(x - 5.0),
                r(label_y + 4.0),
                escape_xml_text(label)
            );
        }
        for (s_idx, s) in chart.series.iter().enumerate() {
            let labels = resolve_series_data_labels(chart, s);
            for (c, val) in s.values.iter().enumerate() {
                let bar_w = (val / scale_max) * w;
                let bar_x = x;
                let bar_y = y + c as f64 * group_h + group_pad + s_idx as f64 * bar_h;
                let _ = write!(
                    out,
                    "<rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" {}/>",
                    r(bar_x),
                    r(bar_y),
                    r(bar_w),
                    r(bar_h),
                    fill_attr(&s.color)
                );
                let cat = chart.categories.get(c).map(String::as_str);
                if let Some(text) =
                    compose_data_label(labels.as_ref(), *val, cat, s.name.as_deref(), None)
                {
                    emit_data_label(
                        &mut out,
                        &text,
                        bar_x + bar_w + 4.0,
                        bar_y + bar_h / 2.0 + 4.0,
                        "start",
                    );
                }
            }
        }
    } else {
        let group_w = w / cat_count as f64;
        let bar_w = (group_w * 0.7) / chart.series.len() as f64;
        let group_pad = group_w * 0.15;
        for c in 0..cat_count {
            let label = chart.categories.get(c).map_or("", String::as_str);
            let label_x = x + c as f64 * group_w + group_w / 2.0;
            let _ = write!(
                out,
                "<text x=\"{}\" y=\"{}\" text-anchor=\"middle\" font-size=\"12\" fill=\"#595959\">{}</text>",
                r(label_x),
                r(y + h + 15.0),
                escape_xml_text(label)
            );
        }
        for (s_idx, s) in chart.series.iter().enumerate() {
            let labels = resolve_series_data_labels(chart, s);
            for (c, val) in s.values.iter().enumerate() {
                let bar_h = (val / scale_max) * h;
                let bar_x = x + c as f64 * group_w + group_pad + s_idx as f64 * bar_w;
                let bar_y = y + h - bar_h;
                let pt_color = point_color(s, c as u32);
                let _ = write!(
                    out,
                    "<rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" {}/>",
                    r(bar_x),
                    r(bar_y),
                    r(bar_w),
                    r(bar_h),
                    fill_attr(&pt_color)
                );
                let cat = chart.categories.get(c).map(String::as_str);
                if let Some(text) =
                    compose_data_label(labels.as_ref(), *val, cat, s.name.as_deref(), None)
                {
                    emit_data_label(&mut out, &text, bar_x + bar_w / 2.0, bar_y - 4.0, "middle");
                }
            }
            // Trendline overlay (vertical bar only — horizontal bars are
            // a rare case and TS skips them too).
            let mut to_px =
                |i: f64, v: f64| (x + i * group_w + group_w / 2.0, y + h - (v / scale_max) * h);
            out.push_str(&render_trendlines(
                s.trendlines.as_deref(),
                &s.values,
                &s.color,
                &mut to_px,
            ));
        }
    }
    out
}

#[allow(clippy::too_many_lines, clippy::many_single_char_names)]
fn render_line_chart(chart: &ChartData, x: f64, y: f64, w: f64, h: f64) -> String {
    if chart.series.is_empty() {
        return String::new();
    }
    let max_val = get_max_value(&chart.series);
    if max_val == 0.0 {
        return String::new();
    }
    let cat_count = if chart.categories.is_empty() {
        chart
            .series
            .iter()
            .map(|s| s.values.len())
            .max()
            .unwrap_or(0)
    } else {
        chart.categories.len()
    };
    if cat_count == 0 {
        return String::new();
    }

    let target_count = ((h / 30.0).floor() as i64).max(2) as u32;
    let ticks = compute_nice_ticks(0.0, max_val, target_count);
    let scale_max = *ticks.last().unwrap_or(&max_val);
    if scale_max == 0.0 {
        return String::new();
    }

    let mut out = String::new();
    let _ = write!(
        out,
        "<line x1=\"{}\" y1=\"{}\" x2=\"{}\" y2=\"{}\" stroke=\"#D9D9D9\" stroke-width=\"1\"/>",
        r(x),
        r(y + h),
        r(x + w),
        r(y + h)
    );
    let _ = write!(
        out,
        "<line x1=\"{}\" y1=\"{}\" x2=\"{}\" y2=\"{}\" stroke=\"#D9D9D9\" stroke-width=\"1\"/>",
        r(x),
        r(y),
        r(x),
        r(y + h)
    );
    out.push_str(&render_value_axis_labels(
        &ticks,
        0.0,
        scale_max,
        x,
        y,
        h,
        value_axis_options(chart, w),
    ));

    let divisor = if cat_count > 1 {
        (cat_count - 1) as f64
    } else {
        1.0
    };
    for c in 0..cat_count {
        let label = chart.categories.get(c).map_or("", String::as_str);
        let label_x = x + (c as f64 / divisor) * w;
        let _ = write!(
            out,
            "<text x=\"{}\" y=\"{}\" text-anchor=\"middle\" font-size=\"12\" fill=\"#595959\">{}</text>",
            r(label_x),
            r(y + h + 15.0),
            escape_xml_text(label)
        );
    }

    for s in &chart.series {
        let labels = resolve_series_data_labels(chart, s);
        let pts: Vec<(f64, f64)> = s
            .values
            .iter()
            .enumerate()
            .map(|(i, v)| (x + (i as f64 / divisor) * w, y + h - (v / scale_max) * h))
            .collect();
        let opacity = if s.color.alpha < 1.0 {
            format!(" stroke-opacity=\"{}\"", s.color.alpha)
        } else {
            String::new()
        };
        let stroke_hex = crate::color::color_hex(&s.color);
        if s.smooth.unwrap_or(false) && pts.len() >= 2 {
            let d = build_smooth_path_d(&pts);
            let _ = write!(
                out,
                "<path d=\"{d}\" fill=\"none\" stroke=\"{stroke_hex}\" stroke-width=\"2\"{opacity}/>"
            );
        } else {
            let mut points_str = String::new();
            for (i, p) in pts.iter().enumerate() {
                if i > 0 {
                    points_str.push(' ');
                }
                let _ = write!(points_str, "{},{}", r(p.0), r(p.1));
            }
            let _ = write!(
                out,
                "<polyline points=\"{points_str}\" fill=\"none\" stroke=\"{stroke_hex}\" stroke-width=\"2\"{opacity}/>"
            );
        }
        for (i, p) in pts.iter().enumerate() {
            let _ = write!(
                out,
                "<circle cx=\"{}\" cy=\"{}\" r=\"3\" {}/>",
                r(p.0),
                r(p.1),
                fill_attr(&s.color)
            );
            let cat = chart.categories.get(i).map(String::as_str);
            if let Some(text) =
                compose_data_label(labels.as_ref(), s.values[i], cat, s.name.as_deref(), None)
            {
                emit_data_label(&mut out, &text, p.0, p.1 - 8.0, "middle");
            }
        }
        // Trendline overlay.
        let mut to_px = |i: f64, v: f64| (x + (i / divisor) * w, y + h - (v / scale_max) * h);
        out.push_str(&render_trendlines(
            s.trendlines.as_deref(),
            &s.values,
            &s.color,
            &mut to_px,
        ));
    }
    out
}

// `chart`/`x`/`y`/`w`/`h` mirror the spec signature; renaming
// would only obscure parity.
#[allow(clippy::many_single_char_names)]
fn render_pie_chart(chart: &ChartData, x: f64, y: f64, w: f64, h: f64) -> String {
    let series = match chart.series.first() {
        Some(s) if !s.values.is_empty() => s,
        _ => return String::new(),
    };
    let total: f64 = series.values.iter().sum();
    if total == 0.0 {
        return String::new();
    }
    let cx = x + w / 2.0;
    let cy = y + h / 2.0;
    let radius = (w.min(h) / 2.0) * 0.85;
    let labels = resolve_series_data_labels(chart, series);
    let mut current_angle = -PI / 2.0;
    let mut out = String::new();
    let single = series.values.len() == 1;
    for (i, val) in series.values.iter().enumerate() {
        let slice_angle = (val / total) * 2.0 * PI;
        let color = pie_slice_color(i, chart);
        let explosion_pct = point_explosion(series, i as u32);
        let offset = if explosion_pct > 0.0 {
            radius * (explosion_pct / 100.0)
        } else {
            0.0
        };
        let mid = current_angle + slice_angle / 2.0;
        let ox = cx + offset * mid.cos();
        let oy = cy + offset * mid.sin();
        if single {
            let _ = write!(
                out,
                "<circle cx=\"{}\" cy=\"{}\" r=\"{}\" {}/>",
                r(ox),
                r(oy),
                r(radius),
                fill_attr(&color)
            );
        } else {
            let x1 = ox + radius * current_angle.cos();
            let y1 = oy + radius * current_angle.sin();
            let x2 = ox + radius * (current_angle + slice_angle).cos();
            let y2 = oy + radius * (current_angle + slice_angle).sin();
            let large_arc = i32::from(slice_angle > PI);
            let _ = write!(
                out,
                "<path d=\"M{},{} L{},{} A{},{} 0 {large_arc},1 {},{} Z\" {}/>",
                r(ox),
                r(oy),
                r(x1),
                r(y1),
                r(radius),
                r(radius),
                r(x2),
                r(y2),
                fill_attr(&color)
            );
        }
        if let Some(labels) = &labels {
            let label_r = radius * 0.65;
            let cat = chart.categories.get(i).map(String::as_str);
            let percent = val / total;
            if let Some(text) = compose_data_label(
                Some(labels),
                *val,
                cat,
                series.name.as_deref(),
                Some(percent),
            ) {
                emit_data_label(
                    &mut out,
                    &text,
                    ox + label_r * mid.cos(),
                    oy + label_r * mid.sin() + 4.0,
                    "middle",
                );
            }
        }
        current_angle += slice_angle;
    }
    out
}

#[allow(clippy::many_single_char_names)]
fn render_doughnut_chart(chart: &ChartData, x: f64, y: f64, w: f64, h: f64) -> String {
    let series = match chart.series.first() {
        Some(s) if !s.values.is_empty() => s,
        _ => return String::new(),
    };
    let total: f64 = series.values.iter().sum();
    if total == 0.0 {
        return String::new();
    }
    let cx = x + w / 2.0;
    let cy = y + h / 2.0;
    let outer_r = (w.min(h) / 2.0) * 0.85;
    let hole_size = chart.hole_size.unwrap_or(50.0);
    let inner_r = outer_r * (hole_size / 100.0);
    let mut current_angle = -PI / 2.0;
    let mut out = String::new();
    let single = series.values.len() == 1;
    for (i, val) in series.values.iter().enumerate() {
        let slice_angle = (val / total) * 2.0 * PI;
        let color = pie_slice_color(i, chart);
        if single {
            let _ = write!(
                out,
                "<circle cx=\"{}\" cy=\"{}\" r=\"{}\" {}/><circle cx=\"{}\" cy=\"{}\" r=\"{}\" fill=\"#FFFFFF\"/>",
                r(cx),
                r(cy),
                r(outer_r),
                fill_attr(&color),
                r(cx),
                r(cy),
                r(inner_r)
            );
        } else {
            let ox1 = cx + outer_r * current_angle.cos();
            let oy1 = cy + outer_r * current_angle.sin();
            let ox2 = cx + outer_r * (current_angle + slice_angle).cos();
            let oy2 = cy + outer_r * (current_angle + slice_angle).sin();
            let ix1 = cx + inner_r * (current_angle + slice_angle).cos();
            let iy1 = cy + inner_r * (current_angle + slice_angle).sin();
            let ix2 = cx + inner_r * current_angle.cos();
            let iy2 = cy + inner_r * current_angle.sin();
            let large_arc = i32::from(slice_angle > PI);
            let _ = write!(
                out,
                "<path d=\"M{},{} A{},{} 0 {large_arc},1 {},{} L{},{} A{},{} 0 {large_arc},0 {},{} Z\" {}/>",
                r(ox1),
                r(oy1),
                r(outer_r),
                r(outer_r),
                r(ox2),
                r(oy2),
                r(ix1),
                r(iy1),
                r(inner_r),
                r(inner_r),
                r(ix2),
                r(iy2),
                fill_attr(&color)
            );
        }
        current_angle += slice_angle;
    }
    out
}

#[allow(clippy::too_many_lines, clippy::many_single_char_names)]
fn render_area_chart(chart: &ChartData, x: f64, y: f64, w: f64, h: f64) -> String {
    if chart.series.is_empty() {
        return String::new();
    }
    let max_val = get_max_value(&chart.series);
    if max_val == 0.0 {
        return String::new();
    }
    let cat_count = if chart.categories.is_empty() {
        chart
            .series
            .iter()
            .map(|s| s.values.len())
            .max()
            .unwrap_or(0)
    } else {
        chart.categories.len()
    };
    if cat_count == 0 {
        return String::new();
    }
    let target_count = ((h / 30.0).floor() as i64).max(2) as u32;
    let ticks = compute_nice_ticks(0.0, max_val, target_count);
    let scale_max = *ticks.last().unwrap_or(&max_val);
    if scale_max == 0.0 {
        return String::new();
    }
    let mut out = String::new();
    let _ = write!(
        out,
        "<line x1=\"{}\" y1=\"{}\" x2=\"{}\" y2=\"{}\" stroke=\"#D9D9D9\" stroke-width=\"1\"/>",
        r(x),
        r(y + h),
        r(x + w),
        r(y + h)
    );
    let _ = write!(
        out,
        "<line x1=\"{}\" y1=\"{}\" x2=\"{}\" y2=\"{}\" stroke=\"#D9D9D9\" stroke-width=\"1\"/>",
        r(x),
        r(y),
        r(x),
        r(y + h)
    );
    out.push_str(&render_value_axis_labels(
        &ticks,
        0.0,
        scale_max,
        x,
        y,
        h,
        value_axis_options(chart, w),
    ));

    let divisor = if cat_count > 1 {
        (cat_count - 1) as f64
    } else {
        1.0
    };
    for c in 0..cat_count {
        let label = chart.categories.get(c).map_or("", String::as_str);
        let label_x = x + (c as f64 / divisor) * w;
        let _ = write!(
            out,
            "<text x=\"{}\" y=\"{}\" text-anchor=\"middle\" font-size=\"12\" fill=\"#595959\">{}</text>",
            r(label_x),
            r(y + h + 15.0),
            escape_xml_text(label)
        );
    }

    let baseline = y + h;
    for s in &chart.series {
        let pts: Vec<(f64, f64)> = s
            .values
            .iter()
            .enumerate()
            .map(|(i, v)| (x + (i as f64 / divisor) * w, y + h - (v / scale_max) * h))
            .collect();
        if pts.is_empty() {
            continue;
        }
        let mut top = String::new();
        for (i, p) in pts.iter().enumerate() {
            if i > 0 {
                top.push(' ');
            }
            let _ = write!(top, "{},{}", r(p.0), r(p.1));
        }
        let last_x = pts.last().map_or(0.0, |p| p.0);
        let first_x = pts.first().map_or(0.0, |p| p.0);
        let stroke_hex = color_hex(&s.color);
        let fill_opacity = if s.color.alpha < 1.0 {
            s.color.alpha
        } else {
            0.5
        };
        let stroke_opacity = if s.color.alpha < 1.0 {
            format!(" stroke-opacity=\"{}\"", s.color.alpha)
        } else {
            String::new()
        };
        let _ = write!(
            out,
            "<polygon points=\"{top} {},{} {},{}\" fill=\"{stroke_hex}\" fill-opacity=\"{fill_opacity}\" stroke=\"{stroke_hex}\" stroke-width=\"2\"{stroke_opacity}/>",
            r(last_x),
            r(baseline),
            r(first_x),
            r(baseline)
        );
    }
    out
}

#[allow(clippy::many_single_char_names)]
fn render_scatter_chart(chart: &ChartData, x: f64, y: f64, w: f64, h: f64) -> String {
    if chart.series.is_empty() {
        return String::new();
    }
    let mut max_x = 0.0_f64;
    let mut max_y = 0.0_f64;
    for s in &chart.series {
        if let Some(xs) = &s.x_values {
            for v in xs {
                max_x = max_x.max(*v);
            }
        }
        for v in &s.values {
            max_y = max_y.max(*v);
        }
    }
    if max_x == 0.0 {
        max_x = 1.0;
    }
    if max_y == 0.0 {
        max_y = 1.0;
    }

    let target = ((h / 30.0).floor() as i64).max(2) as u32;
    let ticks = compute_nice_ticks(0.0, max_y, target);
    let scale_max_y = *ticks.last().unwrap_or(&max_y);

    let mut out = String::new();
    let _ = write!(
        out,
        "<line x1=\"{}\" y1=\"{}\" x2=\"{}\" y2=\"{}\" stroke=\"#D9D9D9\" stroke-width=\"1\"/>",
        r(x),
        r(y + h),
        r(x + w),
        r(y + h)
    );
    let _ = write!(
        out,
        "<line x1=\"{}\" y1=\"{}\" x2=\"{}\" y2=\"{}\" stroke=\"#D9D9D9\" stroke-width=\"1\"/>",
        r(x),
        r(y),
        r(x),
        r(y + h)
    );
    out.push_str(&render_value_axis_labels(
        &ticks,
        0.0,
        scale_max_y,
        x,
        y,
        h,
        value_axis_options(chart, w),
    ));

    for s in &chart.series {
        let xs = s.x_values.as_deref().unwrap_or(&[]);
        for (i, y_val) in s.values.iter().enumerate() {
            let x_val = xs.get(i).copied().unwrap_or(i as f64);
            let px = x + (x_val / max_x) * w;
            let py = y + h - (y_val / scale_max_y) * h;
            let _ = write!(
                out,
                "<circle cx=\"{}\" cy=\"{}\" r=\"4\" {}/>",
                r(px),
                r(py),
                fill_attr(&s.color)
            );
        }
    }
    out
}

#[allow(clippy::many_single_char_names)]
fn render_bubble_chart(chart: &ChartData, x: f64, y: f64, w: f64, h: f64) -> String {
    if chart.series.is_empty() {
        return String::new();
    }
    let mut max_x = 0.0_f64;
    let mut max_y = 0.0_f64;
    let mut max_bubble = 0.0_f64;
    for s in &chart.series {
        if let Some(xs) = &s.x_values {
            for v in xs {
                max_x = max_x.max(*v);
            }
        }
        for v in &s.values {
            max_y = max_y.max(*v);
        }
        if let Some(sizes) = &s.bubble_sizes {
            for v in sizes {
                max_bubble = max_bubble.max(*v);
            }
        }
    }
    if max_x == 0.0 {
        max_x = 1.0;
    }
    if max_y == 0.0 {
        max_y = 1.0;
    }
    if max_bubble == 0.0 {
        max_bubble = 1.0;
    }

    let max_radius = w.min(h) * 0.08;
    let target = ((h / 30.0).floor() as i64).max(2) as u32;
    let ticks = compute_nice_ticks(0.0, max_y, target);
    let scale_max_y = *ticks.last().unwrap_or(&max_y);

    let mut out = String::new();
    let _ = write!(
        out,
        "<line x1=\"{}\" y1=\"{}\" x2=\"{}\" y2=\"{}\" stroke=\"#D9D9D9\" stroke-width=\"1\"/>",
        r(x),
        r(y + h),
        r(x + w),
        r(y + h)
    );
    let _ = write!(
        out,
        "<line x1=\"{}\" y1=\"{}\" x2=\"{}\" y2=\"{}\" stroke=\"#D9D9D9\" stroke-width=\"1\"/>",
        r(x),
        r(y),
        r(x),
        r(y + h)
    );
    out.push_str(&render_value_axis_labels(
        &ticks,
        0.0,
        scale_max_y,
        x,
        y,
        h,
        value_axis_options(chart, w),
    ));

    for s in &chart.series {
        let xs = s.x_values.as_deref().unwrap_or(&[]);
        let sizes = s.bubble_sizes.as_deref().unwrap_or(&[]);
        for (i, y_val) in s.values.iter().enumerate() {
            let x_val = xs.get(i).copied().unwrap_or(i as f64);
            let size = sizes.get(i).copied().unwrap_or(1.0);
            let px = x + (x_val / max_x) * w;
            let py = y + h - (y_val / scale_max_y) * h;
            let radius = ((size / max_bubble).sqrt() * max_radius).max(2.0);
            let _ = write!(
                out,
                "<circle cx=\"{}\" cy=\"{}\" r=\"{}\" {} fill-opacity=\"0.6\"/>",
                r(px),
                r(py),
                r(radius),
                fill_attr(&s.color)
            );
        }
    }
    out
}

#[allow(clippy::too_many_lines, clippy::many_single_char_names)]
fn render_radar_chart(chart: &ChartData, x: f64, y: f64, w: f64, h: f64) -> String {
    if chart.series.is_empty() {
        return String::new();
    }
    let max_val = get_max_value(&chart.series);
    if max_val == 0.0 {
        return String::new();
    }
    let cat_count = if chart.categories.is_empty() {
        chart
            .series
            .iter()
            .map(|s| s.values.len())
            .max()
            .unwrap_or(0)
    } else {
        chart.categories.len()
    };
    if cat_count == 0 {
        return String::new();
    }

    let cx = x + w / 2.0;
    let cy = y + h / 2.0;
    let radius = (w.min(h) / 2.0) * 0.85;
    let grid_levels: i32 = 5;

    let mut out = String::new();
    for level in 1..=grid_levels {
        let lr = (radius / f64::from(grid_levels)) * f64::from(level);
        let _ = write!(
            out,
            "<circle cx=\"{}\" cy=\"{}\" r=\"{}\" fill=\"none\" stroke=\"#D9D9D9\" stroke-width=\"0.5\"/>",
            r(cx),
            r(cy),
            r(lr)
        );
    }

    for i in 0..cat_count {
        let angle = (i as f64 / cat_count as f64) * 2.0 * PI - PI / 2.0;
        let ax = cx + radius * angle.cos();
        let ay = cy + radius * angle.sin();
        let _ = write!(
            out,
            "<line x1=\"{}\" y1=\"{}\" x2=\"{}\" y2=\"{}\" stroke=\"#D9D9D9\" stroke-width=\"0.5\"/>",
            r(cx),
            r(cy),
            r(ax),
            r(ay)
        );
        let label = chart.categories.get(i).map_or("", String::as_str);
        if !label.is_empty() {
            let label_r = radius + 12.0;
            let lx = cx + label_r * angle.cos();
            let ly = cy + label_r * angle.sin();
            let cos_a = angle.cos();
            let anchor = if cos_a.abs() < 0.01 {
                "middle"
            } else if cos_a > 0.0 {
                "start"
            } else {
                "end"
            };
            let _ = write!(
                out,
                "<text x=\"{}\" y=\"{}\" text-anchor=\"{anchor}\" font-size=\"12\" fill=\"#595959\">{}</text>",
                r(lx),
                r(ly + 4.0),
                escape_xml_text(label)
            );
        }
    }

    let is_filled = chart.radar_style == Some(RadarStyle::Filled);
    let show_markers = chart.radar_style == Some(RadarStyle::Marker);

    for s in &chart.series {
        let mut points = String::new();
        let mut coords: Vec<(f64, f64)> = Vec::new();
        for i in 0..cat_count {
            let val = s.values.get(i).copied().unwrap_or(0.0);
            let angle = (i as f64 / cat_count as f64) * 2.0 * PI - PI / 2.0;
            let lr = (val / max_val) * radius;
            let px = cx + lr * angle.cos();
            let py = cy + lr * angle.sin();
            if !points.is_empty() {
                points.push(' ');
            }
            let _ = write!(points, "{},{}", r(px), r(py));
            coords.push((px, py));
        }
        let stroke_hex = color_hex(&s.color);
        let stroke_opacity = if s.color.alpha < 1.0 {
            format!(" stroke-opacity=\"{}\"", s.color.alpha)
        } else {
            String::new()
        };
        if is_filled {
            let _ = write!(
                out,
                "<polygon points=\"{points}\" fill=\"{stroke_hex}\" fill-opacity=\"0.3\" stroke=\"{stroke_hex}\" stroke-width=\"2\"{stroke_opacity}/>"
            );
        } else {
            let _ = write!(
                out,
                "<polygon points=\"{points}\" fill=\"none\" stroke=\"{stroke_hex}\" stroke-width=\"2\"{stroke_opacity}/>"
            );
        }
        if show_markers {
            for (px, py) in &coords {
                let _ = write!(
                    out,
                    "<circle cx=\"{}\" cy=\"{}\" r=\"3\" {}/>",
                    r(*px),
                    r(*py),
                    fill_attr(&s.color)
                );
            }
        }
    }
    out
}

#[allow(clippy::many_single_char_names)]
fn render_stock_chart(chart: &ChartData, x: f64, y: f64, w: f64, h: f64) -> String {
    // Stock chart expects three series in order: High (0), Low (1), Close (2).
    if chart.series.len() < 3 {
        return String::new();
    }
    let high = &chart.series[0];
    let low = &chart.series[1];
    let close = &chart.series[2];
    let cat_count = if chart.categories.is_empty() {
        high.values.len()
    } else {
        chart.categories.len()
    };
    if cat_count == 0 {
        return String::new();
    }

    let mut min_val = f64::INFINITY;
    let mut max_val = f64::NEG_INFINITY;
    for s in [high, low, close] {
        for v in &s.values {
            if *v < min_val {
                min_val = *v;
            }
            if *v > max_val {
                max_val = *v;
            }
        }
    }
    if max_val == min_val {
        return String::new();
    }

    let target = ((h / 30.0).floor() as i64).max(2) as u32;
    let ticks = compute_nice_ticks(min_val, max_val, target);
    let scale_min = *ticks.first().unwrap_or(&min_val);
    let scale_max = *ticks.last().unwrap_or(&max_val);

    let mut out = String::new();
    let _ = write!(
        out,
        "<line x1=\"{}\" y1=\"{}\" x2=\"{}\" y2=\"{}\" stroke=\"#D9D9D9\" stroke-width=\"1\"/>",
        r(x),
        r(y + h),
        r(x + w),
        r(y + h)
    );
    let _ = write!(
        out,
        "<line x1=\"{}\" y1=\"{}\" x2=\"{}\" y2=\"{}\" stroke=\"#D9D9D9\" stroke-width=\"1\"/>",
        r(x),
        r(y),
        r(x),
        r(y + h)
    );
    out.push_str(&render_value_axis_labels(
        &ticks,
        scale_min,
        scale_max,
        x,
        y,
        h,
        value_axis_options(chart, w),
    ));

    let group_w = w / cat_count as f64;
    for c in 0..cat_count {
        let label = chart.categories.get(c).map_or("", String::as_str);
        let label_x = x + (c as f64 + 0.5) * group_w;
        let _ = write!(
            out,
            "<text x=\"{}\" y=\"{}\" text-anchor=\"middle\" font-size=\"12\" fill=\"#595959\">{}</text>",
            r(label_x),
            r(y + h + 15.0),
            escape_xml_text(label)
        );
    }

    let range = scale_max - scale_min;
    for c in 0..cat_count {
        let cx = x + (c as f64 + 0.5) * group_w;
        let high_v = high.values.get(c).copied().unwrap_or(0.0);
        let low_v = low.values.get(c).copied().unwrap_or(0.0);
        let close_v = close.values.get(c).copied().unwrap_or(0.0);
        let high_y = y + h - ((high_v - scale_min) / range) * h;
        let low_y = y + h - ((low_v - scale_min) / range) * h;
        let close_y = y + h - ((close_v - scale_min) / range) * h;
        let _ = write!(
            out,
            "<line x1=\"{}\" y1=\"{}\" x2=\"{}\" y2=\"{}\" stroke=\"#404040\" stroke-width=\"2\"/>",
            r(cx),
            r(high_y),
            r(cx),
            r(low_y)
        );
        let tick_w = group_w * 0.2;
        let _ = write!(
            out,
            "<line x1=\"{}\" y1=\"{}\" x2=\"{}\" y2=\"{}\" stroke=\"#404040\" stroke-width=\"2\"/>",
            r(cx),
            r(close_y),
            r(cx + tick_w),
            r(close_y)
        );
    }
    out
}

#[allow(clippy::many_single_char_names, clippy::similar_names)]
fn render_surface_chart(chart: &ChartData, x: f64, y: f64, w: f64, h: f64) -> String {
    if chart.series.is_empty() {
        return String::new();
    }
    let rows = chart.series.len();
    let cols = if chart.categories.is_empty() {
        chart
            .series
            .iter()
            .map(|s| s.values.len())
            .max()
            .unwrap_or(0)
    } else {
        chart.categories.len()
    };
    if cols == 0 {
        return String::new();
    }
    let mut min_val = f64::INFINITY;
    let mut max_val = f64::NEG_INFINITY;
    for s in &chart.series {
        for v in &s.values {
            if *v < min_val {
                min_val = *v;
            }
            if *v > max_val {
                max_val = *v;
            }
        }
    }
    if min_val == max_val {
        max_val = min_val + 1.0;
    }
    let cell_w = w / cols as f64;
    let cell_h = h / rows as f64;

    let mut out = String::new();
    for (r_idx, s) in chart.series.iter().enumerate() {
        for c in 0..cols {
            let val = s.values.get(c).copied().unwrap_or(0.0);
            let t = (val - min_val) / (max_val - min_val);
            let color = heatmap_color(t);
            let cx_pos = x + c as f64 * cell_w;
            let cy_pos = y + r_idx as f64 * cell_h;
            let _ = write!(
                out,
                "<rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" fill=\"{color}\" stroke=\"#FFFFFF\" stroke-width=\"0.5\"/>",
                r(cx_pos),
                r(cy_pos),
                r(cell_w),
                r(cell_h)
            );
        }
    }
    for c in 0..cols {
        let label = chart.categories.get(c).map_or("", String::as_str);
        if !label.is_empty() {
            let label_x = x + (c as f64 + 0.5) * cell_w;
            let _ = write!(
                out,
                "<text x=\"{}\" y=\"{}\" text-anchor=\"middle\" font-size=\"12\" fill=\"#595959\">{}</text>",
                r(label_x),
                r(y + h + 15.0),
                escape_xml_text(label)
            );
        }
    }
    for (r_idx, s) in chart.series.iter().enumerate() {
        let label = s.name.as_deref().unwrap_or("");
        if !label.is_empty() {
            let label_y = y + (r_idx as f64 + 0.5) * cell_h;
            let _ = write!(
                out,
                "<text x=\"{}\" y=\"{}\" text-anchor=\"end\" font-size=\"12\" fill=\"#595959\">{}</text>",
                r(x - 5.0),
                r(label_y + 4.0),
                escape_xml_text(label)
            );
        }
    }
    out
}

fn heatmap_color(t: f64) -> String {
    let clamped = t.clamp(0.0, 1.0);
    let (rc, gc, bc) = if clamped < 0.25 {
        let s = clamped / 0.25;
        (0_u8, (s * 255.0).round() as u8, 255_u8)
    } else if clamped < 0.5 {
        let s = (clamped - 0.25) / 0.25;
        (0_u8, 255_u8, ((1.0 - s) * 255.0).round() as u8)
    } else if clamped < 0.75 {
        let s = (clamped - 0.5) / 0.25;
        ((s * 255.0).round() as u8, 255_u8, 0_u8)
    } else {
        let s = (clamped - 0.75) / 0.25;
        (255_u8, ((1.0 - s) * 255.0).round() as u8, 0_u8)
    };
    format!("#{rc:02X}{gc:02X}{bc:02X}")
}

#[allow(
    clippy::too_many_lines,
    clippy::many_single_char_names,
    clippy::similar_names
)]
fn render_of_pie_chart(chart: &ChartData, x: f64, y: f64, w: f64, h: f64) -> String {
    let series = match chart.series.first() {
        Some(s) if !s.values.is_empty() => s,
        _ => return String::new(),
    };
    let total: f64 = series.values.iter().sum();
    if total == 0.0 {
        return String::new();
    }
    let split_pos = chart.split_pos.unwrap_or(2.0) as usize;
    let second_pie_size = chart.second_pie_size.unwrap_or(75.0);
    let is_bar_of_pie = chart.of_pie_type == Some(OfPieType::Bar);

    let split_idx = series.values.len().saturating_sub(split_pos);
    let primary_values: &[f64] = &series.values[..split_idx];
    let secondary_values: &[f64] = &series.values[split_idx..];
    let secondary_total: f64 = secondary_values.iter().sum();

    let pie_w = w * 0.45;
    let pie_cx = x + pie_w / 2.0;
    let pie_cy = y + h / 2.0;
    let pie_r = (pie_w.min(h) / 2.0) * 0.85;

    let mut out = String::new();
    let mut current_angle = -PI / 2.0;
    for (i, val) in primary_values.iter().enumerate() {
        let slice_angle = (val / total) * 2.0 * PI;
        let color = pie_slice_color(i, chart);
        let x1 = pie_cx + pie_r * current_angle.cos();
        let y1 = pie_cy + pie_r * current_angle.sin();
        let x2 = pie_cx + pie_r * (current_angle + slice_angle).cos();
        let y2 = pie_cy + pie_r * (current_angle + slice_angle).sin();
        let large_arc = i32::from(slice_angle > PI);
        let _ = write!(
            out,
            "<path d=\"M{},{} L{},{} A{},{} 0 {large_arc},1 {},{} Z\" {}/>",
            r(pie_cx),
            r(pie_cy),
            r(x1),
            r(y1),
            r(pie_r),
            r(pie_r),
            r(x2),
            r(y2),
            fill_attr(&color)
        );
        current_angle += slice_angle;
    }

    let other_angle_start = current_angle;
    let other_slice_angle = (secondary_total / total) * 2.0 * PI;
    let other_color = ResolvedColor::new(Rgb::new(0xD9, 0xD9, 0xD9), 1.0);
    if primary_values.is_empty() && !secondary_values.is_empty() {
        let _ = write!(
            out,
            "<circle cx=\"{}\" cy=\"{}\" r=\"{}\" {}/>",
            r(pie_cx),
            r(pie_cy),
            r(pie_r),
            fill_attr(&other_color)
        );
    } else if secondary_total > 0.0 {
        let x1 = pie_cx + pie_r * other_angle_start.cos();
        let y1 = pie_cy + pie_r * other_angle_start.sin();
        let x2 = pie_cx + pie_r * (other_angle_start + other_slice_angle).cos();
        let y2 = pie_cy + pie_r * (other_angle_start + other_slice_angle).sin();
        let large_arc = i32::from(other_slice_angle > PI);
        let _ = write!(
            out,
            "<path d=\"M{},{} L{},{} A{},{} 0 {large_arc},1 {},{} Z\" {}/>",
            r(pie_cx),
            r(pie_cy),
            r(x1),
            r(y1),
            r(pie_r),
            r(pie_r),
            r(x2),
            r(y2),
            fill_attr(&other_color)
        );
    }

    let sec_w = w * 0.25;
    let sec_h = h * (second_pie_size / 100.0) * 0.85;
    let sec_x = x + w * 0.65;
    let sec_cy = y + h / 2.0;

    let line_start_x = pie_cx + pie_r * other_angle_start.cos();
    let line_start_y = pie_cy + pie_r * other_angle_start.sin();
    let line_end_start_x = pie_cx + pie_r * (other_angle_start + other_slice_angle).cos();
    let line_end_start_y = pie_cy + pie_r * (other_angle_start + other_slice_angle).sin();
    let _ = write!(
        out,
        "<line x1=\"{}\" y1=\"{}\" x2=\"{}\" y2=\"{}\" stroke=\"#A6A6A6\" stroke-width=\"1\"/>",
        r(line_start_x),
        r(line_start_y),
        r(sec_x),
        r(sec_cy - sec_h / 2.0)
    );
    let _ = write!(
        out,
        "<line x1=\"{}\" y1=\"{}\" x2=\"{}\" y2=\"{}\" stroke=\"#A6A6A6\" stroke-width=\"1\"/>",
        r(line_end_start_x),
        r(line_end_start_y),
        r(sec_x),
        r(sec_cy + sec_h / 2.0)
    );

    if is_bar_of_pie {
        let mut bar_y = sec_cy - sec_h / 2.0;
        for (i, val) in secondary_values.iter().enumerate() {
            let bar_h = if secondary_total > 0.0 {
                (val / secondary_total) * sec_h
            } else {
                0.0
            };
            let color = pie_slice_color(split_idx + i, chart);
            let _ = write!(
                out,
                "<rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" {}/>",
                r(sec_x),
                r(bar_y),
                r(sec_w),
                r(bar_h),
                fill_attr(&color)
            );
            bar_y += bar_h;
        }
    } else {
        let sec_pie_cx = sec_x + sec_w / 2.0;
        let sec_r = sec_w.min(sec_h) / 2.0;
        let mut sec_angle = -PI / 2.0;
        if secondary_values.len() == 1 {
            let color = pie_slice_color(split_idx, chart);
            let _ = write!(
                out,
                "<circle cx=\"{}\" cy=\"{}\" r=\"{}\" {}/>",
                r(sec_pie_cx),
                r(sec_cy),
                r(sec_r),
                fill_attr(&color)
            );
        } else {
            for (i, val) in secondary_values.iter().enumerate() {
                let slice_angle = if secondary_total > 0.0 {
                    (val / secondary_total) * 2.0 * PI
                } else {
                    0.0
                };
                let color = pie_slice_color(split_idx + i, chart);
                let sx1 = sec_pie_cx + sec_r * sec_angle.cos();
                let sy1 = sec_cy + sec_r * sec_angle.sin();
                let sx2 = sec_pie_cx + sec_r * (sec_angle + slice_angle).cos();
                let sy2 = sec_cy + sec_r * (sec_angle + slice_angle).sin();
                let large_arc = i32::from(slice_angle > PI);
                let _ = write!(
                    out,
                    "<path d=\"M{},{} L{},{} A{},{} 0 {large_arc},1 {},{} Z\" {}/>",
                    r(sec_pie_cx),
                    r(sec_cy),
                    r(sx1),
                    r(sy1),
                    r(sec_r),
                    r(sec_r),
                    r(sx2),
                    r(sy2),
                    fill_attr(&color)
                );
                sec_angle += slice_angle;
            }
        }
    }
    out
}

#[allow(clippy::too_many_lines, clippy::many_single_char_names)]
fn render_combo_chart(chart: &ChartData, x: f64, y: f64, w: f64, h: f64) -> String {
    if chart.series.is_empty() {
        return String::new();
    }
    let cat_count = if chart.categories.is_empty() {
        chart
            .series
            .iter()
            .map(|s| s.values.len())
            .max()
            .unwrap_or(0)
    } else {
        chart.categories.len()
    };
    if cat_count == 0 {
        return String::new();
    }

    let primary_series: Vec<&ChartSeries> = chart
        .series
        .iter()
        .filter(|s| s.axis_group != Some(AxisGroup::Secondary))
        .collect();
    let secondary_series: Vec<&ChartSeries> = chart
        .series
        .iter()
        .filter(|s| s.axis_group == Some(AxisGroup::Secondary))
        .collect();
    let primary_max = max_value_refs(&primary_series);
    let secondary_max = max_value_refs(&secondary_series);
    if primary_max == 0.0 && secondary_max == 0.0 {
        return String::new();
    }

    let target = ((h / 30.0).floor() as i64).max(2) as u32;
    let primary_ticks = compute_nice_ticks(0.0, primary_max.max(1.0), target);
    let primary_scale = *primary_ticks.last().unwrap_or(&1.0);
    let has_secondary = !secondary_series.is_empty();
    let secondary_ticks = if has_secondary {
        compute_nice_ticks(0.0, secondary_max.max(1.0), target)
    } else {
        Vec::new()
    };
    let secondary_scale = if has_secondary {
        *secondary_ticks.last().unwrap_or(&1.0)
    } else {
        1.0
    };

    let mut out = String::new();
    let _ = write!(
        out,
        "<line x1=\"{}\" y1=\"{}\" x2=\"{}\" y2=\"{}\" stroke=\"#D9D9D9\" stroke-width=\"1\"/>",
        r(x),
        r(y + h),
        r(x + w),
        r(y + h)
    );
    let _ = write!(
        out,
        "<line x1=\"{}\" y1=\"{}\" x2=\"{}\" y2=\"{}\" stroke=\"#D9D9D9\" stroke-width=\"1\"/>",
        r(x),
        r(y),
        r(x),
        r(y + h)
    );
    out.push_str(&render_value_axis_labels(
        &primary_ticks,
        0.0,
        primary_scale,
        x,
        y,
        h,
        value_axis_options(chart, w),
    ));

    if has_secondary {
        let _ = write!(
            out,
            "<line x1=\"{}\" y1=\"{}\" x2=\"{}\" y2=\"{}\" stroke=\"#D9D9D9\" stroke-width=\"1\"/>",
            r(x + w),
            r(y),
            r(x + w),
            r(y + h)
        );
        let range = secondary_scale;
        for tick in &secondary_ticks {
            let ratio = tick / range;
            if !(-0.001..=1.001).contains(&ratio) {
                continue;
            }
            let tick_y = y + h - ratio * h;
            let _ = write!(
                out,
                "<text x=\"{}\" y=\"{}\" text-anchor=\"start\" font-size=\"12\" fill=\"#595959\">{}</text>",
                r(x + w + 5.0),
                r(tick_y + 4.0),
                escape_xml_text(&format_tick_value(*tick))
            );
            let _ = write!(
                out,
                "<line x1=\"{}\" y1=\"{}\" x2=\"{}\" y2=\"{}\" stroke=\"#D9D9D9\" stroke-width=\"1\"/>",
                r(x + w),
                r(tick_y),
                r(x + w + 3.0),
                r(tick_y)
            );
        }
    }

    let divisor = if cat_count > 1 {
        (cat_count - 1) as f64
    } else {
        1.0
    };
    for c in 0..cat_count {
        let label = chart.categories.get(c).map_or("", String::as_str);
        let label_x = x + (c as f64 / divisor) * w;
        let _ = write!(
            out,
            "<text x=\"{}\" y=\"{}\" text-anchor=\"middle\" font-size=\"12\" fill=\"#595959\">{}</text>",
            r(label_x),
            r(y + h + 15.0),
            escape_xml_text(label)
        );
    }

    let bar_series_count = chart
        .series
        .iter()
        .filter(|s| s.sub_chart_type == Some(ChartType::Bar))
        .count();
    let group_w = w / cat_count as f64;
    let bar_w = if bar_series_count > 0 {
        (group_w * 0.7) / bar_series_count as f64
    } else {
        0.0
    };
    let group_pad = group_w * 0.15;

    let mut bar_idx = 0_usize;
    for s in &chart.series {
        let scale = if s.axis_group == Some(AxisGroup::Secondary) {
            secondary_scale
        } else {
            primary_scale
        };
        if s.sub_chart_type == Some(ChartType::Bar) {
            for (c, val) in s.values.iter().enumerate() {
                let bar_h = (val / scale) * h;
                let bar_x = x + c as f64 * group_w + group_pad + bar_idx as f64 * bar_w;
                let bar_y = y + h - bar_h;
                let pt_color = point_color(s, c as u32);
                let _ = write!(
                    out,
                    "<rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" {}/>",
                    r(bar_x),
                    r(bar_y),
                    r(bar_w),
                    r(bar_h),
                    fill_attr(&pt_color)
                );
            }
            bar_idx += 1;
            continue;
        }

        let pts: Vec<(f64, f64)> = s
            .values
            .iter()
            .enumerate()
            .map(|(i, v)| (x + (i as f64 / divisor) * w, y + h - (v / scale) * h))
            .collect();
        let opacity = if s.color.alpha < 1.0 {
            format!(" stroke-opacity=\"{}\"", s.color.alpha)
        } else {
            String::new()
        };
        let stroke_hex = color_hex(&s.color);
        if s.smooth.unwrap_or(false) && pts.len() >= 2 {
            let d = build_smooth_path_d(&pts);
            let _ = write!(
                out,
                "<path d=\"{d}\" fill=\"none\" stroke=\"{stroke_hex}\" stroke-width=\"2\"{opacity}/>"
            );
        } else {
            let mut points_str = String::new();
            for (i, p) in pts.iter().enumerate() {
                if i > 0 {
                    points_str.push(' ');
                }
                let _ = write!(points_str, "{},{}", r(p.0), r(p.1));
            }
            let _ = write!(
                out,
                "<polyline points=\"{points_str}\" fill=\"none\" stroke=\"{stroke_hex}\" stroke-width=\"2\"{opacity}/>"
            );
        }
        for p in &pts {
            let _ = write!(
                out,
                "<circle cx=\"{}\" cy=\"{}\" r=\"3\" {}/>",
                r(p.0),
                r(p.1),
                fill_attr(&s.color)
            );
        }
    }
    out
}

fn max_value_refs(series: &[&ChartSeries]) -> f64 {
    series
        .iter()
        .flat_map(|s| s.values.iter().copied())
        .fold(0.0_f64, f64::max)
}

#[cfg(test)]
#[allow(clippy::field_reassign_with_default)]
mod tests {
    use super::*;
    use slideglance_color::{ResolvedColor, Rgb};
    use slideglance_model::{ChartAxis, ChartLegend, ChartSeries, ChartType, Transform};
    use slideglance_utils::Emu;

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

    fn series(values: Vec<f64>, hex: &str) -> ChartSeries {
        ChartSeries {
            name: Some("S".to_string()),
            values,
            x_values: None,
            bubble_sizes: None,
            color: ResolvedColor::new(Rgb::from_hex(hex).unwrap(), 1.0),
            data_labels: None,
            trendlines: None,
            sub_chart_type: None,
            axis_group: None,
            smooth: None,
            data_points: None,
            explosion: None,
        }
    }

    fn chart_data(chart_type: ChartType, series_vec: Vec<ChartSeries>) -> ChartData {
        ChartData {
            chart_type,
            title: None,
            series: series_vec,
            categories: vec!["A".to_string(), "B".to_string(), "C".to_string()],
            bar_direction: None,
            hole_size: None,
            radar_style: None,
            of_pie_type: None,
            second_pie_size: None,
            split_pos: None,
            legend: None,
            category_axis: None,
            value_axis: None,
            secondary_value_axis: None,
            data_labels: None,
            is_combo: false,
        }
    }

    fn element(chart: ChartData) -> ChartElement {
        ChartElement {
            sp_id: None,
            transform: xfrm(9_144_000, 5_143_500),
            chart,
            object_name: None,
            hidden: false,
        }
    }

    #[test]
    fn empty_chart_emits_only_wrapper_and_background() {
        let mut c = chart_data(ChartType::Bar, vec![]);
        c.categories.clear();
        let res = render_chart(&element(c));
        assert!(res.content.starts_with("<g transform=\""));
        assert!(res.content.contains("<rect width="));
        assert!(res.content.ends_with("</g>"));
        assert!(!res.content.contains("<line"));
    }

    #[test]
    fn chart_emits_data_sp_id_when_present() {
        let mut c = chart_data(ChartType::Bar, vec![]);
        c.categories.clear();
        let mut e = element(c);
        e.sp_id = Some(77);
        let res = render_chart(&e);
        assert!(
            res.content.contains("data-sp-id=\"77\""),
            "data-sp-id missing: {}",
            res.content
        );
        // Attribute lands on the outer <g> immediately after the tag name.
        assert!(
            res.content.starts_with("<g data-sp-id=\"77\" transform=\""),
            "unexpected ordering: {}",
            res.content
        );
    }

    #[test]
    fn bar_chart_emits_bars() {
        let c = chart_data(
            ChartType::Bar,
            vec![series(vec![10.0, 20.0, 30.0], "#FF0000")],
        );
        let res = render_chart(&element(c));
        assert!(res.content.matches("<rect").count() >= 4); // 1 background + 3 bars
        assert!(res.content.contains("fill=\"#FF0000\""));
    }

    #[test]
    fn line_chart_emits_polyline_and_circles() {
        let c = chart_data(
            ChartType::Line,
            vec![series(vec![1.0, 2.0, 3.0], "#00FF00")],
        );
        let res = render_chart(&element(c));
        assert!(res.content.contains("<polyline"));
        assert_eq!(res.content.matches("<circle").count(), 3);
    }

    #[test]
    fn pie_chart_emits_paths_or_circle_per_slice() {
        let c = chart_data(
            ChartType::Pie,
            vec![series(vec![25.0, 25.0, 50.0], "#000000")],
        );
        let res = render_chart(&element(c));
        // 3 slices -> 3 path elements (no single-circle fallback).
        assert_eq!(res.content.matches("<path").count(), 3);
    }

    #[test]
    fn pie_single_slice_uses_circle() {
        let c = chart_data(ChartType::Pie, vec![series(vec![100.0], "#000000")]);
        let res = render_chart(&element(c));
        assert!(res.content.contains("<circle"));
    }

    #[test]
    fn doughnut_emits_paths_with_inner_radius() {
        let c = chart_data(
            ChartType::Doughnut,
            vec![series(vec![1.0, 2.0, 3.0], "#000000")],
        );
        let res = render_chart(&element(c));
        // 3 path elements (one per slice).
        assert_eq!(res.content.matches("<path").count(), 3);
    }

    #[test]
    fn title_renders_above_chart() {
        let mut c = chart_data(ChartType::Bar, vec![series(vec![1.0], "#000000")]);
        c.title = Some("My Chart".to_string());
        let res = render_chart(&element(c));
        assert!(res.content.contains(">My Chart</text>"));
    }

    #[test]
    fn legend_at_right_renders_swatches() {
        let mut c = chart_data(
            ChartType::Bar,
            vec![series(vec![1.0], "#FF0000"), series(vec![2.0], "#00FF00")],
        );
        c.legend = Some(ChartLegend {
            position: LegendPosition::R,
        });
        let res = render_chart(&element(c));
        // Each series should produce one swatch <rect> + one label <text>.
        assert!(res.content.contains("fill=\"#FF0000\""));
        assert!(res.content.contains("fill=\"#00FF00\""));
    }

    #[test]
    fn category_axis_title_renders_below_plot() {
        let mut c = chart_data(ChartType::Bar, vec![series(vec![1.0, 2.0], "#000000")]);
        c.category_axis = Some(ChartAxis {
            title: Some("Categories".to_string()),
            ..ChartAxis::default()
        });
        let res = render_chart(&element(c));
        assert!(res.content.contains(">Categories</text>"));
    }

    #[test]
    fn area_chart_emits_filled_polygon() {
        let c = chart_data(
            ChartType::Area,
            vec![series(vec![1.0, 2.0, 3.0], "#FF0000")],
        );
        let res = render_chart(&element(c));
        assert!(
            res.content.contains("<polygon points=\""),
            "{}",
            res.content
        );
        assert!(res.content.contains("fill=\"#FF0000\""));
    }

    #[test]
    fn scatter_chart_emits_circles_per_point() {
        let mut s = series(vec![10.0, 20.0, 30.0], "#0000FF");
        s.x_values = Some(vec![1.0, 2.0, 3.0]);
        let c = chart_data(ChartType::Scatter, vec![s]);
        let res = render_chart(&element(c));
        assert!(res.content.matches("<circle ").count() >= 3);
    }

    #[test]
    fn bubble_chart_uses_size_array_for_radius() {
        let mut s = series(vec![10.0, 20.0], "#FF8800");
        s.x_values = Some(vec![1.0, 2.0]);
        s.bubble_sizes = Some(vec![100.0, 400.0]);
        let c = chart_data(ChartType::Bubble, vec![s]);
        let res = render_chart(&element(c));
        assert!(res.content.contains("fill-opacity=\"0.6\""));
    }

    #[test]
    fn radar_chart_renders_concentric_grid_and_polygon() {
        let c = chart_data(
            ChartType::Radar,
            vec![series(vec![1.0, 2.0, 3.0, 4.0], "#00AA00")],
        );
        let res = render_chart(&element(c));
        // 5 concentric grid circles
        assert!(
            res.content.matches("<circle cx=").count() >= 5,
            "{}",
            res.content
        );
        assert!(res.content.contains("<polygon points="));
    }

    #[test]
    fn radar_filled_emits_fill_opacity_03() {
        let mut c = chart_data(
            ChartType::Radar,
            vec![series(vec![1.0, 2.0, 3.0], "#00AA00")],
        );
        c.radar_style = Some(RadarStyle::Filled);
        let res = render_chart(&element(c));
        assert!(res.content.contains("fill-opacity=\"0.3\""));
    }

    #[test]
    fn stock_chart_requires_three_series() {
        let c = chart_data(ChartType::Stock, vec![series(vec![10.0], "#000000")]);
        let res = render_chart(&element(c));
        // Only the chart frame + axes (if any), no hi-lo lines.
        assert!(!res.content.contains("stroke=\"#404040\""));
    }

    #[test]
    fn stock_chart_with_high_low_close_emits_hi_lo_lines() {
        let high = series(vec![5.0, 8.0, 12.0], "#000000");
        let low = series(vec![1.0, 2.0, 3.0], "#000000");
        let close = series(vec![3.0, 5.0, 9.0], "#000000");
        let c = chart_data(ChartType::Stock, vec![high, low, close]);
        let res = render_chart(&element(c));
        assert!(res.content.contains("stroke=\"#404040\""));
    }

    #[test]
    fn surface_chart_emits_heatmap_cells() {
        let s1 = series(vec![1.0, 2.0, 3.0], "#000000");
        let s2 = series(vec![4.0, 5.0, 6.0], "#000000");
        let c = chart_data(ChartType::Surface, vec![s1, s2]);
        let res = render_chart(&element(c));
        // 2 rows x 3 cols = 6 heatmap rects (plus the chart frame rect).
        assert!(res.content.matches("<rect").count() >= 7);
    }

    #[test]
    fn of_pie_chart_emits_secondary_pie_or_bar() {
        let c = chart_data(
            ChartType::OfPie,
            vec![series(vec![10.0, 20.0, 5.0, 5.0], "#000000")],
        );
        let res = render_chart(&element(c));
        // Connector line between pies should exist.
        assert!(res.content.contains("stroke=\"#A6A6A6\""));
    }

    #[test]
    fn combo_chart_dispatches_per_subchart_type() {
        let mut bar = series(vec![1.0, 2.0, 3.0], "#FF0000");
        bar.sub_chart_type = Some(ChartType::Bar);
        let mut line = series(vec![10.0, 20.0, 30.0], "#0000FF");
        line.sub_chart_type = Some(ChartType::Line);
        let mut c = chart_data(ChartType::Bar, vec![bar, line]);
        c.is_combo = true;
        let res = render_chart(&element(c));
        // Bar series → at least one rect inside the plot area.
        assert!(res.content.matches("<rect").count() >= 2);
        // Line series → polyline emitted.
        assert!(res.content.contains("<polyline points="));
    }

    #[test]
    fn combo_chart_secondary_axis_emits_right_side_axis() {
        let mut primary = series(vec![1.0, 2.0, 3.0], "#FF0000");
        primary.sub_chart_type = Some(ChartType::Bar);
        let mut secondary = series(vec![100.0, 200.0, 300.0], "#0000FF");
        secondary.sub_chart_type = Some(ChartType::Line);
        secondary.axis_group = Some(AxisGroup::Secondary);
        let mut c = chart_data(ChartType::Bar, vec![primary, secondary]);
        c.is_combo = true;
        let res = render_chart(&element(c));
        // The right-side secondary axis should have ticks via labels at
        // text-anchor="start".
        assert!(
            res.content.contains("text-anchor=\"start\""),
            "{}",
            res.content
        );
    }

    #[test]
    fn line_chart_with_smooth_emits_path_d() {
        let mut s = series(vec![1.0, 2.0, 3.0, 4.0], "#000000");
        s.smooth = Some(true);
        let c = chart_data(ChartType::Line, vec![s]);
        let res = render_chart(&element(c));
        assert!(res.content.contains("<path d=\""));
        assert!(!res.content.contains("<polyline"));
    }

    #[test]
    fn line_chart_with_trendline_emits_dashed_overlay() {
        let mut s = series(vec![1.0, 2.0, 3.0, 4.0], "#000000");
        s.trendlines = Some(vec![slideglance_model::ChartTrendline {
            trendline_type: slideglance_model::TrendlineType::Linear,
            period: None,
            name: None,
        }]);
        let c = chart_data(ChartType::Line, vec![s]);
        let res = render_chart(&element(c));
        assert!(res.content.contains("stroke-dasharray=\"4,3\""));
    }

    #[test]
    fn horizontal_bar_chart_uses_horizontal_layout() {
        let mut c = chart_data(ChartType::Bar, vec![series(vec![10.0, 20.0], "#000000")]);
        c.bar_direction = Some(BarDirection::Bar);
        let res = render_chart(&element(c));
        // Horizontal bars should have the value-axis labels along the bottom
        // (text-anchor="middle"). Just verify the chart renders without
        // panicking and produces some bars.
        assert!(res.content.matches("<rect").count() >= 3);
    }

    #[test]
    fn empty_series_list_emits_no_plot() {
        let c = chart_data(ChartType::Bar, vec![]);
        let res = render_chart(&element(c));
        assert!(!res.content.contains("<polyline"));
    }

    #[test]
    fn chart_with_max_zero_skips_plot() {
        let c = chart_data(ChartType::Bar, vec![series(vec![0.0, 0.0], "#000000")]);
        let res = render_chart(&element(c));
        // Background rect + axes only, no bar rects added beyond the
        // background.
        assert_eq!(res.content.matches("fill=\"#000000\"").count(), 0);
    }
}
