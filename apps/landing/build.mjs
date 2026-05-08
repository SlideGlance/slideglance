#!/usr/bin/env node
// Stage the static landing page into ./dist by copying index.html,
// styles.css, the SlideGlance icon, and the chrome-extension store
// screenshots side-by-side. The same layout the GitHub Pages workflow
// publishes so a developer can preview locally before deploying.

import { copyFile, cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const dist = join(here, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(join(dist, "screenshots"), { recursive: true });

await copyFile(join(here, "index.html"), join(dist, "index.html"));
await copyFile(join(here, "styles.css"), join(dist, "styles.css"));
await copyFile(
  join(repoRoot, "assets", "icon", "source.svg"),
  join(dist, "icon.svg"),
);

const shotDir = join(
  repoRoot,
  "apps",
  "chrome-extension",
  "store-assets",
  "screenshots",
);
const shots = (await readdir(shotDir)).filter((name) =>
  name.toLowerCase().endsWith(".png"),
);
for (const name of shots) {
  await copyFile(join(shotDir, name), join(dist, "screenshots", name));
}

// If the playground has already been built locally, mirror it under
// dist/playground/ so the overlay iframe has something to load when the
// user previews via `node serve.mjs`. The Pages workflow performs the
// equivalent copy in a separate step, so the local build is purely a
// developer-experience nicety.
const playgroundDist = join(repoRoot, "apps", "web-playground", "dist");
let playgroundFiles = 0;
try {
  const info = await stat(playgroundDist);
  if (info.isDirectory()) {
    await cp(playgroundDist, join(dist, "playground"), { recursive: true });
    playgroundFiles = (await readdir(join(dist, "playground"))).length;
  }
} catch {
  // Playground not built — overlay iframe will be empty until the
  // developer runs `pnpm --filter @slideglance/web-playground build`.
}

const playgroundNote =
  playgroundFiles > 0
    ? `, playground (${playgroundFiles} entries)`
    : ", no playground (run web-playground build for the overlay)";
console.log(
  `[landing] built -> ${dist} (${shots.length} screenshots, 1 icon${playgroundNote})`,
);
