#!/usr/bin/env node
/**
 * Render banner.png (2560×640) and social-preview.png (1280×640) from wordmark.html.
 */
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const studio = path.join(root, "studio");
const require = createRequire(path.join(studio, "package.json"));
const { chromium } = require("playwright");
const htmlPath = path.join(__dirname, "wordmark.html");
const assetsDir = path.join(root, "assets");

mkdirSync(assetsDir, { recursive: true });

async function shot(browser, { id, width, height, scale, out }) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: scale,
  });
  const page = await context.newPage();
  await page.goto(`file://${htmlPath}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
  });
  // Keep only the target frame
  await page.evaluate((keepId) => {
    for (const el of document.querySelectorAll(".frame")) {
      if (el.id !== keepId) el.remove();
    }
    document.body.style.margin = "0";
  }, id);
  await page.locator(`#${id}`).screenshot({
    path: path.join(assetsDir, out),
    type: "png",
  });
  await context.close();
  console.log(`wrote assets/${out} (${width * scale}×${height * scale} CSS×scale)`);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  await shot(browser, {
    id: "banner",
    width: 1280,
    height: 320,
    scale: 2,
    out: "banner.png",
  });
  await shot(browser, {
    id: "social",
    width: 1280,
    height: 640,
    scale: 1,
    out: "social-preview.png",
  });
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
