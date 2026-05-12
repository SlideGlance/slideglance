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

/**
 * Tokenize a small XML snippet for syntax-highlighted display. Output is
 * HTML and goes into element-content position only (never attribute-value
 * position — see design §6.3). All input goes through escapeHtml first.
 */
export function highlightXml(src: string): string {
  const safe = escapeHtml(src);
  // tag-open and tag-close
  // The attrs class allows `&` because escaped attribute values contain
  // `&quot;` entities; the `&gt;` tail anchor still terminates the match
  // correctly because `\s*\/?` cannot consume `&`.
  let out = safe.replace(
    /&lt;(\/?)([A-Za-z][\w]*)((?:\s+.+?)?)(\s*\/?)&gt;/g,
    (_m, slash, tag, attrs, tail) => {
      const inside = attrs ? highlightAttrs(attrs) : "";
      return (
        `<span class="tk-punct">&lt;${slash}</span>` +
        `<span class="tk-tag">${tag}</span>` +
        inside +
        `<span class="tk-punct">${tail}&gt;</span>`
      );
    },
  );
  // interpolation
  out = out.replace(/\{([^{}]+)\}/g, `<span class="tk-interp">{$1}</span>`);
  return out;
}

function highlightAttrs(s: string): string {
  // Attribute values may contain already-escaped entities (&amp;, &lt;, etc.)
  // — the prior escapeHtml pass converted source `&`, `<`, `>` to entities.
  // The value class matches anything that's not a literal `"` (which only
  // appears as &quot; after escape).
  return s.replace(
    /\s+([\w.-]+)=(&quot;.*?&quot;)/g,
    (_m, name, value) =>
      ` <span class="tk-attr">${name}</span>=` +
      `<span class="tk-str">${value}</span>`,
  );
}
