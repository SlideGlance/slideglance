import type { Diagnostic } from "../../diagnostics.ts";
import type { LintReport } from "../types.ts";

/**
 * Build a stable, LLM-readable JSON report. Schema versioned as `version: 1`.
 */
export function buildJsonReport(
  diags: readonly Diagnostic[],
  slideCount: number,
): LintReport {
  const summary = { error: 0, warn: 0, info: 0 };
  for (const d of diags) summary[d.severity ?? "warn"]++;
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    slideCount,
    summary,
    diagnostics: [...diags],
  };
}
