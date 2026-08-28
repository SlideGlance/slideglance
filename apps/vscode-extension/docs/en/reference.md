---
title: vscode-extension — Reference
lang: en
kind: reference
app: vscode-extension
last_verified_commit: ffd91b05b9e540c1d1c4dd3b8533f3485bcf20da
source_files:
  - apps/vscode-extension/package.json
  - apps/vscode-extension/esbuild.mjs
  - apps/vscode-extension/vite.webview.config.ts
  - apps/vscode-extension/src/
---

# vscode-extension — Reference

## App layout

```
apps/vscode-extension/
├── package.json            # extension manifest (publisher: slideglance, id: slide-builder)
├── esbuild.mjs             # extension-host bundle (CommonJS, target=node) + XML catalog plugin
├── vite.webview.config.ts  # webview bundle (ESM, target=es2022, WASM + top-level-await)
├── vitest.config.ts        # unit tests for the host-side modules
├── icon.svg / icon.png     # icon.png is the manifest icon; icon.svg is the source
├── icons/                  # command icons (dark/light variants)
├── src/
│   ├── extension.ts        # activation, command registration, XML catalog registration
│   ├── preview.ts          # .sgx live-preview webview lifecycle
│   ├── coalescingRunner.ts # one-at-a-time job runner behind the preview
│   ├── pptxViewer.ts       # .pptx custom-editor lifecycle
│   ├── exportPptx.ts       # "Export PPTX" command
│   ├── definitionProvider.ts  # go-to-definition for imports / template placeholders
│   ├── importResolver.ts   # <Import> resolution for the builder
│   ├── webviewHtml.ts      # webview HTML shell
│   ├── fileUtils.ts        # .sgx detection helpers
│   └── webview/            # React preview app (main.tsx, index.html)
├── dist/                   # build output (host bundle, webview assets, XSD, catalog, WASM)
└── docs/en/{index,reference,guides}.md
```

## Manifest highlights (`package.json`)

| Field                       | Value                                                                                   |
| --------------------------- | --------------------------------------------------------------------------------------- |
| `publisher`                 | `slideglance`                                                                           |
| `name`                      | `slide-builder`                                                                         |
| `displayName`               | `SlideGlance PPTX Viewer`                                                               |
| `engines.vscode`            | `^1.85.0`                                                                               |
| `categories`                | `Visualization`                                                                         |
| `extensionDependencies`     | none — `redhat.vscode-xml` is a soft dependency (see below)                             |
| `activationEvents`          | `onLanguage:xml`, `onCustomEditor:slideBuilder.pptxViewer`                              |
| `contributes.commands`      | `SlideGlance: Open Preview`, `SlideGlance: Refresh Preview`, `SlideGlance: Export PPTX` |
| `contributes.languages`     | id `xml` (alias `SlideGlance XML`) bound to the `.sgx` extension                        |
| `contributes.customEditors` | `slideBuilder.pptxViewer` for `*.pptx` (`priority: option`)                             |

`.sgx` files are contributed as the `xml` language, so `onLanguage:xml`
fires the moment one is opened — including a single file opened with no
folder, which a `workspaceContains` glob never covered.

`.sgx` schema validation is not a `jsonValidation` contribution. The
extension writes an OASIS XML catalog next to `dist/extension.js` and
registers it with `redhat.vscode-xml` at activation
(`src/extension.ts` → `registerXmlCatalog`), so the
`urn:slideglance:builder:v1` namespace resolves to the bundled
`dist/builder.xsd`.

`redhat.vscode-xml` is deliberately **not** in `extensionDependencies`.
VS Code activates every declared dependency to completion before
activating the dependent one, and that extension's `activate` waits on a
Java runtime probe and a LemMinX language-server boot. Gating on it
holds this extension's commands, diagnostics, and navigation behind that
boot. When it is missing, `registerXmlCatalog` offers the install
once (recorded in `globalState` under
`slideBuilder.xmlExtensionPromptShown`) and everything except schema
validation works without it.

The `.sgx` title-bar buttons do not wait for activation at all: their
menu `when` clause is `slideBuilder.isActive || resourceExtname == .sgx`,
and `resourceExtname` is a built-in context key. The
`slideBuilder.isActive` half still covers `.xml` documents that opt in
by declaring the namespace on their root element, which only the
extension itself can detect.

## Settings

| Setting                                  | Default | Meaning                                                                                                 |
| ---------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------- |
| `slideglance.preview.slowRenderNoticeMs` | `15000` | How long a preview render may run before the preview reports it is still working. `0` hides the notice. |

The notice is not a deadline. The build keeps running and its deck is
still delivered when it finishes — the builder has no cancellation, so
abandoning a render would spend the same CPU and throw the finished deck
away. Renders are also serialized: one build runs at a time, and edits
that land while it runs collapse into a single rebuild
(`src/coalescingRunner.ts`).

## Build artefacts (`dist/`)

| Path                      | Purpose                                             |
| ------------------------- | --------------------------------------------------- |
| `dist/extension.js`       | CommonJS extension-host bundle (esbuild)            |
| `dist/webview/`           | Webview React app (Vite) + worker / WASM assets     |
| `dist/builder.xsd`        | Bundled XSD for `.sgx` schema validation            |
| `dist/xml-catalog.xml`    | OASIS catalog registered with `redhat.vscode-xml`   |
| `dist/*.wasm`             | slideglance core + measure WASM (host-side builder) |
| `*.vsix` (CI, gitignored) | Marketplace upload package (`vsce package`)         |

## Scripts (`pnpm --filter slide-builder run <script>`)

| Script              | Purpose                                     |
| ------------------- | ------------------------------------------- |
| `build`             | Production build (webview + extension host) |
| `build:webview`     | Vite build → `dist/webview/`                |
| `build:host`        | esbuild → `dist/extension.js`               |
| `watch:host`        | esbuild watch (extension host only)         |
| `test`              | `vitest run` (host-side unit tests)         |
| `typecheck`         | `tsc --noEmit`                              |
| `lint`              | ESLint                                      |
| `fmt` / `fmt:check` | Prettier write / check                      |
| `package`           | `vsce package --no-dependencies` → `.vsix`  |
| `publish`           | `vsce publish --no-dependencies`            |

There is no `dev` script — the webview is built (not served via HMR);
the `.sgx` preview re-renders on save inside the Extension Development
Host (F5).

VS Code launches the extension via the F5 launch config, attaching a
debugger to the extension host running `dist/extension.js`.
