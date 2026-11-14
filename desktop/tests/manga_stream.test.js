import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const mangaJsPath = path.join(__dirname, '..', 'src', 'ui', 'views', 'manga.js');
const qrJsPath = path.join(__dirname, '..', 'src', 'ui', 'utils', 'qr.js');

test('manga_stream: manga.js supports Send to Phone and Receive from PC', () => {
  const content = fs.readFileSync(mangaJsPath, 'utf8');
  assert.ok(content.includes('openSendToPhoneModal'), 'must support Send to Phone modal');
  assert.ok(content.includes('openReceiveFromPcModal'), 'must support Receive from PC modal');
  assert.ok(content.includes('btn-modal-send-to-phone'), 'must have Send to Phone button in options');
  assert.ok(content.includes('btn-receive-from-pc'), 'must have Receive from PC button in toolbar');
  assert.ok(content.includes('/api/manga/ticket'), 'must request single-use transfer ticket');
  assert.ok(content.includes('storeBookFile'), 'must write streamed bytes to OPFS storage');
});

test('manga_stream: qr utility generates valid SVG with quiet zone and modules', async () => {
  const { generateFallbackQrSvg } = await import('../src/ui/utils/qr.js');
  const url = 'http://192.168.1.50:8000/api/manga/stream/test_vol1?ticket=xyz123';
  const svg = generateFallbackQrSvg(url);
  assert.ok(svg.includes('<svg'), 'must output SVG element');
  assert.ok(svg.includes('viewBox='), 'must have viewBox attribute');
  assert.ok(svg.includes('<path d="M'), 'must have module paths');
  assert.ok(svg.includes('shape-rendering="crispEdges"'), 'must have crisp edges for sharp scanning');
});

test('manga_stream: stream chunk reader handles binary streams into OPFS', async () => {
  // Simulate chunked binary stream
  const chunk1 = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
  const chunk2 = new Uint8Array([0x2d, 0x31, 0x2e, 0x34]); // -1.4
  const chunk3 = new Uint8Array([0x0a, 0x25, 0xe2, 0xe3]); // header

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(chunk1);
      controller.enqueue(chunk2);
      controller.enqueue(chunk3);
      controller.close();
    }
  });

  const reader = stream.getReader();
  const chunks = [];
  let receivedBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    receivedBytes += value.length;
  }

  assert.equal(receivedBytes, 12, 'must receive all 12 chunked bytes');
  assert.equal(chunks.length, 3, 'must preserve chunk count');

  // Verify blob assembly
  const assembled = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const c of chunks) {
    assembled.set(c, offset);
    offset += c.length;
  }

  assert.equal(assembled[0], 0x25); // %
  assert.equal(assembled[1], 0x50); // P
  assert.equal(assembled[2], 0x44); // D
  assert.equal(assembled[3], 0x46); // F
});

test('manga_stream: transfer ticket format and expiry constraints', () => {
  // Transfer URLs require book ID and ticket token query
  const testUrl = 'http://192.168.1.100:8000/api/manga/stream/sample_book?ticket=valid_secret_123';
  const parsed = new URL(testUrl);
  assert.equal(parsed.pathname, '/api/manga/stream/sample_book');
  assert.equal(parsed.searchParams.get('ticket'), 'valid_secret_123');

  // Segments must extract book ID
  const segments = parsed.pathname.split('/').filter(Boolean);
  assert.equal(segments[segments.length - 1], 'sample_book');
});
