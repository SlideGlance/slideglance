import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { buildPptx } from "./buildPptx.ts";

const slideSize = { w: 1280, h: 720 };

async function slideXmlOf(xml: string): Promise<string> {
  const { pptx, diagnostics } = await buildPptx(xml, slideSize, {
    autoFit: false,
  });
  expect(diagnostics).toEqual([]);
  const bytes = (await pptx.write({ outputType: "uint8array" })) as Uint8Array;
  const zip = await JSZip.loadAsync(bytes);
  const file = zip.file("ppt/slides/slide1.xml");
  if (!file) throw new Error("missing slide1.xml");
  return file.async("string");
}

/**
 * Cell border edges in document order. A drawn edge is `<a:lnL>` with a
 * fill; a suppressed one carries `<a:noFill/>`. Returns one entry per
 * real cell as `{ left, right }`, each `true` when that edge is drawn.
 *
 * A merged span still occupies its grid positions in the XML as empty
 * `hMerge` / `vMerge` cells that carry no borders of their own; those are
 * skipped so the result lines up with the authored `<Td>` list.
 */
function cellVerticals(slide: string): { left: boolean; right: boolean }[] {
  const all = slide.match(/<a:tc[ >][\s\S]*?<\/a:tc>/g) ?? [];
  const cells = all.filter(
    (tc) => !/hMerge="1"/.test(tc) && !/vMerge="1"/.test(tc),
  );
  return cells.map((tc) => {
    const edge = (tag: string): boolean => {
      const m = new RegExp(`<a:${tag}[^>]*>([\\s\\S]*?)</a:${tag}>`).exec(tc);
      if (!m) return false;
      return !m[1].includes("<a:noFill/>");
    };
    return { left: edge("lnL"), right: edge("lnR") };
  });
}

const TWO_BY_TWO = (sides: string) => `
  <Table cellBorder.color="333333" cellBorder.width="1"${sides}>
    <Col w="200"/><Col w="200"/><Col w="200"/>
    <Tr><Td>a1</Td><Td>b1</Td><Td>c1</Td></Tr>
    <Tr><Td>a2</Td><Td>b2</Td><Td>c2</Td></Tr>
  </Table>
`;

describe("buildPptx — cellBorderSides", () => {
  it('draws the full grid by default and for "all"', async () => {
    for (const sides of ["", ' cellBorderSides="all"']) {
      const verticals = cellVerticals(await slideXmlOf(TWO_BY_TWO(sides)));
      expect(verticals).toHaveLength(6);
      expect(verticals.every((v) => v.left && v.right)).toBe(true);
    }
  });

  it('opens only the table\'s outer edges for "no-outer-vertical"', async () => {
    const verticals = cellVerticals(
      await slideXmlOf(TWO_BY_TWO(' cellBorderSides="no-outer-vertical"')),
    );
    expect(verticals).toHaveLength(6);
    // Row 1 and row 2 alike: first cell open on the left, last open on
    // the right, everything between still drawn.
    for (const row of [verticals.slice(0, 3), verticals.slice(3, 6)]) {
      expect(row[0]).toEqual({ left: false, right: true });
      expect(row[1]).toEqual({ left: true, right: true });
      expect(row[2]).toEqual({ left: true, right: false });
    }
  });

  it('drops every vertical for "horizontal-only"', async () => {
    const verticals = cellVerticals(
      await slideXmlOf(TWO_BY_TWO(' cellBorderSides="horizontal-only"')),
    );
    expect(verticals).toHaveLength(6);
    expect(verticals.some((v) => v.left || v.right)).toBe(false);
  });

  it("keeps the edges right when a colspan reaches the last column", async () => {
    const slide = await slideXmlOf(`
      <Table cellBorder.color="333333" cellBorder.width="1" cellBorderSides="no-outer-vertical">
        <Col w="200"/><Col w="200"/><Col w="200"/>
        <Tr><Td colspan="2">wide</Td><Td>c1</Td></Tr>
        <Tr><Td>a2</Td><Td colspan="2">wide</Td></Tr>
      </Table>
    `);
    const verticals = cellVerticals(slide);
    expect(verticals).toHaveLength(4);
    // Row 1: the 2-wide cell starts at column 0, the single cell ends the row.
    expect(verticals[0]).toEqual({ left: false, right: true });
    expect(verticals[1]).toEqual({ left: true, right: false });
    // Row 2: the single cell opens the row, the 2-wide cell closes it.
    expect(verticals[2]).toEqual({ left: false, right: true });
    expect(verticals[3]).toEqual({ left: true, right: false });
  });

  it("tracks a rowspan so the row beneath it still finds its own columns", async () => {
    // Column 0 is occupied on row 2 by the rowspan above, so row 2's
    // first listed cell actually sits in column 1 — it must not be
    // treated as the left edge.
    const slide = await slideXmlOf(`
      <Table cellBorder.color="333333" cellBorder.width="1" cellBorderSides="no-outer-vertical">
        <Col w="200"/><Col w="200"/><Col w="200"/>
        <Tr><Td rowspan="2">tall</Td><Td>b1</Td><Td>c1</Td></Tr>
        <Tr><Td>b2</Td><Td>c2</Td></Tr>
      </Table>
    `);
    const verticals = cellVerticals(slide);
    expect(verticals).toHaveLength(5);
    expect(verticals[0]).toEqual({ left: false, right: true }); // tall, column 0
    expect(verticals[1]).toEqual({ left: true, right: true }); // b1
    expect(verticals[2]).toEqual({ left: true, right: false }); // c1
    expect(verticals[3]).toEqual({ left: true, right: true }); // b2 → column 1
    expect(verticals[4]).toEqual({ left: true, right: false }); // c2 → column 2
  });
});

/** Every real cell's `<a:tc>`, merge placeholders dropped. */
function realCells(slide: string): string[] {
  const all = slide.match(/<a:tc[ >][\s\S]*?<\/a:tc>/g) ?? [];
  return all.filter((tc) => !/hMerge="1"/.test(tc) && !/vMerge="1"/.test(tc));
}

/** Solid fill colour of a cell, or undefined when it has none. */
function cellFill(tc: string): string | undefined {
  const props = /<a:tcPr[\s\S]*?<\/a:tcPr>|<a:tcPr[^>]*\/>/.exec(tc)?.[0] ?? "";
  return /<a:solidFill><a:srgbClr val="([0-9A-Fa-f]{6})"\/>/.exec(props)?.[1];
}

describe("buildPptx — table cell style inheritance", () => {
  it("applies the table's own text defaults to every cell", async () => {
    const slide = await slideXmlOf(`
      <Table fontSize="10" color="#334155" bold="true">
        <Col w="200"/><Col w="200"/>
        <Tr><Td>a</Td><Td>b</Td></Tr>
      </Table>
    `);
    const cells = realCells(slide);
    expect(cells).toHaveLength(2);
    for (const tc of cells) {
      // 10px -> 7.5pt -> sz="750"
      expect(tc).toContain('sz="750"');
      expect(tc).toContain('<a:srgbClr val="334155"/>');
      expect(tc).toContain('b="1"');
    }
  });

  it("lets a row override the table and a cell override the row", async () => {
    const slide = await slideXmlOf(`
      <Table fontSize="10" color="#334155">
        <Col w="200"/><Col w="200"/>
        <Tr color="#111827"><Td>row wins</Td><Td color="#dc2626">cell wins</Td></Tr>
      </Table>
    `);
    const cells = realCells(slide);
    // Colours are normalised to upper case on the way out.
    expect(cells[0]).toContain('<a:srgbClr val="111827"/>');
    expect(cells[1]).toContain('<a:srgbClr val="DC2626"/>');
  });

  it("applies a column's alignment to the cells in that column", async () => {
    const slide = await slideXmlOf(`
      <Table>
        <Col w="200"/><Col w="200" textAlign="right"/>
        <Tr><Td>left</Td><Td>123</Td></Tr>
      </Table>
    `);
    const cells = realCells(slide);
    expect(cells[0]).toContain('algn="l"');
    expect(cells[1]).toContain('algn="r"');
  });

  it("keeps a column style from crossing into the wrong column after a colspan", async () => {
    const slide = await slideXmlOf(`
      <Table>
        <Col w="200"/><Col w="200"/><Col w="200" textAlign="right"/>
        <Tr><Td colspan="2">wide</Td><Td>123</Td></Tr>
      </Table>
    `);
    const cells = realCells(slide);
    // The wide cell starts in column 0; only the third column is right-aligned.
    expect(cells[0]).toContain('algn="l"');
    expect(cells[1]).toContain('algn="r"');
  });

  it("gives a row its own fill and lets banding stripe the body rows", async () => {
    const slide = await slideXmlOf(`
      <Table bandedRowFill="#eef2ff" headerRows="1">
        <Col w="200"/>
        <Tr backgroundColor="#1e3a8a"><Td>head</Td></Tr>
        <Tr><Td>body 1</Td></Tr>
        <Tr><Td>body 2</Td></Tr>
        <Tr><Td>body 3</Td></Tr>
      </Table>
    `);
    const cells = realCells(slide);
    expect(cellFill(cells[0])).toBe("1E3A8A");
    expect(cellFill(cells[1])).toBeUndefined();
    expect(cellFill(cells[2])).toBe("EEF2FF");
    expect(cellFill(cells[3])).toBeUndefined();
  });

  it("lets an explicit cell fill win over the banding stripe", async () => {
    const slide = await slideXmlOf(`
      <Table bandedRowFill="#eef2ff">
        <Col w="200"/>
        <Tr><Td>plain</Td></Tr>
        <Tr><Td backgroundColor="#fee2e2">flagged</Td></Tr>
      </Table>
    `);
    const cells = realCells(slide);
    expect(cellFill(cells[1])).toBe("FEE2E2");
  });
});

describe("buildPptx — per-edge cell borders", () => {
  it("draws a rule above one cell without bordering the rest", async () => {
    const slide = await slideXmlOf(`
      <Table>
        <Col w="200"/><Col w="200"/>
        <Tr><Td>a</Td><Td>b</Td></Tr>
        <Tr><Td borderTop.color="#111111" borderTop.width="2">total</Td><Td>99</Td></Tr>
      </Table>
    `);
    const cells = realCells(slide);
    // The totals cell draws its top edge and leaves its other three off.
    expect(cells[2]).toMatch(/<a:lnT[^>]*>(?![\s\S]*?<a:noFill\/>[\s\S]*?<\/a:lnT>)/);
    expect(cells[2]).toContain('<a:srgbClr val="111111"/>');
    // Its neighbour was never given a border and keeps none of its own.
    expect(cells[3]).not.toContain('<a:srgbClr val="111111"/>');
  });

  it("overrides one edge of the table grid", async () => {
    const slide = await slideXmlOf(`
      <Table cellBorder.color="#cccccc" cellBorder.width="1">
        <Col w="200"/><Col w="200"/>
        <Tr><Td>a</Td><Td borderBottom.color="#dc2626" borderBottom.width="3">b</Td></Tr>
      </Table>
    `);
    const cells = realCells(slide);
    expect(cells[0]).toContain('<a:srgbClr val="CCCCCC"/>');
    expect(cells[1]).toContain('<a:srgbClr val="DC2626"/>');
    // The overridden cell keeps the grid on its other edges.
    expect(cells[1]).toContain('<a:srgbClr val="CCCCCC"/>');
  });
});
