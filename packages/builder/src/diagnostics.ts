export type DiagnosticCode =
  | "IMAGE_MEASURE_FAILED"
  | "IMAGE_NOT_PREFETCHED"
  | "AUTOFIT_OVERFLOW"
  | "SCALE_BELOW_THRESHOLD"
  | "MASTER_PPTX_PARSE_FAILED"
  | "INVALID_HREF_SCHEME"
  | "INVALID_IMAGE_SRC"
  | "TEMPLATE_EXPANSION_LIMIT"
  | "MASTER_PPTX_SIZE_LIMIT"
  | "TEMPLATES_NOT_AT_ROOT"
  | "INVALID_NUMBER_TYPE";

export interface DiagnosticSourcePos {
  line?: number;
  file?: string;
}

export interface Diagnostic {
  code: DiagnosticCode;
  message: string;
  sourcePos?: DiagnosticSourcePos;
}

export class DiagnosticCollector {
  readonly items: Diagnostic[] = [];

  add(
    code: DiagnosticCode,
    message: string,
    sourcePos?: DiagnosticSourcePos,
  ): void {
    this.items.push(
      sourcePos ? { code, message, sourcePos } : { code, message },
    );
  }

  addAll(diagnostics: readonly Diagnostic[]): void {
    for (const diagnostic of diagnostics) {
      this.items.push(diagnostic);
    }
  }
}

export class DiagnosticsError extends Error {
  constructor(public readonly diagnostics: Diagnostic[]) {
    const summary = diagnostics
      .map((d) => `[${d.code}] ${d.message}`)
      .join("\n");
    super(`Build completed with diagnostics:\n${summary}`);
    this.name = "DiagnosticsError";
  }
}
