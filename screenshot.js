#!/usr/bin/env node
/**
 * Screenshot Tool — Full-Page Web Screenshot Utility (Node.js)
 * ─────────────────────────────────────────────────────────────
 * Requirements:
 *   npm install
 *   npx playwright install chromium
 *
 * Usage:
 *   node screenshot.js --help
 *   node screenshot.js -r /project -d pattern_a --scan
 *   node screenshot.js -u https://example.com
 *   node screenshot.js          ← interactive mode
 */

"use strict";

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const readline = require("readline");

// ─── MOBILE PRESETS ──────────────────────────────────────────────────────────
const MOBILE_PRESETS = {
  "iphone-se":  { width: 375,  height: 667,  deviceScaleFactor: 2, isMobile: true },
  "iphone-14":  { width: 390,  height: 844,  deviceScaleFactor: 3, isMobile: true },
  "ipad":       { width: 768,  height: 1024, deviceScaleFactor: 2, isMobile: true },
  "ipad-pro":   { width: 1024, height: 1366, deviceScaleFactor: 2, isMobile: true },
  "galaxy-s21": { width: 360,  height: 800,  deviceScaleFactor: 3, isMobile: true },
  "pixel-7":    { width: 412,  height: 915,  deviceScaleFactor: 2, isMobile: true },
};

// ─── FORMAT HELPERS ──────────────────────────────────────────────────────────

/** Map format name to file extension (with dot). 'jpeg' → '.jpg' */
function formatToExt(format) {
  return format === "jpeg" ? ".jpg" : ".png";
}

/**
 * Apply widthSuffix and image format to a base .png output path.
 * applyWidthAndFormat("out/folder/page.png", "_1440", "jpeg") → "out/folder/page_1440.jpg"
 * @param {string} pngPath
 * @param {string} widthSuffix - e.g. "_1440" or ""
 * @param {string} format - "png" | "jpeg"
 * @returns {string}
 */
function applyWidthAndFormat(pngPath, widthSuffix, format) {
  const withSuffix = pngPath.replace(/\.png$/, widthSuffix + ".png");
  return format === "png" ? withSuffix : withSuffix.replace(/\.png$/, formatToExt(format));
}

// ─── INJECT CSS ──────────────────────────────────────────────────────────────
const INJECT_CSS = `
/* 1. Stop ALL animations & transitions */
*, *::before, *::after {
  animation-play-state: paused !important;
  animation-duration: 0s !important;
  animation-delay: 0s !important;
  transition: none !important;
}

/* 2. Reveal scroll-triggered / AOS / WOW / GSAP elements */
[data-aos], [data-aos].aos-animate,
.wow, .animated,
.fadeIn, .fadeInUp, .fadeInDown, .fadeInLeft, .fadeInRight,
.slideInUp, .slideInDown, .slideInLeft, .slideInRight,
.zoomIn, .zoomInUp, .bounceIn, .bounceInUp,
.gsap-reveal, .scroll-trigger,
.r, .rl, .rr, .rs, .ru,
[class*="reveal"], [class*="fade-in"],
[class*="slide-in"], [class*="zoom-in"],
[class*="animate-"], [class*="motion-"] {
  opacity: 1 !important;
  transform: none !important;
  visibility: visible !important;
  transition: none !important;
  pointer-events: auto !important;
}

/* 3. Freeze parallax layers */
[class*="parallax"], [data-parallax],
[class*="jarallax"], .parallax-window {
  transform: none !important;
  background-attachment: scroll !important;
}

/* 4. Hide UI widgets */
[class*="scroll-top"], [class*="back-to-top"],
[id*="scroll-top"], #scrollTop, .scroll-to-top,
[class*="cookie"], [class*="gdpr"],
[id*="cookie"], [class*="consent"],
.gallery-overlay, .item-overlay, .hover-overlay,
[class*="chat-widget"], [class*="live-chat"],
[id*="live-chat"], #tidio-chat, #intercom-container,
.grecaptcha-badge {
  display: none !important;
  opacity: 0 !important;
  pointer-events: none !important;
}

/* 5. Force render of CSS-deferred off-screen content (content-visibility: auto) */
* {
  content-visibility: visible !important;
}
`;

// ─── UTILITIES ───────────────────────────────────────────────────────────────

/**
 * Convert URL to safe PNG filename.
 * @param {string} url
 * @returns {string}
 */
function urlToFilename(url) {
  try {
    const parsed = new URL(url);
    // Use parsed.host (includes port) so localhost:3000 and localhost:8080 don't collide.
    // parsed.host auto-omits default ports (http:80, https:443), so example.com:443 → example.com.
    let name = parsed.host + parsed.pathname + parsed.search + parsed.hash;
    name = name.replace(/[:/\\?=&#%+]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
    // Guard against ENAMETOOLONG — file systems limit filenames to 255 bytes
    if (name.length > 200) {
      const tag = Buffer.from(url).toString("base64url").slice(-8);
      name = name.slice(0, 191) + "_" + tag;
    }
    return (name || "page") + ".png";
  } catch {
    return "page.png";
  }
}

/**
 * Recursively find all *.html files under a directory.
 * @param {string} dir
 * @returns {string[]}
 */
function globHtml(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  function walk(current) {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      console.warn(`  ⚠️  Cannot read directory (skipping): ${current}`);
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith(".html")) {
        results.push(full);
      }
    }
  }
  walk(dir);
  return results.sort();
}

/**
 * Load and parse .screenshotrc.json config file.
 * @param {string} configPath
 * @returns {object}
 */
function loadConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    console.warn(`⚠️  Config not found: ${configPath}`);
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    const label = e && e.code === "ENOENT" ? "Cannot read config file" : "Invalid JSON in config";
    console.error(`❌  ${label}: ${msg}`);
    return {};
  }
}

/**
 * Ensure directory exists (mkdir -p equivalent).
 * @param {string} dirPath
 */
function mkdirp(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

// ─── HTML GALLERY REPORT ─────────────────────────────────────────────────────

/**
 * Escape a string for safe embedding in HTML attributes and text.
 * @param {string} s
 * @returns {string}
 */
function escHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Generate a self-contained HTML gallery report after all screenshots are taken.
 * @param {Array<{outputPath:string, label:string, width:number, ok:boolean}>} results
 * @param {string} outRoot - absolute output directory path
 */
function generateReport(results, outRoot) {
  const successful = results.filter((r) => r.ok);
  if (successful.length === 0) {
    console.warn("⚠️  No successful screenshots — report not generated.");
    return;
  }

  const timestamp = new Date().toLocaleString();
  const widthList = [...new Set(successful.map((r) => r.width))].sort((a, b) => a - b);
  const isMultiWidth = widthList.length > 1;

  // Group by viewport width
  /** @type {Record<number, typeof successful>} */
  const byWidth = Object.fromEntries(widthList.map((w) => [w, []]));
  for (const r of successful) byWidth[r.width].push(r);

  function makeCard(r) {
    const rel = path.relative(outRoot, r.outputPath).replace(/\\/g, "/");
    const isPdf = r.outputPath.endsWith(".pdf");
    const name  = path.basename(r.outputPath);
    const thumb = isPdf
      ? `<div class="thumb pdf-thumb"><span>📄 PDF</span></div>`
      : `<div class="thumb"><img loading="lazy" src="${escHtml(rel)}" alt="${escHtml(r.label)}" /></div>`;
    return `
    <div class="card">
      <a href="${escHtml(rel)}" target="_blank" rel="noopener">${thumb}</a>
      <div class="info">
        <div class="label" title="${escHtml(r.label)}">${escHtml(r.label)}</div>
        <div class="meta">${r.width}px &nbsp;&middot;&nbsp; ${escHtml(name)}</div>
      </div>
    </div>`;
  }

  let bodyContent = "";
  if (isMultiWidth) {
    for (const w of widthList) {
      const cards = byWidth[w];
      const noun  = cards.length !== 1 ? "pages" : "page";
      bodyContent += `\n<section>\n<h2 class="vp-heading">Viewport: ${w}px <span class="count">${cards.length} ${noun}</span></h2>\n<div class="grid">`;
      for (const r of cards) bodyContent += makeCard(r);
      bodyContent += "\n</div>\n</section>";
    }
  } else {
    bodyContent = `<div class="grid">`;
    for (const r of successful) bodyContent += makeCard(r);
    bodyContent += "\n</div>";
  }

  const totalFailed = results.filter((r) => !r.ok).length;
  const failBadge   = totalFailed > 0
    ? ` <span class="badge badge-fail">${totalFailed} failed</span>` : "";
  const pageNoun    = successful.length !== 1 ? "pages" : "page";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Screenshot Report \u2014 ${escHtml(timestamp)}</title>
<style>
  :root {
    --bg:#f4f4f5; --surface:#fff; --border:#e4e4e7;
    --text:#18181b; --muted:#71717a; --accent:#2563eb;
    --fail:#dc2626; --radius:10px;
    --shadow:0 1px 3px rgba(0,0,0,.08),0 1px 2px rgba(0,0,0,.06);
  }
  @media(prefers-color-scheme:dark){
    :root{
      --bg:#09090b; --surface:#18181b; --border:#27272a;
      --text:#fafafa; --muted:#a1a1aa; --accent:#60a5fa;
      --fail:#f87171; --shadow:0 1px 3px rgba(0,0,0,.4);
    }
  }
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--text);padding:28px 24px 60px}
  header{margin-bottom:28px}
  header h1{font-size:1.4rem;font-weight:700;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  header p{margin-top:6px;font-size:.8125rem;color:var(--muted)}
  .badge{display:inline-block;padding:2px 10px;border-radius:999px;font-size:.75rem;font-weight:600;background:var(--accent);color:#fff}
  .badge-fail{background:var(--fail)}
  .vp-heading{font-size:1rem;font-weight:600;margin:32px 0 12px;color:var(--muted);
              display:flex;align-items:center;gap:10px;
              border-bottom:1px solid var(--border);padding-bottom:8px}
  .count{font-size:.8125rem;font-weight:400}
  .grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(260px,1fr))}
  .card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);
        box-shadow:var(--shadow);overflow:hidden;
        transition:transform .15s ease,box-shadow .15s ease}
  .card:hover{transform:translateY(-3px);box-shadow:0 4px 12px rgba(0,0,0,.15)}
  .card a{display:block;text-decoration:none;color:inherit}
  .thumb{width:100%;aspect-ratio:16/9;overflow:hidden;background:var(--bg)}
  .thumb img{width:100%;height:100%;object-fit:cover;object-position:top center;display:block}
  .pdf-thumb{display:flex;align-items:center;justify-content:center;font-size:2rem}
  .info{padding:10px 12px 12px}
  .label{font-size:.8125rem;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:3px}
  .meta{font-size:.75rem;color:var(--muted)}
  footer{margin-top:48px;text-align:center;font-size:.75rem;color:var(--muted)}
</style>
</head>
<body>
<header>
  <h1>&#128248; Screenshot Report <span class="badge">${successful.length} ${pageNoun}</span>${failBadge}</h1>
  <p>Generated: ${escHtml(timestamp)} &nbsp;&middot;&nbsp; Output: ${escHtml(path.resolve(outRoot))}</p>
</header>
${bodyContent}
<footer>Generated by <strong>screenshot-tool</strong> &nbsp;&middot;&nbsp; Playwright + Chromium</footer>
</body>
</html>`;

  const reportPath = path.join(outRoot, "report.html");
  mkdirp(outRoot);
  fs.writeFileSync(reportPath, html, "utf-8");
  console.log(`  \uD83D\uDCC4  Report   \u2192 ${path.resolve(reportPath)}`);
}

// ─── PROGRESS BAR (lightweight, no dependencies) ─────────────────────────────

class ProgressBar {
  constructor(total) {
    this.total = total;
    this.current = 0;
    this.ok = 0;
    this.fail = 0;
  }

  tick(success) {
    this.current++;
    if (success) this.ok++; else this.fail++;
    const pct = Math.round((this.current / this.total) * 100);
    const filled = Math.round(pct / 5);
    const bar = "█".repeat(filled) + "░".repeat(20 - filled);
    process.stdout.write(`\r  [${bar}] ${pct}%  ${this.current}/${this.total}  ✅ ${this.ok}  ❌ ${this.fail}  `);
    if (this.current === this.total) process.stdout.write("\n");
  }
}

// ─── CORE SCREENSHOT ─────────────────────────────────────────────────────────

/**
 * One-time page setup: viewport + dark mode + cookies.
 * Called once per worker page, not per task.
 * @param {import('playwright').Page} page
 * @param {object} opts
 */
async function setupPage(page, opts) {
  const { darkMode, cookies } = opts;
  // Viewport is set at context level in run() so deviceScaleFactor + isMobile are honoured
  if (darkMode) {
    await page.emulateMedia({ colorScheme: "dark" });
  }
  if (cookies && cookies.length > 0) {
    await page.context().addCookies(cookies);
  }
}

/**
 * @param {import('playwright').Page} page
 * @param {string} url
 * @param {string} outputPath
 * @param {object} opts
 * @returns {Promise<boolean>}
 */
async function takeScreenshot(page, url, outputPath, opts) {
  const {
    delayMs, customJs, noCss,
    clipSelector, waitFor, retries,
    exportPdf, localStorage: localStorageData,
    format, quality,
  } = opts;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });

      if (localStorageData && Object.keys(localStorageData).length > 0) {
        await page.evaluate((data) => {
          for (const [k, v] of Object.entries(data)) {
            window.localStorage.setItem(k, v);
          }
        }, localStorageData);
        await page.reload({ waitUntil: "networkidle", timeout: 60_000 });
      }

      if (waitFor) {
        await page.waitForSelector(waitFor, { timeout: 15_000 });
      }

      if (customJs) {
        await page.evaluate(customJs);
      }

      if (!noCss) {
        await page.addStyleTag({ content: INJECT_CSS });
      }

      // Auto-scroll through the page to trigger lazy-loaded images and
      // IntersectionObserver-based content — critical for full-page screenshots.
      // Skipped when capturing a single element (--clip).
      if (!clipSelector) {
        await page.evaluate(async () => {
          await new Promise((resolve) => {
            let lastH = 0, pos = 0, steps = 0;
            const STEP = window.innerHeight || 900;
            const MAX  = 200; // guard against infinite-scroll pages
            function tick() {
              if (steps++ >= MAX) { window.scrollTo(0, 0); resolve(); return; }
              const h = document.documentElement.scrollHeight;
              if (pos >= h && h === lastH) { window.scrollTo(0, 0); resolve(); return; }
              lastH = h;
              pos = Math.min(pos + STEP, h);
              window.scrollTo(0, pos);
              setTimeout(tick, 80);
            }
            setTimeout(tick, 50);
          });
        });
      }

      await page.waitForTimeout(delayMs);

      mkdirp(path.dirname(outputPath));

      if (exportPdf) {
        const pdfPath = outputPath.replace(/\.\w+$/, ".pdf");
        await page.pdf({ path: pdfPath, printBackground: true });
        return true;
      }

      if (clipSelector) {
        const element = await page.$(clipSelector);
        if (element) {
          await element.scrollIntoViewIfNeeded();
          const elemParams = { path: outputPath, type: format };
          if (format !== "png") elemParams.quality = quality;
          await element.screenshot(elemParams);
        } else {
          console.warn(`\n  ⚠️  Selector not found: ${clipSelector}`);
          return false;
        }
      } else {
        const shotParams = { path: outputPath, fullPage: true, type: format };
        if (format !== "png") shotParams.quality = quality;
        await page.screenshot(shotParams);
      }
      return true;
    } catch (err) {
      if (attempt < retries) {
        // Use plain setTimeout — page.waitForTimeout() can throw if page crashed
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      if (err && err.name === "TimeoutError") {
        console.warn(`\n  ⏱  Timeout after ${retries} attempt(s): ${url}`);
      } else {
        console.error(`\n  ❌  Error (${url}): ${err && err.message ? err.message : String(err)}`);
      }
      return false;
    }
  }
  return false;
}

// ─── BUILD TASK LIST ─────────────────────────────────────────────────────────

/**
 * @param {object} args
 * @param {number} currentWidth  - viewport width for this run
 * @param {string} widthSuffix   - appended to filename before extension, e.g. "_1440" or ""
 * @returns {{ url: string, outputPath: string, label: string, width: number }[]}
 */
function buildTasks(args, currentWidth, widthSuffix) {
  const tasks = [];
  const outRoot = args.out;

  // Mode A: specific pages from dirs
  if (args.dirs && args.dirs.length > 0 && args.pages && args.pages.length > 0) {
    const root = args.root;
    for (const folder of args.dirs) {
      const folderPath = path.resolve(root, folder);
      for (const pageName of args.pages) {
        const htmlFile = path.join(folderPath, `${pageName}.html`);
        if (!fs.existsSync(htmlFile)) {
          console.warn(`  ⚠️  Not found: ${htmlFile}`);
          continue;
        }
        const url = `file://${path.resolve(htmlFile)}`;
        const outputPath = applyWidthAndFormat(
          path.join(outRoot, folder, `${pageName}.png`),
          widthSuffix, args.format
        );
        tasks.push({ url, outputPath, label: `${folder}/${pageName}`, width: currentWidth });
      }
    }

  // Mode C: auto-scan *.html
  } else if (args.dirs && args.dirs.length > 0 && args.scan) {
    const root = args.root;
    for (const folder of args.dirs) {
      const folderPath = path.resolve(root, folder);
      const htmlFiles = globHtml(folderPath);
      for (const htmlFile of htmlFiles) {
        const url = `file://${path.resolve(htmlFile)}`;
        const rel = path.relative(folderPath, htmlFile).replace(/\.html$/, ".png");
        const outputPath = applyWidthAndFormat(
          path.join(outRoot, folder, rel),
          widthSuffix, args.format
        );
        const labelRel = rel.replace(/\.png$/, "");
        tasks.push({ url, outputPath, label: `${folder}/${labelRel}`, width: currentWidth });
      }
    }

  // Mode B: direct URLs
  } else if (args.urls && args.urls.length > 0) {
    for (const url of args.urls) {
      const outputPath = applyWidthAndFormat(
        path.join(outRoot, urlToFilename(url)),
        widthSuffix, args.format
      );
      tasks.push({ url, outputPath, label: url, width: currentWidth });
    }

  } else {
    console.error("❌  No valid mode selected. Run with --help for usage.");
    process.exit(1);
  }

  return tasks;
}

// ─── MAIN RUN ─────────────────────────────────────────────────────────────────

/**
 * Run screenshots for a pre-built task list at a specific viewport width.
 * Returns an array of result objects for report generation.
 * @param {object} args
 * @param {{ url:string, outputPath:string, label:string, width:number }[]} tasks
 * @param {number} currentWidth
 * @returns {Promise<{outputPath:string, label:string, width:number, ok:boolean}[]>}
 */
async function runSingle(args, tasks, currentWidth) {
  const results = [];

  const ext        = args.pdf ? "PDF" : args.format.toUpperCase();
  const deviceLabel = args.device ? ` [${args.device}]` : "";
  const darkLabel   = args.darkMode ? " 🌙 dark" : "";
  console.log(`\n📸  Capturing ${tasks.length} page(s) → ${ext} @ ${currentWidth}px wide${deviceLabel}${darkLabel}\n`);

  const bar = new ProgressBar(tasks.length);

  const screenshotOpts = {
    delayMs:        args.delay,
    customJs:       args.js || null,
    noCss:          args.noCss || false,
    clipSelector:   args.clip || null,
    waitFor:        args.waitFor || null,
    retries:        args.retries,
    darkMode:       args.darkMode || false,
    exportPdf:      args.pdf || false,
    cookies:        args.cookiesData || null,
    localStorage:   args.localStorageData || null,
    format:         args.format,
    quality:        args.quality,
  };

  const browser = await chromium.launch({ headless: true });
  try {
    // Create one context + page per worker (isolated sessions)
    const concurrency = Math.min(args.concurrency, tasks.length);
    // Set viewport + device properties at context level (deviceScaleFactor
    // can only be set here, not via page.setViewportSize)
    const ctxOptions = {
      viewport: { width: currentWidth, height: args.height },
    };
    if (args.deviceScaleFactor) ctxOptions.deviceScaleFactor = args.deviceScaleFactor;
    if (args.isMobile) {
      ctxOptions.isMobile = true;
      ctxOptions.hasTouch = true;
    }
    const contexts = await Promise.all(
      Array.from({ length: concurrency }, () => browser.newContext(ctxOptions))
    );
    const workerPages = await Promise.all(contexts.map((ctx) => ctx.newPage()));

    // One-time setup per worker page (viewport, dark mode, cookies)
    await Promise.all(workerPages.map((p) => setupPage(p, screenshotOpts)));

    let taskIndex = 0;

    async function workerFn(workerPage) {
      while (taskIndex < tasks.length) {
        const { url, outputPath, label } = tasks[taskIndex++];
        let ok = false;
        try {
          ok = await takeScreenshot(workerPage, url, outputPath, screenshotOpts);
        } catch (err) {
          console.error(`\n  💥  Worker error (${url}): ${err && err.message ? err.message : String(err)}`);
        }
        // When --pdf is used, takeScreenshot saves a .pdf file by replacing the extension.
        // Record the actual path so the report can reference it correctly.
        const actualPath = (args.pdf && !outputPath.endsWith(".pdf"))
          ? outputPath.replace(/\.\w+$/, ".pdf")
          : outputPath;
        results.push({ outputPath: actualPath, label, width: currentWidth, ok });
        bar.tick(ok);
      }
    }

    await Promise.all(workerPages.map((p) => workerFn(p)));

    // Close all contexts in parallel; ignore individual close errors
    await Promise.allSettled(contexts.map((ctx) => ctx.close()));
  } finally {
    await browser.close();
  }

  const ok   = bar.ok;
  const fail = bar.fail;
  console.log("─".repeat(44));
  console.log(`  Done : ${ok} ✅   Failed : ${fail} ❌`);
  console.log(`  Output → ${path.resolve(args.out)}`);

  return results;
}

/**
 * Entry point: iterate over all requested widths, capture, then generate report.
 * @param {object} args
 */
async function run(args) {
  // If --widths was given use those; otherwise fall back to the single --width value.
  const widths      = (args.widths && args.widths.length > 0) ? args.widths : [args.width];
  const isMultiWidth = widths.length > 1;
  const allResults  = [];

  for (const w of widths) {
    const widthSuffix = isMultiWidth ? `_${w}` : "";
    const tasks = buildTasks(args, w, widthSuffix);
    if (tasks.length === 0) {
      console.warn("⚠️  No pages found to screenshot.");
      continue;
    }
    const results = await runSingle(args, tasks, w);
    allResults.push(...results);
  }

  if (args.report && allResults.length > 0) {
    generateReport(allResults, path.resolve(args.out));
  }

  // Set exit code so CI/CD pipelines can detect failures.
  // Use process.exitCode (not process.exit) so any pending I/O finishes cleanly.
  const totalFail = allResults.filter((r) => !r.ok).length;
  if (allResults.length > 0 && totalFail === allResults.length) {
    process.exitCode = 2;  // all failed
  } else if (totalFail > 0) {
    process.exitCode = 1;  // partial failure
  }
}

// ─── INTERACTIVE MODE ─────────────────────────────────────────────────────────

async function interactiveMode() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((res) => rl.question(q, res));

  console.log("\n🖼  Screenshot Tool — Interactive Setup\n");

  const root     = (await ask("1. Root path of project [.]: ")).trim() || ".";
  const dirsRaw  = (await ask("2. Folder names to capture (space-separated): ")).trim();
  const dirs     = dirsRaw ? dirsRaw.split(/\s+/) : [];
  if (dirs.length === 0) {
    console.warn("⚠️  No folders specified — no pages will be scanned.");
  }
  const pagesRaw = (await ask("3. Page names without .html (Enter = auto-scan all): ")).trim();
  const pages    = pagesRaw ? pagesRaw.split(/\s+/) : null;
  const widthsRaw = (await ask("4. Viewport width(s) in px, space-separated [1440]: ")).trim();
  const widthNums  = widthsRaw
    ? widthsRaw.split(/\s+/).map(Number).filter((n) => n > 0)
    : [1440];
  const widths     = widthNums.length > 1 ? widthNums : null;
  const width      = widthNums[0] || 1440;
  const out        = (await ask("5. Output folder [./screenshots]: ")).trim() || "./screenshots";
  const reportRaw  = (await ask("6. Generate HTML gallery report? [y/N]: ")).trim().toLowerCase();
  const report     = reportRaw === "y" || reportRaw === "yes";

  rl.close();

  // Build the args object by overlaying interactive values onto DEFAULTS so
  // future DEFAULTS changes propagate automatically.
  return {
    ...DEFAULTS,
    urls: [],
    dirs,
    pages,
    scan: !pages,
    root,
    out,
    width,
    js:                null,
    clip:              null,
    waitFor:           null,
    device:            null,
    deviceScaleFactor: null,
    isMobile:          null,
    cookiesData:       null,
    localStorageData:  null,
    widths,
    report,
  };
}

// ─── CLI PARSER ──────────────────────────────────────────────────────────────

// Default values — applied AFTER config merge so config can override them
const DEFAULTS = {
  out:         "./screenshots",
  width:       1440,
  height:      900,
  delay:       800,
  retries:     2,
  concurrency: 3,
  root:        ".",
  scan:        false,
  noCss:       false,
  darkMode:    false,
  pdf:         false,
  format:      "png",
  quality:     80,
  report:      false,
};

function parseArgs(argv) {
  // Use undefined as sentinel = "not set by user" so config can fill in later
  const args = {
    urls:            [],
    dirs:            null,
    pages:           null,
    scan:            undefined,
    root:            undefined,
    out:             undefined,
    width:           undefined,
    height:          undefined,
    delay:           undefined,
    retries:         undefined,
    concurrency:     undefined,
    js:              null,
    noCss:           undefined,
    clip:            null,
    waitFor:         null,
    darkMode:        undefined,
    pdf:             undefined,
    device:            null,
    deviceScaleFactor: null,
    isMobile:          null,
    cookies:           null,
    localStorageRaw:   null,
    config:          null,
    cookiesData:     null,
    localStorageData: null,
    widths:          null,
    format:          undefined,
    quality:         undefined,
    report:          undefined,
  };

  const a = argv.slice(2);

  if (a.includes("--help") || a.includes("-h")) {
    printHelp();
    process.exit(0);
  }

  for (let i = 0; i < a.length; i++) {
    const flag = a[i];
    const next = () => {
      if (i + 1 >= a.length || a[i + 1].startsWith("-")) {
        console.error(`❌  Missing value for ${flag}`);
        process.exit(1);
      }
      return a[++i];
    };
    const nextMany = () => {
      const vals = [];
      while (i + 1 < a.length && !a[i + 1].startsWith("-")) vals.push(a[++i]);
      return vals;
    };

    switch (flag) {
      case "-u": case "--urls":         args.urls.push(...nextMany()); break;
      case "-r": case "--root":         args.root = next(); break;
      case "-d": case "--dirs":         args.dirs = (args.dirs || []).concat(nextMany()); break;
      case "-g": case "--pages":        args.pages = (args.pages || []).concat(nextMany()); break;
      case "--scan":                    args.scan = true; break;
      case "-o": case "--out":          args.out = next(); break;
      case "-w": case "--width":        { const v = parseInt(next(), 10); if (isNaN(v) || v < 1) { console.error("❌  --width must be a positive integer"); process.exit(1); } args.width = v; break; }
      case "--height":                  { const v = parseInt(next(), 10); if (isNaN(v) || v < 1) { console.error("❌  --height must be a positive integer"); process.exit(1); } args.height = v; break; }
      case "--delay":                   { const v = parseInt(next(), 10); if (isNaN(v) || v < 0) { console.error("❌  --delay must be a non-negative integer"); process.exit(1); } args.delay = v; break; }
      case "--retries":                 { const v = parseInt(next(), 10); if (isNaN(v) || v < 1) { console.error("❌  --retries must be a positive integer"); process.exit(1); } args.retries = v; break; }
      case "-c": case "--concurrency":  { const v = parseInt(next(), 10); if (isNaN(v) || v < 1) { console.error("❌  --concurrency must be a positive integer"); process.exit(1); } args.concurrency = v; break; }
      case "--js":                      args.js = next(); break;
      case "--no-css":                  args.noCss = true; break;
      case "--clip":                    args.clip = next(); break;
      case "--wait-for":                args.waitFor = next(); break;
      case "--dark-mode":               args.darkMode = true; break;
      case "--pdf":                     args.pdf = true; break;
      case "--device":                  args.device = next(); break;
      case "--cookies":                 args.cookies = next(); break;
      case "--local-storage":           args.localStorageRaw = next(); break;
      case "--config":                  args.config = next(); break;
      case "--widths": {
        const vals = nextMany().map((v) => {
          const n = parseInt(v, 10);
          if (isNaN(n) || n < 1) { console.error("❌  --widths values must be positive integers"); process.exit(1); }
          return n;
        });
        if (vals.length === 0) { console.error("❌  --widths requires at least one value"); process.exit(1); }
        args.widths = (args.widths || []).concat(vals);
        break;
      }
      case "--format": {
        const f = next();
        if (!["png", "jpeg"].includes(f)) {
          console.error("❌  --format must be one of: png, jpeg");
          process.exit(1);
        }
        args.format = f;
        break;
      }
      case "--quality": {
        const v = parseInt(next(), 10);
        if (isNaN(v) || v < 0 || v > 100) {
          console.error("❌  --quality must be an integer between 0 and 100");
          process.exit(1);
        }
        args.quality = v;
        args._qualityExplicit = true;
        break;
      }
      case "--report":  args.report = true; break;
      default:
        console.error(`❌  Unknown flag: ${flag}. Run with --help for usage.`);
        process.exit(1);
    }
  }

  // Load config file — applies to any value still undefined/null (not set by CLI)
  if (args.config) {
    const cfg = loadConfig(args.config);
    for (const [key, val] of Object.entries(cfg)) {
      const k = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (!(k in args)) {
        console.warn(`⚠️  Unknown config key ignored: "${key}"`);
        continue;
      }
      if (args[k] === undefined || args[k] === null || (Array.isArray(args[k]) && args[k].length === 0)) {
        // Validate array fields (urls/dirs/pages/widths must be arrays)
        if ((k === "urls" || k === "dirs" || k === "pages" || k === "widths") && !Array.isArray(val)) {
          console.warn(`⚠️  Config key "${key}" expects an array — got ${typeof val}, ignored`);
          continue;
        }
        // Coerce and validate numeric fields so "1440" string works and "abc" is rejected
        if (k === "width" || k === "height" || k === "delay" || k === "retries" || k === "concurrency" || k === "deviceScaleFactor" || k === "quality") {
          const num = Number(val);
          if (isNaN(num)) {
            console.warn(`⚠️  Config key "${key}" expects a number — got "${val}", ignored`);
            continue;
          }
          args[k] = num;
        } else if (k === "format") {
          if (!["png", "jpeg"].includes(val)) {
            console.warn(`⚠️  Config key "format" must be "png" or "jpeg" — got "${val}", ignored`);
            continue;
          }
          args[k] = val;
        } else if (k === "widths") {
          // Each element must be a positive integer
          const nums = val.map(Number);
          if (nums.some((n) => isNaN(n) || n < 1)) {
            console.warn(`⚠️  Config key "widths" values must be positive integers — ignored`);
            continue;
          }
          args.widths = (args.widths || []).concat(nums.map(Math.round));
        } else {
          args[k] = val;
        }
      }
    }
  }

  // Apply defaults for anything still undefined after CLI + config
  for (const [k, v] of Object.entries(DEFAULTS)) {
    if (args[k] === undefined) args[k] = v;
  }

  // Apply device preset
  if (args.device) {
    const preset = MOBILE_PRESETS[args.device];
    if (!preset) {
      console.error(`❌  Unknown device: "${args.device}". Available: ${Object.keys(MOBILE_PRESETS).join(", ")}`);
      process.exit(1);
    }
    args.width             = preset.width;
    args.height            = preset.height;
    args.deviceScaleFactor = preset.deviceScaleFactor;
    args.isMobile          = preset.isMobile;
  }

  // ── Cross-option conflict checks ──────────────────────────────────────────
  if (args.widths && args.widths.length > 0) {
    if (args.device) {
      console.error("❌  --widths and --device cannot be used together. A device preset sets a fixed viewport.");
      process.exit(1);
    }
    // Deduplicate widths (user may have overlapping CLI + config values)
    args.widths = [...new Set(args.widths)].sort((a, b) => a - b);
  }

  // Quality only matters for lossy formats — and only warn if user explicitly set it.
  if (args._qualityExplicit && args.format === "png" && !args.pdf) {
    console.warn("⚠️  --quality is ignored for PNG (lossless). Use --format jpeg.");
  }

  if (args.pdf) {
    if (args.format !== "png") {
      console.warn("⚠️  --format is ignored when --pdf is used.");
    }
    if (args.clip) {
      console.warn("⚠️  --clip is ignored when --pdf is used (PDF always exports full page).");
    }
  }

  // Source mode precedence: Mode A/C (dirs) > Mode B (urls). Warn if both given.
  if (args.urls && args.urls.length > 0 && args.dirs && args.dirs.length > 0) {
    console.warn("⚠️  --urls is ignored because --dirs was also provided. Use one source mode at a time.");
  }



  // Parse cookies JSON
  if (args.cookies) {
    try {
      args.cookiesData = JSON.parse(args.cookies);
    } catch (e) {
      console.error(`❌  --cookies must be valid JSON array: ${e.message}`);
      process.exit(1);
    }
    if (!Array.isArray(args.cookiesData)) {
      console.error('❌  --cookies must be a JSON array: [{"name":"…","value":"…","domain":"…"}]');
      process.exit(1);
    }
  }

  // Parse local-storage JSON
  if (args.localStorageRaw) {
    try {
      args.localStorageData = JSON.parse(args.localStorageRaw);
    } catch (e) {
      console.error(`❌  --local-storage must be valid JSON object: ${e.message}`);
      process.exit(1);
    }
    if (typeof args.localStorageData !== "object" || Array.isArray(args.localStorageData) || args.localStorageData === null) {
      console.error('❌  --local-storage must be a JSON object: {"key":"value"}');
      process.exit(1);
    }
  }

  return args;
}

function printHelp() {
  console.log(`
Screenshot Tool — Full-Page Web Screenshot Utility (Node.js)

USAGE
  node screenshot.js [options]
  node screenshot.js            ← interactive guided setup

SOURCE MODES
  -u, --urls <URL...>           Direct URLs to screenshot
  -r, --root <path>             Project root directory (default: .)
  -d, --dirs <folder...>        Subfolders containing HTML files
  -g, --pages <name...>         Page names without .html  (Mode A: specific)
      --scan                    Auto-scan all *.html in dirs (Mode C)

OUTPUT
  -o, --out <path>              Output directory (default: ./screenshots)
      --pdf                     Export PDF instead of PNG
      --format <type>           Image format: png (default), jpeg
      --quality <0-100>         Lossy quality for jpeg (default: 80)

VIEWPORT
  -w, --width <px>              Viewport width (default: 1440)
      --widths <px...>          Multiple widths in one pass: --widths 375 768 1440
      --height <px>             Viewport height (default: 900)
      --device <preset>         Mobile preset: ${Object.keys(MOBILE_PRESETS).join(", ")}
      --dark-mode               Emulate dark color scheme

BEHAVIOUR
      --delay <ms>              Wait after CSS inject (default: 800)
      --retries <n>             Retry attempts per page (default: 2)
  -c, --concurrency <n>         Parallel workers (default: 3)
      --wait-for <selector>     Wait for CSS selector before screenshot
      --clip <selector>         Capture specific element only
      --no-css                  Skip CSS injection (raw screenshot)
      --js <code>               Custom JavaScript to execute before screenshot

AUTH / STATE
      --cookies <json>          JSON array of cookies
      --local-storage <json>    JSON object to inject into localStorage

REPORT
      --report                  Generate report.html gallery in output folder

CONFIG
      --config <file>           Path to .screenshotrc.json config file
  -h, --help                    Show this help

EXAMPLES
  node screenshot.js -r /project -d pattern_a --scan
  node screenshot.js -r /project -d pattern_a pattern_b -g index about contact
  node screenshot.js -u https://example.com https://example.com/about
  node screenshot.js -u https://example.com --device iphone-14
  node screenshot.js -u https://example.com --widths 375 768 1440 --report
  node screenshot.js -u https://example.com --format jpeg --quality 85
  node screenshot.js -u https://example.com --dark-mode --delay 1200 -c 5
  node screenshot.js -u https://example.com --pdf
  node screenshot.js -u https://example.com --clip "#hero-section"
  node screenshot.js --config .screenshotrc.json
`);
}

// ─── ENTRY POINT ─────────────────────────────────────────────────────────────

(async function main() {
  let args;

  if (process.argv.length <= 2) {
    args = await interactiveMode();
  } else {
    args = parseArgs(process.argv);
  }

  await run(args);
})().catch((err) => {
  console.error(`\n💥  Unexpected error: ${err && err.message ? err.message : String(err)}`);
  process.exit(1);
});
