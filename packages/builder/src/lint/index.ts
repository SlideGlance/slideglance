import type { Diagnostic } from "../diagnostics.ts";
import type { PositionedNode } from "../types.ts";
import type { LintContext, LintOptions, LintReport } from "./types.ts";
import type { TextMeasurer } from "../calcYogaLayout/fontLoader.ts";
import { runLintRules } from "./runner.ts";
import { formatStdout } from "./output/stdout.ts";
import { buildJsonReport } from "./output/json.ts";

export type {
  LintContext,
  LintOptions,
  LintReport,
  LintRule,
  LintOutput,
  LintPhase,
} from "./types.ts";
export { runLintRules };
export { formatStdout };
export { buildJsonReport };

/**
 * Inputs the builder collects across the parse pass that the lint
 * runner needs at post-layout time.
 */
export interface DeckLintInputs {
  declaredStyles?: Set<string>;
  referencedStyles?: Set<string>;
  declaredTemplates?: Set<string>;
  referencedTemplates?: Set<string>;
  /**
   * Per-build text measurer threaded into every rule's LintContext.
   * When omitted, overflow-checking rules use the bundled-fonts
   * singleton (still opentype-accurate for Pretendard / Noto Sans JP
   * and their substitution path for unknown families).
   */
  measurer?: TextMeasurer;
}

/**
 * Run all enabled lint rules against the rendered slide trees. Returns
 * the merged diagnostics list plus an optional JSON report. The runner
 * never throws — failing rules degrade to info-severity diagnostics.
 */
export function lintDeck(
  slides: readonly {
    root: PositionedNode;
    slideSize: { w: number; h: number };
  }[],
  options: LintOptions,
  inputs: DeckLintInputs = {},
): { diagnostics: Diagnostic[]; report: LintReport } {
  if (options.enabled === false) {
    return {
      diagnostics: [],
      report: buildJsonReport([], slides.length),
    };
  }
  const all: Diagnostic[] = [];
  slides.forEach((slide, i) => {
    const ctx: LintContext = {
      tree: slide.root,
      slideIndex: i + 1,
      slideSize: slide.slideSize,
      declaredStyles: inputs.declaredStyles,
      referencedStyles: inputs.referencedStyles,
      declaredTemplates: inputs.declaredTemplates,
      referencedTemplates: inputs.referencedTemplates,
      measurer: inputs.measurer,
      phase: "post-layout",
    };
    all.push(...runLintRules(ctx, options));
  });
  return {
    diagnostics: all,
    report: buildJsonReport(all, slides.length),
  };
}
