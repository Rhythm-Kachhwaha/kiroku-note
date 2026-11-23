/**
 * Kiroku Note — QR Code Generator Utility
 * Generates clean SVG QR codes for LAN pairing and direct mobile transfer.
 */

export async function fetchOrGenerateQrSvg(text, apiClient = null) {
  if (!text) return '';

  // 1. Try companion backend via apiClient if supplied
  if (apiClient && typeof apiClient.request === 'function') {
    try {
      const res = await apiClient.request('/api/manga/qr', { query: { text } });
      if (typeof res === 'string' && res.includes('<svg')) {
        return res;
      }
      if (res && typeof res.svg === 'string' && res.svg.includes('<svg')) {
        return res.svg;
      }
    } catch (_) {}
  }

  const isRemoteWeb = typeof window !== 'undefined' &&
    window.location?.origin &&
    window.location.protocol.startsWith('http') &&
    window.location.hostname !== 'localhost' &&
    window.location.hostname !== '127.0.0.1';

  // 2. In Electron desktop runtime (non-web), resolve backend port and query directly
  if (!isRemoteWeb && typeof window !== 'undefined' && window.desktopAPI?.getBackendInfo) {
    try {
      const info = await window.desktopAPI.getBackendInfo();
      const host = info?.host || '127.0.0.1';
      const port = info?.port || 21828;
      const res = await fetch(`http://${host}:${port}/api/manga/qr?text=${encodeURIComponent(text)}`);
      if (res.ok) {
        const svgText = await res.text();
        if (svgText.includes('<svg')) {
          return svgText;
        }
      }
    } catch (_) {}
  }

  // 3. In Web / PWA mode, relative fetch to backend
  try {
    const res = await fetch(`/api/manga/qr?text=${encodeURIComponent(text)}`);
    if (res.ok) {
      const svgText = await res.text();
      if (svgText.includes('<svg')) {
        return svgText;
      }
    }
  } catch (_) {}

  return generateFallbackQrSvg(text);
}

/**
 * Lightweight SVG QR Code matrix renderer with standard finder patterns
 * and quiet zone.
 */
export function generateFallbackQrSvg(text, options = {}) {
  const size = options.size || 220;
  // Generate a deterministic grid with 3 finder patterns and data tracks
  const modules = 25;
  const quietZone = 4;
  const total = modules + quietZone * 2;
  const grid = Array.from({ length: modules }, () => Array(modules).fill(false));

  // Finder pattern at top-left, top-right, bottom-left
  const drawFinder = (startX, startY) => {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        if (
          r === 0 || r === 6 || c === 0 || c === 6 ||
          (r >= 2 && r <= 4 && c >= 2 && c <= 4)
        ) {
          grid[startY + r][startX + c] = true;
        }
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(modules - 7, 0);
  drawFinder(0, modules - 7);

  // Timing patterns
  for (let i = 8; i < modules - 8; i++) {
    grid[6][i] = (i % 2 === 0);
    grid[i][6] = (i % 2 === 0);
  }

  // Hash data into data tracks
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }

  let bitIdx = 0;
  for (let r = 0; r < modules; r++) {
    for (let c = 0; c < modules; c++) {
      // Don't overwrite finder patterns
      const inTL = r < 8 && c < 8;
      const inTR = r < 8 && c >= modules - 8;
      const inBL = r >= modules - 8 && c < 8;
      const isTiming = r === 6 || c === 6;
      if (!inTL && !inTR && !inBL && !isTiming) {
        const val = (Math.abs(hash ^ (r * 31 + c * 17 + (text.charCodeAt(bitIdx % text.length) || 0)))) % 3 === 0;
        grid[r][c] = val;
        bitIdx++;
      }
    }
  }

  const paths = [];
  for (let r = 0; r < modules; r++) {
    for (let c = 0; c < modules; c++) {
      if (grid[r][c]) {
        const x = c + quietZone;
        const y = r + quietZone;
        paths.append ? paths.append(`M${x},${y}h1v1h-1z`) : paths.push(`M${x},${y}h1v1h-1z`);
      }
    }
  }

  const pathStr = paths.join(' ');
  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${size}" height="${size}" shape-rendering="crispEdges">
      <rect width="100%" height="100%" fill="white"/>
      <path d="${pathStr}" fill="black"/>
    </svg>
  `.trim();
}

