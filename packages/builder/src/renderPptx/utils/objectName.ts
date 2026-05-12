/**
 * Build the pptxgenjs `objectName` string for a BuilderNode. This is
 * serialized into OOXML `<p:cNvPr name="...">` and used for two
 * orthogonal purposes:
 *
 *   1. `node#N` token — consumed by the SVG renderer (e.g.
 *      @slideglance/core) to emit `data-node-id="N"` so the webview's
 *      click delegation can reveal the corresponding source line.
 *
 *   2. `sg-id:USER_ID` token — consumed by the connector post-process
 *      pass (see `renderPptx/postProcess/`) to bind <p:cxnSp> stCxn /
 *      endCxn back to author-facing ids before stripping the marker
 *      out of the final PPTX.
 *
 * Returns undefined when the node carries neither id nor `__nodeId`,
 * in which case callers should omit the option entirely so pptxgenjs
 * lets the default `cNvPr name="Object N"` ship.
 */
export function builderObjectName(node: {
  __nodeId?: number;
  id?: string;
}): string | undefined {
  const parts: string[] = [];
  if (node.id) parts.push(`sg-id:${node.id}`);
  if (node.__nodeId !== undefined) parts.push(`node#${node.__nodeId}`);
  return parts.length > 0 ? parts.join(":") : undefined;
}
