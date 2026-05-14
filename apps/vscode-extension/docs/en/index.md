---
title: vscode-extension
lang: en
kind: index
app: vscode-extension
last_verified_commit: 0000000000000000000000000000000000000000
source_files:
  - apps/vscode-extension/package.json
  - apps/vscode-extension/src/
---

# vscode-extension

> Part of the SlideGlance workspace.
> See also: [all apps](../../../../docs/en/apps.md) ·
> [@slideglance/builder](../../../../packages/builder/docs/en/index.md).

## What it is

The "SlideGlance PPTX Viewer" VS Code extension. Live preview for `.sgx`
files (the
[`@slideglance/builder`](../../../../packages/builder/docs/en/index.md)
XML DSL) plus a `.pptx` viewer powered by
[`@slideglance/viewer`](../../../../packages/viewer/docs/en/index.md).
Provides click-to-source from the rendered slide and one-command
PPTX export.

## Install

```text
Search "SlideGlance PPTX Viewer" in the Marketplace
or: code --install-extension slideglance.slide-builder
```

## Run it (development)

```sh
pnpm --filter slide-builder dev          # webview vite server
pnpm --filter slide-builder build        # production build
# Open the apps/vscode-extension folder in VS Code and press F5
```

## When to use this

- Authoring decks in `.sgx` XML with a live preview pane.
- Reviewing a `.pptx` without leaving the editor.
- Validating builder XML against the JSON Schema during edit.

## Where to go next

- [Reference](./reference.md)
- [Guides](./guides.md)
- Source: [`apps/vscode-extension/`](../../)
