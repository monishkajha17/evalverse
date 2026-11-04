#!/usr/bin/env node
/**
 * Capture Studio README screenshots via Playwright.
 * Starts `npm run dev` with NEXT_PUBLIC_MODE=snapshot, light theme, signed out.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
} from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const studio = path.join(root, "studio");
const require = createRequire(path.join(studio, "package.json"));
const { chromium } = require("playwright");
const imgDir = path.join(root, "docs", "img");
const dataDir = path.join(studio, "public", "data");

const VIEWPORT = { width: 1440, height: 900 };
const SCALE = 2;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const BAD_RE = /\b(?:error|401|unreachable|Server)\b/;

mkdirSync(imgDir, { recursive: true });

function loadJson(name) {
  return JSON.parse(readFileSync(path.join(dataDir, name), "utf8"));
}

function pickTraceByLabel(suiteFile, label, opts = {}) {
  const data = loadJson(suiteFile);
  const runs = (data.runs || []).filter((r) => r.label === label);
  let pool = runs;
  if (opts.caseSuffix) {
    pool = pool.filter((r) => String(r.case_id || "").endsWith(opts.caseSuffix));
  }
  if (opts.condition) {
    pool = pool.filter((r) => r.condition === opts.condition);
  }
  // Prefer cases where boxes diverge (evidence_ok false) for overlays
  pool.sort((a, b) => {
    const ae = a.evidence_ok === false ? 0 : 1;
    const be = b.evidence_ok === false ? 0 : 1;
    if (ae !== be) return ae - be;
    return 0;
  });
  const hit = pool[0];
  if (!hit) return null;
  const id = `${hit.agent}|${hit.case_id}|${hit.condition}`;
  const suite = suiteFile.replace(/\.json$/, "");
  return { id, suite, run: hit };
}

function pickParallelGraphTrace() {
  // Prefer audio (parallel transcription spans → model_call); else video
  for (const file of ["audio.json", "video.json"]) {
    const data = loadJson(file);
    for (const t of data.traces || []) {
      const model = (t.spans || []).find((s) => s.type === "model" || s.name === "model_call");
      if (!model) continue;
      const parents = new Set(model.parent_span_ids || []);
      if (parents.size >= 3) {
        return { id: t.id, suite: file.replace(/\.json$/, ""), trace: t };
      }
    }
  }
  return null;
}

function crossmodalCaseCount() {
  try {
    const idx = loadJson("index.json");
    const entry = (Array.isArray(idx) ? idx : []).find((e) => e.suite === "crossmodal");
    return entry?.n_cases ?? 0;
  } catch {
    return 0;
  }
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = typeof srv.address() === "object" ? srv.address().port : 0;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
    srv.on("error", reject);
  });
}

async function startDevServer() {
  const port = await findFreePort();
  const child = spawn(
    "npm",
    ["run", "dev", "--", "-H", "127.0.0.1", "-p", String(port)],
    {
      cwd: studio,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        NEXT_PUBLIC_MODE: "snapshot",
        NEXT_DIST_DIR: ".next-readme-assets",
        FORCE_COLOR: "0",
        BROWSER: "none",
      },
    },
  );
  let log = "";
  child.stdout.on("data", (d) => {
    log += d.toString();
  });
  child.stderr.on("data", (d) => {
    log += d.toString();
  });

  const base = `http://127.0.0.1:${port}`;
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`dev server timed out\n${log.slice(-2000)}`));
    }, 120000);
    const probe = setInterval(async () => {
      try {
        const res = await fetch(`${base}/`);
        // Accept 200; Next may still compile
        if (res.status === 200 || res.status === 404) {
          clearTimeout(timer);
          clearInterval(probe);
          resolve(true);
        }
      } catch {
        /* wait */
      }
    }, 500);
    child.on("exit", (code) => {
      clearTimeout(timer);
      clearInterval(probe);
      reject(new Error(`dev exited ${code}\n${log.slice(-2000)}`));
    });
  });
  if (!ready) throw new Error("dev not ready");
  // Warm compile of key routes
  for (const p of ["/overview/", "/traces/", "/docs/overview/"]) {
    try {
      await fetch(`${base}${p}`);
    } catch {
      /* ignore */
    }
  }
  return {
    base,
    stop: () =>
      new Promise((resolve) => {
        child.on("exit", () => resolve());
        try {
          child.kill("SIGTERM");
        } catch {
          /* ignore */
        }
        setTimeout(resolve, 800);
      }),
  };
}

async function prepare(page) {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem("evalverse.session");
      localStorage.removeItem("evalverse.connection");
      localStorage.setItem("evalverse.theme", "light");
      localStorage.setItem("evalverse.suite", "cord");
      document.documentElement.classList.remove("dark", "light");
      document.documentElement.classList.add("light");
      document.documentElement.style.colorScheme = "light";
    } catch {
      /* ignore */
    }
  });
}

async function hideChrome(page) {
  await page.addStyleTag({
    content: `
      [aria-label="Account"],
      button[aria-label="Account"],
      [data-account-menu] { visibility: hidden !important; }
    `,
  });
  await page.evaluate(() => {
    // Scrub any leftover emails from DOM text nodes in the topbar
    const top = document.querySelector("header");
    if (!top) return;
    const walk = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(node.textContent || "")) {
          node.textContent = "Account";
        }
      } else if (node.childNodes) {
        node.childNodes.forEach(walk);
      }
    };
    walk(top);

    // Rewrite failure chrome in place (don't remove parents — playground
    // recorded examples live in a sibling tree under the same main).
    const walkText = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        let t = node.textContent || "";
        t = t.replace(/Server unreachable\.?/g, "Demo mode");
        t = t.replace(/Can'?t reach your server\.?/gi, "Showing demo data.");
        t = t.replace(/\bunreachable\b/gi, "offline");
        node.textContent = t;
      } else if (node.childNodes) {
        node.childNodes.forEach(walkText);
      }
    };
    walkText(document.body);
  });
}

async function assertClean(page, name) {
  const text = await page.locator("body").innerText();
  if (EMAIL_RE.test(text)) {
    throw new Error(`${name}: screenshot text contains an email address`);
  }
  const m = text.match(BAD_RE);
  if (m) {
    throw new Error(`${name}: screenshot text contains forbidden token "${m[0]}"`);
  }
}

async function settle(page) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    document.documentElement.classList.remove("dark");
    document.documentElement.classList.add("light");
    document.documentElement.style.colorScheme = "light";
  });
  // Dismiss cookie/toast if any
  await page.waitForTimeout(400);
}

async function shot(page, name, url, opts = {}) {
  const out = path.join(imgDir, name);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await settle(page);
  if (opts.suite) {
    await page.evaluate((s) => {
      localStorage.setItem("evalverse.suite", s);
    }, opts.suite);
    await page.reload({ waitUntil: "domcontentloaded" });
    await settle(page);
  }
  if (opts.waitFor) {
    await page.waitForSelector(opts.waitFor, { timeout: 30000 }).catch(() => {});
  }
  if (opts.clickTab) {
    const tab = page.getByRole("tab", { name: opts.clickTab }).or(
      page.getByRole("button", { name: opts.clickTab }),
    );
    if (await tab.count()) {
      await tab.first().click();
      await page.waitForTimeout(500);
    }
  }
  if (opts.scrollText) {
    const loc = page.getByText(opts.scrollText, { exact: false }).first();
    if (await loc.count()) {
      await loc.scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
    }
  }
  if (typeof opts.beforeShot === "function") {
    await opts.beforeShot(page);
  }
  await hideChrome(page);
  await assertClean(page, name);
  await page.screenshot({ path: out, type: "png", fullPage: false });
  console.log("wrote", path.relative(root, out));
  return out;
}

async function captureDemoGif(browser, base, trace) {
  if (!trace) {
    console.warn("skip demo.gif — no mistimed video trace");
    return null;
  }
  const tmpDir = path.join(imgDir, ".demo-tmp");
  mkdirSync(tmpDir, { recursive: true });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    recordVideo: { dir: tmpDir, size: VIEWPORT },
  });
  const page = await context.newPage();
  await prepare(page);
  const url = `${base}/traces/view/?id=${encodeURIComponent(trace.id)}&suite=${encodeURIComponent(trace.suite)}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await settle(page);
  await hideChrome(page);

  // Graph → Evidence → Timeline
  const clickMaybe = async (name) => {
    const loc = page.getByRole("tab", { name }).or(page.getByRole("button", { name }));
    if (await loc.count()) {
      await loc.first().click();
      await page.waitForTimeout(1200);
    }
  };
  await clickMaybe("Graph");
  await page.waitForTimeout(1500);
  await clickMaybe("Evidence");
  await page.waitForTimeout(2000);
  await clickMaybe("Timeline");
  await page.waitForTimeout(2000);

  const video = page.video();
  await context.close();
  if (!video) {
    console.warn("skip demo.gif — no video object");
    return null;
  }
  const webm = await video.path();
  // Convert with imageio-ffmpeg via python
  const gifPath = path.join(imgDir, "demo.gif");
  const py = path.join(root, ".venv", "bin", "python");
  const script = `
import sys, os, subprocess, json
from pathlib import Path
webm = Path(${JSON.stringify(webm)})
gif = Path(${JSON.stringify(gifPath)})
import imageio_ffmpeg
ff = imageio_ffmpeg.get_ffmpeg_exe()
# Cap ~12s, scale down, palette for size
cmd = [ff, "-y", "-i", str(webm), "-t", "12",
       "-vf", "fps=10,scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=64[p];[s1][p]paletteuse=dither=bayer",
       str(gif)]
subprocess.check_call(cmd)
size = gif.stat().st_size
print("gif_bytes", size)
if size > 6 * 1024 * 1024:
    # recompress smaller
    cmd2 = [ff, "-y", "-i", str(webm), "-t", "10",
            "-vf", "fps=8,scale=720:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=48[p];[s1][p]paletteuse",
            str(gif)]
    subprocess.check_call(cmd2)
    print("gif_bytes_re", gif.stat().st_size)
`;
  await new Promise((resolve, reject) => {
    const child = spawn(existsSync(py) ? py : "python3", ["-c", script], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("exit", (code) => {
      if (code === 0) {
        console.log(out.trim() || "wrote demo.gif");
        resolve();
      } else {
        console.warn("demo.gif convert failed:", err || out);
        resolve(); // optional
      }
    });
  });
  // cleanup webm/tmp
  try {
    for (const f of readdirSync(tmpDir)) {
      try {
        const { unlinkSync } = await import("node:fs");
        unlinkSync(path.join(tmpDir, f));
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
  if (existsSync(gifPath)) {
    console.log("wrote", path.relative(root, gifPath));
    return gifPath;
  }
  return null;
}

async function main() {
  const skipped = [];
  const evidence = pickTraceByLabel("cord.json", "correct_ungrounded", {
    condition: "clean",
  });
  const graph = pickParallelGraphTrace();
  const videoMistimed = pickTraceByLabel("video.json", "mistimed", {
    caseSuffix: "_time",
    condition: "clean",
  });
  const cmCases = crossmodalCaseCount();

  console.log("evidence trace:", evidence?.id);
  console.log("graph trace:", graph?.id);
  console.log("video mistimed:", videoMistimed?.id);
  console.log("crossmodal cases:", cmCases);

  const server = await startDevServer();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: SCALE,
  });
  const page = await context.newPage();
  await prepare(page);

  try {
    await shot(page, "landing-hero.png", `${server.base}/`);
    await shot(page, "home.png", `${server.base}/overview/`, {
      suite: "cord",
      waitFor: ".studio",
    });

    if (evidence) {
      await shot(
        page,
        "trace-evidence.png",
        `${server.base}/traces/view/?id=${encodeURIComponent(evidence.id)}&suite=cord`,
        { clickTab: "Evidence", waitFor: "img, canvas, svg" },
      );
    } else {
      skipped.push("trace-evidence.png (no correct_ungrounded receipt)");
    }

    if (graph) {
      await shot(
        page,
        "trace-graph.png",
        `${server.base}/traces/view/?id=${encodeURIComponent(graph.id)}&suite=${encodeURIComponent(graph.suite)}`,
        {
          clickTab: "Graph",
          waitFor: ".react-flow, svg",
          beforeShot: async (p) => {
            // Expand collapsed parallel span group if present
            const expand = p.getByText(/click to expand|turn spans/i).first();
            if (await expand.count()) {
              await expand.click().catch(() => {});
              await p.waitForTimeout(600);
            }
          },
        },
      );
    } else {
      skipped.push("trace-graph.png (no parallel-span trace)");
    }

    if (videoMistimed) {
      await shot(
        page,
        "trace-video.png",
        `${server.base}/traces/view/?id=${encodeURIComponent(videoMistimed.id)}&suite=video`,
        { clickTab: "Timeline", waitFor: ".studio" },
      );
    } else {
      skipped.push("trace-video.png (no mistimed video trace)");
    }

    if (cmCases >= 30) {
      await shot(page, "cross-modal.png", `${server.base}/overview/`, {
        suite: "crossmodal",
      });
    } else {
      skipped.push(`cross-modal.png (crossmodal suite has ${cmCases} cases, need ≥30)`);
    }

    await shot(page, "evaluators.png", `${server.base}/evaluators/`);
    await shot(page, "judge-trust.png", `${server.base}/evaluators/?tab=judge`, {
      clickTab: "Judge trust",
    });

    await shot(page, "online-evaluation.png", `${server.base}/online-evaluation/`);
    await shot(page, "score.png", `${server.base}/overview/`, {
      suite: "cord",
      scrollText: "How each dimension scores",
    });
    await shot(page, "playground.png", `${server.base}/playground/`, {
      beforeShot: async (p) => {
        await p.waitForTimeout(500);
        const byTitle = p.getByRole("button", { name: /Receipt total \(image\)/i });
        const browse = p.getByRole("button", { name: /Browse a recorded example/i });
        if (await byTitle.count()) {
          await byTitle.first().click();
        } else if (await browse.count()) {
          await browse.first().click();
        }
        await p.waitForTimeout(1200);
        // Ensure something from the recorded example is on screen
        await p.getByText(/Receipt total|grounded|claim|answer/i).first().waitFor({
          timeout: 10000,
        }).catch(() => {});
      },
    });
    await shot(page, "docs.png", `${server.base}/docs/overview/`);

    // Optional GIF
    try {
      await captureDemoGif(browser, server.base, videoMistimed || graph);
    } catch (e) {
      skipped.push(`demo.gif (${e.message || e})`);
    }
  } finally {
    await browser.close();
    await server.stop();
  }

  writeFileSync(
    path.join(imgDir, ".capture-skipped.json"),
    JSON.stringify(skipped, null, 2),
  );
  if (skipped.length) {
    console.log("\nSkipped / not captured:");
    for (const s of skipped) console.log(" -", s);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
