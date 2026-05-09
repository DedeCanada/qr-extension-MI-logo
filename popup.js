//---------------------------------------------------------------------
//
// QR Memory and Imagination Code Popup for JavaScript 
// by DedeCanada (https://github.com/DedeCanada)
//
// Licensed under the MIT license:
//  http://www.opensource.org/licenses/mit-license.php
//
//---------------------------------------------------------------------
const canvas = document.getElementById('qrCanvas');
const urlInput = document.getElementById('urlInput');
const downloadBtn = document.getElementById('downloadBtn');
const sizeBtn = document.getElementById('sizeBtn');
const sizeValueEl = document.getElementById('sizeValue');
const logoOpts = document.querySelectorAll('.logo-opt');
const settingsToggle = document.getElementById('settingsToggle');
const settingsPanel = document.getElementById('settingsPanel');
const settingsChevron = document.getElementById('settingsChevron');
const fgColorText = document.getElementById('fgColorText');
const fgColorBtn = document.getElementById('fgColorBtn');
const fgColorSwatch = document.getElementById('fgColorSwatch');
const fgColorWheel = document.getElementById('fgColorWheel');
const bgColorText = document.getElementById('bgColorText');
const bgColorBtn = document.getElementById('bgColorBtn');
const bgColorSwatch = document.getElementById('bgColorSwatch');
const bgColorWheel = document.getElementById('bgColorWheel');
const bgTransparent = document.getElementById('bgTransparent');

const QR_SIZE = 600;          // internal pixel size for the on-screen canvas
const DISPLAY_SIZE = 300;     // CSS display size
const LOGO_RATIO = 0.25;      // outer (border + image) target — snapped to module grid
const BORDER_MODULES = 1;     // thickness of the white border, in QR modules
const SELECTED_LOGO_KEY = 'selectedLogo';
const DOWNLOAD_SIZE_KEY = 'downloadSize';
const FG_COLOR_KEY = 'qrFgColor';
const BG_COLOR_KEY = 'qrBgColor';
const BG_TRANSPARENT_KEY = 'qrBgTransparent';
const DOWNLOAD_SIZES = [512, 1024, 2048, 4096];

// Built-in logo choices. Files are bundled in the extension folder.
const LOGOS = {
  none:  null,
  logo1: 'logo1.png',
  logo2: 'logo2.png',
};

let currentUrl = '';
let selectedLogo = 'none';
let logoImageCache = {};      // key -> HTMLImageElement
let downloadSize = DOWNLOAD_SIZES[0];
let fgColor = '#1a1814';
let bgColor = '#ffffff';
let bgIsTransparent = false;
let renderTimer = null;

canvas.width = QR_SIZE;
canvas.height = QR_SIZE;
canvas.style.width = DISPLAY_SIZE + 'px';
canvas.style.height = DISPLAY_SIZE + 'px';

// ---------- helpers ----------

async function getActiveTabUrl() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab && tab.url ? tab.url : '';
  } catch {
    return '';
  }
}

function loadImageFromUrl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image failed to load: ' + url));
    img.src = url;
  });
}

// Lazily load a bundled logo and cache it. Returns null for 'none'.
async function getLogoImage(key) {
  if (key === 'none') return null;
  if (logoImageCache[key]) return logoImageCache[key];

  const path = LOGOS[key];
  if (!path) return null;

  const img = await loadImageFromUrl(chrome.runtime.getURL(path));
  logoImageCache[key] = img;
  return img;
}

// ---------- storage ----------

async function saveSelectedLogo(key) {
  try { await chrome.storage.local.set({ [SELECTED_LOGO_KEY]: key }); } catch {}
}

async function loadSavedLogoKey() {
  try {
    const result = await chrome.storage.local.get(SELECTED_LOGO_KEY);
    const saved = result[SELECTED_LOGO_KEY];
    return Object.prototype.hasOwnProperty.call(LOGOS, saved) ? saved : 'none';
  } catch { return 'none'; }
}

async function saveDownloadSize(size) {
  try { await chrome.storage.local.set({ [DOWNLOAD_SIZE_KEY]: size }); } catch {}
}

async function saveFgColor(color) {
  try { await chrome.storage.local.set({ [FG_COLOR_KEY]: color }); } catch {}
}

async function loadSavedFgColor() {
  try {
    const result = await chrome.storage.local.get(FG_COLOR_KEY);
    const saved = result[FG_COLOR_KEY];
    return /^#[0-9a-fA-F]{6}$/.test(saved) ? saved : '#1a1814';
  } catch { return '#1a1814'; }
}

async function saveBgColor(color) {
  try { await chrome.storage.local.set({ [BG_COLOR_KEY]: color }); } catch {}
}

async function loadSavedBgColor() {
  try {
    const result = await chrome.storage.local.get(BG_COLOR_KEY);
    const saved = result[BG_COLOR_KEY];
    return /^#[0-9a-fA-F]{6}$/.test(saved) ? saved : '#ffffff';
  } catch { return '#ffffff'; }
}

async function saveBgTransparent(val) {
  try { await chrome.storage.local.set({ [BG_TRANSPARENT_KEY]: val }); } catch {}
}

async function loadSavedBgTransparent() {
  try {
    const result = await chrome.storage.local.get(BG_TRANSPARENT_KEY);
    return result[BG_TRANSPARENT_KEY] === true;
  } catch { return false; }
}

async function loadSavedDownloadSize() {
  try {
    const result = await chrome.storage.local.get(DOWNLOAD_SIZE_KEY);
    const saved = result[DOWNLOAD_SIZE_KEY];
    return DOWNLOAD_SIZES.includes(saved) ? saved : DOWNLOAD_SIZES[0];
  } catch { return DOWNLOAD_SIZES[0]; }
}

// ---------- rendering ----------

// Render the QR (with optional logo + white border) to any canvas at any size.
function renderQR(targetCanvas, text, logoImage) {
  const targetCtx = targetCanvas.getContext('2d');
  const size = targetCanvas.width;

  // Empty input → just draw a blank white card so the popup doesn't look broken
  if (!text) {
    targetCtx.clearRect(0, 0, size, size);
    if (!bgIsTransparent) {
      targetCtx.fillStyle = bgColor;
      targetCtx.fillRect(0, 0, size, size);
    }
    return;
  }

  // Error correction level 'H' (~30%) — handles the logo overlay's missing data
  const qr = qrcode(0, 'H');
  qr.addData(text);
  qr.make();

  const modules = qr.getModuleCount();   // always odd: 21, 25, 29, ...
  const cell = size / modules;

  // Background
  targetCtx.clearRect(0, 0, size, size);
  if (!bgIsTransparent) {
    targetCtx.fillStyle = bgColor;
    targetCtx.fillRect(0, 0, size, size);
  }

  // Modules
  targetCtx.fillStyle = fgColor;
  for (let r = 0; r < modules; r++) {
    for (let c = 0; c < modules; c++) {
      if (qr.isDark(r, c)) {
        targetCtx.fillRect(
          Math.floor(c * cell),
          Math.floor(r * cell),
          Math.ceil(cell) + 0.5,
          Math.ceil(cell) + 0.5
        );
      }
    }
  }

  if (!logoImage) return;

  // ---- Snap the OUTER (border + image) square to the module grid ----
  // Force odd module count so it centers exactly on the grid.
  let outerModules = Math.round(modules * LOGO_RATIO);
  if (outerModules % 2 === 0) outerModules += 1;
  const minOuter = BORDER_MODULES * 2 + 3;     // need room for border + at least 3 image modules
  if (outerModules < minOuter) outerModules = minOuter;

  const outerStart = (modules - outerModules) / 2;
  const innerStart = outerStart + BORDER_MODULES;
  const innerModules = outerModules - BORDER_MODULES * 2;

  // Convert module offsets to pixels.
  // IMPORTANT: each QR module is drawn at floor(c*cell) with width ceil(cell)+0.5,
  // so the *drawn* right edge of the last covered module sits beyond floor((c+1)*cell).
  // We have to mirror that or a thin black sliver leaks through on the right/bottom.
  const moduleEnd = (m) => Math.floor((m - 1) * cell) + Math.ceil(cell) + 1;

  const outerX = Math.floor(outerStart * cell);
  const outerY = outerX;
  const outerEnd = moduleEnd(outerStart + outerModules);
  const outerW = outerEnd - outerX;

  const innerX = Math.floor(innerStart * cell);
  const innerY = innerX;
  const innerEnd = moduleEnd(innerStart + innerModules);
  const innerW = innerEnd - innerX;

  // 1) Fill the entire outer square with the background. This both creates
  //    the border AND gives transparent regions of the logo a backing so
  //    they don't show QR modules through.
  if (bgIsTransparent) {
    targetCtx.clearRect(outerX, outerY, outerW, outerW);
  } else {
    targetCtx.fillStyle = bgColor;
    targetCtx.fillRect(outerX, outerY, outerW, outerW);
  }

  // 2) Cover-fit the logo into the inner square (preserve aspect, crop overflow)
  const iw = logoImage.naturalWidth;
  const ih = logoImage.naturalHeight;
  const scale = Math.max(innerW / iw, innerW / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  const dx = innerX + (innerW - dw) / 2;
  const dy = innerY + (innerW - dh) / 2;

  targetCtx.save();
  targetCtx.beginPath();
  targetCtx.rect(innerX, innerY, innerW, innerW);
  targetCtx.clip();
  targetCtx.drawImage(logoImage, dx, dy, dw, dh);
  targetCtx.restore();
}

async function drawPreview() {
  const logo = await getLogoImage(selectedLogo);
  renderQR(canvas, currentUrl, logo);
}

// Debounce repeated re-renders while the user is typing in the URL field
function scheduleDraw() {
  if (renderTimer) clearTimeout(renderTimer);
  renderTimer = setTimeout(drawPreview, 120);
}

// ---------- events ----------

urlInput.addEventListener('input', () => {
  currentUrl = urlInput.value.trim();
  scheduleDraw();
});

logoOpts.forEach((btn) => {
  btn.addEventListener('click', async () => {
    const key = btn.dataset.logo;
    if (key === selectedLogo) return;
    selectedLogo = key;
    logoOpts.forEach((b) => b.classList.toggle('is-active', b === btn));
    await saveSelectedLogo(key);
    drawPreview();
  });
});

function updateSizeLabel() {
  sizeValueEl.textContent = downloadSize + ' px';
}

sizeBtn.addEventListener('click', async () => {
  const i = DOWNLOAD_SIZES.indexOf(downloadSize);
  downloadSize = DOWNLOAD_SIZES[(i + 1) % DOWNLOAD_SIZES.length];
  updateSizeLabel();
  await saveDownloadSize(downloadSize);
});

// ---------- settings panel ----------

settingsToggle.addEventListener('click', () => {
  settingsToggle.classList.toggle('is-open');
  settingsPanel.classList.toggle('is-open');
});

function updateFgUI(color) {
  fgColorText.value = color;
  fgColorWheel.value = color;
  fgColorSwatch.style.background = color;
}

function updateBgUI(color, transparent) {
  bgColorText.value = color;
  bgColorWheel.value = color;
  bgTransparent.checked = transparent;
  bgColorText.disabled = transparent;
  bgColorBtn.disabled = transparent;
  if (transparent) {
    bgColorSwatch.style.background =
      'linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%),' +
      'linear-gradient(45deg, #ccc 25%, transparent 25%, transparent 75%, #ccc 75%)';
    bgColorSwatch.style.backgroundSize = '8px 8px';
    bgColorSwatch.style.backgroundPosition = '0 0, 4px 4px';
    bgColorSwatch.style.backgroundColor = '#fff';
  } else {
    bgColorSwatch.style.background = color;
    bgColorSwatch.style.backgroundSize = '';
    bgColorSwatch.style.backgroundPosition = '';
  }
}

// Foreground
fgColorBtn.addEventListener('click', () => fgColorWheel.click());

fgColorWheel.addEventListener('input', async (e) => {
  fgColor = e.target.value;
  updateFgUI(fgColor);
  scheduleDraw();
  await saveFgColor(fgColor);
});

fgColorText.addEventListener('change', async () => {
  let val = fgColorText.value.trim();
  if (!val.startsWith('#')) val = '#' + val;
  if (/^#[0-9a-fA-F]{6}$/.test(val)) {
    fgColor = val;
    updateFgUI(fgColor);
    scheduleDraw();
    await saveFgColor(fgColor);
  } else {
    fgColorText.value = fgColor;
  }
});

// Background
bgColorBtn.addEventListener('click', () => { if (!bgIsTransparent) bgColorWheel.click(); });

bgColorWheel.addEventListener('input', async (e) => {
  bgColor = e.target.value;
  updateBgUI(bgColor, false);
  scheduleDraw();
  await saveBgColor(bgColor);
});

bgColorText.addEventListener('change', async () => {
  let val = bgColorText.value.trim();
  if (!val.startsWith('#')) val = '#' + val;
  if (/^#[0-9a-fA-F]{6}$/.test(val)) {
    bgColor = val;
    updateBgUI(bgColor, false);
    scheduleDraw();
    await saveBgColor(bgColor);
  } else {
    bgColorText.value = bgColor;
  }
});

bgTransparent.addEventListener('change', async () => {
  bgIsTransparent = bgTransparent.checked;
  updateBgUI(bgColor, bgIsTransparent);
  scheduleDraw();
  await saveBgTransparent(bgIsTransparent);
});

downloadBtn.addEventListener('click', async () => {
  if (!currentUrl) return;

  // Render fresh to a temp canvas at the chosen download size
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = downloadSize;
  exportCanvas.height = downloadSize;

  const logo = await getLogoImage(selectedLogo);
  renderQR(exportCanvas, currentUrl, logo);

  let host = 'qrcode';
  try { host = new URL(currentUrl).hostname.replace(/^www\./, '') || 'qrcode'; }
  catch {}

  const link = document.createElement('a');
  link.download = `qr-${host}-${downloadSize}.png`;
  link.href = exportCanvas.toDataURL('image/png');
  link.click();
});

// ---------- init ----------

(async function init() {
  const [activeUrl, savedLogoKey, savedSize, savedFg, savedBg, savedBgTransp] = await Promise.all([
    getActiveTabUrl(),
    loadSavedLogoKey(),
    loadSavedDownloadSize(),
    loadSavedFgColor(),
    loadSavedBgColor(),
    loadSavedBgTransparent(),
  ]);

  currentUrl = activeUrl || '';
  urlInput.value = currentUrl;

  selectedLogo = savedLogoKey;
  logoOpts.forEach((b) => b.classList.toggle('is-active', b.dataset.logo === selectedLogo));

  downloadSize = savedSize;
  updateSizeLabel();

  fgColor = savedFg;
  bgColor = savedBg;
  bgIsTransparent = savedBgTransp;
  updateFgUI(fgColor);
  updateBgUI(bgColor, bgIsTransparent);

  await drawPreview();
})();
