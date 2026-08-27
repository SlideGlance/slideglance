import { describe, expect, it } from "vitest";
import { DiagnosticCollector } from "../diagnostics.ts";
import { measureImage } from "./measureImage.ts";

/** Wrap raw bytes as a `data:` URL so `measureImage` reads them directly. */
function dataUrl(bytes: number[]): string {
  return `data:image/x;base64,${Buffer.from(Uint8Array.from(bytes)).toString("base64")}`;
}

/** A 1×1 PNG — the smallest real image the measurer should accept. */
const PNG_1X1 = [
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89,
];

describe("measureImage", () => {
  it("measures a supported format", () => {
    const diagnostics = new DiagnosticCollector();
    const size = measureImage(dataUrl(PNG_1X1), new Map(), diagnostics);
    expect(size).toEqual({ widthPx: 1, heightPx: 1 });
  });

  it("refuses a format a deck cannot carry", () => {
    // ICNS. `image-size` would dispatch to a parser that can spin
    // forever on crafted input, and no deck can carry the format
    // anyway, so the bytes must not reach it.
    const icns = [0x69, 0x63, 0x6e, 0x73, 0x00, 0x00, 0x00, 0x10];
    const diagnostics = new DiagnosticCollector();
    const size = measureImage(dataUrl(icns), new Map(), diagnostics);

    expect(size).toEqual({ widthPx: 100, heightPx: 100 });
    const reported = JSON.stringify(diagnostics);
    expect(reported).toContain("IMAGE_MEASURE_FAILED");
    expect(reported).toContain("unsupported image format");
  });

  it("accepts SVG behind leading whitespace and a BOM", () => {
    const svg = [
      0xef, 0xbb, 0xbf, 0x0a, 0x20,
      ...[...'<svg xmlns="http://www.w3.org/2000/svg" width="12" height="8"></svg>'].map(
        (c) => c.charCodeAt(0),
      ),
    ];
    const diagnostics = new DiagnosticCollector();
    const size = measureImage(dataUrl(svg), new Map(), diagnostics);
    expect(size).toEqual({ widthPx: 12, heightPx: 8 });
  });
});
