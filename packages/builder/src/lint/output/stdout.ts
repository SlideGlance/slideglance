import type { Diagnostic } from "../../diagnostics.ts";

const SEV_LABEL: Record<string, string> = {
  error: "error",
  warn: "warn ",
  info: "info ",
};

/** Renders a human-readable summary suitable for build CLI output. */
export function formatStdout(diags: readonly Diagnostic[]): string {
  if (diags.length === 0) return "  no lint findings.\n";
  const byFile = new Map<string, Diagnostic[]>();
  for (const d of diags) {
    const key = d.sourcePos?.file ?? "<inline>";
    if (!byFile.has(key)) byFile.set(key, []);
    byFile.get(key)!.push(d);
  }
  const lines: string[] = [];
  for (const [file, items] of byFile) {
    lines.push(`  ${file}`);
    for (const d of items) {
      const sev = SEV_LABEL[d.severity ?? "warn"] ?? "warn ";
      const loc = d.sourcePos?.line ? `:${d.sourcePos.line}` : "";
      lines.push(
        `    ${sev}  ${d.code.padEnd(28)} ${file ? "" : "(inline)"}${loc}`,
      );
      lines.push(`           ${d.message}`);
      if (d.suggestedFix) {
        const fixDesc =
          d.suggestedFix.kind === "attribute-set"
            ? `set ${Object.entries(d.suggestedFix.set)
                .map(([k, v]) => `${k}="${v}"`)
                .join(" ")} on ${d.suggestedFix.target}`
            : d.suggestedFix.kind === "wrap-with"
              ? `wrap with <${d.suggestedFix.tag}>`
              : `change text to "${d.suggestedFix.to}"`;
        lines.push(`           fix: ${fixDesc}`);
      }
    }
  }
  // counts summary
  const counts = { error: 0, warn: 0, info: 0 };
  for (const d of diags) counts[d.severity ?? "warn"]++;
  lines.push(
    `\n  ${counts.error} error · ${counts.warn} warn · ${counts.info} info`,
  );
  return lines.join("\n") + "\n";
}
