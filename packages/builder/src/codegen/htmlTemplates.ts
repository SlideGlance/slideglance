/**
 * HTML rendering helpers for reference-html codegen. Pure functions —
 * no I/O, no DOM, no globals. See design §6.3 for the escape contract.
 */

const ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(s: string): string {
  // The regex guarantees `c` is always one of the keys in ESCAPE_MAP, so the
  // lookup is total. The non-null assertion satisfies `noUncheckedIndexedAccess`.
  return s.replace(/[&<>"']/g, (c) => ESCAPE_MAP[c]!);
}
