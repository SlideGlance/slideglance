import {
  measureTextWidth as measureTextWidthOpentype,
  isBundledFont,
  pickBundledFontForText,
} from "./fontLoader.ts";

type MeasureOptions = {
  fontFamily: string;
  fontSizePx: number;
  fontWeight?: "normal" | "bold" | number;
  lineHeight?: number;
};

export type TextMeasurementMode = "opentype" | "fallback" | "auto";

/**
 * Whether `char` is a CJK / wide-Asian character. Used by the
 * fallback width estimator to give CJK glyphs ≈ 1em while Latin and
 * other narrow scripts get ≈ 0.5em.
 */
function isCJKChar(char: string): boolean {
  const code = char.codePointAt(0);
  if (code === undefined) return false;

  // CJK Unified Ideographs
  if (code >= 0x4e00 && code <= 0x9fff) return true;
  // CJK Unified Ideographs Extension A
  if (code >= 0x3400 && code <= 0x4dbf) return true;
  // CJK Unified Ideographs Extensions B-F
  if (code >= 0x20000 && code <= 0x2ebef) return true;
  // Hiragana
  if (code >= 0x3040 && code <= 0x309f) return true;
  // Katakana
  if (code >= 0x30a0 && code <= 0x30ff) return true;
  // Full-width ASCII / symbols
  if (code >= 0xff00 && code <= 0xffef) return true;
  // CJK symbols and punctuation
  if (code >= 0x3000 && code <= 0x303f) return true;
  // Hangul syllables
  if (code >= 0xac00 && code <= 0xd7a3) return true;
  // Hangul jamo
  if (code >= 0x1100 && code <= 0x11ff) return true;
  // Hangul compatibility jamo
  if (code >= 0x3130 && code <= 0x318f) return true;
  // Hangul jamo extended-A
  if (code >= 0xa960 && code <= 0xa97f) return true;
  // Hangul jamo extended-B
  if (code >= 0xd7b0 && code <= 0xd7ff) return true;

  return false;
}

/**
 * Fallback character-width estimate.
 * - CJK / wide character: 1em (= fontSizePx)
 * - Latin / narrow character: 0.5em
 */
function estimateCharWidth(char: string, fontSizePx: number): number {
  if (isCJKChar(char)) {
    return fontSizePx; // 1em
  }
  return fontSizePx * 0.5; // 0.5em
}

/**
 * Fallback text-width estimate (sum of per-character widths).
 */
function estimateTextWidth(text: string, fontSizePx: number): number {
  let width = 0;
  for (const char of text) {
    width += estimateCharWidth(char, fontSizePx);
  }
  return width;
}

/** Per-text width measurement function. */
type MeasureTextWidthFn = (text: string) => number;

/**
 * Wrap `text` to fit within `maxWidthPx` and return per-line widths.
 */
function wrapText(
  text: string,
  maxWidthPx: number,
  measureWidth: MeasureTextWidthFn,
): { widthPx: number }[] {
  const paragraphs = text.split("\n");
  const lines: { widthPx: number }[] = [];

  for (const paragraph of paragraphs) {
    if (paragraph === "") {
      lines.push({ widthPx: 0 });
      continue;
    }

    const words = splitForWrap(paragraph);
    let current = "";
    let currentWidth = 0;

    for (const word of words) {
      const candidate = current ? current + word : word;
      const w = measureWidth(candidate);

      if (w <= maxWidthPx || !current) {
        current = candidate;
        currentWidth = w;
      } else {
        lines.push({ widthPx: currentWidth });
        current = word;
        currentWidth = measureWidth(word);
      }
    }

    if (current) {
      lines.push({ widthPx: currentWidth });
    }
  }

  return lines;
}

/**
 * Reduce the per-line widths to an overall {widthPx, heightPx} box.
 */
function calculateResult(
  lines: { widthPx: number }[],
  opts: MeasureOptions,
): { widthPx: number; heightPx: number } {
  const lineHeightRatio = opts.lineHeight ?? 1.0;
  const lineHeightPx = opts.fontSizePx * lineHeightRatio;
  const widthPx = lines.length ? Math.max(...lines.map((l) => l.widthPx)) : 0;
  const heightPx = lines.length * lineHeightPx;
  // Add a 10px safety margin to absorb fractional rounding.
  return { widthPx: widthPx + 10, heightPx };
}

/** Normalize a `fontWeight` value to `"normal" | "bold"`. */
function normalizeFontWeight(
  weight: "normal" | "bold" | number | undefined,
): "normal" | "bold" {
  if (weight === "bold" || weight === 700) {
    return "bold";
  }
  return "normal";
}

/**
 * Lay out `text` with wrapping and return the resulting box size.
 */
export function measureText(
  text: string,
  maxWidthPx: number,
  opts: MeasureOptions,
  mode: TextMeasurementMode = "auto",
): {
  widthPx: number;
  heightPx: number;
} {
  // Pick the measurement strategy:
  //   - "opentype" / "fallback": honour the explicit caller choice.
  //   - "auto": use opentype for bundled families, fallback otherwise.
  const shouldUseFallback = (() => {
    switch (mode) {
      case "opentype":
        return false;
      case "fallback":
        return true;
      case "auto":
        return !isBundledFont(opts.fontFamily);
    }
  })();

  if (shouldUseFallback) {
    return measureTextFallback(text, maxWidthPx, opts);
  }

  return measureTextWithOpentype(text, maxWidthPx, opts);
}

/** Opentype-backed text measurement via the slideglance measurer. */
function measureTextWithOpentype(
  text: string,
  maxWidthPx: number,
  opts: MeasureOptions,
): { widthPx: number; heightPx: number } {
  const fontWeight = normalizeFontWeight(opts.fontWeight);
  // Script-aware fallback: when the caller's family isn't bundled,
  // pick Pretendard for Hangul-dominant text and the default
  // (Noto Sans JP — covers CJK + Latin) otherwise.
  const bundledFontFamily = pickBundledFontForText(opts.fontFamily, text);
  const lines = wrapText(text, maxWidthPx, (t) =>
    measureTextWidthOpentype(t, bundledFontFamily, opts.fontSizePx, fontWeight),
  );
  return calculateResult(lines, opts);
}

/** Fallback (heuristic) text measurement that doesn't load any fonts. */
function measureTextFallback(
  text: string,
  maxWidthPx: number,
  opts: MeasureOptions,
): { widthPx: number; heightPx: number } {
  const { fontSizePx } = opts;
  const lines = wrapText(text, maxWidthPx, (t) =>
    estimateTextWidth(t, fontSizePx),
  );
  return calculateResult(lines, opts);
}

// Wrap-time tokenisation:
// - Latin scripts: split on whitespace, attaching trailing whitespace
//   to the preceding token so widths add up exactly when concatenated.
// - CJK: split per character, since word boundaries aren't whitespace.
function splitForWrap(text: string): string[] {
  // Heuristic: if the text contains any Hiragana/Katakana/Han/Hangul
  // glyph, treat the whole string as character-segmented. Mixed
  // scripts in slide content are rare; the only side effect is that
  // Latin sub-strings get tokenised one char at a time (still a
  // valid wrap).
  const hasCJK =
    /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}\p{Script=Hangul}]/u.test(
      text,
    );

  if (hasCJK) {
    return Array.from(text); // one glyph ≈ one token
  }

  // Latin-script wrapping: a word + trailing whitespace forms one token.
  const tokens: string[] = [];
  const re = /(\S+\s*|\s+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    tokens.push(m[0]);
  }
  return tokens;
}
