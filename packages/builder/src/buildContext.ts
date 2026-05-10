import type { TextMeasurementMode } from "./calcYogaLayout/measureText.ts";
import type { DefaultTextStyle } from "./types.ts";
import {
  normalizeDefaultTextStyle,
  type ResolvedDefaultTextStyle,
} from "./defaultTextStyle.ts";
import { DiagnosticCollector } from "./diagnostics.ts";
import type { ImageSrcGuardOptions } from "./options.ts";

/** Resolved security configuration threaded through the build pipeline. */
export interface SecurityConfig {
  /** Allowed URL schemes for <A href>. Always populated (defaults applied). */
  allowedHrefSchemes: ReadonlySet<string>;
  /** Optional guard for <Image src> / <Master backgroundPath>. Undefined = disabled (OD3). */
  imageSrcGuard: ImageSrcGuardOptions | undefined;
}

export interface BuildContext {
  textMeasurementMode: TextMeasurementMode;
  defaultTextStyle: ResolvedDefaultTextStyle;
  imageSizeCache: Map<string, { widthPx: number; heightPx: number }>;
  imageDataCache: Map<string, string>;
  iconRasterCache: Map<string, string>;
  diagnostics: DiagnosticCollector;
  security: SecurityConfig;
  /** Fallback BCP 47 lang tag for text runs without an explicit lang. Undefined = no fallback. */
  defaultLang: string | undefined;
}

const DEFAULT_HREF_SCHEMES = ["https:", "http:", "mailto:", "tel:"];

export function createBuildContext(
  textMeasurementMode: TextMeasurementMode = "auto",
  defaultTextStyle?: DefaultTextStyle,
  allowedHrefSchemes?: string[],
  imageSrcGuard?: ImageSrcGuardOptions,
  defaultLang?: string,
): BuildContext {
  const mergedSchemes = allowedHrefSchemes
    ? [...DEFAULT_HREF_SCHEMES, ...allowedHrefSchemes]
    : DEFAULT_HREF_SCHEMES;
  return {
    textMeasurementMode,
    defaultTextStyle: normalizeDefaultTextStyle(defaultTextStyle),
    imageSizeCache: new Map(),
    imageDataCache: new Map(),
    iconRasterCache: new Map(),
    diagnostics: new DiagnosticCollector(),
    security: {
      allowedHrefSchemes: new Set(mergedSchemes),
      imageSrcGuard,
    },
    defaultLang,
  };
}
