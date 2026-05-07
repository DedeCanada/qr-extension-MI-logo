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

const QR_SIZE = 600;          // internal pixel size for the on-screen canvas
const DISPLAY_SIZE = 300;     // CSS display size
const LOGO_RATIO = 0.25;      // outer (border + image) target — snapped to module grid
const BORDER_MODULES = 1;     // thickness of the white border, in QR modules
const SELECTED_LOGO_KEY = 'selectedLogo';
const DOWNLOAD_SIZE_KEY = 'downloadSize';
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
    targetCtx.fillStyle = '#ffffff';
    targetCtx.fillRect(0, 0, size, size);
    return;
  }

  // Error correction level 'H' (~30%) — handles the logo overlay's missing data
  const qr = qrcode(0, 'H');
  qr.addData(text);
  qr.make();

  const modules = qr.getModuleCount();   // always odd: 21, 25, 29, ...
  const cell = size / modules;

  // Background
  targetCtx.fillStyle = '#ffffff';
  targetCtx.fillRect(0, 0, size, size);

  // Modules
  targetCtx.fillStyle = '#1a1814';
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

  // 1) Fill the entire outer square white. This both creates the border AND
  //    gives transparent regions of the logo a white backing so they don't
  //    show QR modules through.
  targetCtx.fillStyle = '#ffffff';
  targetCtx.fillRect(outerX, outerY, outerW, outerW);

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
  const [activeUrl, savedLogoKey, savedSize] = await Promise.all([
    getActiveTabUrl(),
    loadSavedLogoKey(),
    loadSavedDownloadSize(),
  ]);

  currentUrl = activeUrl || '';
  urlInput.value = currentUrl;

  selectedLogo = savedLogoKey;
  logoOpts.forEach((b) => b.classList.toggle('is-active', b.dataset.logo === selectedLogo));

  downloadSize = savedSize;
  updateSizeLabel();

  await drawPreview();
})();
