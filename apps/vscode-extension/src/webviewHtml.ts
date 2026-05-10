/**
 * Shared webview HTML builder for the .sgx live preview and the .pptx
 * custom editor. Both surfaces mount the same slideglance/viewer React
 * shell from `dist/webview/index.html`; the only thing that changes is
 * which side feeds it bytes — `PreviewPanel` rebuilds them from XML on
 * every edit, `PptxViewerProvider` reads them straight from disk.
 *
 * Centralising the index.html → CSP/asset rewriting here keeps both
 * call-sites in lockstep when the bundled webview changes (script
 * nonce, blob: rules, asset rewrite rules).
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as vscode from "vscode";

function getNonce(): string {
  return crypto.randomBytes(16).toString("hex");
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function buildErrorBootHtml(message: string): string {
  return `<!DOCTYPE html><html><body style="font-family:sans-serif;padding:24px;">
<pre style="white-space:pre-wrap;color:#f48771;">${escapeHtml(message)}</pre>
</body></html>`;
}

/**
 * Read Vite's emitted `dist/webview/index.html`, rewrite every relative
 * `src=` / `href=` to a `webview://` URI, and inject a CSP that permits
 * the script nonce plus the wasm/blob/cdn rules the slideglance worker
 * needs to bootstrap. Returns a self-contained HTML string ready to
 * assign to `webview.html`.
 */
export function buildWebviewHtml(
  extensionUri: vscode.Uri,
  webview: vscode.Webview,
): string {
  const nonce = getNonce();
  const distUri = vscode.Uri.joinPath(extensionUri, "dist", "webview");
  const indexPath = vscode.Uri.joinPath(distUri, "index.html").fsPath;

  let raw: string;
  try {
    raw = fs.readFileSync(indexPath, "utf8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return buildErrorBootHtml(
      `Failed to load webview bundle: ${msg}\nDid you run \`pnpm --filter builder-vscode run build\`?`,
    );
  }

  const cspSource = webview.cspSource;
  // Vite emits `<script type="module" src="/assets/...">` (root-absolute)
  // when built; rewrite into webview URIs so VS Code serves them from
  // `dist/webview/` via `localResourceRoots`.
  raw = raw.replace(
    /(src|href)="(\.?\/[^"]+)"/g,
    (_match, attr: string, rel: string) => {
      const cleaned = rel.replace(/^\.?\//, "");
      const uri = webview.asWebviewUri(vscode.Uri.joinPath(distUri, cleaned));
      return `${attr}="${uri.toString()}"`;
    },
  );

  // Vite emits no inline content; every external module tag needs the
  // nonce so the CSP accepts it.
  raw = raw.replace(/<script(\s|>)/g, `<script nonce="${nonce}"$1`);

  const csp = [
    `default-src 'none'`,
    `img-src ${cspSource} blob: data:`,
    `style-src ${cspSource} 'unsafe-inline'`,
    // `wasm-unsafe-eval` allows `WebAssembly.compile`/`instantiate`
    // (slideglance's core). `blob:` permits the same-origin Blob
    // wrapper that bootstraps the slideglance worker — VS Code
    // webviews block direct cross-origin Worker URLs (the resource
    // cdn lives at a different origin), so the wrapper imports the
    // real worker URL from a blob it owns.
    `script-src 'nonce-${nonce}' 'wasm-unsafe-eval' blob: ${cspSource}`,
    `worker-src ${cspSource} blob:`,
    `font-src ${cspSource} data:`,
    // The slideglance worker fetches its sibling chunks (the wasm shim +
    // `.wasm` payload) via `fetch()`. The main-thread inliner in
    // `webview/main.tsx` materializes those payloads as same-origin
    // `blob:` URLs and rewrites the worker source to use them, so both
    // the main webview origin (`${cspSource}`) and `blob:` must be
    // allowed for `connect-src`.
    `connect-src ${cspSource} blob:`,
  ].join("; ");

  raw = raw.replace(
    /<head>/,
    `<head>\n  <meta http-equiv="Content-Security-Policy" content="${csp}">`,
  );

  return raw;
}
