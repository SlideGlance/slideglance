#!/usr/bin/env node
/*
 * sync-versions.mjs — propagate the workspace's single version source
 * (root `package.json`'s `version` field) to every place that needs
 * to ship the same number:
 *
 *   - All workspace `packages/<x>/package.json` and
 *     `apps/<x>/package.json` `version` fields.
 *   - Root `Cargo.toml`'s `[workspace.package].version` and the
 *     `version = "X.Y.Z"` slot inside every `[workspace.dependencies]`
 *     internal-crate entry (`slideglance-utils`, `slideglance-png`,
 *     `slideglance`, ...).
 *
 * Run modes:
 *   - default: write changes in-place. Hooked into `pnpm prebuild` so
 *     a stale checkout can never ship a desynced bundle.
 *   - --check: exit 1 if any file would change. Use in CI to assert
 *     the tree is in sync without mutating it.
 *
 * Why this exists: PowerPoint deck rendering is a tightly-versioned
 * surface (Chrome Store + npm + crates.io all publish in lockstep). A
 * mismatch between the WASM crate version and the JS viewer version
 * silently causes confusing fallback behaviour. Single source of
 * truth in the root removes the class of bug entirely.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..");

const checkOnly = process.argv.includes("--check");

const rootPkg = JSON.parse(
  readFileSync(join(repoRoot, "package.json"), "utf-8"),
);
const targetVersion = rootPkg.version;
if (typeof targetVersion !== "string" || !/^\d+\.\d+\.\d+/.test(targetVersion)) {
  console.error(
    `[sync-versions] root package.json has no usable "version" — got: ${JSON.stringify(targetVersion)}`,
  );
  process.exit(2);
}

const packageJsonTargets = [
  "packages/core/package.json",
  "packages/measure/package.json",
  "packages/viewer/package.json",
  "apps/chrome-extension/package.json",
  "apps/web-playground/package.json",
  "apps/desktop-viewer/package.json",
];

const cargoTargets = [
  "Cargo.toml",
  // slideglance-wasm and slideglance-measure-wasm pin their package
  // versions inline because wasm-pack's manifest parser cannot resolve
  // workspace inheritance — see the comment in those crates' Cargo.toml.
  // Sync applies the same regex (matches the first `version = "..."`
  // line in each file, which is the [package] one).
  "crates/slideglance-wasm/Cargo.toml",
  "crates/slideglance-measure-wasm/Cargo.toml",
];

const drift = [];

function syncPackageJson(relPath) {
  const full = join(repoRoot, relPath);
  const original = readFileSync(full, "utf-8");
  const obj = JSON.parse(original);
  if (obj.version === targetVersion) return;
  drift.push(`${relPath}: ${obj.version} → ${targetVersion}`);
  if (checkOnly) return;
  obj.version = targetVersion;
  // Preserve trailing newline like the rest of the workspace.
  writeFileSync(full, JSON.stringify(obj, null, 2) + "\n");
}

function syncCargoToml(relPath) {
  const full = join(repoRoot, relPath);
  const original = readFileSync(full, "utf-8");
  // Match `version = "X.Y.Z"` in the [workspace.package] table.
  let updated = original.replace(
    /(\[workspace\.package\][\s\S]*?\nversion\s*=\s*")([^"]+)(")/,
    (_m, p1, prev, p3) => {
      if (prev === targetVersion) return _m;
      drift.push(`${relPath}: [workspace.package] ${prev} → ${targetVersion}`);
      return `${p1}${targetVersion}${p3}`;
    },
  );
  // Match a `[package]` block's inline `version = "X.Y.Z"` line.
  // Used by `crates/slideglance-wasm/Cargo.toml`, which cannot
  // inherit from the workspace because wasm-pack's parser rejects
  // `field.workspace = true` on `version` / `license` / etc.
  updated = updated.replace(
    /(\[package\][\s\S]*?\nversion\s*=\s*")([^"]+)(")/,
    (_m, p1, prev, p3) => {
      if (prev === targetVersion) return _m;
      drift.push(`${relPath}: [package] ${prev} → ${targetVersion}`);
      return `${p1}${targetVersion}${p3}`;
    },
  );
  // Match each `slideglance-* = { path = "...", version = "X.Y.Z" }`
  // declaration inside [workspace.dependencies] — keeps internal crate
  // pins aligned with the published version of the workspace.
  updated = updated.replace(
    /(\bslideglance(?:-[a-z]+)?\s*=\s*\{\s*path\s*=\s*"[^"]+"\s*,\s*version\s*=\s*")([^"]+)(")/g,
    (_m, p1, prev, p3) => {
      if (prev === targetVersion) return _m;
      drift.push(`${relPath}: workspace dep pin ${prev} → ${targetVersion}`);
      return `${p1}${targetVersion}${p3}`;
    },
  );
  if (updated === original) return;
  if (checkOnly) return;
  writeFileSync(full, updated);
}

for (const t of packageJsonTargets) syncPackageJson(t);
for (const t of cargoTargets) syncCargoToml(t);

if (drift.length === 0) {
  console.log(`[sync-versions] all targets already at ${targetVersion}`);
  process.exit(0);
}

if (checkOnly) {
  console.error("[sync-versions] DRIFT detected (run `pnpm version:sync` to fix):");
  for (const line of drift) console.error("  " + line);
  process.exit(1);
}

console.log(`[sync-versions] propagated ${targetVersion} →`);
for (const line of drift) console.log("  " + line);
