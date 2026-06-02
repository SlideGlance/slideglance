// Convert store-assets/promo-tile.svg -> store-assets/promo-tile-440x280.png,
// the Chrome Web Store "small promo tile" (required, 440x280). Run on
// demand when the tile design changes; intentionally not wired into the
// production build (the tile rarely changes and is not shipped in dist/).
//
//   node scripts/render-promo.mjs
import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFile } from "node:fs/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const svgPath = resolve(__dirname, "../store-assets/promo-tile.svg");
const outPath = resolve(__dirname, "../store-assets/promo-tile-440x280.png");

// Higher render density keeps the wordmark and vector edges crisp before
// the final resize to the exact 440x280 the Web Store requires.
const svg = await readFile(svgPath);
await sharp(svg, { density: 192 }).resize(440, 280).png().toFile(outPath);
console.log(`wrote ${outPath}`);
