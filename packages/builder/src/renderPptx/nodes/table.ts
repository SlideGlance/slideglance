import type { PositionedNode } from "../../types.ts";
import type { RenderContext } from "../types.ts";
import { resolveFontFamily } from "../../defaultTextStyle.ts";
import {
  resolveColumnWidths,
  resolveRowHeights,
} from "../../shared/tableUtils.ts";
import { pxToIn, pxToPt } from "../units.ts";
import { convertUnderline, convertStrike } from "../textOptions.ts";
import { getContentArea } from "../utils/contentArea.ts";
import { renderObjectName } from "../utils/objectName.ts";
import { validateHref } from "../utils/href.ts";

type TablePositionedNode = Extract<PositionedNode, { type: "table" }>;

// Default cell margin in px. Converted to pt per pptxgenjs expectation.
// ~0.05in vertical / ~0.1in horizontal matches PowerPoint's default table margin.
const DEFAULT_CELL_MARGIN_PX: [number, number, number, number] = [5, 10, 5, 10];

type MarginInput =
  | number
  | { top?: number; right?: number; bottom?: number; left?: number }
  | undefined;

function resolveCellMarginPt(
  cellMargin: MarginInput,
  tableMargin: MarginInput,
): [number, number, number, number] {
  const [dt, dr, db, dl] = DEFAULT_CELL_MARGIN_PX;
  const pick = (
    m: MarginInput,
    fallback: [number, number, number, number],
  ): [number, number, number, number] => {
    if (m === undefined) return fallback;
    if (typeof m === "number") return [m, m, m, m];
    return [
      m.top ?? fallback[0],
      m.right ?? fallback[1],
      m.bottom ?? fallback[2],
      m.left ?? fallback[3],
    ];
  };
  const tableResolved = pick(tableMargin, [dt, dr, db, dl]);
  const cellResolved = pick(cellMargin, tableResolved);
  return [
    pxToPt(cellResolved[0]),
    pxToPt(cellResolved[1]),
    pxToPt(cellResolved[2]),
    pxToPt(cellResolved[3]),
  ];
}

type TableRowNode = TablePositionedNode["rows"][number];
type TableCellNode = TableRowNode["cells"][number];
type TableColumnNode = TablePositionedNode["columns"][number];
type BorderSpec = { color: string; pt: number; type: string } | { type: "none" };

/** Where a cell actually sits once spans are accounted for. */
interface CellPlacement {
  col: number;
  colspan: number;
}

/**
 * Maps every authored cell to its real column.
 *
 * A cell's column is not its index in the row: an earlier colspan pushes
 * it right, and a rowspan from a row above occupies a column without
 * appearing in this row's cell list at all. Both the column-level style
 * lookup and the table-edge border decision need the true column, so the
 * occupancy grid is walked once and shared.
 */
function placeCells(node: TablePositionedNode): CellPlacement[][] {
  const nCols = node.columns.length;
  const nRows = node.rows.length;
  const occupied: boolean[][] = Array.from({ length: nRows }, () =>
    new Array<boolean>(nCols).fill(false),
  );

  return node.rows.map((row, ri) => {
    let col = 0;
    return row.cells.map((cell) => {
      while (col < nCols && occupied[ri]?.[col]) col++;
      const colspan = Math.max(1, cell.colspan ?? 1);
      const rowspan = Math.max(1, cell.rowspan ?? 1);
      for (let r = ri; r < Math.min(ri + rowspan, nRows); r++) {
        for (let c = col; c < Math.min(col + colspan, nCols); c++) {
          const flags = occupied[r];
          if (flags) flags[c] = true;
        }
      }
      const placement = { col, colspan };
      col += colspan;
      return placement;
    });
  });
}

/**
 * Resolves one cell's text styling down the chain
 * cell → row → column → table → the deck's default text style.
 *
 * Without the chain every attribute has to be repeated on every `<Td>`,
 * which is how a ten-row table ends up setting `fontSize` thirty times.
 */
function resolveCellStyle(
  cell: TableCellNode,
  row: TableRowNode,
  column: TableColumnNode | undefined,
  node: TablePositionedNode,
  defaultTextStyle: RenderContext["buildContext"]["defaultTextStyle"] | undefined,
) {
  const fontSizePx =
    cell.fontSize ??
    row.fontSize ??
    column?.fontSize ??
    node.fontSize ??
    defaultTextStyle?.fontSize ??
    18;
  const fontFamily = resolveFontFamily(
    cell.fontFamily ?? row.fontFamily ?? column?.fontFamily ?? node.fontFamily,
    defaultTextStyle,
  );
  return {
    fontSizePx,
    fontFamily,
    color:
      cell.color ??
      row.color ??
      column?.color ??
      node.color ??
      defaultTextStyle?.color,
    bold:
      cell.bold ?? row.bold ?? column?.bold ?? node.bold ?? defaultTextStyle?.bold,
    italic:
      cell.italic ??
      row.italic ??
      column?.italic ??
      node.italic ??
      defaultTextStyle?.italic,
    underline: cell.underline ?? row.underline ?? column?.underline ?? node.underline,
    strike: cell.strike ?? row.strike ?? column?.strike ?? node.strike,
    highlight: cell.highlight ?? row.highlight ?? column?.highlight ?? node.highlight,
    textAlign:
      cell.textAlign ?? row.textAlign ?? column?.textAlign ?? node.textAlign ?? "left",
    verticalAlign:
      cell.verticalAlign ??
      row.verticalAlign ??
      column?.verticalAlign ??
      node.verticalAlign ??
      "middle",
    letterSpacing:
      cell.letterSpacing ??
      row.letterSpacing ??
      column?.letterSpacing ??
      node.letterSpacing,
  };
}

/**
 * Fill for one cell: the cell's own, else its row's, else its column's,
 * else the banding stripe. Banding is weakest so an explicit fill on a
 * header row or a highlighted column always wins.
 */
function resolveCellFill(
  cell: TableCellNode,
  row: TableRowNode,
  column: TableColumnNode | undefined,
  node: TablePositionedNode,
  rowIndex: number,
): string | undefined {
  const explicit =
    cell.backgroundColor ?? row.backgroundColor ?? column?.backgroundColor;
  if (explicit) return explicit;
  if (!node.bandedRowFill) return undefined;
  const bodyIndex = rowIndex - (node.headerRows ?? 0);
  // Stripe the second body row and every other one after it, so the
  // first body row keeps the table's own background.
  return bodyIndex >= 0 && bodyIndex % 2 === 1 ? node.bandedRowFill : undefined;
}

function toBorderSpec(border: {
  color?: string;
  width?: number;
  dashType?: string;
}): BorderSpec {
  return {
    color: border.color ?? "000000",
    pt: border.width !== undefined ? pxToPt(border.width) : 1,
    type: border.dashType ?? "solid",
  };
}

/**
 * The four borders of one cell, in pptxgenjs order [top, right, bottom,
 * left].
 *
 * Three things stack here. `cellBorder` draws the grid;
 * `cellBorderSides` removes verticals — either the table's outer pair or
 * all of them, which is why the cell's true column matters; and a cell's
 * own `borderTop` / `borderRight` / `borderBottom` / `borderLeft`
 * overrides a single edge, the only way to draw a rule above a totals
 * row. Returns undefined when nothing sets a border, leaving pptxgenjs
 * its own default.
 */
function resolveCellBorders(
  cell: TableCellNode,
  node: TablePositionedNode,
  placement: CellPlacement,
): BorderSpec[] | undefined {
  const perEdge = [
    cell.borderTop,
    cell.borderRight,
    cell.borderBottom,
    cell.borderLeft,
  ];
  const hasPerEdge = perEdge.some((b) => b !== undefined);
  if (!node.cellBorder && !hasPerEdge) return undefined;

  const none: BorderSpec = { type: "none" };
  const base: BorderSpec = node.cellBorder
    ? toBorderSpec(node.cellBorder)
    : none;

  const sides = node.cellBorderSides ?? "all";
  const dropVerticals = sides === "horizontal-only";
  const atLeftEdge = placement.col === 0;
  const atRightEdge = placement.col + placement.colspan >= node.columns.length;
  const openOuter = sides === "no-outer-vertical";

  const left = dropVerticals || (openOuter && atLeftEdge) ? none : base;
  const right = dropVerticals || (openOuter && atRightEdge) ? none : base;
  const resolved: BorderSpec[] = [base, right, base, left];

  perEdge.forEach((border, i) => {
    if (border) resolved[i] = toBorderSpec(border);
  });
  return resolved;
}

export function renderTableNode(
  node: TablePositionedNode,
  ctx: RenderContext,
): void {
  const defaultTextStyle = ctx.buildContext?.defaultTextStyle;
  const placements = placeCells(node);
  const tableRows = node.rows.map((row, ri) =>
    row.cells.map((cell, ci) => {
      const placement = placements[ri]?.[ci] ?? { col: ci, colspan: 1 };
      const column = node.columns[placement.col];
      const style = resolveCellStyle(cell, row, column, node, defaultTextStyle);
      const fill = resolveCellFill(cell, row, column, node, ri);
      const borders = resolveCellBorders(cell, node, placement);
      const cellMarginPt = resolveCellMarginPt(
        cell.padding ?? cell.margin,
        node.cellMargin,
      );
      const charSpacing =
        style.letterSpacing !== undefined ? style.letterSpacing * 100 : undefined;

      const cellOptions: Record<string, unknown> = {
        fontSize: pxToPt(style.fontSizePx),
        fontFace: style.fontFamily,
        color: style.color,
        bold: style.bold,
        italic: style.italic,
        underline: convertUnderline(style.underline),
        strike: convertStrike(style.strike),
        highlight: style.highlight,
        align: style.textAlign,
        valign: style.verticalAlign,
        fill: fill ? { color: fill } : undefined,
        colspan: cell.colspan,
        rowspan: cell.rowspan,
        margin: cellMarginPt,
        charSpacing,
        ...(borders ? { border: borders } : {}),
      };

      if (cell.runs && cell.runs.length > 0) {
        const textItems = cell.runs.map((run) => {
          const validatedHref = run.href
            ? validateHref(
                run.href,
                ctx.buildContext.security.allowedHrefSchemes,
                ctx,
              )
            : undefined;
          return {
            text: run.text,
            options: {
              fontSize: pxToPt(style.fontSizePx),
              fontFace: style.fontFamily,
              color: run.color ?? style.color,
              bold: run.bold ?? style.bold,
              italic: run.italic ?? style.italic,
              underline: convertUnderline(run.underline ?? style.underline),
              strike: convertStrike(run.strike ?? style.strike),
              highlight: run.highlight ?? style.highlight,
              charSpacing,
              ...(validatedHref ? { hyperlink: { url: validatedHref } } : {}),
            },
          };
        });
        return { text: textItems, options: cellOptions };
      }

      return {
        text: cell.text,
        options: cellOptions,
      };
    }),
  );

  const content = getContentArea(node);
  const objectName = renderObjectName(node, ctx);
  const tableOptions: Record<string, unknown> = {
    x: pxToIn(content.x),
    y: pxToIn(content.y),
    w: pxToIn(content.w),
    h: pxToIn(content.h),
    colW: resolveColumnWidths(node, content.w).map((width) => pxToIn(width)),
    rowH: resolveRowHeights(node).map((height) => pxToIn(height)),
    valign: "middle",
    ...(objectName ? { objectName } : {}),
  };

  // Per-cell border arrays already carry everything (grid, open sides,
  // per-edge overrides); the table-wide option would only fight them.
  if (node.cellBorder && !tableRows.some((row) => row.some((c) => c.options.border))) {
    tableOptions.border = toBorderSpec(node.cellBorder);
  }

  ctx.slide.addTable(tableRows, tableOptions);
}
