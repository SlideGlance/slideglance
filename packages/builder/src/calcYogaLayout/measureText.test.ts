import { describe, expect, it } from "vitest";
import { measureText } from "./measureText";

describe("measureText", () => {
  describe("フォントファミリーによる計測方法の切り替え", () => {
    const text = "Hello World";
    const maxWidth = 500;

    it("バンドル済みフォント（Noto Sans JP）では opentype 計測を使用する", () => {
      const opentypeResult = measureText(text, maxWidth, {
        fontFamily: "Noto Sans JP",
        fontSizePx: 24,
      });

      const fallbackResult = measureText(
        text,
        maxWidth,
        {
          fontFamily: "Noto Sans JP",
          fontSizePx: 24,
        },
        "fallback",
      );

      // Confirm opentype and fallback produce different results (=opentype is in effect).
      expect(opentypeResult.widthPx).not.toBe(fallbackResult.widthPx);
    });

    it("Pretendard でも opentype 計測を使用する", () => {
      const opentypeResult = measureText(text, maxWidth, {
        fontFamily: "Pretendard",
        fontSizePx: 24,
      });

      const fallbackResult = measureText(
        text,
        maxWidth,
        {
          fontFamily: "Pretendard",
          fontSizePx: 24,
        },
        "fallback",
      );

      expect(opentypeResult.widthPx).not.toBe(fallbackResult.widthPx);
    });

    it("バンドル外フォントではフォールバック計測を使用する", () => {
      const arialResult = measureText(text, maxWidth, {
        fontFamily: "Arial",
        fontSizePx: 24,
      });

      const fallbackResult = measureText(
        text,
        maxWidth,
        {
          fontFamily: "Arial",
          fontSizePx: 24,
        },
        "fallback",
      );

      // An unbundled font matches the fallback result.
      expect(arialResult.widthPx).toBe(fallbackResult.widthPx);
      expect(arialResult.heightPx).toBe(fallbackResult.heightPx);
    });

    it("mode=fallback が明示された場合はフォントに関係なくフォールバックを使用する", () => {
      const result = measureText(
        text,
        maxWidth,
        {
          fontFamily: "Noto Sans JP",
          fontSizePx: 24,
        },
        "fallback",
      );

      const fallbackDirect = measureText(
        text,
        maxWidth,
        {
          fontFamily: "Arial",
          fontSizePx: 24,
        },
        "fallback",
      );

      // Same fallback computation, so the result is identical.
      expect(result.widthPx).toBe(fallbackDirect.widthPx);
    });

    it("mode=opentype が明示された場合はバンドル外フォントでも opentype 計測を使用する", () => {
      const opentypeForced = measureText(
        text,
        maxWidth,
        {
          fontFamily: "Arial",
          fontSizePx: 24,
        },
        "opentype",
      );

      const fallbackResult = measureText(
        text,
        maxWidth,
        {
          fontFamily: "Arial",
          fontSizePx: 24,
        },
        "fallback",
      );

      // Forcing opentype yields a result distinct from fallback.
      expect(opentypeForced.widthPx).not.toBe(fallbackResult.widthPx);
    });
  });
});
