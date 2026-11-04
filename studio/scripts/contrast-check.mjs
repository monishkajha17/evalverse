#!/usr/bin/env node
/**
 * Colour-contrast check for Studio dashboard (.studio).
 *
 * 1) Sets theme in localStorage via page.addInitScript BEFORE navigation.
 * 2) Runs axe colour-contrast on .studio.
 * 3) Custom WCAG check on sidebar links, selects, chips, buttons, table headers
 *    and the brand — uses computed colour including inherited opacity vs effective
 *    background; fails below 4.5:1.
 *
 * Usage: npm run build && npm run contrast
 * Or: CONTRAST_BASE_URL=http://127.0.0.1:3000 node scripts/contrast-check.mjs
 */

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "out");
const MIN_RATIO = 4.5;

const PAGES = [
  { name: "Home", path: "/overview/" },
  { name: "Traces", path: "/traces/" },
  {
    name: "Trace detail",
    path: `/traces/view/?id=${encodeURIComponent("muse-spark-1.3|cord_total_01|clean")}`,
  },
  { name: "Sessions", path: "/sessions/" },
  { name: "Evaluators", path: "/evaluators/" },
  { name: "Online evaluation", path: "/online-evaluation/" },
  { name: "Playground", path: "/playground/" },
  { name: "Settings", path: "/settings/" },
];

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
    srv.on("error", reject);
  });
}

async function startStaticServer() {
  if (!existsSync(outDir)) {
    throw new Error("Missing studio/out — run `npm run build` first.");
  }
  const port = await findFreePort();
  const child = spawn(
    "npx",
    ["--yes", "serve", outDir, "-l", `tcp://127.0.0.1:${port}`],
    {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, FORCE_COLOR: "0" },
    },
  );
  const base = `http://127.0.0.1:${port}`;
  await new Promise((resolve, reject) => {
    let settled = false;
    const done = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(probe);
      if (err) reject(err);
      else resolve();
    };
    const timer = setTimeout(() => done(new Error("serve timed out")), 30000);
    const probe = setInterval(async () => {
      try {
        const res = await fetch(`${base}/overview/`);
        if (res.ok || res.status === 404) done();
      } catch {
        /* keep waiting */
      }
    }, 400);
    child.on("error", (e) => done(e));
    child.on("exit", (code) => {
      if (code && code !== 0) done(new Error(`serve exited ${code}`));
    });
  });
  return {
    base,
    stop: () =>
      new Promise((resolve) => {
        child.on("exit", () => resolve());
        child.kill("SIGTERM");
        setTimeout(resolve, 500);
      }),
  };
}

/** Theme must be in localStorage before first paint / navigation. */
async function applyThemeInit(page, theme) {
  await page.addInitScript((t) => {
    try {
      localStorage.removeItem("evalverse.session");
      localStorage.removeItem("evalverse.connection");
      localStorage.setItem("evalverse.theme", t);
    } catch {
      /* ignore */
    }
    document.documentElement.classList.remove("dark", "light");
    document.documentElement.classList.add(t);
    document.documentElement.style.colorScheme = t;
  }, theme);
}

/**
 * In-page custom WCAG contrast audit for chrome text nodes.
 * Returns { violations, lowest }.
 */
async function customContrastAudit(page, pageName, theme) {
  return page.evaluate(
    ({ pageName, theme, minRatio }) => {
      function parseColor(str) {
        if (!str || str === "transparent") return null;
        const m = str.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/i);
        if (!m) return null;
        return {
          r: Number(m[1]),
          g: Number(m[2]),
          b: Number(m[3]),
          a: m[4] != null ? Number(m[4]) : 1,
        };
      }

      function srgbToLin(c) {
        const v = c / 255;
        return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      }

      function luminance({ r, g, b }) {
        return 0.2126 * srgbToLin(r) + 0.7152 * srgbToLin(g) + 0.0722 * srgbToLin(b);
      }

      function blend(fg, bg) {
        const a = Math.max(0, Math.min(1, fg.a));
        if (a >= 1) return { r: fg.r, g: fg.g, b: fg.b, a: 1 };
        return {
          r: fg.r * a + bg.r * (1 - a),
          g: fg.g * a + bg.g * (1 - a),
          b: fg.b * a + bg.b * (1 - a),
          a: 1,
        };
      }

      function contrastRatio(fg, bg) {
        const L1 = luminance(fg);
        const L2 = luminance(bg);
        const lighter = Math.max(L1, L2);
        const darker = Math.min(L1, L2);
        return (lighter + 0.05) / (darker + 0.05);
      }

      function effectiveOpacity(el) {
        let o = 1;
        let n = el;
        while (n && n !== document.documentElement) {
          const op = getComputedStyle(n).opacity;
          const v = op === "" ? 1 : Number(op);
          if (!Number.isNaN(v)) o *= v;
          n = n.parentElement;
        }
        return o;
      }

      function effectiveBackground(el) {
        let n = el;
        while (n && n !== document.documentElement) {
          const bg = parseColor(getComputedStyle(n).backgroundColor);
          if (bg && bg.a > 0.01) {
            // Composite over body if translucent
            if (bg.a < 0.99) {
              const bodyBg =
                parseColor(getComputedStyle(document.body).backgroundColor) || {
                  r: 5,
                  g: 10,
                  b: 20,
                  a: 1,
                };
              return blend(bg, bodyBg);
            }
            return { r: bg.r, g: bg.g, b: bg.b, a: 1 };
          }
          n = n.parentElement;
        }
        return (
          parseColor(getComputedStyle(document.body).backgroundColor) || {
            r: 255,
            g: 255,
            b: 255,
            a: 1,
          }
        );
      }

      function describe(el) {
        const id = el.id ? `#${el.id}` : "";
        const cls =
          typeof el.className === "string" && el.className
            ? `.${el.className.trim().split(/\s+/).slice(0, 3).join(".")}`
            : "";
        const tag = el.tagName.toLowerCase();
        const text = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40);
        return `${tag}${id}${cls}${text ? ` "${text}"` : ""}`;
      }

      const root = document.querySelector(".studio");
      if (!root) {
        return {
          violations: [
            {
              page: pageName,
              theme,
              target: ".studio",
              ratio: 0,
              failureSummary: "Missing .studio root",
            },
          ],
          lowest: { ratio: 0, target: ".studio", page: pageName, theme },
        };
      }

      const selectors = [
        '[data-studio-brand]',
        'nav[aria-label="Primary"] a',
        'nav[aria-label="Primary"] .label-mono',
        'nav[aria-label="Primary"] .studio-nav-group',
        "[data-studio-select]",
        ".studio-select",
        "[data-studio-chip]",
        ".studio-chip",
        ".studio button",
        ".studio th",
        ".studio thead th",
      ];

      const seen = new Set();
      const samples = [];

      for (const sel of selectors) {
        for (const el of root.querySelectorAll(sel)) {
          if (!(el instanceof HTMLElement)) continue;
          if (seen.has(el)) continue;
          seen.add(el);
          const style = getComputedStyle(el);
          if (style.display === "none" || style.visibility === "hidden") continue;
          const rect = el.getBoundingClientRect();
          if (rect.width < 1 || rect.height < 1) continue;

          let fg = parseColor(style.color);
          if (!fg) continue;
          const op = effectiveOpacity(el);
          fg = { ...fg, a: (fg.a == null ? 1 : fg.a) * op };
          const bg = effectiveBackground(el);
          const solid = blend(fg, bg);
          const ratio = contrastRatio(solid, bg);
          samples.push({
            page: pageName,
            theme,
            target: describe(el),
            selector: sel,
            ratio,
            fg: style.color,
            opacity: op,
            bg: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})`,
          });
        }
      }

      samples.sort((a, b) => a.ratio - b.ratio);
      const violations = samples
        .filter((s) => s.ratio < minRatio)
        .map((s) => ({
          page: s.page,
          theme: s.theme,
          target: s.target,
          ratio: Number(s.ratio.toFixed(2)),
          failureSummary: `${s.ratio.toFixed(2)}:1 (fg ${s.fg} · opacity ${s.opacity.toFixed(2)} · bg ${s.bg})`,
        }));

      const lowest = samples[0]
        ? {
            ratio: Number(samples[0].ratio.toFixed(2)),
            target: samples[0].target,
            page: samples[0].page,
            theme: samples[0].theme,
            failureSummary: `${samples[0].ratio.toFixed(2)}:1 on ${samples[0].target}`,
          }
        : { ratio: Infinity, target: "(none)", page: pageName, theme };

      return { violations, lowest, sampleCount: samples.length };
    },
    { pageName, theme, minRatio: MIN_RATIO },
  );
}

async function scan(page, base, route, theme) {
  // Init script BEFORE navigation (required)
  await applyThemeInit(page, theme);

  const url = `${base}${route.path}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector(".studio", { timeout: 15000 });
  await page.waitForTimeout(500);

  // Confirm theme stuck after hydration
  const applied = await page.evaluate((t) => {
    const has = document.documentElement.classList.contains(t);
    const stored = localStorage.getItem("evalverse.theme");
    if (!has || stored !== t) {
      document.documentElement.classList.remove("dark", "light");
      document.documentElement.classList.add(t);
      document.documentElement.style.colorScheme = t;
      localStorage.setItem("evalverse.theme", t);
      return false;
    }
    return true;
  }, theme);
  if (!applied) await page.waitForTimeout(200);

  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .include(".studio")
    .analyze();

  const axeNodes = [];
  for (const v of (axe.violations || []).filter((x) => x.id === "color-contrast")) {
    for (const n of v.nodes || []) {
      axeNodes.push({
        page: route.name,
        theme,
        path: route.path,
        source: "axe",
        target: (n.target || []).join(" "),
        ratio: null,
        failureSummary: (n.failureSummary || "").split("\n")[0],
      });
    }
  }

  const custom = await customContrastAudit(page, route.name, theme);
  return {
    axe: axeNodes,
    custom: custom.violations || [],
    lowest: custom.lowest,
    sampleCount: custom.sampleCount || 0,
  };
}

async function main() {
  const external = process.env.CONTRAST_BASE_URL;
  let base = external;
  let stop = async () => {};
  if (!base) {
    const srv = await startStaticServer();
    base = srv.base;
    stop = srv.stop;
  }

  const browser = await chromium.launch({ headless: true });
  const light = [];
  const dark = [];
  let lowestOverall = { ratio: Infinity, target: "(none)", page: "", theme: "" };

  try {
    for (const theme of ["light", "dark"]) {
      for (const route of PAGES) {
        const context = await browser.newContext();
        const page = await context.newPage();
        try {
          const result = await scan(page, base, route, theme);
          const hits = [...result.axe, ...result.custom];
          if (theme === "light") light.push(...hits);
          else dark.push(...hits);

          if (result.lowest && result.lowest.ratio < lowestOverall.ratio) {
            lowestOverall = result.lowest;
          }

          process.stdout.write(
            `[${theme}] ${route.name}: axe=${result.axe.length} custom=${result.custom.length} (samples ${result.sampleCount}, lowest ${result.lowest?.ratio})\n`,
          );
        } catch (e) {
          console.error(`Failed ${theme} ${route.name}:`, e.message || e);
          const hit = {
            page: route.name,
            theme,
            path: route.path,
            source: "error",
            target: "(navigation)",
            ratio: 0,
            failureSummary: String(e.message || e),
          };
          if (theme === "light") light.push(hit);
          else dark.push(hit);
        } finally {
          await context.close();
        }
      }
    }
  } finally {
    await browser.close();
    await stop();
  }

  console.log("\n=== Contrast check summary ===");
  console.log(`LIGHT violations: ${light.length}`);
  console.log(`DARK violations:  ${dark.length}`);
  if (Number.isFinite(lowestOverall.ratio)) {
    console.log(
      `Lowest ratio: ${lowestOverall.ratio}:1 — [${lowestOverall.theme}/${lowestOverall.page}] ${lowestOverall.target}`,
    );
  }

  if (dark.length) {
    console.log("\nDARK violations:");
    for (const v of dark) {
      console.log(`- [${v.page}] ${v.target}${v.ratio != null ? ` (${v.ratio}:1)` : ""}`);
      if (v.failureSummary) console.log(`  ${v.failureSummary}`);
    }
  }

  if (light.length) {
    console.log("\nLIGHT violations:");
    for (const v of light) {
      console.log(`- [${v.page}] ${v.target}${v.ratio != null ? ` (${v.ratio}:1)` : ""}`);
      if (v.failureSummary) console.log(`  ${v.failureSummary}`);
    }
  }

  if (light.length || dark.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
