/**
 * Sigil format used by the connector pipeline to smuggle metadata
 * through the pptxgenjs output and back to the post-process pass via
 * `<p:cNvPr name="...">`.
 *
 * Two sigils share the same `name` attribute slot because pptxgenjs
 * has no other clean per-shape channel:
 *
 *   sg-id:USER_ID[:node#N]      -- present on any node carrying an
 *                                   author-facing `id` attribute, so
 *                                   the rewriter can resolve from / to
 *                                   author ids back to OOXML spIds.
 *
 *   sg-cxn:FROM#FS>TO#TS:K:P    -- present on the placeholder line a
 *                                   Connector node emits. K is the
 *                                   author-chosen kind (straight /
 *                                   elbow / curved), P is the picked
 *                                   PPTX preset (straightConnector1,
 *                                   bentConnector3, ...). The rewriter
 *                                   parses this to recreate the cxnSp
 *                                   in-place.
 *
 * Both sigils are stripped from the final PPTX so the author-facing
 * cNvPr@name looks unremarkable to PowerPoint.
 */

export const SG_ID_PREFIX = "sg-id:";
export const SG_CXN_PREFIX = "sg-cxn:";

export interface ParsedIdSigil {
  /** Author-facing id from `<Element id="...">`. */
  userId: string;
  /** Optional `node#N` token (when trackSourcePos is on). */
  nodeIdToken?: string;
}

/**
 * Parse a `sg-id:USER_ID[:node#N]` sigil. Tolerates the optional
 * second token. Returns null when the input does not start with the
 * sg-id prefix.
 */
export function parseIdSigil(name: string | undefined): ParsedIdSigil | null {
  if (!name || !name.startsWith(SG_ID_PREFIX)) return null;
  // Strip prefix and split on ":" — the userId never contains a colon
  // (the parser enforces a regex that excludes it), so the first split
  // is the userId.
  const rest = name.slice(SG_ID_PREFIX.length);
  const idx = rest.indexOf(":");
  if (idx === -1) {
    return { userId: rest };
  }
  return { userId: rest.slice(0, idx), nodeIdToken: rest.slice(idx + 1) };
}

export interface ParsedCxnSigil {
  from: string;
  fromSide: "top" | "right" | "bottom" | "left";
  to: string;
  toSide: "top" | "right" | "bottom" | "left";
  kind: "straight" | "elbow" | "curved";
  preset: string;
}

const SIDES = new Set(["top", "right", "bottom", "left"]);
const KINDS = new Set(["straight", "elbow", "curved"]);

/**
 * Parse a `sg-cxn:FROM#FS>TO#TS:K:P` sigil. Returns null on any
 * structural mismatch so callers can leave the unrecognised cNvPr in
 * place (the post-process pass treats unknown sigils as "not ours").
 */
export function parseCxnSigil(name: string | undefined): ParsedCxnSigil | null {
  if (!name || !name.startsWith(SG_CXN_PREFIX)) return null;
  const body = name.slice(SG_CXN_PREFIX.length);
  // Split on the unambiguous separator between binding and presentation
  // tokens. The from/to author ids never contain `>` (id regex
  // excludes it), so the first `>` is the endpoint separator. After
  // the endpoint pair we get :kind:preset.
  const arrowIdx = body.indexOf(">");
  if (arrowIdx === -1) return null;
  const left = body.slice(0, arrowIdx);
  const rightAndTail = body.slice(arrowIdx + 1);
  const leftHash = left.indexOf("#");
  if (leftHash === -1) return null;
  const from = left.slice(0, leftHash);
  const fromSide = left.slice(leftHash + 1);
  if (!SIDES.has(fromSide)) return null;

  // rightAndTail looks like "TO#TS:KIND:PRESET"
  const rightHash = rightAndTail.indexOf("#");
  if (rightHash === -1) return null;
  const to = rightAndTail.slice(0, rightHash);
  const tail = rightAndTail.slice(rightHash + 1);
  const tailParts = tail.split(":");
  if (tailParts.length !== 3) return null;
  const [toSide, kind, preset] = tailParts;
  if (!toSide || !kind || !preset) return null;
  if (!SIDES.has(toSide)) return null;
  if (!KINDS.has(kind)) return null;

  return {
    from,
    fromSide: fromSide as ParsedCxnSigil["fromSide"],
    to,
    toSide: toSide as ParsedCxnSigil["toSide"],
    kind: kind as ParsedCxnSigil["kind"],
    preset,
  };
}

/**
 * Strip both sigils from a cNvPr@name, leaving only the `node#N`
 * token (or an empty string) so the final PPTX shows nothing unusual.
 * When the name reduces to nothing, callers should remove the
 * attribute entirely so PowerPoint applies its default cNvPr@name.
 */
export function stripSigils(name: string | undefined): string {
  if (!name) return "";
  if (name.startsWith(SG_ID_PREFIX)) {
    const parsed = parseIdSigil(name);
    return parsed?.nodeIdToken ?? "";
  }
  if (name.startsWith(SG_CXN_PREFIX)) {
    // Connector placeholders carry only the sg-cxn sigil; nothing else
    // hides behind it.
    return "";
  }
  return name;
}
