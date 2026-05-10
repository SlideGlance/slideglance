import type { TableNode } from "../types.ts";

const DEFAULT_TABLE_ROW_HEIGHT = 32;
const DEFAULT_TABLE_COLUMN_WIDTH = 100;

function numericWidth(
  w: string | number | undefined,
  fallback: number,
): number {
  if (typeof w === "number") return w;
  return fallback;
}

export function calcTableIntrinsicSize(node: TableNode) {
  const width = node.columns.reduce(
    (sum, column) =>
      sum + numericWidth(column.w ?? column.width, DEFAULT_TABLE_COLUMN_WIDTH),
    0,
  );
  const height = resolveRowHeights(node).reduce((sum, h) => sum + h, 0);

  return { width, height };
}

export function resolveRowHeights(node: TableNode) {
  const fallbackRowHeight = node.defaultRowHeight ?? DEFAULT_TABLE_ROW_HEIGHT;
  return node.rows.map((row) => {
    const h = row.h ?? row.height;
    return typeof h === "number" ? h : fallbackRowHeight;
  });
}

/**
 * Resolves the width of each table column.
 * - Columns with an explicit width use that value.
 * - Columns without a width share the remaining space equally.
 */
export function resolveColumnWidths(
  node: TableNode,
  tableWidth: number,
): number[] {
  const specifiedTotal = node.columns.reduce(
    (sum, col) => sum + numericWidth(col.w ?? col.width, 0),
    0,
  );
  const unspecifiedCount = node.columns.filter(
    (col) => (col.w ?? col.width) === undefined,
  ).length;

  // Calculate remaining width for columns without explicit widths
  const remainingWidth = Math.max(0, tableWidth - specifiedTotal);
  const widthPerUnspecified =
    unspecifiedCount > 0 ? remainingWidth / unspecifiedCount : 0;

  return node.columns.map((col) =>
    numericWidth(col.w ?? col.width, widthPerUnspecified),
  );
}
