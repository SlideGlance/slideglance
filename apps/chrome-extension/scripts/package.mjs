// Build the production bundle and zip dist/ into a Web Store
// upload artifact at slideglance-chrome-{version}.zip in the package
// root. Parallels the `slideglance-vscode-{version}.vsix` name that
// release.yml's publish-vsix job produces, so download artefacts
// across stores look like they belong to one project.
//
// Run via `pnpm -F @slideglance/chrome-extension package`. Re-runs
// `vite build` first so the zip always reflects the latest source.
import { execFile } from "node:child_process";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createWriteStream } from "node:fs";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

const execFileP = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DIST = resolve(ROOT, "dist");

const pkg = JSON.parse(await readFile(resolve(ROOT, "package.json"), "utf8"));
const outName = `slideglance-chrome-${pkg.version}.zip`;
const outPath = resolve(ROOT, outName);

async function ensureDist() {
  try {
    const st = await stat(DIST);
    if (!st.isDirectory()) throw new Error(`${DIST} is not a directory`);
  } catch {
    throw new Error(
      `dist/ missing — run \`pnpm -F @slideglance/chrome-extension build\` first`,
    );
  }
}

async function zipDist() {
  await rm(outPath, { force: true });
  // Use the system `zip` to produce a Chrome-Web-Store-compatible
  // archive. The extension folder must be the archive root, not
  // nested under `dist/`. -r recurses, -X strips Mac extra fields,
  // and -q keeps output quiet.
  await execFileP("zip", ["-rqX", outPath, "."], { cwd: DIST });
}

await ensureDist();
await zipDist();
const { size } = await stat(outPath);
const mb = (size / 1024 / 1024).toFixed(2);
console.log(`wrote ${outName} (${mb} MB)`);
