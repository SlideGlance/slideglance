#!/usr/bin/env node
// Tiny static file server for previewing the built landing page at
// http://localhost:5179/. No dependencies — uses Node's built-in http
// + fs APIs only.

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "dist");
const port = Number.parseInt(process.env.PORT ?? "5179", 10);

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith("/")) pathname += "index.html";
  const target = normalize(join(root, pathname));
  if (!target.startsWith(root)) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }
  try {
    const info = await stat(target);
    if (info.isDirectory()) {
      const indexPath = join(target, "index.html");
      const indexInfo = await stat(indexPath);
      if (!indexInfo.isFile()) throw new Error("not file");
      res.writeHead(200, {
        "content-type": mime[".html"],
        "cache-control": "no-store",
      });
      createReadStream(indexPath).pipe(res);
      return;
    }
    res.writeHead(200, {
      "content-type": mime[extname(target)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    createReadStream(target).pipe(res);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});

server.listen(port, () => {
  console.log(`[landing] http://localhost:${port}/`);
});
