// Post-build verifier — scans every .html file under dist/ for relative
// href values that do not resolve to an existing file inside dist/. Surfaces
// broken links (e.g. a deep-link target whose codegen output didn't ship)
// before they reach production.

import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export async function verifyLinks(distRoot) {
  const failures = [];
  await walk(distRoot, async (filePath) => {
    if (!filePath.endsWith(".html")) return;
    const html = await readFile(filePath, "utf8");
    const hrefs = [...html.matchAll(/href="([^"#?]+)(?:[?#][^"]*)?"/g)].map(
      (m) => m[1],
    );
    for (const href of hrefs) {
      if (/^[a-z]+:|^\/\//i.test(href) || href === "" || href.startsWith("#"))
        continue;
      const abs = resolve(dirname(filePath), href);
      const target = abs.endsWith("/") ? join(abs, "index.html") : abs;
      try {
        await stat(target);
      } catch {
        failures.push({ from: filePath, href, resolved: target });
      }
    }
  });
  return failures;
}

async function walk(dir, fn) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, fn);
    else await fn(p);
  }
}
