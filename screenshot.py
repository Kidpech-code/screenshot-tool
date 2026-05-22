#!/usr/bin/env python3
"""
Screenshot Tool — Full-Page Web Screenshot Utility
────────────────────────────────────────────────────
Requirements:
    pip install playwright tqdm
    playwright install chromium

Usage (CLI):
    python screenshot.py --help
    python screenshot.py -r /my/project -d pattern_a --scan
    python screenshot.py -r /my/project -d pattern_a -g index about contact
    python screenshot.py -u https://example.com https://example.com/about
    python screenshot.py  ← interactive mode

Author: Generated from screenshot_tool.md spec
"""

import asyncio
import argparse
import json
import re
import sys
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

try:
    from playwright.async_api import (
        async_playwright,
        Browser,
        BrowserContext,
        Page,
        TimeoutError as PlaywrightTimeoutError,
    )
except ImportError:
    print("❌  Missing dependency: pip install playwright && playwright install chromium")
    sys.exit(1)

try:
    from tqdm.asyncio import tqdm as atqdm
    HAS_TQDM = True
except ImportError:
    HAS_TQDM = False


# ─── MOBILE PRESETS ────────────────────────────────────────────────────────────
MOBILE_PRESETS: dict[str, dict] = {
    "iphone-se":    {"width": 375,  "height": 667,  "device_scale_factor": 2, "is_mobile": True},
    "iphone-14":    {"width": 390,  "height": 844,  "device_scale_factor": 3, "is_mobile": True},
    "ipad":         {"width": 768,  "height": 1024, "device_scale_factor": 2, "is_mobile": True},
    "ipad-pro":     {"width": 1024, "height": 1366, "device_scale_factor": 2, "is_mobile": True},
    "galaxy-s21":   {"width": 360,  "height": 800,  "device_scale_factor": 3, "is_mobile": True},
    "pixel-7":      {"width": 412,  "height": 915,  "device_scale_factor": 2, "is_mobile": True},
}

# ─── INJECT CSS ────────────────────────────────────────────────────────────────
INJECT_CSS = """
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

/* 4. Hide UI widgets (scroll-to-top, cookies, overlays) */
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
"""


# ─── UTILITIES ────────────────────────────────────────────────────────────────

def url_to_filename(url: str) -> str:
    """Convert URL to safe PNG filename.
    https://example.com/about/team → example.com_about_team.png
    """
    parsed = urlparse(url)
    name = parsed.netloc + parsed.path
    name = re.sub(r'[:/\\?=&#+%]', '_', name)
    name = re.sub(r'_+', '_', name).strip('_')
    return (name or "page") + ".png"


def load_config(config_path: str) -> dict:
    """Load .screenshotrc.json config file."""
    p = Path(config_path)
    if not p.exists():
        print(f"⚠️  Config not found: {config_path}")
        return {}
    with p.open(encoding="utf-8") as f:
        return json.load(f)


# ─── CORE SCREENSHOT ─────────────────────────────────────────────────────────

async def take_screenshot(
    page: Page,
    url: str,
    output_path: Path,
    width: int,
    height: int,
    delay_ms: int,
    custom_js: Optional[str],
    no_css: bool,
    clip_selector: Optional[str],
    wait_for: Optional[str],
    retries: int,
    dark_mode: bool,
    export_pdf: bool,
    cookies: Optional[list[dict]],
    local_storage: Optional[dict],
) -> bool:
    """Navigate to URL and capture full-page screenshot (or PDF)."""

    for attempt in range(1, retries + 1):
        try:
            await page.set_viewport_size({"width": width, "height": height})

            # Dark mode emulation
            if dark_mode:
                await page.emulate_media(color_scheme="dark")

            # Inject cookies before navigation
            if cookies:
                await page.context.add_cookies(cookies)

            await page.goto(url, wait_until="networkidle", timeout=60_000)

            # Inject localStorage after navigation
            if local_storage:
                js = "; ".join(
                    f"localStorage.setItem({json.dumps(k)}, {json.dumps(v)})"
                    for k, v in local_storage.items()
                )
                await page.evaluate(js)
                await page.reload(wait_until="networkidle", timeout=60_000)

            # Wait for selector if specified
            if wait_for:
                await page.wait_for_selector(wait_for, timeout=15_000)

            # Custom JS execution
            if custom_js:
                await page.evaluate(custom_js)

            # CSS injection (bypass animations/reveal)
            if not no_css:
                await page.add_style_tag(content=INJECT_CSS)

            # Wait for rendering to settle
            await page.wait_for_timeout(delay_ms)

            output_path.parent.mkdir(parents=True, exist_ok=True)

            # PDF export
            if export_pdf:
                pdf_path = output_path.with_suffix(".pdf")
                await page.pdf(path=str(pdf_path), print_background=True)
                return True

            # Clip to specific element
            if clip_selector:
                element = await page.query_selector(clip_selector)
                if element:
                    await element.screenshot(path=str(output_path))
                else:
                    print(f"  ⚠️  Selector not found: {clip_selector}")
                    return False
            else:
                await page.screenshot(path=str(output_path), full_page=True)

            return True

        except PlaywrightTimeoutError:
            if attempt < retries:
                await page.wait_for_timeout(2000)
                continue
            print(f"  ⏱  Timeout after {retries} attempt(s): {url}")
            return False

        except Exception as e:
            if attempt < retries:
                await page.wait_for_timeout(2000)
                continue
            print(f"  ❌  Error ({url}): {e}")
            return False

    return False


# ─── CONCURRENCY WORKER ───────────────────────────────────────────────────────

async def worker(
    browser: Browser,
    task_queue: asyncio.Queue,
    results: list,
    args: argparse.Namespace,
    semaphore: asyncio.Semaphore,
):
    """Single concurrent worker — owns its own browser page."""
    context: BrowserContext = await browser.new_context(
        **({} if not args.device else {"viewport": {"width": args.width, "height": args.height}})
    )
    page: Page = await context.new_page()

    while True:
        try:
            url, out_path, label = task_queue.get_nowait()
        except asyncio.QueueEmpty:
            break

        async with semaphore:
            ok = await take_screenshot(
                page=page,
                url=url,
                output_path=out_path,
                width=args.width,
                height=args.height,
                delay_ms=args.delay,
                custom_js=args.js,
                no_css=args.no_css,
                clip_selector=args.clip,
                wait_for=args.wait_for,
                retries=args.retries,
                dark_mode=args.dark_mode,
                export_pdf=args.pdf,
                cookies=args.cookies_data,
                local_storage=args.localstorage_data,
            )
            results.append((label, ok))

        task_queue.task_done()

    await context.close()


# ─── MAIN RUN ─────────────────────────────────────────────────────────────────

async def run(args: argparse.Namespace):
    tasks: list[tuple[str, Path, str]] = []  # (url, output_path, label)
    out_root = Path(args.out)

    # ── Mode A: specific pages from dirs ──────────────────────────────────────
    if args.dirs and args.pages:
        root = Path(args.root)
        for folder in args.dirs:
            folder_path = root / folder
            for page_name in args.pages:
                html_file = folder_path / f"{page_name}.html"
                if not html_file.exists():
                    print(f"  ⚠️  Not found: {html_file}")
                    continue
                url = html_file.resolve().as_uri()
                out = out_root / folder / f"{page_name}.png"
                tasks.append((url, out, f"{folder}/{page_name}"))

    # ── Mode C: auto-scan *.html ───────────────────────────────────────────────
    elif args.dirs and args.scan:
        root = Path(args.root)
        for folder in args.dirs:
            folder_path = root / folder
            for html_file in sorted(folder_path.rglob("*.html")):
                url = html_file.resolve().as_uri()
                rel = html_file.relative_to(folder_path)
                out = out_root / folder / rel.with_suffix(".png")
                tasks.append((url, out, f"{folder}/{rel}"))

    # ── Mode B: direct URLs ───────────────────────────────────────────────────
    elif args.urls:
        for url in args.urls:
            out = out_root / url_to_filename(url)
            tasks.append((url, out, url))

    else:
        print("❌  No valid mode selected. Use --help for usage.")
        return

    if not tasks:
        print("⚠️  No pages found to screenshot.")
        return

    ext = "PDF" if args.pdf else "PNG"
    print(f"\n📸  Capturing {len(tasks)} page(s) → {ext} @ {args.width}px wide"
          + (f" [{args.device}]" if args.device else "")
          + (" 🌙 dark" if args.dark_mode else "")
          + "\n")

    # Build queue
    queue: asyncio.Queue = asyncio.Queue()
    for task in tasks:
        queue.put_nowait(task)

    results: list[tuple[str, bool]] = []
    semaphore = asyncio.Semaphore(args.concurrency)

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)

        # Spawn workers
        workers = [
            asyncio.create_task(worker(browser, queue, results, args, semaphore))
            for _ in range(min(args.concurrency, len(tasks)))
        ]
        await asyncio.gather(*workers)
        await browser.close()

    # Summary
    ok   = sum(1 for _, s in results if s)
    fail = sum(1 for _, s in results if not s)

    print(f"\n{'─' * 44}")
    print(f"  Done : {ok} ✅   Failed : {fail} ❌")
    print(f"  Output → {out_root.resolve()}")


# ─── INTERACTIVE MODE ─────────────────────────────────────────────────────────

def interactive_mode() -> argparse.Namespace:
    """Guided step-by-step setup when no CLI args given."""
    print("\n🖼  Screenshot Tool — Interactive Setup\n")

    root   = input("1. Root path of project [.]: ").strip() or "."
    dirs_i = input("2. Folder names to capture (space-separated): ").strip()
    dirs   = dirs_i.split() if dirs_i else []

    pages_i = input("3. Page names without .html (Enter = auto-scan all): ").strip()
    pages   = pages_i.split() if pages_i else []

    width_i = input("4. Viewport width in px [1440]: ").strip()
    width   = int(width_i) if width_i.isdigit() else 1440

    out = input("5. Output folder [./screenshots]: ").strip() or "./screenshots"

    return argparse.Namespace(
        urls=[],
        dirs=dirs,
        pages=pages if pages else None,
        scan=(not pages),
        root=root,
        out=out,
        width=width,
        height=900,
        delay=800,
        js=None,
        no_css=False,
        clip=None,
        wait_for=None,
        retries=2,
        concurrency=3,
        dark_mode=False,
        pdf=False,
        device=None,
        cookies_data=None,
        localstorage_data=None,
    )


# ─── CLI PARSER ───────────────────────────────────────────────────────────────

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="screenshot",
        description="Full-page web screenshot tool with animation bypass",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Auto-scan all HTML in folder
  python screenshot.py -r /project -d pattern_a --scan

  # Specific pages across multiple folders
  python screenshot.py -r /project -d pattern_a pattern_b -g index about contact

  # Direct URLs
  python screenshot.py -u https://example.com https://example.com/about

  # Mobile viewport
  python screenshot.py -u https://example.com --device iphone-14

  # Dark mode + custom delay + 5 workers
  python screenshot.py -r /project -d site --scan --dark-mode --delay 1200 -c 5

  # Export PDF
  python screenshot.py -u https://example.com --pdf

  # Capture specific element only
  python screenshot.py -u https://example.com --clip "#hero-section"

  # Authenticated page via cookies
  python screenshot.py -u https://app.example.com --cookies '[{"name":"token","value":"abc","domain":"app.example.com"}]'

  # Load config file
  python screenshot.py --config .screenshotrc.json
        """,
    )

    # ── Source
    src = p.add_argument_group("Source")
    src.add_argument("-u", "--urls",  nargs="+", metavar="URL",    help="Direct URLs to screenshot")
    src.add_argument("-r", "--root",  default=".", metavar="PATH", help="Project root directory")
    src.add_argument("-d", "--dirs",  nargs="+", metavar="FOLDER", help="Subfolders containing HTML files")
    src.add_argument("-g", "--pages", nargs="+", metavar="NAME",   help="Page names without .html (Mode A)")
    src.add_argument("--scan",        action="store_true",          help="Auto-scan all *.html in dirs (Mode C)")

    # ── Output
    out = p.add_argument_group("Output")
    out.add_argument("-o", "--out",  default="./screenshots", metavar="PATH", help="Output directory (default: ./screenshots)")
    out.add_argument("--pdf",        action="store_true",                      help="Export PDF instead of PNG")

    # ── Viewport
    vp = p.add_argument_group("Viewport")
    vp.add_argument("-w", "--width",  type=int, default=1440, metavar="PX",     help="Viewport width (default: 1440)")
    vp.add_argument("--height",       type=int, default=900,  metavar="PX",     help="Viewport height (default: 900)")
    vp.add_argument("--device",       choices=list(MOBILE_PRESETS), metavar="DEVICE",
                    help=f"Mobile preset: {', '.join(MOBILE_PRESETS)}")
    vp.add_argument("--dark-mode",    action="store_true",                       help="Emulate dark color scheme")

    # ── Behaviour
    bh = p.add_argument_group("Behaviour")
    bh.add_argument("--delay",     type=int, default=800, metavar="MS",  help="Wait after CSS inject in ms (default: 800)")
    bh.add_argument("--retries",   type=int, default=2,   metavar="N",   help="Retry attempts per page (default: 2)")
    bh.add_argument("-c", "--concurrency", type=int, default=3, metavar="N", help="Parallel workers (default: 3)")
    bh.add_argument("--wait-for",  metavar="SELECTOR",               help="Wait for CSS selector before screenshot")
    bh.add_argument("--clip",      metavar="SELECTOR",               help="Capture specific element only")
    bh.add_argument("--no-css",    action="store_true",              help="Skip CSS injection (raw screenshot)")
    bh.add_argument("--js",        metavar="CODE",                   help="Custom JavaScript to execute before screenshot")

    # ── Auth
    au = p.add_argument_group("Auth / State")
    au.add_argument("--cookies",       metavar="JSON",  help='JSON array of cookies e.g. \'[{"name":"k","value":"v","domain":"x.com"}]\'')
    au.add_argument("--local-storage", metavar="JSON",  help='JSON object to inject into localStorage e.g. \'{"key":"value"}\'')

    # ── Config
    p.add_argument("--config", metavar="FILE", help="Path to .screenshotrc.json config file")

    return p


# ─── ENTRY POINT ─────────────────────────────────────────────────────────────

def main():
    parser = build_parser()

    if len(sys.argv) == 1:
        args = interactive_mode()
    else:
        args = parser.parse_args()

        # ── Load config file and merge (CLI args override config)
        if args.config:
            cfg = load_config(args.config)
            for key, val in cfg.items():
                k = key.replace("-", "_")
                if not any(f"--{key}" in a or f"-{key[0]}" in a for a in sys.argv[1:]):
                    setattr(args, k, val)

        # ── Apply device preset (overrides --width / --height if device given)
        if args.device and args.device in MOBILE_PRESETS:
            preset = MOBILE_PRESETS[args.device]
            args.width  = preset["width"]
            args.height = preset["height"]

        # ── Parse cookies JSON
        args.cookies_data = None
        if getattr(args, "cookies", None):
            try:
                args.cookies_data = json.loads(args.cookies)
            except json.JSONDecodeError:
                print("❌  --cookies must be valid JSON array")
                sys.exit(1)

        # ── Parse local-storage JSON
        args.localstorage_data = None
        ls_raw = getattr(args, "local_storage", None)
        if ls_raw:
            try:
                args.localstorage_data = json.loads(ls_raw)
            except json.JSONDecodeError:
                print("❌  --local-storage must be valid JSON object")
                sys.exit(1)

    asyncio.run(run(args))


if __name__ == "__main__":
    main()
