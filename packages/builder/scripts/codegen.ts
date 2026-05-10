#!/usr/bin/env -S node --experimental-strip-types
/**
 * Entry point for `pnpm run codegen`.
 *
 * Generates:
 *   dist-schema/builder.xsd          — XML Schema
 *   dist-schema/builder.schema.json  — JSON Schema for BuilderNode
 *   dist-schema/.codegen-hash.json   — content hashes for CI verify
 *   dist-schema/reference.md         — human-readable node reference
 *
 * Flags:
 *   --check    do not write; re-emit, hash, and exit non-zero on drift
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { generateXsd } from "../src/codegen/xsd.ts";
import { generateJsonSchemaString } from "../src/codegen/jsonSchema.ts";
import { generateNodesMd } from "../src/codegen/docs.ts";
import {
  buildHashRecord,
  sha256,
  verifyAgainstHashes,
  type CodegenHashes,
} from "../src/codegen/verify.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, "..");

const OUTPUTS = {
  "dist-schema/builder.xsd": () => generateXsd(),
  "dist-schema/builder.schema.json": () => generateJsonSchemaString(),
  // Generated reference published alongside the schema artifacts. The
  // hand-curated `docs/nodes.md` (with rich XML samples) remains as the
  // primary user-facing doc.
  "dist-schema/reference.md": () => generateNodesMd(),
};

function main(): void {
  const isCheck = process.argv.includes("--check");

  // Generate
  const generated: Record<string, string> = {};
  for (const [rel, gen] of Object.entries(OUTPUTS)) {
    generated[rel] = gen();
  }

  if (isCheck) {
    const hashPath = join(PKG, "dist-schema/.codegen-hash.json");
    if (!existsSync(hashPath)) {
      console.error(
        "Codegen --check failed: dist-schema/.codegen-hash.json is missing. Run `pnpm run codegen` and commit.",
      );
      process.exit(1);
    }
    const recorded: CodegenHashes = JSON.parse(readFileSync(hashPath, "utf8"));
    const v = verifyAgainstHashes(generated, recorded);
    if (!v.ok) {
      console.error("Codegen drift detected:");
      for (const d of v.diffs) {
        console.error(`  ${d.file}: ${d.reason}`);
      }
      console.error(
        "Re-run `pnpm run codegen` and commit the regenerated files.",
      );
      process.exit(1);
    }
    // Compare against on-disk content too — hashes alone don't catch a
    // committed-but-stale generated file.
    for (const rel of Object.keys(generated)) {
      const onDiskPath = join(PKG, rel);
      if (!existsSync(onDiskPath)) {
        console.error(`Codegen --check: missing on-disk file ${rel}`);
        process.exit(1);
      }
      const onDisk = readFileSync(onDiskPath, "utf8");
      if (sha256(onDisk) !== sha256(generated[rel])) {
        console.error(
          `Codegen --check: ${rel} on-disk content differs from regenerated.`,
        );
        process.exit(1);
      }
    }
    console.log("✔ Codegen check passed.");
    return;
  }

  // Write outputs
  for (const [rel, content] of Object.entries(generated)) {
    const abs = join(PKG, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
    console.log(`✔ ${rel} (${content.length} bytes)`);
  }

  // Write hash record
  const hashRel = "dist-schema/.codegen-hash.json";
  const hashAbs = join(PKG, hashRel);
  const record = buildHashRecord(generated);
  // Strip generatedAt for stable diffs across runs.
  const stable = { ...record, generatedAt: "" };
  writeFileSync(hashAbs, JSON.stringify(stable, null, 2) + "\n");
  console.log(`✔ ${hashRel}`);
}

main();
