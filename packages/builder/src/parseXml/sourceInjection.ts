// ===== Source-position injection =====
//
// Before feeding an XML string to fast-xml-parser, this utility injects
// `__sourceLine="<N>" __sourceFile="<path>"` attributes into every start tag.
// The parser preserves them as regular attributes (":@" block) which
// convertElement later strips and records into the BuilderSourceMap.
//
// Rationale: fast-xml-parser in preserveOrder mode does not expose node
// positions, so this attribute-injection is the simplest carrier that
// survives imports (<Import>) and template expansion (<Use>).

const TAG_START_RE = /<([A-Za-z_][A-Za-z0-9_:.-]*)(?=[\s/>])/g;

/** Escape an attribute value for inclusion in a double-quoted XML attribute. */
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

/**
 * Inject `__sourceLine` / `__sourceEndLine` / `__sourceFile` attributes
 * into every start tag of `xml`.
 *
 * Comments (`<!-- … -->`), CDATA (`<![CDATA[…]]>`) and processing
 * instructions (`<?…?>`) are skipped. The tag pattern alone does not
 * skip them — `<!--` fails it, but `<A` *inside* a comment matches it
 * perfectly well, and a commented-out element was being stamped as if
 * it were markup. The mask decides what counts as a tag; the pattern
 * only finds candidates.
 */
/**
 * Blank out comments, CDATA and processing instructions, keeping every
 * offset — the tag scanner below would otherwise read a `>` inside a
 * comment as the end of a tag.
 *
 * Newlines survive the blanking. Replacing them with spaces keeps every
 * offset and still destroys the line numbering, which is worse than
 * either: the scanner counts lines as it walks, so a masked comment
 * subtracts its own height from every line number after it — a file
 * whose templates start at line 37 reported line 6, and each element's
 * closing line landed before its opening one.
 */
function maskNonMarkup(xml: string): string {
  return xml.replace(
    /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>/g,
    (m) => m.replace(/[^\n]/g, " "),
  );
}

/**
 * Map each start tag's offset to the 1-based line its element closes on.
 * Takes text that `maskNonMarkup` has already been over.
 *
 * A shape's position is where it starts, but an edit needs the span:
 * "line 412" sends a reader to an opening tag whose body runs another
 * forty lines, and an LLM told only that will replace the wrong text.
 *
 * Self-closing tags close on the line they open. An unbalanced document
 * simply leaves entries out — this runs before validation, so it has to
 * survive markup that is about to be rejected.
 */
function scanEndLines(masked: string): Map<number, number> {
  const tagRe =
    /<(\/?)([A-Za-z_][A-Za-z0-9_:.-]*)((?:"[^"]*"|'[^']*'|[^>])*?)(\/?)>/g;
  const endLineByStart = new Map<number, number>();
  const stack: { name: string; offset: number }[] = [];
  let scanned = 0;
  let line = 1;
  const lineAt = (idx: number): number => {
    for (let i = scanned; i < idx; i++) {
      if (masked.charCodeAt(i) === 10) line++;
    }
    scanned = idx;
    return line;
  };

  for (const m of masked.matchAll(tagRe)) {
    const [full, closing, name, , selfClose] = m;
    const offset = m.index;
    const at = lineAt(offset);
    if (closing) {
      // Pop to the matching name so one stray tag does not desync the
      // rest of the file.
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i]!.name !== name) continue;
        endLineByStart.set(stack[i]!.offset, at + countNewlines(full));
        stack.length = i;
        break;
      }
      continue;
    }
    if (selfClose) {
      endLineByStart.set(offset, at + countNewlines(full));
      continue;
    }
    stack.push({ name: name!, offset });
  }
  return endLineByStart;
}

function countNewlines(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++;
  return n;
}

export function injectSourceAttrs(
  xml: string,
  file: string | undefined,
): string {
  // Build a cumulative newline-offset table so we can map a string index to a
  // 1-based line number in O(log n) via binary search — but the XML sizes we
  // handle are modest, so a linear count over the prefix is fine too.
  const fileAttr = file ? ` __sourceFile="${escapeAttr(file)}"` : "";
  const masked = maskNonMarkup(xml);
  const endLines = scanEndLines(masked);
  // Offsets that are tags in the masked text — everything else the
  // pattern finds is inside a comment or a CDATA block.
  const realTags = new Set<number>();
  for (const m of masked.matchAll(TAG_START_RE)) realTags.add(m.index);
  let lastIndex = 0;
  let lineAtLastIndex = 1;

  function lineAt(idx: number): number {
    // Count newlines between lastIndex and idx, then remember the new anchor.
    for (let i = lastIndex; i < idx; i++) {
      if (xml.charCodeAt(i) === 10) lineAtLastIndex++;
    }
    lastIndex = idx;
    return lineAtLastIndex;
  }

  return xml.replace(TAG_START_RE, (match, _tag: string, offset: number) => {
    if (!realTags.has(offset)) return match;
    const line = lineAt(offset);
    const end = endLines.get(offset);
    const endAttr = end !== undefined ? ` __sourceEndLine="${end}"` : "";
    return `${match} __sourceLine="${line}"${endAttr}${fileAttr}`;
  });
}
