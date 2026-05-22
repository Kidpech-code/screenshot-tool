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
          await element.screenshot({ path: outputPath });
        } else {
          console.warn(`\n  ⚠️  Selector not found: ${clipSelector}`);
          return false;
        }
      } else {
        await page.screenshot({ path: outputPath, fullPage: true });
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
 * @returns {{ url: string, outputPath: string, label: string }[]}
 */
function buildTasks(args) {
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
        const outputPath = path.join(outRoot, folder, `${pageName}.png`);
        tasks.push({ url, outputPath, label: `${folder}/${pageName}` });
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
        const outputPath = path.join(outRoot, folder, rel);
        tasks.push({ url, outputPath, label: `${folder}/${rel}` });
      }
    }

  // Mode B: direct URLs
  } else if (args.urls && args.urls.length > 0) {
    for (const url of args.urls) {
      const outputPath = path.join(outRoot, urlToFilename(url));
      tasks.push({ url, outputPath, label: url });
    }

  } else {
    console.error("❌  No valid mode selected. Run with --help for usage.");
    process.exit(1);
  }

  return tasks;
}

// ─── MAIN RUN ─────────────────────────────────────────────────────────────────

async function run(args) {
  const tasks = buildTasks(args);

  if (tasks.length === 0) {
    console.warn("⚠️  No pages found to screenshot.");
    return;
  }

  const ext = args.pdf ? "PDF" : "PNG";
  const deviceLabel = args.device ? ` [${args.device}]` : "";
  const darkLabel   = args.darkMode ? " 🌙 dark" : "";
  console.log(`\n📸  Capturing ${tasks.length} page(s) → ${ext} @ ${args.width}px wide${deviceLabel}${darkLabel}\n`);

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
  };

  const browser = await chromium.launch({ headless: true });
  try {
    // Create one context + page per worker (isolated sessions)
    const concurrency = Math.min(args.concurrency, tasks.length);
    // Set viewport + device properties at context level (deviceScaleFactor
    // can only be set here, not via page.setViewportSize)
    const ctxOptions = {
      viewport: { width: args.width, height: args.height },
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
        const { url, outputPath } = tasks[taskIndex++];
        let ok = false;
        try {
          ok = await takeScreenshot(workerPage, url, outputPath, screenshotOpts);
        } catch (err) {
          console.error(`\n  💥  Worker error (${url}): ${err && err.message ? err.message : String(err)}`);
        }
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
  const widthRaw = (await ask("4. Viewport width in px [1440]: ")).trim();
  const width    = Number(widthRaw) > 0 ? Number(widthRaw) : 1440;
  const out      = (await ask("5. Output folder [./screenshots]: ")).trim() || "./screenshots";

  rl.close();

  return {
    urls: [],
    dirs,
    pages,
    scan: !pages,
    root,
    out,
    width,
    height:      900,
    delay:       800,
    js:          null,
    noCss:       false,
    clip:        null,
    waitFor:     null,
    retries:     2,
    concurrency: 3,
    darkMode:    false,
    pdf:         false,
    device:            null,
    deviceScaleFactor: null,
    isMobile:          null,
    cookiesData:       null,
    localStorageData:  null,
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
        // Validate array fields (urls/dirs/pages must be arrays)
        if ((k === "urls" || k === "dirs" || k === "pages") && !Array.isArray(val)) {
          console.warn(`⚠️  Config key "${key}" expects an array — got ${typeof val}, ignored`);
          continue;
        }
        // Coerce and validate numeric fields so "1440" string works and "abc" is rejected
        if (k === "width" || k === "height" || k === "delay" || k === "retries" || k === "concurrency" || k === "deviceScaleFactor") {
          const num = Number(val);
          if (isNaN(num)) {
            console.warn(`⚠️  Config key "${key}" expects a number — got "${val}", ignored`);
            continue;
          }
          args[k] = num;
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

  // Parse cookies JSON
  if (args.cookies) {
    try {
      args.cookiesData = JSON.parse(args.cookies);
    } catch {
      console.error("❌  --cookies must be valid JSON array");
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
    } catch {
      console.error("❌  --local-storage must be valid JSON object");
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

VIEWPORT
  -w, --width <px>              Viewport width (default: 1440)
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

CONFIG
      --config <file>           Path to .screenshotrc.json config file
  -h, --help                    Show this help

EXAMPLES
  node screenshot.js -r /project -d pattern_a --scan
  node screenshot.js -r /project -d pattern_a pattern_b -g index about contact
  node screenshot.js -u https://example.com https://example.com/about
  node screenshot.js -u https://example.com --device iphone-14
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
