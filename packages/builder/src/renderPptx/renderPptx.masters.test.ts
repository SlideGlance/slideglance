import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBuildContext } from "../buildContext.ts";

const defineLayout = vi.fn();
const defineSlideMaster = vi.fn();
const addSlide = vi.fn((_opts?: { masterName?: string }) => ({
  addText: vi.fn(),
  addImage: vi.fn(),
  addShape: vi.fn(),
  addTable: vi.fn(),
  addNotes: vi.fn(),
}));

class MockPptxGenJS {
  layout = "";
  defineLayout = defineLayout;
  defineSlideMaster = defineSlideMaster;
  addSlide = addSlide;
}

vi.mock("pptxgenjs", () => ({
  default: MockPptxGenJS,
}));

import { renderPptx } from "./renderPptx.ts";

describe("renderPptx masters", () => {
  beforeEach(() => {
    defineLayout.mockReset();
    defineSlideMaster.mockReset();
    addSlide.mockClear();
  });

  it("default master 와 페이지별 master 를 함께 적용한다", async () => {
    await renderPptx(
      [
        {
          type: "vstack",
          x: 0,
          y: 0,
          w: 1280,
          h: 720,
          children: [],
        },
        {
          type: "vstack",
          x: 0,
          y: 0,
          w: 1280,
          h: 720,
          master: "ALT",
          children: [],
        },
      ] as never,
      { w: 1280, h: 720 },
      createBuildContext({ textMeasurementMode: "fallback" }),
      [
        { title: "PRIMARY", background: { color: "FFFFFF" } },
        {
          title: "ALT",
          objects: [
            {
              type: "rect",
              x: 0,
              y: 0,
              w: 1280,
              h: 40,
              fill: { color: "0F172A" },
            },
          ],
        },
      ],
      "PRIMARY",
    );

    expect(defineSlideMaster).toHaveBeenCalledTimes(2);
    expect(defineSlideMaster.mock.calls[0]?.[0]).toMatchObject({
      title: "PRIMARY",
    });
    expect(defineSlideMaster.mock.calls[1]?.[0]).toMatchObject({
      title: "ALT",
    });
    expect(addSlide.mock.calls[0]?.[0]).toEqual({ masterName: "PRIMARY" });
    expect(addSlide.mock.calls[1]?.[0]).toEqual({ masterName: "ALT" });
  });

  it("slide notes 를 speaker notes 로 기록한다", async () => {
    await renderPptx(
      [
        {
          type: "vstack",
          x: 0,
          y: 0,
          w: 1280,
          h: 720,
          notes: "Presenter note",
          children: [],
        },
      ] as never,
      { w: 1280, h: 720 },
      createBuildContext({ textMeasurementMode: "fallback" }),
    );

    expect(addSlide).toHaveBeenCalledTimes(1);
    const slide = addSlide.mock.results[0]?.value as {
      addNotes: ReturnType<typeof vi.fn>;
    };
    expect(slide.addNotes).toHaveBeenCalledWith("Presenter note");
  });

  it("Master content 를 true master object 로 변환한다", async () => {
    await renderPptx(
      [
        {
          type: "vstack",
          x: 0,
          y: 0,
          w: 1280,
          h: 720,
          children: [],
        },
      ] as never,
      { w: 1280, h: 720 },
      createBuildContext({ textMeasurementMode: "fallback" }),
      [{ title: "PRIMARY" }],
      "PRIMARY",
      {
        PRIMARY: [
          {
            type: "vstack",
            x: 0,
            y: 0,
            w: 1280,
            h: 720,
            backgroundColor: "F8FAFC",
            children: [
              {
                type: "text",
                text: "Header",
                x: 48,
                y: 12,
                w: 200,
                h: 28,
                fontSize: 14,
                color: "111827",
              },
              {
                type: "shape",
                shapeType: "roundRect",
                x: 48,
                y: 64,
                w: 160,
                h: 40,
                text: "CTA",
                fill: { color: "1D4ED8" },
                color: "FFFFFF",
              },
            ],
          },
        ],
      },
    );

    expect(defineSlideMaster).toHaveBeenCalledTimes(1);
    expect(defineSlideMaster.mock.calls[0]?.[0]).toMatchObject({
      title: "PRIMARY",
      background: { color: "F8FAFC" },
    });
    expect(defineSlideMaster.mock.calls[0]?.[0].objects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: expect.objectContaining({
            text: "Header",
          }),
        }),
        expect.objectContaining({
          text: expect.objectContaining({
            text: "CTA",
            options: expect.objectContaining({ shape: "roundRect" }),
          }),
        }),
      ]),
    );
  });

  it("문서 기본 텍스트 스타일을 slide 와 master 에 적용한다", async () => {
    await renderPptx(
      [
        {
          type: "vstack",
          x: 0,
          y: 0,
          w: 1280,
          h: 720,
          children: [
            {
              type: "text",
              text: "Body",
              x: 48,
              y: 48,
              w: 200,
              h: 40,
            },
          ],
        },
      ] as never,
      { w: 1280, h: 720 },
      createBuildContext({
        textMeasurementMode: "fallback",
        defaultTextStyle: {
          fontFamily: "Pretendard",
          fontSize: 20,
          color: "334155",
          bold: true,
        },
      }),
      [
        {
          title: "PRIMARY",
          objects: [
            {
              type: "text",
              text: "Header",
              x: 40,
              y: 12,
              w: 200,
              h: 24,
            },
          ],
          slideNumber: {
            x: 1200,
            y: 680,
          },
        },
      ],
      "PRIMARY",
    );

    expect(defineSlideMaster.mock.calls[0]?.[0]).toMatchObject({
      objects: expect.arrayContaining([
        expect.objectContaining({
          text: expect.objectContaining({
            text: "Header",
            options: expect.objectContaining({
              fontFace: "Pretendard",
              fontSize: 15,
              color: "334155",
              bold: true,
            }),
          }),
        }),
      ]),
      slideNumber: expect.objectContaining({
        fontFace: "Pretendard",
        fontSize: 15,
        color: "334155",
      }),
    });

    const slide = addSlide.mock.results[0]?.value as {
      addText: ReturnType<typeof vi.fn>;
    };
    expect(slide.addText).toHaveBeenCalledWith(
      "Body",
      expect.objectContaining({
        fontFace: "Pretendard",
        fontSize: 15,
        color: "334155",
        bold: true,
      }),
    );
  });

  it("Master content 에서 Icon 과 Svg 도 master object 로 변환한다", async () => {
    await renderPptx(
      [
        {
          type: "vstack",
          x: 0,
          y: 0,
          w: 1280,
          h: 720,
          children: [],
        },
      ] as never,
      { w: 1280, h: 720 },
      createBuildContext({ textMeasurementMode: "fallback" }),
      [{ title: "PRIMARY" }],
      "PRIMARY",
      {
        PRIMARY: [
          {
            type: "layer",
            x: 0,
            y: 0,
            w: 1280,
            h: 720,
            children: [
              {
                type: "icon",
                name: "star",
                x: 48,
                y: 32,
                w: 32,
                h: 32,
                variant: "circle-filled",
                bgColor: "1D4ED8",
                iconImageData: "data:image/png;base64,ICON",
                bgX: 40,
                bgY: 24,
                bgW: 48,
                bgH: 48,
                iconX: 48,
                iconY: 32,
                iconW: 32,
                iconH: 32,
              },
              {
                type: "svg",
                svgContent: "<svg/>",
                x: 120,
                y: 24,
                w: 64,
                h: 64,
                iconImageData: "data:image/png;base64,SVG",
              },
            ],
          },
        ],
      },
    );

    expect(defineSlideMaster).toHaveBeenCalledTimes(1);
    expect(defineSlideMaster.mock.calls[0]?.[0].objects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: expect.objectContaining({
            text: "",
            options: expect.objectContaining({ shape: "ellipse" }),
          }),
        }),
        expect.objectContaining({
          image: expect.objectContaining({
            data: "data:image/png;base64,ICON",
          }),
        }),
        expect.objectContaining({
          image: expect.objectContaining({
            data: "data:image/png;base64,SVG",
          }),
        }),
      ]),
    );
  });

  it("Master content 의 Table 은 true master 로 변환하지 못하면 에러를 던진다", async () => {
    await expect(
      renderPptx(
        [
          {
            type: "vstack",
            x: 0,
            y: 0,
            w: 1280,
            h: 720,
            children: [],
          },
        ] as never,
        { w: 1280, h: 720 },
        createBuildContext({ textMeasurementMode: "fallback" }),
        [{ title: "PRIMARY" }],
        "PRIMARY",
        {
          PRIMARY: [
            {
              type: "table",
              x: 0,
              y: 0,
              w: 200,
              h: 64,
              columns: [{ width: 100 }, { width: 100 }],
              rows: [{ cells: [{ text: "A" }, { text: "B" }] }],
            },
          ],
        },
      ),
    ).rejects.toThrow("Table nodes are not supported in true slide masters");
  });
});

describe('renderPptx <SlideNumber count="numbered">', () => {
  beforeEach(() => {
    defineLayout.mockReset();
    defineSlideMaster.mockReset();
    addSlide.mockClear();
  });

  /** A page tree that carries nothing but its master reference. */
  const page = (master?: string) =>
    ({
      type: "vstack",
      x: 0,
      y: 0,
      w: 794,
      h: 1123,
      ...(master ? { master } : {}),
      children: [],
    }) as never;

  const numberedMaster = (title: string, startAt?: number) => ({
    title,
    slideNumber: {
      x: 374,
      y: 1081,
      w: 46,
      h: 16,
      fontSize: 9,
      color: "6B7280",
      textAlign: "center" as const,
      count: "numbered" as const,
      ...(startAt === undefined ? {} : { startAt }),
    },
  });

  /** The folio strings passed to addText, slide by slide. */
  const folios = () =>
    addSlide.mock.results.map((r) => {
      const slide = r.value as { addText: ReturnType<typeof vi.fn> };
      const call = slide.addText.mock.calls.find(
        (c) => (c[1] as { objectName?: string })?.objectName === "Slide Number",
      );
      return call ? (call[0] as string) : null;
    });

  it("counts only the slides whose master carries a folio", async () => {
    await renderPptx(
      [page("COVER"), page("COVER"), page("BODY"), page("BODY"), page("ANNEX")],
      { w: 794, h: 1123 },
      createBuildContext({ textMeasurementMode: "fallback" }),
      [{ title: "COVER" }, numberedMaster("BODY"), { title: "ANNEX" }],
      "BODY",
    );

    // The two cover pages and the appendix print nothing; the body pages
    // start at 1 rather than at their position in the deck (3 and 4).
    expect(folios()).toEqual([null, null, "1", "2", null]);
  });

  it("does not register the live placeholder for a numbered master", async () => {
    await renderPptx(
      [page("BODY")],
      { w: 794, h: 1123 },
      createBuildContext({ textMeasurementMode: "fallback" }),
      [numberedMaster("BODY")],
      "BODY",
    );

    expect(defineSlideMaster.mock.calls[0]?.[0]).not.toHaveProperty(
      "slideNumber",
    );
  });

  it("keeps the live placeholder when count is absent", async () => {
    await renderPptx(
      [page("BODY")],
      { w: 794, h: 1123 },
      createBuildContext({ textMeasurementMode: "fallback" }),
      [{ title: "BODY", slideNumber: { x: 374, y: 1081 } }],
      "BODY",
    );

    expect(defineSlideMaster.mock.calls[0]?.[0]).toHaveProperty("slideNumber");
    expect(folios()).toEqual([null]);
  });

  it("starts the count at startAt", async () => {
    await renderPptx(
      [page("BODY"), page("BODY")],
      { w: 794, h: 1123 },
      createBuildContext({ textMeasurementMode: "fallback" }),
      [numberedMaster("BODY", 12)],
      "BODY",
    );

    expect(folios()).toEqual(["12", "13"]);
  });

  it("continues one count across every numbered master", async () => {
    // A proposal splits its body into one master per part; the folio runs
    // through them rather than restarting at each.
    await renderPptx(
      [page("PART-1"), page("BODY-1"), page("PART-2"), page("BODY-2")],
      { w: 794, h: 1123 },
      createBuildContext({ textMeasurementMode: "fallback" }),
      [
        numberedMaster("PART-1"),
        numberedMaster("BODY-1"),
        numberedMaster("PART-2"),
        numberedMaster("BODY-2"),
      ],
      "BODY-1",
    );

    expect(folios()).toEqual(["1", "2", "3", "4"]);
  });

  it("rejects numbered masters that disagree on startAt", async () => {
    await expect(
      renderPptx(
        [page("BODY-1")],
        { w: 794, h: 1123 },
        createBuildContext({ textMeasurementMode: "fallback" }),
        [numberedMaster("BODY-1", 1), numberedMaster("BODY-2", 5)],
        "BODY-1",
      ),
    ).rejects.toThrow(/startAt disagrees across masters/);
  });

  it("places the folio with the geometry and type the master declared", async () => {
    await renderPptx(
      [page("BODY")],
      { w: 794, h: 1123 },
      createBuildContext({
        textMeasurementMode: "fallback",
        defaultTextStyle: { fontFamily: "Pretendard" },
      }),
      [numberedMaster("BODY")],
      "BODY",
    );

    const slide = addSlide.mock.results[0]?.value as {
      addText: ReturnType<typeof vi.fn>;
    };
    expect(slide.addText).toHaveBeenCalledWith(
      "1",
      expect.objectContaining({
        x: 374 / 96,
        y: 1081 / 96,
        w: 46 / 96,
        h: 16 / 96,
        fontSize: 9 * 0.75,
        fontFace: "Pretendard",
        color: "6B7280",
        align: "center",
        // The live placeholder anchors at the top; the static folio must
        // sit in the same place or switching `count` moves it.
        valign: "top",
        objectName: "Slide Number",
      }),
    );
  });
});
