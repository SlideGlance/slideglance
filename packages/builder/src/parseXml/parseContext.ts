/**
 * Module-scoped parse context.
 *
 * The whole parse pipeline is synchronous, so a simple mutable variable
 * suffices — it avoids threading a context object through every converter.
 * Set at the start of parseBuilderDocument and cleared in its finally block.
 */

import type { Diagnostic } from "../diagnostics.ts";

/**
 * Source location of a BuilderNode in its originating XML file.
 * `file` is the absolute file path when known (e.g. for imports) or undefined
 * when the root document was passed as a plain string without `sourcePath`.
 * `line` is 1-based.
 */
/**
 * Where a node was written inside a `<Template>` body, and which
 * template that was.
 *
 * A shape drawn on a page can be defined two files away: the line under
 * the reader's cursor is the `<Use>` that called the template, not the
 * markup that drew the shape. Both ends are needed — the `<Use>` is
 * where the arguments live, the template body is where the drawing
 * lives, and an edit lands in one or the other depending on what is
 * being changed.
 */
export interface BuilderTemplateOrigin {
  /** `<Template name="…">` the node's markup lives in. */
  template: string;
  /** File holding that `<Template>`, when known. */
  file: string | undefined;
  /** 1-based line of the node inside the template body. */
  line: number;
  /** Line the node's element closes on inside the template body. */
  endLine?: number;
}

export interface BuilderSourcePos {
  file: string | undefined;
  line: number;
  /**
   * 1-based line the element closes on. Absent when the document was
   * too malformed to pair the tags — the opening line still stands.
   */
  endLine?: number;
  /**
   * Template expansions this node came through, innermost first.
   * Absent for markup the author wrote where it is rendered.
   */
  via?: BuilderTemplateOrigin[];
}

export type BuilderSourceMap = Map<number, BuilderSourcePos>;

let CURRENT_SOURCE_MAP: BuilderSourceMap | null = null;
let NEXT_NODE_ID = 0;
let CURRENT_DIAGNOSTICS: Diagnostic[] | null = null;

export function beginParseContext(
  sourceMap: BuilderSourceMap | null,
  diagnostics: Diagnostic[] | null,
): void {
  CURRENT_SOURCE_MAP = sourceMap;
  CURRENT_DIAGNOSTICS = diagnostics;
  NEXT_NODE_ID = 0;
}

export function endParseContext(): void {
  CURRENT_SOURCE_MAP = null;
  CURRENT_DIAGNOSTICS = null;
}

export function getCurrentSourceMap(): BuilderSourceMap | null {
  return CURRENT_SOURCE_MAP;
}

export function getCurrentDiagnostics(): Diagnostic[] | null {
  return CURRENT_DIAGNOSTICS;
}

export function allocateNextPomId(): number {
  return ++NEXT_NODE_ID;
}
