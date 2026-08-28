import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { buildPptx } from "./buildPptx.ts";

const slideSize = { w: 1280, h: 720 };

async function readSlideXml(
  bytes: Uint8Array,
  slideNumber = 1,
): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const path = `ppt/slides/slide${slideNumber}.xml`;
  const file = zip.file(path);
  if (!file) throw new Error(`missing ${path}`);
  return file.async("string");
}

async function slideXmlOf(xml: string): Promise<string> {
  const { pptx, diagnostics } = await buildPptx(xml, slideSize, {
    autoFit: false,
  });
  expect(diagnostics).toEqual([]);
  const bytes = (await pptx.write({ outputType: "uint8array" })) as Uint8Array;
  return readSlideXml(bytes);
}

function countOf(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("buildPptx — text frame autofit", () => {
  it('emits <a:spAutoFit/> for a <Text> sized by its own content so PowerPoint reports "Resize shape to fit text"', async () => {
    const slide = await slideXmlOf(
      `<Text fontSize="18">Resize the shape to the text, not the text to the shape.</Text>`,
    );
    expect(slide).toContain("<a:spAutoFit/>");
    expect(slide).not.toContain("<a:noAutofit/>");
    expect(slide).not.toContain("<a:normAutofit");
  });

  it('keeps the frame width fixed — bodyPr stays wrap="square"', async () => {
    const slide = await slideXmlOf(
      `<Text fontSize="18" w="400">Text wraps inside the box instead of widening it.</Text>`,
    );
    expect(slide).toContain('wrap="square"');
  });

  it("emits <a:spAutoFit/> for a <Text> carrying inline runs", async () => {
    const slide = await slideXmlOf(
      `<Text fontSize="18">plain <B>bold</B> tail</Text>`,
    );
    expect(slide).toContain("<a:spAutoFit/>");
  });

  it("emits <a:spAutoFit/> for a <Text> whose background makes it a filled frame", async () => {
    const slide = await slideXmlOf(
      `<Text fontSize="18" backgroundColor="#eef2ff" padding="12">Filled text frame.</Text>`,
    );
    expect(slide).toContain("<a:spAutoFit/>");
  });

  it("emits <a:spAutoFit/> for <Ul> and <Ol>", async () => {
    const slide = await slideXmlOf(
      `<VStack gap="16">
         <Ul fontSize="16"><Li>first</Li><Li>second</Li></Ul>
         <Ol fontSize="16"><Li>first</Li><Li>second</Li></Ol>
       </VStack>`,
    );
    expect(countOf(slide, "<a:spAutoFit/>")).toBe(2);
  });

  it("leaves <Shape> alone — its box is authored geometry, not a function of its text", async () => {
    const slide = await slideXmlOf(
      `<Shape shapeType="rect" w="300" h="160" fill.color="#dddddd" text="label"/>`,
    );
    expect(slide).not.toContain("<a:spAutoFit/>");
  });

  it("withholds it from a <Text> given an explicit height — spAutoFit would collapse the box to one line", async () => {
    const slide = await slideXmlOf(
      `<Text fontSize="14" h="60" backgroundColor="#1d4ed8" color="#ffffff">01</Text>`,
    );
    expect(slide).not.toContain("<a:spAutoFit/>");
  });

  it("withholds it from a <Text> whose height is a percentage of its parent", async () => {
    const slide = await slideXmlOf(
      `<VStack h="200" gap="16">
         <Text fontSize="14" h="50%" backgroundColor="#1d4ed8" color="#ffffff">Top</Text>
         <Text fontSize="14" h="50%" backgroundColor="#0ea5e9" color="#ffffff">Bottom</Text>
       </VStack>`,
    );
    expect(slide).not.toContain("<a:spAutoFit/>");
  });

  it("withholds it from a <Text> stretched to a taller sibling by the row's cross-axis alignment", async () => {
    // The 12px caption is stretched to the 48px headline's height; only the
    // headline's own box still equals what its text measured to.
    const slide = await slideXmlOf(
      `<HStack gap="16" alignItems="stretch">
         <Text fontSize="48">Headline</Text>
         <Text fontSize="12">caption</Text>
       </HStack>`,
    );
    expect(countOf(slide, "<a:spAutoFit/>")).toBe(1);
  });

  it("withholds it from a <Text> that fills the remaining space with flexGrow", async () => {
    const slide = await slideXmlOf(
      `<VStack h="400" gap="16">
         <Text fontSize="14" flexGrow="1" backgroundColor="#eef2ff">grows</Text>
         <Text fontSize="14">natural</Text>
       </VStack>`,
    );
    expect(countOf(slide, "<a:spAutoFit/>")).toBe(1);
  });
});
