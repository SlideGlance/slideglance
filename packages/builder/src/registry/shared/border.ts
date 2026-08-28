/**
 * Border atoms: dash type enum + composite border style.
 */

import { z } from "zod";

export const borderDashSchema = z.enum([
  "solid",
  "dash",
  "dashDot",
  "lgDash",
  "lgDashDot",
  "lgDashDotDot",
  "sysDash",
  "sysDot",
]);

export const borderStyleSchema = z.object({
  color: z.string().optional(),
  width: z.number().optional(),
  dashType: borderDashSchema.optional(),
});

/**
 * Which cell borders a table draws. "all" is the full grid; "no-outer-vertical"
 * keeps the grid but opens the table's left and right edges (the editorial
 * open-side table); "horizontal-only" keeps only the horizontal rules.
 */
export const cellBorderSidesSchema = z.enum([
  "all",
  "no-outer-vertical",
  "horizontal-only",
]);

export type BorderDash = z.infer<typeof borderDashSchema>;
export type BorderStyle = z.infer<typeof borderStyleSchema>;
export type CellBorderSides = z.infer<typeof cellBorderSidesSchema>;
