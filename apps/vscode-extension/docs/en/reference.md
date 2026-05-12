---
title: vscode-extension — Reference
lang: en
kind: reference
app: vscode-extension
last_verified_commit: 0000000000000000000000000000000000000000
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
├── esbuild.mjs             # extension-side bundle (CommonJS, target=node)
├── vite.webview.config.ts  # webview-side bundle (ESM, target=es2022)
├── icon.svg / icon.png
├── icons/                  # category and file-type icons
├── src/
│   ├── extension.ts        # extension activation
│   ├── preview.ts          # webview lifecycle
│   ├── webview/            # React-based preview pane
│   └── …
├── dist/                   # both bundles + webview assets
└── docs/en/{index,reference,guides}.md
```

## Manifest highlights (`package.json`)

| Field | Value |
|---|---|
| `publisher` | `slideglance` |
| `name` | `slide-builder` |
| `engines.vscode` | `^1.85.0` |
| `categories` | "Programming Languages", "Other" |
| `activationEvents` | On `.sgx` file open, on `.pptx` file open |
| `contributes.commands` | "Slide Builder: Preview", "Slide Builder: Export PPTX" |
| `contributes.languages` | `slidegx` for `.sgx` files |
| `contributes.jsonValidation` | Maps `.sgx` to `builder.schema.json` |

## Build artefacts

| Path | Purpose |
|---|---|
| `dist/extension.js` | CommonJS bundle (esbuild) |
| `dist/webview/` | Webview React app (Vite) |
| `dist/icons/` | File-type and category icons |
| `*.vsix` (CI) | Marketplace upload package |

## Commands

| Script | Purpose |
|---|---|
| `pnpm --filter slide-builder dev` | Webview HMR via Vite |
| `pnpm --filter slide-builder build` | Production build (extension + webview) |
| `pnpm --filter slide-builder typecheck` | `tsc --noEmit` |
| `pnpm --filter slide-builder lint` | ESLint |

VS Code launches the extension via the F5 launch config; this
attaches a debugger to the extension host running `dist/extension.js`.
