import { defineManifest } from "@crxjs/vite-plugin";
import pkg from "./package.json" with { type: "json" };

// MV3 manifest for the SlideGlance Chrome extension.
//
// Permissions are deliberately narrow:
//   - <all_urls> host so a .pptx URL on any site can be redirected to
//     the viewer and the same URL refetched with the user's cookies.
//   - declarativeNetRequest for the redirect rule (registered
//     dynamically from the service worker because the extension URL
//     isn't known until install time).
//   - contextMenus for the right-click "Open with SlideGlance"
//     entry on .pptx links.
//
// CSP requires 'wasm-unsafe-eval' so the @slideglance/core wasm module
// can be instantiated inside extension pages — without it the viewer
// fails to boot.
export default defineManifest({
  manifest_version: 3,
  // Web Store listing + install confirmation surface. Mirrors the
  // VS Code extension's `displayName` so users see the same product
  // brand on both stores.
  name: "SlideGlance PPTX Viewer",
  // Chrome restricts `short_name` to 12 chars for toolbar tooltips
  // and OS menus; the longer name is truncated unattractively if
  // used here, so keep the bare brand.
  short_name: "SlideGlance",
  description:
    "Open .pptx presentations in your browser — fully local, no upload, no server.",
  version: pkg.version,
  // Web Store listing surfaces this as the "Website" link next to
  // the publisher info; matches the repository.url in core/viewer
  // package.json so users land in the same place no matter which
  // entry point they came from.
  homepage_url: "https://github.com/SlideGlance/slideglance",
  minimum_chrome_version: "120",
  icons: {
    16: "public/icon-16.png",
    32: "public/icon-32.png",
    48: "public/icon-48.png",
    128: "public/icon-128.png",
  },
  action: {
    default_title: "Open .pptx file",
    default_icon: {
      16: "public/icon-16.png",
      32: "public/icon-32.png",
    },
  },
  background: {
    service_worker: "src/background.ts",
    type: "module",
  },
  permissions: ["declarativeNetRequest", "contextMenus"],
  host_permissions: ["<all_urls>"],
  // Font-src must include `data:` so the deck's embedded `@font-face`
  // declarations (mounted by the viewer with `src:url(data:font/ttf;
  // base64,...)`) can actually be applied by the browser. MV3
  // extension_pages otherwise restrict `font-src` to `'self'`, which
  // silently rejects every `data:` URI font without a console error
  // — the visible symptom is text rendering with system sans-serif
  // (wider metrics) and overflowing the deck's text frames into
  // adjacent layout regions.
  content_security_policy: {
    extension_pages:
      "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; font-src 'self' data:",
  },
  web_accessible_resources: [
    {
      resources: ["src/viewer/index.html", "assets/*"],
      matches: ["<all_urls>"],
    },
  ],
});
