---
title: vscode-extension — Reference
lang: en
kind: reference
app: vscode-extension
last_verified_commit: 93952eafcabba0eb4e38b1d79738462835c3e5c3
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
├── package.json            # extension manifest (publisher: simplecore, id: slide-builder)
├── esbuild.mjs             # extension-host bundle (CommonJS, target=node) + XML catalog plugin
├── vite.webview.config.ts  # webview bundle (ESM, target=es2022, WASM + top-level-await)
├── icon.svg / icon.png     # icon.png is the manifest icon; icon.svg is the source
├── icons/                  # command icons (dark/light variants)
├── src/
│   ├── extension.ts        # activation, command registration, XML catalog registration
│   ├── preview.ts          # .sgx live-preview webview lifecycle
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
| `publisher`                 | `simplecore`                                                                            |
| `name`                      | `slide-builder`                                                                         |
| `displayName`               | `SlideGlance PPTX Viewer`                                                               |
| `engines.vscode`            | `^1.85.0`                                                                               |
| `categories`                | `Visualization`                                                                         |
| `extensionDependencies`     | `redhat.vscode-xml`                                                                     |
| `activationEvents`          | `workspaceContains:**/*.sgx`, `onCustomEditor:slideBuilder.pptxViewer`                  |
| `contributes.commands`      | `SlideGlance: Open Preview`, `SlideGlance: Refresh Preview`, `SlideGlance: Export PPTX` |
| `contributes.languages`     | id `xml` (alias `SlideGlance XML`) bound to the `.sgx` extension                        |
| `contributes.customEditors` | `slideBuilder.pptxViewer` for `*.pptx` (`priority: option`)                             |

`.sgx` schema validation is not a `jsonValidation` contribution. The
extension writes an OASIS XML catalog next to `dist/extension.js` and
registers it with `redhat.vscode-xml` at activation
(`src/extension.ts` → `registerXmlCatalog`), so the
`urn:slideglance:builder:v1` namespace resolves to the bundled
`dist/builder.xsd`.

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
