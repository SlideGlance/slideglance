import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { buildPptx } from "./buildPptx.ts";
import type { PositionedNode } from "./types.ts";

const slideSize = { w: 794, h: 1123 };

function deck(editedSlide?: number): string {
  const page = (i: number) => `
    <Slide>
      <VStack w="100%" h="max" padding="40" gap="14">
        <Text fontSize="20" bold="true">${i}. 수신 인터페이스${editedSlide === i ? " (edited)" : ""}</Text>
        <HStack gap="24" alignItems="stretch">
          <Text w="50%" fontSize="11">프로토콜별 수신 모듈이 공통 처리 구조의 인터페이스를 제공한다.</Text>
          <Text w="50%" fontSize="11">통신 연결 상태를 채널별 실시간 지표로 감시한다.</Text>
        </HStack>
        <Table fontSize="10" cellBorder.color="CBD5E1" cellBorder.width="1">
          <Col w="150"/><Col w="150"/>
          <Tr><Td>항목</Td><Td>값</Td></Tr>
          <Tr><Td>전송 계층</Td><Td>TCP 102</Td></Tr>
        </Table>
      </VStack>
    </Slide>`;
  return `<SlideGlance xmlns="urn:slideglance:builder:v1"><Document size="A4"/>${[
    1, 2, 3,
  ]
    .map(page)
    .join("")}</SlideGlance>`;
}

async function slideXmls(bytes: Uint8Array): Promise<string[]> {
  const zip = await JSZip.loadAsync(bytes);
  const out: string[] = [];
  for (let i = 1; ; i++) {
    const file = zip.file(`ppt/slides/slide${i}.xml`);
    if (!file) break;
    out.push(await file.async("string"));
  }
  return out;
}

async function build(
  xml: string,
  reuseSlideLayout?: readonly (PositionedNode | undefined)[],
) {
  const built = await buildPptx(xml, slideSize, {
    textMeasurement: "auto",
    trackSourcePos: true,
    ...(reuseSlideLayout ? { reuseSlideLayout } : {}),
  });
  const bytes = (await built.pptx.write({
    outputType: "uint8array",
  })) as Uint8Array;
  return { built, slides: await slideXmls(bytes) };
}

describe("buildPptx — reuseSlideLayout", () => {
  it("produces the same slides as laying every page out again", async () => {
    const cold = await build(deck());
    const cache = cold.built.positionedSlides ?? [];
    expect(cache).toHaveLength(3);

    // Slide 2 edited; the other two are handed back.
    const edited = deck(2);
    const full = await build(edited);
    const reused = await build(edited, [cache[0], undefined, cache[2]]);

    expect(reused.slides).toHaveLength(3);
    expect(reused.slides).toEqual(full.slides);
  });

  it("renumbers node ids from the fresh parse so click-to-source stays right", async () => {
    const cold = await build(deck());
    const cache = cold.built.positionedSlides ?? [];
    // The edit adds a word to slide 1, shifting nothing structurally but
    // re-running the id counter for the whole document.
    const edited = deck(1);
    const { built } = await build(edited, [undefined, cache[1], cache[2]]);

    const ids: number[] = [];
    const walk = (n: PositionedNode): void => {
      const id = (n as { __nodeId?: number }).__nodeId;
      if (id !== undefined) ids.push(id);
      for (const child of (n as { children?: PositionedNode[] }).children ?? [])
        walk(child);
    };
    for (const slide of built.positionedSlides ?? []) walk(slide);

    // Every id a reused slide carries must exist in this build's source
    // map, or the preview would jump to a line from the previous parse.
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(built.sourceMap?.has(id)).toBe(true);
  });

  it("lays the slide out normally when the cached tree does not line up", async () => {
    const cold = await build(deck());
    const cache = cold.built.positionedSlides ?? [];
    // Hand slide 3's layout in for slide 1 after a structural change:
    // a mismatch must fall back, never graft the wrong boxes.
    const structurallyDifferent = `<SlideGlance xmlns="urn:slideglance:builder:v1"><Document size="A4"/>
      <Slide><VStack padding="40"><Text fontSize="20">only one child</Text></VStack></Slide>
    </SlideGlance>`;
    const { slides } = await build(structurallyDifferent, [cache[2]]);
    expect(slides).toHaveLength(1);
    expect(slides[0]).toContain("only one child");
  });
});
