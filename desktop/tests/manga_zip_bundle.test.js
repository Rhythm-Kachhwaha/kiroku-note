const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Load JSZip from local vendor file
const jszipPath = path.join(__dirname, '..', 'src', 'ui', 'vendor', 'jszip.min.js');
const JSZip = require(jszipPath);

test('manga_zip_bundle: recognizes nested PDF and CBZ files', async () => {
  const zip = new JSZip();
  zip.file('Genki 1.pdf', new Uint8Array([1, 2, 3]));
  zip.file('Genki 2.pdf', new Uint8Array([4, 5, 6]));
  zip.file('Answer_Key.cbz', new Uint8Array([7, 8, 9]));
  // Ignore macOS metadata
  zip.file('__MACOSX/._Genki 1.pdf', new Uint8Array([0]));

  const validMangaExts = ['.pdf', '.cbz', '.cbr', '.zip'];
  const nested = [];
  zip.forEach((relPath, entry) => {
    if (entry.dir || relPath.startsWith('__MACOSX/') || relPath.includes('/.')) return;
    const lower = relPath.toLowerCase();
    if (validMangaExts.some(ext => lower.endsWith(ext))) {
      nested.push(relPath);
    }
  });

  assert.equal(nested.length, 3);
  assert.ok(nested.includes('Genki 1.pdf'));
  assert.ok(nested.includes('Genki 2.pdf'));
  assert.ok(nested.includes('Answer_Key.cbz'));
});

test('manga_zip_bundle: groups multi-chapter image directories into volumes', async () => {
  const zip = new JSZip();
  zip.file('Series/Chapter 01/01.jpg', new Uint8Array([1]));
  zip.file('Series/Chapter 01/02.jpg', new Uint8Array([2]));
  zip.file('Series/Chapter 02/01.jpg', new Uint8Array([3]));
  zip.file('Series/Chapter 02/02.jpg', new Uint8Array([4]));

  const validImgExts = ['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif'];
  const imageEntries = [];
  zip.forEach((relPath, entry) => {
    if (entry.dir || relPath.startsWith('__MACOSX/') || relPath.includes('/.')) return;
    const lower = relPath.toLowerCase();
    if (validImgExts.some(ext => lower.endsWith(ext))) {
      imageEntries.push({ relPath, entry });
    }
  });

  // Common prefix detection
  const pathPartsList = imageEntries.map(e => e.relPath.split('/'));
  let commonPrefixLength = 0;
  if (pathPartsList.length > 0 && pathPartsList[0].length > 2) {
    const firstParts = pathPartsList[0];
    for (let i = 0; i < firstParts.length - 1; i++) {
      const seg = firstParts[i];
      if (pathPartsList.every(parts => parts.length > i + 1 && parts[i] === seg)) {
        commonPrefixLength = i + 1;
      } else {
        break;
      }
    }
  }

  assert.equal(commonPrefixLength, 1); // 'Series'

  const volumeMap = new Map();
  for (const img of imageEntries) {
    const parts = img.relPath.split('/');
    const relativeParts = parts.slice(commonPrefixLength);
    const volName = relativeParts.length > 1 ? relativeParts[0].trim() : 'Root';
    if (!volumeMap.has(volName)) volumeMap.set(volName, []);
    volumeMap.get(volName).push(img);
  }

  assert.equal(volumeMap.size, 2);
  assert.ok(volumeMap.has('Chapter 01'));
  assert.ok(volumeMap.has('Chapter 02'));
  assert.equal(volumeMap.get('Chapter 01').length, 2);
  assert.equal(volumeMap.get('Chapter 02').length, 2);
});
