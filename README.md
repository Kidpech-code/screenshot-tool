# Screenshot Tool

เครื่องมือถ่ายภาพ full-page เว็บไซต์อัตโนมัติ รองรับทุก frontend framework  
พกพาได้ทันที — copy folder แล้วใช้งานเลย ไม่ต้อง config อะไรเพิ่ม

---

## สารบัญ

1. [ความต้องการ](#ความต้องการ)
2. [การติดตั้ง](#การติดตั้ง)
3. [โครงสร้างไฟล์](#โครงสร้างไฟล์)
4. [3 โหมดการใช้งาน](#3-โหมดการใช้งาน)
5. [ตัวเลือก CLI ทั้งหมด](#ตัวเลือก-cli-ทั้งหมด)
6. [ตัวอย่างการใช้งาน](#ตัวอย่างการใช้งาน)
7. [Mobile & Dark Mode](#mobile--dark-mode)
8. [การยืนยันตัวตน (Auth)](#การยืนยันตัวตน-auth)
9. [Config File](#config-file)
10. [Python Version](#python-version)
11. [ฟีเจอร์เทคนิค](#ฟีเจอร์เทคนิค)
12. [Troubleshooting](#troubleshooting)

---

## ความต้องการ

| รายการ  | เวอร์ชันขั้นต่ำ |
| ------- | --------------- |
| Node.js | 18.0.0+         |
| npm     | 8.0.0+          |

> **หรือ Python** (ดู [Python Version](#python-version))  
> Python 3.10+ + `pip install playwright tqdm`

---

## การติดตั้ง

### Node.js (แนะนำ)

```bash
# 1. เข้า folder
cd "screenshot tool"

# 2. ติดตั้ง dependencies
npm install

# 3. ติดตั้ง Chromium browser (ครั้งเดียว)
npx playwright install chromium
```

### Python (ทางเลือก)

```bash
pip install playwright tqdm
playwright install chromium
```

---

## โครงสร้างไฟล์

```
screenshot tool/
├── screenshot.js        ← Node.js version (แนะนำ)
├── screenshot.py        ← Python version
├── package.json
├── README.md
└── screenshots/         ← output (สร้างอัตโนมัติ)
    ├── pattern_a/
    │   ├── index.png
    │   ├── about.png
    │   └── services.png
    └── pattern_b/
        ├── index.png
        └── contact.png
```

---

## 3 โหมดการใช้งาน

### โหมด A — Specific Pages (ระบุหน้าเฉพาะ)

ใช้เมื่อ: รู้ชื่อไฟล์ที่ต้องการถ่ายชัดเจน

```
โปรเจ็ก/
├── pattern_a/
│   ├── index.html
│   ├── about.html
│   └── contact.html
└── pattern_b/
    └── index.html
```

```bash
node screenshot.js \
  --root /path/to/project \
  --dirs pattern_a pattern_b \
  --pages index about contact
```

ผลลัพธ์:

```
screenshots/
├── pattern_a/index.png
├── pattern_a/about.png
├── pattern_a/contact.png
├── pattern_b/index.png
└── ...
```

---

### โหมด B — Direct URLs

ใช้เมื่อ: ถ่าย URL ตรงๆ ทั้ง http:// https:// และ file://

```bash
node screenshot.js \
  --urls https://example.com https://example.com/about https://example.com/contact
```

ชื่อไฟล์สร้างอัตโนมัติจาก URL:

```
screenshots/
├── example.com_.png
├── example.com_about.png
└── example.com_contact.png
```

---

### โหมด C — Auto-Scan (สแกนอัตโนมัติ)

ใช้เมื่อ: ต้องการถ่ายทุกหน้าใน folder โดยไม่ต้องระบุชื่อ

```bash
node screenshot.js \
  --root /path/to/project \
  --dirs pattern_a pattern_b \
  --scan
```

สแกนหา `*.html` ทุกไฟล์ใน folder ที่ระบุ รวมถึง subfolder

---

### โหมด Interactive (ไม่ใส่ argument)

รันโดยไม่ใส่ argument จะถามทีละขั้นตอน:

```bash
node screenshot.js
```

```
🖼  Screenshot Tool — Interactive Setup

1. Root path of project [.]: /Users/me/my-project
2. Folder names to capture (space-separated): pattern_a pattern_b
3. Page names without .html (Enter = auto-scan all): index about
4. Viewport width in px [1440]: 1440
5. Output folder [./screenshots]: ./screenshots
```

---

## ตัวเลือก CLI ทั้งหมด

### Source (แหล่งข้อมูล)

| Flag                 | ย่อ  | Default | คำอธิบาย                            |
| -------------------- | ---- | ------- | ----------------------------------- |
| `--urls <URL...>`    | `-u` | —       | Direct URLs                         |
| `--root <path>`      | `-r` | `.`     | Root directory ของโปรเจ็ก           |
| `--dirs <folder...>` | `-d` | —       | Subfolders ที่มี HTML               |
| `--pages <name...>`  | `-g` | —       | ชื่อไฟล์ (ไม่รวม .html) — Mode A    |
| `--scan`             | —    | false   | Auto-scan `*.html` ทั้งหมด — Mode C |

### Output (ผลลัพธ์)

| Flag           | ย่อ  | Default         | คำอธิบาย               |
| -------------- | ---- | --------------- | ---------------------- |
| `--out <path>` | `-o` | `./screenshots` | Output directory       |
| `--pdf`        | —    | false           | ส่งออกเป็น PDF แทน PNG |

### Viewport (ขนาดหน้าจอ)

| Flag                | ย่อ  | Default | คำอธิบาย                        |
| ------------------- | ---- | ------- | ------------------------------- |
| `--width <px>`      | `-w` | `1440`  | ความกว้าง viewport              |
| `--height <px>`     | —    | `900`   | ความสูง viewport เริ่มต้น       |
| `--device <preset>` | —    | —       | Mobile preset (ดูตารางด้านล่าง) |
| `--dark-mode`       | —    | false   | Emulate dark color scheme       |

#### Device Presets

| Preset       | ขนาด      | Scale | ใช้งาน               |
| ------------ | --------- | ----- | -------------------- |
| `iphone-se`  | 375×667   | 2x    | iPhone SE / iPhone 8 |
| `iphone-14`  | 390×844   | 3x    | iPhone 14 / 15       |
| `ipad`       | 768×1024  | 2x    | iPad standard        |
| `ipad-pro`   | 1024×1366 | 2x    | iPad Pro 12.9"       |
| `galaxy-s21` | 360×800   | 3x    | Samsung Galaxy S21   |
| `pixel-7`    | 412×915   | 2x    | Google Pixel 7       |

### Behaviour (พฤติกรรม)

| Flag                    | ย่อ  | Default | คำอธิบาย                      |
| ----------------------- | ---- | ------- | ----------------------------- |
| `--delay <ms>`          | —    | `800`   | รอหลัง inject CSS (ms)        |
| `--retries <n>`         | —    | `2`     | ลองซ้ำเมื่อ timeout           |
| `--concurrency <n>`     | `-c` | `3`     | จำนวน parallel workers        |
| `--wait-for <selector>` | —    | —       | รอ CSS selector ปรากฏก่อนถ่าย |
| `--clip <selector>`     | —    | —       | ถ่ายเฉพาะ element เดียว       |
| `--no-css`              | —    | false   | ปิด CSS injection             |
| `--js <code>`           | —    | —       | JavaScript ที่รันก่อนถ่าย     |

### Auth / State (การยืนยันตัวตน)

| Flag                     | คำอธิบาย                             |
| ------------------------ | ------------------------------------ |
| `--cookies <json>`       | JSON array ของ cookies               |
| `--local-storage <json>` | JSON object inject เข้า localStorage |

### Config

| Flag              | คำอธิบาย                        |
| ----------------- | ------------------------------- |
| `--config <file>` | โหลดค่าจาก `.screenshotrc.json` |

---

## ตัวอย่างการใช้งาน

### พื้นฐาน

```bash
# สแกนทั้ง folder
node screenshot.js -r ~/my-project -d website --scan

# ระบุหลาย folder พร้อมกัน
node screenshot.js -r ~/my-project -d pattern_a pattern_b pattern_c -g index about services contact

# ถ่าย URL ตรง
node screenshot.js -u https://mysite.com https://mysite.com/about
```

### ปรับ viewport

```bash
# Desktop 1920px
node screenshot.js -r . -d site --scan -w 1920

# Tablet
node screenshot.js -u https://example.com -w 768

# Mobile
node screenshot.js -u https://example.com --device iphone-14
```

### เพิ่มความเร็ว

```bash
# 6 parallel workers (ระวัง RAM ถ้าหน้าเยอะมาก)
node screenshot.js -r . -d site --scan -c 6

# ลด delay สำหรับหน้าเบา
node screenshot.js -r . -d site --scan --delay 400
```

### ถ่าย element เฉพาะส่วน

```bash
# ถ่ายเฉพาะ hero section
node screenshot.js -u https://example.com --clip "#hero"

# ถ่ายเฉพาะ navigation
node screenshot.js -u https://example.com --clip "nav.main-nav"

# รอ element โหลดก่อน (สำหรับ lazy content)
node screenshot.js -u https://example.com --wait-for ".products-loaded"
```

### PDF export

```bash
# ส่งออกเป็น PDF พร้อมพิมพ์
node screenshot.js -r . -d site --scan --pdf

# URL ตรง → PDF
node screenshot.js -u https://example.com/report --pdf
```

### Custom JavaScript

```bash
# เปลี่ยนภาษาก่อนถ่าย
node screenshot.js -u https://example.com \
  --js "document.documentElement.lang='th'; document.querySelector('.lang-btn').click();"

# ซ่อน element บางอย่าง
node screenshot.js -u https://example.com \
  --js "document.querySelector('.promo-banner').remove();"
```

### ถ่ายโดยไม่ bypass animation

```bash
# raw screenshot ไม่ inject CSS
node screenshot.js -u https://example.com --no-css
```

---

## Mobile & Dark Mode

```bash
# iPhone 14 — light mode
node screenshot.js -u https://example.com --device iphone-14

# iPhone 14 — dark mode
node screenshot.js -u https://example.com --device iphone-14 --dark-mode

# Desktop dark mode
node screenshot.js -r . -d site --scan --dark-mode

# ถ่ายทั้ง desktop + mobile ในคราวเดียว (รัน 2 คำสั่ง)
node screenshot.js -r . -d site --scan -o ./screenshots/desktop
node screenshot.js -r . -d site --scan --device iphone-14 -o ./screenshots/mobile
```

---

## การยืนยันตัวตน (Auth)

### ผ่าน Cookies

เหมาะสำหรับ session-based auth, JWT token ใน cookie

```bash
node screenshot.js \
  -u https://app.example.com/dashboard \
  --cookies '[
    {
      "name": "session_id",
      "value": "abc123xyz",
      "domain": "app.example.com",
      "path": "/",
      "httpOnly": true
    }
  ]'
```

### ผ่าน localStorage

เหมาะสำหรับ JWT token ที่เก็บใน localStorage, language preference

```bash
node screenshot.js \
  -u https://app.example.com/dashboard \
  --local-storage '{"auth_token": "Bearer eyJhbGci...", "lang": "th"}'
```

> **หมายเหตุ:** เมื่อใช้ `--local-storage` หน้าจะ reload หนึ่งครั้งหลัง inject ค่า

---

## Config File

เก็บ preset ที่ใช้บ่อยไว้ใน `.screenshotrc.json` แทนการพิมพ์ flag ซ้ำทุกครั้ง

### สร้างไฟล์ `.screenshotrc.json`

```json
{
  "root": "/Users/me/my-project",
  "dirs": ["pattern_a", "pattern_b"],
  "scan": true,
  "width": 1440,
  "out": "./screenshots",
  "delay": 1000,
  "concurrency": 4,
  "retries": 3
}
```

### ใช้งาน

```bash
# โหลด config ทั้งหมด
node screenshot.js --config .screenshotrc.json

# CLI flag override config ได้เสมอ
node screenshot.js --config .screenshotrc.json --device iphone-14 -o ./screenshots/mobile
```

### ตัวอย่าง config หลายชุด

```bash
# config สำหรับ desktop
node screenshot.js --config config/desktop.json

# config สำหรับ mobile
node screenshot.js --config config/mobile.json
```

`config/desktop.json`:

```json
{
  "root": ".",
  "dirs": ["site"],
  "scan": true,
  "width": 1440,
  "out": "./shots/desktop"
}
```

`config/mobile.json`:

```json
{
  "root": ".",
  "dirs": ["site"],
  "scan": true,
  "device": "iphone-14",
  "out": "./shots/mobile"
}
```

---

## Python Version

ใช้ไฟล์ `screenshot.py` แทน `screenshot.js` — syntax เหมือนกันทุกอย่าง

```bash
# ติดตั้ง
pip install playwright tqdm
playwright install chromium

# ใช้งาน (syntax เดียวกัน)
python screenshot.py -r . -d site --scan
python screenshot.py -u https://example.com --device iphone-14
python screenshot.py --config .screenshotrc.json
```

---

## ฟีเจอร์เทคนิค

### Animation Bypass

inject CSS อัตโนมัติเพื่อ:

| ปัญหา                             | วิธีแก้                                          |
| --------------------------------- | ------------------------------------------------ |
| AOS / WOW.js ซ่อน element ไว้     | บังคับ `opacity: 1; visibility: visible`         |
| GSAP / ScrollTrigger ซ่อน element | bypass ด้วย class pattern                        |
| CSS transition ทำให้ภาพเบลอ       | `transition: none !important`                    |
| Parallax เลื่อนออก                | `transform: none; background-attachment: scroll` |
| Cookie banner บัง                 | `display: none !important`                       |
| Chat widget บัง                   | ซ่อน Tidio, Intercom, LiveChat                   |

### Timing Strategy

```
goto(url, waitUntil: "networkidle")  ← รอ network หยุด
     ↓
evaluate(customJs)                    ← optional
     ↓
addStyleTag(INJECT_CSS)              ← bypass animations
     ↓
waitForTimeout(delay)                 ← รอ font/render (default 800ms)
     ↓
screenshot(fullPage: true)            ← ถ่าย
```

### Concurrency Model

```
Browser (1 instance)
├── Context 1 → Page 1 → worker 1
├── Context 2 → Page 2 → worker 2
└── Context 3 → Page 3 → worker 3
```

- แต่ละ worker มี browser context และ page เป็นของตัวเอง
- cookie/localStorage ไม่รั่วข้ามหน้า
- ปรับจำนวน worker ด้วย `-c`

---

## Troubleshooting

### ภาพมีช่องว่างขาว / element หายไป

animation library ทำงานอยู่ก่อน inject CSS

```bash
# เพิ่ม delay
node screenshot.js ... --delay 1500

# หรือรอ element โหลดก่อน
node screenshot.js ... --wait-for ".all-content-loaded"
```

### Timeout error

หน้าหนักหรือ network ช้า

```bash
# เพิ่ม retry
node screenshot.js ... --retries 3

# ลด concurrency (ลด load)
node screenshot.js ... -c 1
```

### ภาพตัดครึ่ง (ไม่ full-page)

```bash
# ตรวจสอบว่าไม่ได้ใช้ --clip โดยไม่ตั้งใจ
# ลอง --delay สูงขึ้น
node screenshot.js ... --delay 2000
```

### CSS ของหน้าไม่โหลด (local file)

ตรวจสอบว่า path ของ CSS ใน HTML เป็น relative path ที่ถูกต้อง

```html
<!-- ✅ ถูก -->
<link rel="stylesheet" href="css/style.css" />

<!-- ❌ ผิด -->
<link rel="stylesheet" href="/absolute/path/style.css" />
```

### Cannot find module 'playwright'

```bash
npm install
npx playwright install chromium
```

### Error: executable doesn't exist

```bash
npx playwright install chromium
```

---

## Quick Reference

```bash
# ─── Node.js ──────────────────────────────────────────────
node screenshot.js -r <root> -d <folder> --scan          # Auto-scan
node screenshot.js -r <root> -d <folder> -g <pages>      # Specific pages
node screenshot.js -u <url1> <url2>                      # Direct URLs
node screenshot.js                                        # Interactive

# ─── Common Options ───────────────────────────────────────
-w 1280                  # Custom width
--device iphone-14       # Mobile
--dark-mode              # Dark theme
--delay 1200             # Longer wait
-c 5                     # 5 parallel workers
--retries 3              # More retries
--clip "#section"        # Element only
--wait-for ".loaded"     # Wait for selector
--pdf                    # PDF output
--no-css                 # Raw screenshot

# ─── Python ───────────────────────────────────────────────
python screenshot.py -r <root> -d <folder> --scan
```
