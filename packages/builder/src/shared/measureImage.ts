import * as fs from "fs";
import { imageSize } from "image-size";
import type { DiagnosticCollector } from "../diagnostics.ts";

/**
 * Formats a PPTX can carry, and the only ones handed to `image-size`.
 *
 * `image-size` dispatches on the magic bytes it finds, and its ICNS,
 * JXL and HEIF parsers can spin forever on crafted input
 * (GHSA-w3rx-r6r6-pgpr, GHSA-5p2g-fcmc-qvqq — no fixed release as of
 * 2.0.2). None of those three can go into a deck, and one source here
 * is a remote URL, so the buffer is checked before the parser sees it.
 * @param buffer First bytes of the image.
 * @returns `true` when the bytes open with a supported image signature.
 */
function isSupportedImage(buffer: Uint8Array): boolean {
  const startsWith = (...bytes: number[]): boolean =>
    bytes.every((b, i) => buffer[i] === b);
  const ascii = (offset: number, text: string): boolean =>
    [...text].every((c, i) => buffer[offset + i] === c.charCodeAt(0));

  // PNG, JPEG, GIF, BMP, TIFF (both byte orders), WebP.
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return true;
  if (startsWith(0xff, 0xd8, 0xff)) return true;
  if (ascii(0, "GIF87a") || ascii(0, "GIF89a")) return true;
  if (ascii(0, "BM")) return true;
  if (startsWith(0x49, 0x49, 0x2a, 0x00)) return true;
  if (startsWith(0x4d, 0x4d, 0x00, 0x2a)) return true;
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return true;

  // SVG is text; skip a UTF-8 BOM and any leading whitespace, then look
  // for the document or root element.
  let i = startsWith(0xef, 0xbb, 0xbf) ? 3 : 0;
  while (i < buffer.length && buffer[i] !== undefined && buffer[i]! <= 0x20)
    i++;
  return ascii(i, "<?xml") || ascii(i, "<svg") || ascii(i, "<!--");
}

/**
 * Measures `buffer`, refusing formats a deck cannot carry.
 * @param buffer Image bytes.
 * @returns Width and height in pixels.
 * @throws When the bytes are not a supported image format.
 */
function measureSupported(buffer: Uint8Array): {
  width?: number;
  height?: number;
} {
  if (!isSupportedImage(buffer)) {
    throw new Error(
      "unsupported image format — a deck carries PNG, JPEG, GIF, BMP, TIFF, WebP or SVG",
    );
  }
  return imageSize(buffer);
}

type ImageSizeCache = Map<string, { widthPx: number; heightPx: number }>;
type ImageDataCache = Map<string, string>;

/**
 * Read cached image data (Base64).
 * @param src Image path.
 * @param cache imagedatacache
 * @returns Image data in Base64, or `undefined` when not cached.
 */
export function getImageData(
  src: string,
  cache: ImageDataCache,
): string | undefined {
  return cache.get(src);
}

/**
 * Prefetch and cache image sizes (async).
 * Used when handling HTTPS URL images.
 * @param src Image path (local path, base64 data, or HTTPS URL).
 * @param sizeCache imagesizecache
 * @param dataCache imagedatacache
 * @returns image width and height（px）
 */
export async function prefetchImageSize(
  src: string,
  sizeCache: ImageSizeCache,
  dataCache: ImageDataCache,
  diagnostics: DiagnosticCollector,
): Promise<{
  widthPx: number;
  heightPx: number;
}> {
  // Return the cached value when present.
  const cached = sizeCache.get(src);
  if (cached) {
    return cached;
  }

  try {
    let buffer: Uint8Array;

    // base64 data case.
    if (src.startsWith("data:")) {
      const base64Data = src.split(",")[1] ?? "";
      buffer = new Uint8Array(Buffer.from(base64Data, "base64"));
    }
    // HTTPS/HTTP URL case.
    else if (src.startsWith("https://") || src.startsWith("http://")) {
      const response = await fetch(src);
      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      buffer = new Uint8Array(arrayBuffer);

      // Cache image data as Base64 (for pptxgenjs).
      const contentType = response.headers.get("content-type") || "image/png";
      const base64 = Buffer.from(arrayBuffer).toString("base64");
      dataCache.set(src, `${contentType};base64,${base64}`);
    }
    // Local file-path case.
    else {
      buffer = new Uint8Array(fs.readFileSync(src));
    }

    const dimensions = measureSupported(buffer);

    const width = dimensions.width ?? 100; // default100px
    const height = dimensions.height ?? 100; // default100px

    const result = {
      widthPx: width,
      heightPx: height,
    };

    // Store in cache.
    sizeCache.set(src, result);

    return result;
  } catch (error) {
    // Return the default size on error.
    diagnostics.add(
      "IMAGE_MEASURE_FAILED",
      `Failed to measure image size for ${src}: ${String(error)}`,
    );
    const result = {
      widthPx: 100,
      heightPx: 100,
    };
    sizeCache.set(src, result);
    return result;
  }
}

/**
 * Read an image file's size (sync).
 * Pre-warm the cache via `prefetchImageSize`.
 * @param src Image path (local path, base64 data, or HTTPS URL).
 * @param sizeCache imagesizecache
 * @returns image width and height（px）
 */
export function measureImage(
  src: string,
  sizeCache: ImageSizeCache,
  diagnostics: DiagnosticCollector,
): {
  widthPx: number;
  heightPx: number;
} {
  // Return the cached value when present.
  const cached = sizeCache.get(src);
  if (cached) {
    return cached;
  }

  // Cache miss: only local files or base64 can be handled synchronously.
  try {
    let buffer: Uint8Array;

    // base64 data case.
    if (src.startsWith("data:")) {
      const base64Data = src.split(",")[1] ?? "";
      buffer = new Uint8Array(Buffer.from(base64Data, "base64"));
    }
    // HTTPS/HTTP URLs: return the default size when not cached.
    else if (src.startsWith("https://") || src.startsWith("http://")) {
      diagnostics.add(
        "IMAGE_NOT_PREFETCHED",
        `Image size for URL ${src} was not prefetched. Using default size.`,
      );
      return {
        widthPx: 100,
        heightPx: 100,
      };
    }
    // Local file-path case.
    else {
      buffer = new Uint8Array(fs.readFileSync(src));
    }

    const dimensions = measureSupported(buffer);

    const width = dimensions.width ?? 100; // default100px
    const height = dimensions.height ?? 100; // default100px

    const result = {
      widthPx: width,
      heightPx: height,
    };

    // Store in cache.
    sizeCache.set(src, result);

    return result;
  } catch (error) {
    // Return the default size on error.
    diagnostics.add(
      "IMAGE_MEASURE_FAILED",
      `Failed to measure image size for ${src}: ${String(error)}`,
    );
    return {
      widthPx: 100,
      heightPx: 100,
    };
  }
}
