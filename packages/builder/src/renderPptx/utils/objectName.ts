/**
 * Build the pptxgenjs `objectName` string for a BuilderNode. This is serialized
 * into OOXML `<p:cNvPr name="node#N">` and later consumed by the SVG renderer
 * (e.g. @slideglance/core) to emit `data-node-id="N"` on the generated SVG
 * elements. Webview click delegation uses that id to look up the node's
 * source position and reveal the corresponding line in the user's editor.
 *
 * Returns undefined when the node has no `__nodeId` (e.g. parse ran without
 * `trackSourcePos`), in which case callers should omit the option entirely.
 */
export function builderObjectName(node: {
  __nodeId?: number;
}): string | undefined {
  return node.__nodeId !== undefined ? `node#${node.__nodeId}` : undefined;
}
