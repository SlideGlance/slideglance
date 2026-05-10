/**
 * Build a PPTX byte buffer from a slide builder XML document. Used by
 * the `slideBuilder.exportPptx` command — both from the preview panel's
 * toolbar and from the .sgx editor's title menu.
 *
 * Uses the same import resolver shape the preview panel uses so unsaved
 * edits to imported files are picked up at export time.
 */

import { buildPptx, parseBuilderDocument } from "@slideglance/builder";
import { createFsImportResolver } from "./importResolver.js";

const DEFAULT_SLIDE_WIDTH = 1280;
const DEFAULT_SLIDE_HEIGHT = 720;

export async function generatePptxBuffer(
  content: string,
  documentPath: string,
): Promise<Uint8Array> {
  if (!content.trim()) {
    throw new Error("No slides found in the document");
  }

  const importResolver = createFsImportResolver();
  const { document } = parseBuilderDocument(content, {
    resolveImport: importResolver,
    sourcePath: documentPath,
    equalize: true,
  });

  if (document.nodes.length === 0) {
    throw new Error("No slides found in the document");
  }

  const slideWidth = document.slideSize?.w ?? DEFAULT_SLIDE_WIDTH;
  const slideHeight = document.slideSize?.h ?? DEFAULT_SLIDE_HEIGHT;

  const { pptx } = await buildPptx(
    content,
    { w: slideWidth, h: slideHeight },
    {
      // Export aims for fidelity, not interactivity — use opentype-driven
      // measurement so glyph widths match the production renderer rather
      // than the fast-path fallback the preview can fall back to.
      textMeasurement: "opentype",
      resolveImport: importResolver,
      sourcePath: documentPath,
      equalize: true,
    },
  );

  const buffer = await pptx.write({ outputType: "uint8array" });
  if (!(buffer instanceof Uint8Array)) {
    throw new Error("Unexpected output type from pptx.write");
  }

  return buffer;
}
