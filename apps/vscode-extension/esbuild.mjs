// esbuild config for the EXTENSION HOST bundle (Node target).
//
// The webview bundle is built separately by Vite (see
// `vite.webview.config.ts`) because the slideglance worker chunk
// requires `vite-plugin-wasm` + `vite-plugin-top-level-await` to
// resolve `@slideglance/core`'s WASM module — esbuild has no
// equivalent.

import * as esbuild from "esbuild";
import fs from "fs";
import path from "path";
import { createRequire } from "module";

const watch = process.argv.includes("--watch");

// Copy the @slideglance/measure WASM (used at extension-host runtime
// by `@slideglance/builder`'s measureText) next to the bundled
// `extension.js` — pom resolves the wasm via `__dirname/<name>_bg.wasm`,
// and after esbuild bundles pom's CJS into extension.js, that
// `__dirname` resolves to the bundle output directory.
function makeWasmCopyPlugin(packageEntry, wasmFileName) {
  return {
    name: `${wasmFileName}-copy`,
    setup(build) {
      const pkgRequire = createRequire(import.meta.url);
      const nodeEntry = pkgRequire.resolve(packageEntry);
      const wasmSrc = path.join(path.dirname(nodeEntry), wasmFileName);
      build.onEnd(() => {
        const outdir = path.dirname(build.initialOptions.outfile);
        fs.mkdirSync(outdir, { recursive: true });
        fs.copyFileSync(wasmSrc, path.join(outdir, wasmFileName));
      });
    },
  };
}

const slideglanceMeasureWasmPlugin = makeWasmCopyPlugin(
  "@slideglance/measure/node",
  "slideglance_measure_wasm_bg.wasm",
);

// `@resvg/resvg-wasm` ships a WASM binary loaded by the builder's icon
// renderer. Copy it next to the bundle so the builder's `createRequire`
// resolves it from the same directory.
const resvgWasmPlugin = {
  name: "resvg-wasm-copy",
  setup(build) {
    const builderDir = path.resolve(
      import.meta.dirname,
      "../../packages/builder",
    );
    const builderRequire = createRequire(path.join(builderDir, "package.json"));
    const wasmSrc = builderRequire.resolve("@resvg/resvg-wasm/index_bg.wasm");
    const outdir = path.dirname(build.initialOptions.outfile);
    const wasmDest = path.join(outdir, "index_bg.wasm");
    build.onEnd(() => {
      fs.mkdirSync(outdir, { recursive: true });
      fs.copyFileSync(wasmSrc, wasmDest);
    });
  },
};

// builder's `renderIcon.js` uses a dynamic `createRequire(import.meta.url)`
// to load `@resvg/resvg-wasm`, which esbuild cannot statically analyse.
// Rewrite to a static require so the dependency lands in the bundle.
const resvgModulePlugin = {
  name: "resvg-module-resolve",
  setup(build) {
    const targetSuffix = path.join("dist", "icons", "renderIcon.js");
    build.onLoad({ filter: /renderIcon\.js$/ }, async (args) => {
      if (!args.path.endsWith(targetSuffix)) return undefined;
      let contents = await fs.promises.readFile(args.path, "utf8");
      const original = contents;
      contents = contents.replace(
        /const req = createRequire\(import\.meta\.url\);\s*\n\s*const mod = req\(RESVG_PKG\)/,
        'const mod = require("@resvg/resvg-wasm")',
      );
      if (contents === original) {
        throw new Error(
          "Failed to patch renderIcon.js: dynamic require pattern not found.",
        );
      }
      contents = contents.replace(
        /fileURLToPath\(import\.meta\.url\)/g,
        "__filename",
      );
      contents = contents.replace(
        /createRequire\(import\.meta\.url\)/g,
        "createRequire(__filename)",
      );
      return { contents, loader: "js" };
    });
  },
};

// Copies @slideglance/builder's `builder.xsd` next to the bundle and
// writes an OASIS XML catalog redirecting the unpkg URL (and the
// `urn:slideglance:builder:v1` namespace) to the local copy. The
// extension's activate() registers this catalog with the RedHat XML
// extension so `.sgx` files validate without depending on a published
// npm package.
const xmlCatalogPlugin = {
  name: "xml-catalog-copy",
  setup(build) {
    const builderXsdSrc = path.resolve(
      import.meta.dirname,
      "../../packages/builder/builder.xsd",
    );
    build.onEnd(() => {
      const outdir = path.dirname(build.initialOptions.outfile);
      fs.mkdirSync(outdir, { recursive: true });
      fs.copyFileSync(builderXsdSrc, path.join(outdir, "builder.xsd"));
      const catalog = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<catalog xmlns="urn:oasis:names:tc:entity:xmlns:xml:catalog">',
        '  <uri name="urn:slideglance:builder:v1" uri="./builder.xsd"/>',
        '  <system systemId="https://unpkg.com/@slideglance/builder@^0.1/builder.xsd" uri="./builder.xsd"/>',
        "</catalog>",
        "",
      ].join("\n");
      fs.writeFileSync(path.join(outdir, "xml-catalog.xml"), catalog);
    });
  },
};

// CJS bundles set `import.meta.url` to an empty string, which breaks
// downstream calls like `createRequire(import.meta.url)`. Rewrite to
// `__filename` so those calls resolve relative to the bundle output.
const importMetaPlugin = {
  name: "import-meta-url-shim",
  setup(build) {
    build.onLoad({ filter: /\.js$/, namespace: "file" }, async (args) => {
      if (args.path.includes("node_modules")) return undefined;
      const contents = await fs.promises.readFile(args.path, "utf8");
      if (!contents.includes("import.meta.url")) return undefined;
      return {
        contents: contents.replace(/import\.meta\.url/g, "__filename"),
        loader: "js",
      };
    });
  },
};

/** @type {import('esbuild').BuildOptions} */
const buildOptions = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  external: ["vscode"],
  loader: { ".node": "copy" },
  format: "cjs",
  platform: "node",
  target: "node18",
  sourcemap: true,
  plugins: [
    slideglanceMeasureWasmPlugin,
    resvgWasmPlugin,
    resvgModulePlugin,
    xmlCatalogPlugin,
    importMetaPlugin,
  ],
};

if (watch) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.log("Watching for changes...");
} else {
  await esbuild.build(buildOptions);
  console.log("Build complete");
}
