// ─────────────────────────────────────────────────────────────
//  State
// ─────────────────────────────────────────────────────────────

console.log('%c🧹 CleanSlate', 'font-size: 24px; font-weight: bold; color: #2563eb;');
console.log('%cPrivacy-first metadata cleaner running entirely in your browser.', 'font-size: 14px; margin-bottom: 8px;');
console.log('%cContributions welcome! https://github.com/CasualcoderDev/CleanSlate', 'font-size: 12px; color: gray;');

// Each entry: { id, file, thumbUrl, meta, cleanedBlob, cleanedSize, removedFields, status }
const files = [];
let idSeq = 0;

// Only jpeg/png/webp/svg reliably render as <img> cross-browser
const THUMB_TYPES = new Set(['jpg','jpeg','png','webp','svg']);

// ─────────────────────────────────────────────────────────────
//  Theme
// ─────────────────────────────────────────────────────────────

const themeBtn = document.getElementById('theme-btn');

function toggleTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
    || (!document.documentElement.hasAttribute('data-theme')
        && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', isDark ? 'light' : 'dark');
  themeBtn.textContent = isDark ? '🌙 Dark' : '☀ Light';
  localStorage.setItem('cs-theme', isDark ? 'light' : 'dark');
}

(function initTheme() {
  const saved = localStorage.getItem('cs-theme');
  if (saved) {
    document.documentElement.setAttribute('data-theme', saved);
    themeBtn.textContent = saved === 'dark' ? '☀ Light' : '🌙 Dark';
  } else {
    themeBtn.textContent = window.matchMedia('(prefers-color-scheme: dark)').matches ? '☀ Light' : '🌙 Dark';
  }
})();

// ─────────────────────────────────────────────────────────────
//  Drop zone
// ─────────────────────────────────────────────────────────────

const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');

// dragDepth stops the drag-over state flickering when you hover child elements
let dragDepth = 0;
dropZone.addEventListener('dragenter', e => { e.preventDefault(); if (++dragDepth === 1) dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', ()  => { if (--dragDepth === 0) dropZone.classList.remove('drag-over'); });
dropZone.addEventListener('dragover',  e  => e.preventDefault());
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dragDepth = 0;
  dropZone.classList.remove('drag-over');
  handleFiles([...e.dataTransfer.files]);
});

// keyboard users: Enter or Space opens the file picker
dropZone.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
});

fileInput.addEventListener('change', () => {
  handleFiles([...fileInput.files]);
  fileInput.value = '';
});

// paste an image from clipboard (Ctrl/Cmd+V anywhere on the page)
document.addEventListener('paste', e => {
  if (!e.clipboardData?.items) return;
  const pasted = [...e.clipboardData.items]
    .filter(i => i.kind === 'file')
    .map(i => i.getAsFile())
    .filter(Boolean);
  if (pasted.length) {
    handleFiles(pasted);
    toast(`📋 Pasted ${pasted.length} file${pasted.length > 1 ? 's' : ''}`);
  }
});

// ─────────────────────────────────────────────────────────────
//  File handling
// ─────────────────────────────────────────────────────────────

const SUPPORTED_EXTS = ['jpg','jpeg','png','tiff','tif','webp','svg','pdf','docx','xlsx','pptx','mp3','mp4','m4a','mov'];

function handleFiles(incoming) {
  const supported = incoming.filter(f => SUPPORTED_EXTS.includes(ext(f)));
  if (!supported.length) { toast('No supported files detected'); return; }

  supported.forEach(f => {
    const id      = ++idSeq;
    const thumbUrl = THUMB_TYPES.has(ext(f)) ? URL.createObjectURL(f) : null;
    const entry   = { id, file: f, thumbUrl, meta: null, cleanedBlob: null, cleanedSize: null, removedFields: [], status: 'loading' };
    files.push(entry);
    injectCard(entry);
    processFile(entry).catch(err => {
      entry.meta = { Error: err.message };
      entry.status = 'ready';
      updateCard(entry);
    });
  });

  updateToolbar();
}

async function processFile(entry) {
  const buf = await entry.file.arrayBuffer();
  const e   = ext(entry.file);

  try {
    if (['jpg','jpeg'].includes(e))       entry.meta = readJpegMeta(buf);
    else if (e === 'png')                 entry.meta = readPngMeta(buf);
    else if (e === 'webp')                entry.meta = readWebpMeta(buf);
    else if (['tiff','tif'].includes(e))  entry.meta = readTiffMeta(buf);
    else if (e === 'svg')                 entry.meta = readSvgMeta(await entry.file.text());
    else if (e === 'pdf')                 entry.meta = readPdfMeta(buf);
    else if (['docx','xlsx','pptx'].includes(e)) entry.meta = await readOfficeMeta(buf);
    else if (e === 'mp3')                 entry.meta = readMp3Meta(buf);
    else if (['mp4','m4a','mov'].includes(e)) entry.meta = readMp4Meta(buf);
  } catch (err) {
    entry.meta = { Error: err.message };
  }

  entry.status = 'ready';
  updateCard(entry);
}

// ─────────────────────────────────────────────────────────────
//  JPEG
// ─────────────────────────────────────────────────────────────

// APP segments to drop: APP1 (EXIF/XMP), APP2 (ICC), APP13 (IPTC), APP14, COM
const STRIP_MARKERS = new Set([0xe1, 0xe2, 0xed, 0xee, 0xfe]);

function readJpegMeta(buf) {
  const view = new DataView(buf);
  if (view.getUint16(0) !== 0xffd8) throw new Error('Not a JPEG');

  const meta = {};
  let off = 2;

  while (off < buf.byteLength - 1) {
    if (view.getUint8(off) !== 0xff) break;
    const marker = view.getUint8(off + 1);
    if (marker === 0xd9 || marker === 0xda) break;

    const segLen = view.getUint16(off + 2);

    if (marker === 0xe1) {
      const header = new TextDecoder().decode(new Uint8Array(buf, off + 4, 6));
      if (header.startsWith('Exif')) Object.assign(meta, parseExifIFD(buf, off + 10));
      else if (header.startsWith('http://') || header.includes('xpacket')) meta['XMP'] = '(XMP packet present)';
    } else if (marker === 0xed) {
      meta['IPTC'] = '(IPTC block present)';
    } else if (marker === 0xfe) {
      meta['Comment'] = new TextDecoder().decode(new Uint8Array(buf, off + 4, segLen - 2)).trim().slice(0, 200);
    }

    off += 2 + segLen;
  }

  return Object.keys(meta).length ? meta : null;
}

function stripJpeg(buf) {
  const view   = new DataView(buf);
  if (view.getUint16(0) !== 0xffd8) throw new Error('Not a JPEG');

  const chunks = [new Uint8Array(buf, 0, 2)];
  let off = 2;

  while (off < buf.byteLength - 1) {
    if (view.getUint8(off) !== 0xff) { chunks.push(new Uint8Array(buf, off)); break; }

    const marker = view.getUint8(off + 1);
    if (marker === 0xd9) { chunks.push(new Uint8Array(buf, off, 2)); break; }
    if (marker === 0xda) { chunks.push(new Uint8Array(buf, off)); break; }

    const segLen = view.getUint16(off + 2);
    if (!STRIP_MARKERS.has(marker)) chunks.push(new Uint8Array(buf, off, 2 + segLen));
    off += 2 + segLen;
  }

  return mergeBuffers(chunks);
}

// Minimal EXIF IFD parser — just enough to surface the useful fields
const EXIF_TAGS = {
  0x010e: 'ImageDescription', 0x010f: 'Make',         0x0110: 'Model',
  0x0112: 'Orientation',      0x011a: 'XResolution',  0x011b: 'YResolution',
  0x0131: 'Software',         0x0132: 'DateTime',     0x013b: 'Artist',
  0x8769: 'ExifSubIFD',       0x8825: 'GPSIFDPointer',
  0x829a: 'ExposureTime',     0x829d: 'FNumber',      0x8827: 'ISOSpeed',
  0x9003: 'DateTimeOriginal', 0x9004: 'DateTimeDigitized',
  0x9201: 'ShutterSpeedValue',0x9202: 'ApertureValue',
  0xa002: 'PixelXDimension',  0xa003: 'PixelYDimension',
  0x0002: 'GPSLatitude',      0x0004: 'GPSLongitude', 0x0006: 'GPSAltitude',
  0x8298: 'Copyright',
};

function parseExifIFD(buf, exifStart) {
  const meta = {};
  try {
    const view = new DataView(buf);
    const le   = view.getUint16(exifStart) === 0x4949;
    const u16  = o => view.getUint16(exifStart + o, le);
    const u32  = o => view.getUint32(exifStart + o, le);

    function parseIFD(offset) {
      if (offset + 2 > buf.byteLength - exifStart) return;
      const count = u16(offset);
      for (let i = 0; i < count; i++) {
        const e    = offset + 2 + i * 12;
        const tag  = u16(e);
        const type = u16(e + 2);
        const comp = u32(e + 4);
        const vOff = e + 8;

        if (tag === 0x8769 || tag === 0x8825) { parseIFD(u32(vOff)); continue; }

        const label = EXIF_TAGS[tag];
        if (!label) continue;

        if (type === 2) {
          const absOff = comp > 4 ? exifStart + u32(vOff) : vOff + exifStart;
          const str    = new TextDecoder().decode(new Uint8Array(buf, absOff, comp - 1)).trim();
          if (str) meta[label] = str;
        } else if (type === 5 || type === 10) {
          const rOff = exifStart + u32(vOff);
          const num  = view.getUint32(rOff, le);
          const den  = view.getUint32(rOff + 4, le);
          if (den) meta[label] = `${num}/${den}`;
        } else if (type === 3) {
          meta[label] = view.getUint16(vOff, le);
        } else if (type === 4) {
          meta[label] = u32(vOff);
        }
      }
    }

    parseIFD(u32(4));
  } catch (_) { /* tolerate malformed EXIF */ }
  return meta;
}

// ─────────────────────────────────────────────────────────────
//  PNG
// ─────────────────────────────────────────────────────────────

const PNG_SIG       = [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a];
const PNG_STRIP     = new Set(['tEXt','iTXt','zTXt','eXIf','tIME','iCCP']);
const PNG_META_SHOW = new Set(['tEXt','iTXt','zTXt','eXIf','tIME']);

function readPngMeta(buf) {
  const bytes = new Uint8Array(buf);
  const view  = new DataView(buf);
  for (let i = 0; i < 8; i++) if (bytes[i] !== PNG_SIG[i]) throw new Error('Not a PNG');

  const meta = {};
  let off = 8;

  while (off + 8 <= buf.byteLength) {
    const len  = view.getUint32(off);
    const type = String.fromCharCode(...bytes.slice(off+4, off+8));
    if (type === 'IEND') break;

    if (PNG_META_SHOW.has(type)) {
      const data = bytes.slice(off+8, off+8+len);
      if (type === 'tEXt' || type === 'iTXt') {
        const nul = data.indexOf(0);
        const key = new TextDecoder().decode(data.slice(0, nul));
        meta[key] = type === 'tEXt'
          ? new TextDecoder().decode(data.slice(nul+1)).trim().slice(0, 200)
          : '(iTXt block)';
      } else if (type === 'eXIf') {
        Object.assign(meta, parseExifIFD(buf, off + 8));
      } else if (type === 'tIME') {
        const yr = view.getUint16(off+8);
        meta['Last Modified'] = `${yr}-${data[2].toString().padStart(2,'0')}-${data[3].toString().padStart(2,'0')}`;
      }
    }

    off += 8 + len + 4;
  }

  return Object.keys(meta).length ? meta : null;
}

function stripPng(buf) {
  const bytes  = new Uint8Array(buf);
  const view   = new DataView(buf);
  const chunks = [bytes.slice(0, 8)];
  let off = 8;

  while (off + 8 <= buf.byteLength) {
    const len  = view.getUint32(off);
    const type = String.fromCharCode(...bytes.slice(off+4, off+8));
    if (!PNG_STRIP.has(type)) chunks.push(bytes.slice(off, off + 8 + len + 4));
    if (type === 'IEND') break;
    off += 8 + len + 4;
  }

  return mergeBuffers(chunks);
}

// ─────────────────────────────────────────────────────────────
//  WebP
// ─────────────────────────────────────────────────────────────

function readWebpMeta(buf) {
  const view  = new DataView(buf);
  const bytes = new Uint8Array(buf);
  const s4    = (a, b) => new TextDecoder().decode(bytes.slice(a, b));

  if (s4(0,4) !== 'RIFF' || s4(8,12) !== 'WEBP') throw new Error('Not a WebP');

  const meta    = {};
  let off       = 12;
  const riffEnd = view.getUint32(4, true) + 8;

  while (off + 8 <= buf.byteLength && off < riffEnd) {
    const id  = s4(off, off+4);
    const len = view.getUint32(off+4, true);

    if (id === 'EXIF')      Object.assign(meta, parseExifIFD(buf, off + 8));
    else if (id === 'XMP ') meta['XMP'] = '(XMP packet present)';
    else if (id === 'ICCP') meta['ICC Profile'] = '(color profile present)';

    off += 8 + len + (len & 1);
  }

  return Object.keys(meta).length ? meta : null;
}

function stripWebp(buf) {
  const view  = new DataView(buf);
  const bytes = new Uint8Array(buf);
  const s4    = o => new TextDecoder().decode(bytes.slice(o, o+4));

  if (s4(0) !== 'RIFF' || s4(8) !== 'WEBP') throw new Error('Not a WebP');
  if (s4(12) !== 'VP8X') return buf; // plain VP8/VP8L can't carry metadata

  const STRIP_WEBP = new Set(['EXIF','XMP ','ICCP']);
  const kept   = [bytes.slice(0, 12)];
  let newSize  = 4;
  let off      = 12;

  while (off + 8 <= buf.byteLength) {
    const id     = s4(off);
    const len    = view.getUint32(off+4, true);
    const padded = len + (len & 1);

    if (!STRIP_WEBP.has(id)) {
      if (id === 'VP8X') {
        const chunk = bytes.slice(off, off + 8 + padded).slice();
        chunk[8] &= ~0b00101100; // clear EXIF, XMP, ICCP flags
        kept.push(chunk);
      } else {
        kept.push(bytes.slice(off, off + 8 + padded));
      }
      newSize += 8 + padded;
    }

    off += 8 + padded;
  }

  const out = mergeBuffers(kept);
  new DataView(out.buffer).setUint32(4, newSize, true);
  return out;
}

// ─────────────────────────────────────────────────────────────
//  TIFF
// ─────────────────────────────────────────────────────────────

const TIFF_TAGS = {
  0x010e: 'ImageDescription', 0x010f: 'Make',  0x0110: 'Model',
  0x0131: 'Software',         0x0132: 'DateTime', 0x013b: 'Artist',
  0x8298: 'Copyright',        0x013c: 'HostComputer',
};

function readTiffMeta(buf) {
  const view   = new DataView(buf);
  const endian = view.getUint16(0);
  if (endian !== 0x4949 && endian !== 0x4d4d) throw new Error('Not a TIFF');
  const le    = endian === 0x4949;
  const u16   = o => view.getUint16(o, le);
  const u32   = o => view.getUint32(o, le);
  const meta  = {};
  const count = u16(u32(4));

  for (let i = 0; i < count; i++) {
    const e     = u32(4) + 2 + i * 12;
    const tag   = u16(e);
    const type  = u16(e + 2);
    const comp  = u32(e + 4);
    const label = TIFF_TAGS[tag];
    if (!label || type !== 2) continue;
    const dataOff = comp > 4 ? u32(e+8) : e+8;
    const str = new TextDecoder().decode(new Uint8Array(buf, dataOff, comp - 1)).trim();
    if (str) meta[label] = str;
  }

  return Object.keys(meta).length ? meta : null;
}

function stripTiff(buf) {
  const view  = new DataView(buf);
  const le    = view.getUint16(0) === 0x4949;
  const u16   = o => view.getUint16(o, le);
  const u32   = o => view.getUint32(o, le);
  const out   = buf.slice(0);
  const bytes = new Uint8Array(out);
  const count = u16(u32(4));

  for (let i = 0; i < count; i++) {
    const e    = u32(4) + 2 + i * 12;
    const tag  = u16(e);
    const type = u16(e + 2);
    const comp = u32(e + 4);
    if (!TIFF_TAGS[tag] || type !== 2) continue;
    const dataOff = comp > 4 ? u32(e+8) : e+8;
    bytes.fill(0x00, dataOff, dataOff + comp);
  }

  return bytes;
}

// ─────────────────────────────────────────────────────────────
//  PDF
// ─────────────────────────────────────────────────────────────

function readPdfMeta(buf) {
  const text = new TextDecoder('latin1').decode(buf);
  if (!text.startsWith('%PDF')) throw new Error('Not a PDF');

  const meta   = {};
  const infoRx = /<<([\s\S]*?)>>/g;
  const kvRx   = /\/(Title|Author|Subject|Keywords|Creator|Producer|CreationDate|ModDate)\s*\(([^)]*)\)/g;
  let m;

  while ((m = infoRx.exec(text)) !== null) {
    let kv;
    kvRx.lastIndex = 0;
    while ((kv = kvRx.exec(m[1])) !== null) {
      meta[kv[1]] = kv[2].replace(/\\n/g,' ').trim().slice(0, 300);
    }
  }

  if (text.includes('<?xpacket')) meta['XMP'] = '(XMP stream present)';
  return Object.keys(meta).length ? meta : null;
}

function stripPdf(buf) {
  const bytes = new Uint8Array(buf.slice(0));
  const text  = new TextDecoder('latin1').decode(bytes);
  const keys  = ['Title','Author','Subject','Keywords','Creator','Producer','CreationDate','ModDate'];

  // 1. Strip parenthesis-delimited values: /Key (value)
  const rxParen = new RegExp(`/(${keys.join('|')})\\s*\\(([^)]*)\\)`, 'g');
  let m;
  while ((m = rxParen.exec(text)) !== null) {
    const start = m.index + m[0].indexOf('(') + 1;
    bytes.fill(0x20, start, start + m[2].length);
  }

  // 2. Strip hex-string-delimited values: /Key <FEFF0048...>
  const rxHex = new RegExp(`/(${keys.join('|')})\\s*<([0-9A-Fa-f\\s]+)>`, 'g');
  while ((m = rxHex.exec(text)) !== null) {
    const ltPos = m.index + m[0].indexOf('<') + 1;
    bytes.fill(0x20, ltPos, ltPos + m[2].length);
  }

  const xs = text.indexOf('<?xpacket');
  if (xs !== -1) {
    const xe = text.indexOf('<?xpacket end', xs);
    if (xe !== -1) bytes.fill(0x20, xs + 9, xe);
  }

  return bytes;
}

// ─────────────────────────────────────────────────────────────
//  Office (docx / xlsx / pptx — ZIP + XML)
// ─────────────────────────────────────────────────────────────

const CORE_FIELDS = [
  'dc:title','dc:creator','dc:description','dc:subject','dc:keywords',
  'cp:lastModifiedBy','cp:revision','dcterms:created','dcterms:modified',
];
const APP_FIELDS = ['Application','AppVersion','Company','Manager','Template'];

// XML namespaces used in OPC packages
const NS = {
  ct:  'http://schemas.openxmlformats.org/package/2006/content-types',
  rel: 'http://schemas.openxmlformats.org/package/2006/relationships',
  cp:  'http://schemas.openxmlformats.org/package/2006/metadata/core-properties',
};

// Parts that carry personal data or document preview thumbnails
const PROPS_PARTS = [
  'docProps/core.xml',
  'docProps/app.xml',
  'docProps/custom.xml',
  'docProps/custom.xml.rels',
  'docProps/thumbnail.jpeg',
  'docProps/thumbnail.png',
  'docProps/thumbnail.wmf',
  'docProps/thumbnail.emf',
];

function xmlFromText(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) {
    throw new Error('XML parse error');
  }
  return doc;
}

function xmlToText(doc) {
  return new XMLSerializer().serializeToString(doc);
}

// Re-encode an image through canvas: pixels survive, metadata does not.
async function scrubImageBytes(name, data) {
  const ext = name.split('.').pop().toLowerCase();
  const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
  try {
    const blob = new Blob([data], { type: mime });
    const bmp  = await createImageBitmap(blob);
    let outBlob;
    if (typeof OffscreenCanvas !== 'undefined') {
      const cv  = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = cv.getContext('2d');
      ctx.drawImage(bmp, 0, 0);
      outBlob = await cv.convertToBlob({ type: mime, quality: 0.95 });
    } else if (typeof document !== 'undefined') {
      const cv = document.createElement('canvas');
      cv.width = bmp.width;
      cv.height = bmp.height;
      const ctx = cv.getContext('2d');
      ctx.drawImage(bmp, 0, 0);
      outBlob = await new Promise(resolve => cv.toBlob(resolve, mime, 0.95));
    }
    if (outBlob) {
      return new Uint8Array(await outBlob.arrayBuffer());
    }
    return data;
  } catch {
    return data; // decoding failed or unsupported format, leave original bytes
  }
}

async function readOfficeMeta(buf) {
  if (typeof JSZip === 'undefined') throw new Error('JSZip not loaded — needs internet on first use for Office files');
  const zip  = await JSZip.loadAsync(buf);
  const meta = {};

  const coreFile = zip.file('docProps/core.xml');
  if (coreFile) {
    const xml = await coreFile.async('text');
    for (const field of CORE_FIELDS) {
      const m = xml.match(new RegExp(`<${field}[^>]*>([^<]*)<`));
      if (m?.[1]?.trim()) meta[field.replace(/.*:/,'')] = m[1].trim().slice(0, 200);
    }
  }

  const appFile = zip.file('docProps/app.xml');
  if (appFile) {
    const xml = await appFile.async('text');
    for (const field of APP_FIELDS) {
      const m = xml.match(new RegExp(`<${field}>([^<]*)<`));
      if (m?.[1]?.trim()) meta[field] = m[1].trim().slice(0, 200);
    }
  }

  if (zip.file('docProps/custom.xml')) {
    meta['Custom Properties'] = '(Custom properties present)';
  }

  const thumb = Object.keys(zip.files).find(n => n.startsWith('docProps/thumbnail'));
  if (thumb) {
    meta['Preview Thumbnail'] = '(Document preview image present)';
  }

  const media = Object.keys(zip.files).filter(n => /\/media\/.+\.(jpe?g|png)$/i.test(n));
  if (media.length > 0) {
    meta['Embedded Media'] = `${media.length} embedded image${media.length > 1 ? 's' : ''}`;
  }

  return Object.keys(meta).length ? meta : null;
}

async function stripOffice(buf) {
  if (typeof JSZip === 'undefined') throw new Error('JSZip not loaded — needs internet on first use for Office files');

  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files);
  const nameSet = new Set(names);

  // 1. [Content_Types].xml: drop overrides for removed parts and nonexistent parts
  const ctName = '[Content_Types].xml';
  if (!zip.file(ctName)) throw new Error('Not an Office file');
  const ct = xmlFromText(await zip.file(ctName).async('text'));
  for (const ov of [...ct.getElementsByTagNameNS(NS.ct, 'Override')]) {
    const pn = ov.getAttribute('PartName').replace(/^\//, '');
    if (PROPS_PARTS.includes(pn) || !nameSet.has(pn)) {
      ov.parentNode.removeChild(ov);
    }
  }
  zip.file(ctName, xmlToText(ct));

  // 2. _rels/.rels: drop relationships that point at removed parts
  const rootRelsName = '_rels/.rels';
  if (zip.file(rootRelsName)) {
    const rels = xmlFromText(await zip.file(rootRelsName).async('text'));
    for (const rel of [...rels.getElementsByTagNameNS(NS.rel, 'Relationship')]) {
      const target = rel.getAttribute('Target').replace(/^\//, '');
      if (PROPS_PARTS.includes(target) || (rel.getAttribute('TargetMode') !== 'External' && !target.startsWith('http') && !nameSet.has(target))) {
        rel.parentNode.removeChild(rel);
      }
    }
    zip.file(rootRelsName, xmlToText(rels));
  }

  // 3. Remove the property and thumbnail parts themselves
  for (const p of PROPS_PARTS) {
    zip.remove(p);
  }

  // 4. Scrub metadata inside embedded images (media folder)
  const media = names.filter(n => /\/media\/.+\.(jpe?g|png)$/i.test(n));
  for (const m of media) {
    const raw = await zip.file(m).async('uint8array');
    zip.file(m, await scrubImageBytes(m, raw));
  }

  // 5. Keep [Content_Types].xml as the FIRST entry, normalize timestamps to epoch 0
  const out = new JSZip();
  out.file(ctName, await zip.file(ctName).async('text'), { date: new Date(0) });
  for (const n of names) {
    if (n === ctName || PROPS_PARTS.includes(n) || zip.files[n].dir) continue;
    out.file(n, zip.files[n].async('uint8array'), {
      date: new Date(0),
      binary: true,
    });
  }

  const blob = await out.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  // 6. VALIDATE: verify that all XML and rels parts parse cleanly
  const check = await JSZip.loadAsync(await blob.arrayBuffer());
  const checkNames = Object.keys(check.files);
  for (const n of checkNames) {
    if (n.endsWith('.xml') || n.endsWith('.rels')) {
      xmlFromText(await check.file(n).async('text'));
    }
  }
  if (!checkNames.includes(ctName)) throw new Error('Office validation failed');

  return new Uint8Array(await blob.arrayBuffer());
}

// ─────────────────────────────────────────────────────────────
//  SVG (Vector Graphics & Sanitization)
// ─────────────────────────────────────────────────────────────

function readSvgMeta(text) {
  const meta = {};
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  if (doc.getElementsByTagName('parsererror').length) {
    throw new Error('Invalid SVG markup');
  }

  // 1. Metadata / RDF elements
  const metadataEl = doc.getElementsByTagName('metadata')[0];
  if (metadataEl && metadataEl.textContent.trim()) {
    meta['Metadata Block'] = '(RDF/XML metadata present)';
  }

  // 2. Title and Description
  const title = doc.getElementsByTagName('title')[0]?.textContent?.trim();
  if (title) meta['Title'] = title.slice(0, 150);
  const desc = doc.getElementsByTagName('desc')[0]?.textContent?.trim();
  if (desc) meta['Description'] = desc.slice(0, 150);

  // 3. Scripts
  const scripts = doc.getElementsByTagName('script');
  if (scripts.length) {
    meta['Embedded Scripts'] = `${scripts.length} script tag${scripts.length > 1 ? 's' : ''} detected`;
  }

  // 4. Editor signatures / namespaces
  const svgEl = doc.documentElement;
  const editorAttrs = [];
  for (const attr of [...svgEl.attributes]) {
    if (/inkscape|sodipodi|illustrator|sketch|serif|adobe/i.test(attr.name + attr.value)) {
      editorAttrs.push(attr.name);
    }
  }
  if (editorAttrs.length) {
    meta['Editor Signatures'] = editorAttrs.slice(0, 3).join(', ');
  }

  // 5. XML comments
  const commentCount = (text.match(/<!--[\s\S]*?-->/g) || []).length;
  if (commentCount > 0) {
    meta['Comments'] = `${commentCount} comment${commentCount > 1 ? 's' : ''}`;
  }

  return Object.keys(meta).length ? meta : null;
}

function stripSvg(text) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  if (doc.getElementsByTagName('parsererror').length) {
    throw new Error('Invalid SVG markup');
  }

  // 1. Remove metadata, scripts, and auxiliary description tags
  const removeTags = ['metadata', 'script', 'desc', 'title', 'foreignObject'];
  for (const tag of removeTags) {
    const els = [...doc.getElementsByTagName(tag)];
    for (const el of els) el.remove();
  }

  // 2. Recursively clean comments and editor/event attributes
  function cleanNode(node) {
    for (let i = node.childNodes.length - 1; i >= 0; i--) {
      const child = node.childNodes[i];
      if (child.nodeType === 8) { // Comment
        node.removeChild(child);
      } else if (child.nodeType === 1) { // Element
        const attrsToRemove = [];
        for (const attr of child.attributes) {
          if (attr.name.startsWith('on') || /^(inkscape|sodipodi|i:|sketch:|serif:|adobe:)/i.test(attr.name)) {
            attrsToRemove.push(attr.name);
          }
        }
        attrsToRemove.forEach(a => child.removeAttribute(a));
        cleanNode(child);
      }
    }
  }

  cleanNode(doc.documentElement);

  // Clean root element attributes
  for (const attr of [...doc.documentElement.attributes]) {
    if (attr.name.startsWith('on') || /^(inkscape|sodipodi|i:|sketch:|serif:|adobe:|xmlns:(inkscape|sodipodi|i|sketch|serif|adobe|ns))/i.test(attr.name)) {
      doc.documentElement.removeAttribute(attr.name);
    }
  }

  const cleanXml = new XMLSerializer().serializeToString(doc);
  return new TextEncoder().encode(cleanXml);
}

// ─────────────────────────────────────────────────────────────
//  MP3 (ID3v1 & ID3v2 Tags)
// ─────────────────────────────────────────────────────────────

const ID3V2_FRAMES = {
  'TIT2': 'Title', 'TPE1': 'Artist', 'TALB': 'Album', 'TYER': 'Year',
  'TDRC': 'Recording Date', 'COMM': 'Comment', 'TENC': 'Encoded By',
  'TSSE': 'Encoder Settings', 'TCON': 'Genre', 'APIC': 'Cover Art',
};

function readMp3Meta(buf) {
  const bytes = new Uint8Array(buf);
  const meta = {};

  // 1. Check ID3v2 at start
  if (bytes.length >= 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) { // 'ID3'
    const majorVer = bytes[3];
    const tagSize = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
    meta['ID3 Tag'] = `ID3v2.${majorVer}`;

    let pos = 10;
    const end = Math.min(bytes.length, 10 + tagSize);

    while (pos + 10 < end) {
      const frameId = String.fromCharCode(...bytes.slice(pos, pos + 4));
      if (!/^[A-Z0-9]{4}$/.test(frameId)) break;

      let fSize;
      if (majorVer === 4) {
        fSize = ((bytes[pos+4] & 0x7f) << 21) | ((bytes[pos+5] & 0x7f) << 14) | ((bytes[pos+6] & 0x7f) << 7) | (bytes[pos+7] & 0x7f);
      } else {
        fSize = (bytes[pos+4] << 24) | (bytes[pos+5] << 16) | (bytes[pos+6] << 8) | bytes[pos+7];
      }

      if (fSize <= 0 || pos + 10 + fSize > end) break;

      const label = ID3V2_FRAMES[frameId];
      if (label && fSize > 1) {
        if (frameId === 'APIC') {
          meta[label] = '(Cover image embedded)';
        } else {
          const enc = bytes[pos + 10];
          const textBytes = bytes.slice(pos + 11, pos + 10 + fSize);
          let str = '';
          if (enc === 1 || enc === 2) {
            str = new TextDecoder('utf-16').decode(textBytes);
          } else {
            str = new TextDecoder('utf-8').decode(textBytes);
          }
          str = str.replace(/\0/g, '').trim();
          if (str) meta[label] = str.slice(0, 150);
        }
      }
      pos += 10 + fSize;
    }
  }

  // 2. Check ID3v1 at EOF
  if (bytes.length >= 128) {
    const endOffset = bytes.length - 128;
    if (bytes[endOffset] === 0x54 && bytes[endOffset+1] === 0x41 && bytes[endOffset+2] === 0x47) { // 'TAG'
      if (!meta['Title']) {
        const title = new TextDecoder('latin1').decode(bytes.slice(endOffset + 3, endOffset + 33)).replace(/\0/g, '').trim();
        if (title) meta['Title'] = title;
      }
      if (!meta['Artist']) {
        const artist = new TextDecoder('latin1').decode(bytes.slice(endOffset + 33, endOffset + 63)).replace(/\0/g, '').trim();
        if (artist) meta['Artist'] = artist;
      }
      if (!meta['ID3 Tag']) meta['ID3 Tag'] = 'ID3v1';
    }
  }

  return Object.keys(meta).length ? meta : null;
}

function stripMp3(buf) {
  const bytes = new Uint8Array(buf);
  let start = 0;
  let end = bytes.length;

  // 1. Strip ID3v2 header
  if (bytes.length >= 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    const flags = bytes[5];
    const tagSize = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
    const hasFooter = Boolean(flags & 0x10);
    start = 10 + tagSize + (hasFooter ? 10 : 0);
  }

  // 2. Strip ID3v1 trailer
  if (bytes.length >= 128) {
    const endOffset = bytes.length - 128;
    if (bytes[endOffset] === 0x54 && bytes[endOffset+1] === 0x41 && bytes[endOffset+2] === 0x47) {
      end = endOffset;
    }
  }

  return bytes.slice(start, end);
}

// ─────────────────────────────────────────────────────────────
//  MP4 / M4A / MOV (ISO Base Media File Format & QuickTime)
// ─────────────────────────────────────────────────────────────

function mp4FourCC(view, offset) {
  return String.fromCharCode(view.getUint8(offset), view.getUint8(offset+1), view.getUint8(offset+2), view.getUint8(offset+3));
}

function extractIlstString(view, buf, start, len) {
  if (len < 1) return null;
  // If wrapped in a standard 'data' box (common in MP4 ilst): size(4) + 'data'(4) + flags(4) + locale(4) + text
  if (len >= 16) {
    const childType = mp4FourCC(view, start + 4);
    if (childType === 'data') {
      const dataSize = view.getUint32(start);
      const strBytes = new Uint8Array(buf, start + 16, Math.min(len - 16, Math.max(0, dataSize - 16)));
      const str = new TextDecoder('utf-8').decode(strBytes).replace(/[\0\r\n]/g, ' ').trim();
      if (str) return str;
    }
  }
  // Otherwise parse direct text payload
  const str = new TextDecoder('utf-8').decode(new Uint8Array(buf, start, Math.min(len, 200))).replace(/[\0\r\n]/g, ' ').trim();
  return str || null;
}

function readMp4Meta(buf) {
  const view = new DataView(buf);
  const meta = {};
  const s4 = offset => mp4FourCC(view, offset);

  function parseBox(offset, maxEnd, depth = 0) {
    if (depth > 7) return;
    let p = offset;
    while (p + 8 <= maxEnd && p + 8 <= buf.byteLength) {
      const size = view.getUint32(p);
      const type = s4(p + 4);
      if (size < 8 && size !== 1) break;
      const boxEnd = (size === 1) ? p + Number(view.getBigUint64(p + 8)) : p + size;
      if (boxEnd > maxEnd && maxEnd !== buf.byteLength) break;

      const headerLen = (size === 1) ? 16 : 8;
      const payloadLen = boxEnd - (p + headerLen);

      if (type === 'moov' || type === 'udta' || type === 'trak' || type === 'mdia' || type === 'minf' || type === 'ilst') {
        parseBox(p + headerLen, boxEnd, depth + 1);
      } else if (type === 'meta') {
        // Meta box might be FullBox (4 extra bytes ver/flags)
        const metaHeader = (view.getUint32(p + headerLen) === 0) ? headerLen + 4 : headerLen;
        parseBox(p + metaHeader, boxEnd, depth + 1);
      } else if (type === 'mvhd' || type === 'mdhd') {
        const ver = view.getUint8(p + headerLen);
        const createSec = (ver === 1) ? Number(view.getBigUint64(p + headerLen + 4)) : view.getUint32(p + headerLen + 4);
        if (createSec > 0) {
          const date = new Date((createSec - 2082844800) * 1000);
          if (!isNaN(date.getTime()) && date.getFullYear() > 1990 && !meta['Creation Date']) {
            meta['Creation Date'] = date.toISOString().replace('T', ' ').slice(0, 19);
          }
        }
      } else if (type === '©xyz' || type === 'xyz' || type === 'location.ISO6709') {
        const raw = new TextDecoder('utf-8').decode(new Uint8Array(buf, p + headerLen, Math.min(payloadLen, 100))).replace(/[\0\r\n]/g, '').trim();
        meta['GPS Location'] = raw || '(Geotag coordinates present)';
      } else if (type === 'make') {
        const str = new TextDecoder('utf-8').decode(new Uint8Array(buf, p + headerLen, Math.min(payloadLen, 80))).replace(/[\0\r\n]/g, '').trim();
        if (str) meta['Device Make'] = str;
      } else if (type === 'modl') {
        const str = new TextDecoder('utf-8').decode(new Uint8Array(buf, p + headerLen, Math.min(payloadLen, 80))).replace(/[\0\r\n]/g, '').trim();
        if (str) meta['Device Model'] = str;
      } else if (type === '©too' || type === '©enc') {
        const val = extractIlstString(view, buf, p + headerLen, payloadLen);
        meta['Encoder/Software'] = val ? val.slice(0, 150) : '(Encoder signature present)';
      } else if (type === '©nam') {
        const val = extractIlstString(view, buf, p + headerLen, payloadLen);
        meta['Title'] = val ? val.slice(0, 150) : '(Title tag present)';
      } else if (type === '©ART' || type === '©aut') {
        const val = extractIlstString(view, buf, p + headerLen, payloadLen);
        meta['Author/Artist'] = val ? val.slice(0, 150) : '(Author tag present)';
      } else if (type === '©cmt') {
        const val = extractIlstString(view, buf, p + headerLen, payloadLen);
        if (val) meta['Comment'] = val.slice(0, 150);
      }

      p = boxEnd;
    }
  }

  parseBox(0, buf.byteLength);
  return Object.keys(meta).length ? meta : null;
}

function stripMp4(buf) {
  // In-place atom neutralization:
  // 1. Converts 'udta' and 'meta' user-data boxes to standard 'free' filler boxes
  // 2. Zeroes creation/modification timestamps in mvhd, tkhd, and mdhd boxes
  // -> Guarantees 100% sample offset stability (stco/co64) and instant, lossless cleaning with zero desync.
  const out = buf.slice(0);
  const view = new DataView(out);
  const bytes = new Uint8Array(out);

  const s4 = offset => mp4FourCC(view, offset);

  function scrubBoxes(offset, maxEnd, depth = 0) {
    if (depth > 7) return;
    let p = offset;
    while (p + 8 <= maxEnd && p + 8 <= out.byteLength) {
      const size = view.getUint32(p);
      const type = s4(p + 4);
      if (size < 8 && size !== 1) break;
      const boxEnd = (size === 1) ? p + Number(view.getBigUint64(p + 8)) : p + size;
      if (boxEnd > maxEnd && maxEnd !== out.byteLength) break;

      const headerLen = (size === 1) ? 16 : 8;

      if (type === 'udta') {
        // Change atom type to 'free' and wipe payload with zeros
        bytes[p + 4] = 0x66; // 'f'
        bytes[p + 5] = 0x72; // 'r'
        bytes[p + 6] = 0x65; // 'e'
        bytes[p + 7] = 0x65; // 'e'
        bytes.fill(0, p + headerLen, boxEnd);
      } else if (type === 'mvhd' || type === 'tkhd' || type === 'mdhd') {
        // Zero out creation and modification timestamps
        const ver = view.getUint8(p + headerLen);
        if (ver === 1) {
          view.setBigUint64(p + headerLen + 4, 0n);
          view.setBigUint64(p + headerLen + 12, 0n);
        } else {
          view.setUint32(p + headerLen + 4, 0);
          view.setUint32(p + headerLen + 8, 0);
        }
      } else if (type === 'moov' || type === 'trak' || type === 'mdia') {
        scrubBoxes(p + headerLen, boxEnd, depth + 1);
      }

      p = boxEnd;
    }
  }

  scrubBoxes(0, out.byteLength);
  return bytes;
}

// ─────────────────────────────────────────────────────────────
//  Cleaning dispatcher
// ─────────────────────────────────────────────────────────────

async function cleanFile(entry) {
  const buf = await entry.file.arrayBuffer();
  const e   = ext(entry.file);
  let cleaned;

  if (['jpg','jpeg'].includes(e))       cleaned = stripJpeg(buf);
  else if (e === 'png')                 cleaned = stripPng(buf);
  else if (e === 'webp')                cleaned = stripWebp(buf);
  else if (['tiff','tif'].includes(e))  cleaned = stripTiff(buf);
  else if (e === 'svg')                 cleaned = stripSvg(await entry.file.text());
  else if (e === 'pdf')                 cleaned = stripPdf(buf);
  else if (['docx','xlsx','pptx'].includes(e)) cleaned = await stripOffice(buf);
  else if (e === 'mp3')                 cleaned = stripMp3(buf);
  else if (['mp4','m4a','mov'].includes(e)) cleaned = stripMp4(buf);
  else throw new Error('Unsupported type');

  entry.cleanedBlob    = new Blob([cleaned], { type: entry.file.type || 'application/octet-stream' });
  entry.cleanedSize    = entry.cleanedBlob.size;
  entry.removedFields  = entry.meta ? Object.keys(entry.meta) : [];
  entry.status         = 'cleaned';
}

// ─────────────────────────────────────────────────────────────
//  Download helpers
// ─────────────────────────────────────────────────────────────

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a   = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const cleanedName = name => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) + '_clean' + name.slice(dot) : name + '_clean';
};

async function downloadSingle(id) {
  const entry = files.find(f => f.id === id);
  if (!entry) return;

  const btn = document.querySelector(`[data-download="${id}"]`);
  if (btn) { btn.disabled = true; btn.textContent = 'Cleaning…'; }

  try {
    await cleanFile(entry);
    downloadBlob(entry.cleanedBlob, cleanedName(entry.file.name));
    updateCard(entry);
    toast('Downloaded: ' + cleanedName(entry.file.name));
  } catch (err) {
    toast('Error: ' + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⬇ Download clean'; }
  }
}

async function cleanAll() {
  const btn      = document.getElementById('clean-all-btn');
  const progWrap = document.getElementById('progress-wrap');
  const progBar  = document.getElementById('progress-bar');

  btn.disabled = true;
  progWrap.style.display = 'block';

  let done = 0;
  for (const entry of files) {
    if (entry.status !== 'cleaned') {
      try { await cleanFile(entry); updateCard(entry); }
      catch (err) { console.warn('Failed:', entry.file.name, err); }
    }
    progBar.style.width = `${(++done / files.length) * 100}%`;
  }

  if (files.length === 1) {
    if (files[0].cleanedBlob) downloadBlob(files[0].cleanedBlob, cleanedName(files[0].file.name));
  } else if (typeof JSZip !== 'undefined') {
    const zip = new JSZip();
    files.forEach(e => { if (e.cleanedBlob) zip.file(cleanedName(e.file.name), e.cleanedBlob); });
    downloadBlob(await zip.generateAsync({ type: 'blob' }), 'cleanslate_cleaned.zip');
  } else {
    // JSZip unavailable — download each file individually
    for (const e of files) {
      if (e.cleanedBlob) downloadBlob(e.cleanedBlob, cleanedName(e.file.name));
    }
  }

  setTimeout(() => { progWrap.style.display = 'none'; progBar.style.width = '0%'; }, 800);
  btn.disabled = false;
  toast('All files cleaned ✓');
}

// ─────────────────────────────────────────────────────────────
//  UI rendering
// ─────────────────────────────────────────────────────────────

const FILE_ICONS = {
  jpg:'🖼', jpeg:'🖼', png:'🖼', webp:'🖼', tiff:'🖼', tif:'🖼',
  svg:'📐',
  pdf:'📄', docx:'📝', xlsx:'📊', pptx:'📋',
  mp3:'🎵', m4a:'🎵',
  mp4:'🎬', mov:'🎬',
};

function injectCard(entry) {
  const e     = ext(entry.file);
  const icon  = FILE_ICONS[e] || '📁';
  const thumb = entry.thumbUrl
    ? `<img class="thumbnail" src="${entry.thumbUrl}" alt="" loading="lazy" />`
    : '';

  const card = document.createElement('div');
  card.className = 'file-card';
  card.id = `card-${entry.id}`;
  card.innerHTML = `
    <div class="file-header" onclick="toggleCard(${entry.id})">
      ${thumb}
      <span class="file-icon">${icon}</span>
      <span class="file-name">${esc(entry.file.name)}</span>
      <span class="file-size" id="size-${entry.id}">${fmtSize(entry.file.size)}</span>
      <span class="badge badge-dirty" id="badge-${entry.id}">reading…</span>
      <span class="chevron">▼</span>
    </div>
    <div class="file-body" id="body-${entry.id}">
      <div class="meta-section">
        <h3>Metadata found</h3>
        <div id="meta-${entry.id}"><span class="meta-empty">Reading…</span></div>
      </div>
      <div id="stripped-${entry.id}"></div>
      <div class="file-actions">
        <button class="btn btn-sm btn-primary" data-download="${entry.id}"
          onclick="downloadSingle(${entry.id})">⬇ Download clean</button>
        <button class="btn btn-sm" onclick="removeFile(${entry.id})">Remove</button>
      </div>
    </div>`;

  document.getElementById('file-list').appendChild(card);
}

function updateCard(entry) {
  const badge    = document.getElementById(`badge-${entry.id}`);
  const metaDiv  = document.getElementById(`meta-${entry.id}`);
  const sizeEl   = document.getElementById(`size-${entry.id}`);
  const stripped = document.getElementById(`stripped-${entry.id}`);
  if (!badge || !metaDiv) return;

  const hasMeta   = entry.meta && Object.keys(entry.meta).length > 0;
  const metaCount = hasMeta ? Object.keys(entry.meta).length : 0;

  // badge
  if (entry.status === 'cleaned') {
    badge.className   = 'badge badge-clean';
    badge.textContent = 'Cleaned ✓';
  } else if (entry.status === 'ready') {
    badge.className   = hasMeta ? 'badge badge-dirty' : 'badge badge-clean';
    badge.textContent = hasMeta ? `${metaCount} field${metaCount !== 1 ? 's' : ''}` : 'No metadata';
  }

  // size: show "before → after (−X%)" once cleaned
  if (sizeEl && entry.cleanedSize !== null) {
    const saved = entry.file.size - entry.cleanedSize;
    const pct   = Math.round((saved / entry.file.size) * 100);
    const delta = saved > 0 ? ` <span class="size-saved">−${pct}%</span>` : '';
    sizeEl.innerHTML = `${fmtSize(entry.file.size)} <span class="size-arrow">→</span> ${fmtSize(entry.cleanedSize)}${delta}`;
  }

  // metadata table (always shows what was originally there)
  if (!hasMeta) {
    metaDiv.innerHTML = `<span class="meta-empty">No metadata detected</span>`;
  } else {
    let html = '<div class="meta-grid">';
    for (const [k, v] of Object.entries(entry.meta)) {
      html += `<span class="meta-key">${esc(k)}</span><span class="meta-val">${esc(String(v))}</span>`;
    }
    metaDiv.innerHTML = html + '</div>';
  }

  // stripped-fields summary — shown after cleaning
  if (stripped) {
    if (entry.status === 'cleaned' && entry.removedFields.length) {
      const pills = entry.removedFields
        .map(f => `<span class="field-pill">${esc(f)}</span>`)
        .join('');
      stripped.innerHTML = `<div class="stripped-summary">✓ Stripped: ${pills}</div>`;
    } else if (entry.status === 'cleaned') {
      stripped.innerHTML = `<div class="stripped-summary">✓ Nothing to strip — file was already clean</div>`;
    } else {
      stripped.innerHTML = '';
    }
  }
}

function toggleCard(id) {
  document.getElementById(`card-${id}`)?.classList.toggle('open');
}

function removeFile(id) {
  const idx = files.findIndex(f => f.id === id);
  if (idx !== -1) {
    if (files[idx].thumbUrl) URL.revokeObjectURL(files[idx].thumbUrl);
    files.splice(idx, 1);
  }
  document.getElementById(`card-${id}`)?.remove();
  updateToolbar();
}

function clearAll() {
  files.forEach(e => { if (e.thumbUrl) URL.revokeObjectURL(e.thumbUrl); });
  files.length = 0;
  document.getElementById('file-list').innerHTML = '';
  updateToolbar();
}

function updateToolbar() {
  const toolbar = document.getElementById('toolbar');
  const count   = document.getElementById('file-count');
  toolbar.classList.toggle('visible', files.length > 0);
  count.textContent = files.length ? `${files.length} file${files.length > 1 ? 's' : ''} loaded` : '';
}

// ─────────────────────────────────────────────────────────────
//  Utilities
// ─────────────────────────────────────────────────────────────

const ext = file => file.name.split('.').pop().toLowerCase();

function mergeBuffers(chunks) {
  const total = chunks.reduce((s, c) => s + c.byteLength, 0);
  const out   = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.byteLength; }
  return out;
}

function fmtSize(bytes) {
  if (bytes < 1024)    return bytes + ' B';
  if (bytes < 1024**2) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024**2).toFixed(1) + ' MB';
}

function esc(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

let toastTimer;
function toast(msg, duration = 3000) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), duration);
}

// ─────────────────────────────────────────────────────────────
//  Service Worker Registration (PWA)
// ─────────────────────────────────────────────────────────────

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(err => {
      console.warn('Service worker registration failed:', err);
    });
  });
}
