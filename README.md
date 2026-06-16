# 🧹 CleanSlate

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=flat&logo=html5&logoColor=white)]()
[![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat&logo=javascript&logoColor=black)]()

**Strip metadata from files without uploading them anywhere.**

<p align="center">
  <img src="cleanslate-screenshot.png" alt="CleanSlate Screenshot" width="800">
</p>

CleanSlate is a privacy-first metadata cleaner that runs entirely in your browser. Drop in images, PDFs, or Office documents, see exactly what metadata is buried in them, then download clean versions. No servers, no tracking, no sign-up, no nothing.

---

## Features

- **Drag-and-drop, click-to-browse, or paste** — Ctrl+V / ⌘V to drop a clipboard image straight in
- **Image thumbnails** — see what you're working on at a glance
- **Metadata preview before cleaning** — actually see what's in there (camera model, GPS coordinates, author name, software used, timestamps…)
- **Before → after file size** — shows exactly how much weight was cut, with the percentage saved in green
- **Stripped fields confirmation** — after cleaning, the card shows exactly which fields were removed
- **Fully client-side** — everything runs in memory in your browser, nothing ever touches a server
- **Batch download** — clean one file or grab the whole lot as a ZIP
- **Dark / light mode** — follows your system setting by default, manual toggle saves your preference
- **Keyboard accessible** — Tab to the drop zone, Enter/Space to open the file picker
- **No install, no build step** — just open `index.html` and it works

---

## Supported Formats

| Format | What gets removed |
|--------|-------------------|
| **JPEG** | EXIF (camera, GPS, dates, software), XMP, IPTC, comments |
| **PNG** | `tEXt`, `iTXt`, `zTXt`, `eXIf`, `tIME`, `iCCP` chunks |
| **WebP** | EXIF, XMP, ICC profile (VP8X extended format) |
| **TIFF** | Make, Model, Software, DateTime, Artist, Copyright, description |
| **PDF** | Title, Author, Subject, Keywords, Creator, Producer, dates, XMP stream |
| **DOCX / XLSX / PPTX** | Author, title, dates (`core.xml`) and app name, version, company (`app.xml`) |

---

## How It Works

### Images (JPEG / PNG / WebP / TIFF)
Files are parsed at the binary level with `ArrayBuffer` and `DataView`. Metadata segments get identified by their format markers and dropped when the output is written — the actual image data is never touched.

### PDFs
Info dictionary fields get overwritten in-place with spaces of the same byte length, keeping the cross-reference table intact without needing a full PDF parser.

### Office Documents
DOCX, XLSX, and PPTX files are just ZIP archives with XML inside. [JSZip](https://stuk.github.io/jszip/) unpacks them, the metadata XMLs (`docProps/core.xml` and `docProps/app.xml`) get cleaned, and everything gets re-zipped. Nothing else in the document is touched.

---

## Usage

```bash
git clone https://github.com/CasualcoderDev/CleanSlate.git
cd CleanSlate
open index.html   # or just double-click it in Finder/Explorer
```

No `npm install`. No build step. Just open and go.

> **Heads up:** Office file support (DOCX, XLSX, PPTX) loads JSZip from a CDN, so you'll need an internet connection the first time for those. Every other format works completely offline.

---

## File Structure

```
CleanSlate/
├── index.html   # markup only, no inline scripts or styles
├── style.css    # design tokens, layout, dark/light mode
├── script.js    # all the logic — parsing, stripping, UI
└── README.md
```

---

## Privacy

- **Nothing is uploaded.** Files are read directly from disk into browser memory via the File API.
- **Nothing is stored.** No cookies, no IndexedDB, no analytics. The only localStorage key is `cs-theme` for your dark/light preference.
- **No server at all.** You could download this repo, disconnect from the internet, and it would still work for everything except Office files (which need JSZip).

---

## Browser Support

Any modern browser — Chrome, Firefox, Safari, Edge. Needs `ArrayBuffer`, `DataView`, and `URL.createObjectURL`, which every current browser has had for years.

---

## License

MIT — do whatever you want with it.
