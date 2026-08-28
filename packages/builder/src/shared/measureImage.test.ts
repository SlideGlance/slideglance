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

  // `image-size` dispatches on magic bytes, and its ICNS, JXL and HEIF
  // parsers can spin forever on crafted input (GHSA-w3rx-r6r6-pgpr,
  // GHSA-5p2g-fcmc-qvqq — unfixed as of 2.0.2). No deck can carry any of
  // the three, so the bytes must be refused before the parser sees them.
  const unreachableParsers: [string, number[]][] = [
    ["ICNS", [0x69, 0x63, 0x6e, 0x73, 0x00, 0x00, 0x00, 0x10]],
    // Raw JXL codestream.
    ["JXL codestream", [0xff, 0x0a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]],
    // JXL in an ISOBMFF container: a "JXL " signature box.
    [
      "JXL container",
      [
        0x00, 0x00, 0x00, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a,
      ],
    ],
    // HEIF: an ftyp box with the "heic" brand.
    [
      "HEIF",
      [
        0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63,
        0x00, 0x00, 0x00, 0x00,
      ],
    ],
  ];

  it.each(unreachableParsers)(
    "refuses %s — a format a deck cannot carry",
    (_label, bytes) => {
      const diagnostics = new DiagnosticCollector();
      const size = measureImage(dataUrl(bytes), new Map(), diagnostics);

      expect(size).toEqual({ widthPx: 100, heightPx: 100 });
      const reported = JSON.stringify(diagnostics);
      expect(reported).toContain("IMAGE_MEASURE_FAILED");
      expect(reported).toContain("unsupported image format");
    },
  );

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
