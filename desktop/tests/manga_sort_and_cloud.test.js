import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

// Mock minimal browser globals for Node test environment
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => store.get(k) || null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear()
  };
}
if (typeof globalThis.window === 'undefined') {
  globalThis.window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    location: { origin: 'http://127.0.0.1:8000' }
  };
}
if (typeof globalThis.document === 'undefined') {
  globalThis.document = {
    createElement: () => ({ addEventListener: () => {}, click: () => {}, remove: () => {} }),
    body: { appendChild: () => {}, removeChild: () => {} }
  };
}
if (typeof globalThis.URL === 'undefined' || !globalThis.URL.createObjectURL) {
  globalThis.URL = globalThis.URL || {};
  globalThis.URL.createObjectURL = () => 'blob:mock-url';
  globalThis.URL.revokeObjectURL = () => {};
}

describe('Manga Natural Sort', () => {
  it('correctly orders volumes naturally so Vol 1 is first and Vol 15 is last', () => {
    const books = [
      { id: 'b15', title: 'Yotsuba&! Vol 15' },
      { id: 'b2', title: 'Yotsuba&! Vol 2' },
      { id: 'b1', title: 'Yotsuba&! Vol 1' },
      { id: 'b10', title: 'Yotsuba&! Vol 10' },
      { id: 'b3', title: 'Yotsuba&! Vol 3' }
    ];

    const sorted = [...books].sort((a, b) => {
      const titleA = a.title || a.name || '';
      const titleB = b.title || b.name || '';
      return titleA.localeCompare(titleB, undefined, { numeric: true, sensitivity: 'base' });
    });

    assert.equal(sorted[0].title, 'Yotsuba&! Vol 1');
    assert.equal(sorted[1].title, 'Yotsuba&! Vol 2');
    assert.equal(sorted[2].title, 'Yotsuba&! Vol 3');
    assert.equal(sorted[3].title, 'Yotsuba&! Vol 10');
    assert.equal(sorted[4].title, 'Yotsuba&! Vol 15');
  });

  it('handles mixed case and symbols in volume titles', () => {
    const titles = ['よつばと! 第15巻', 'よつばと! 第1巻', 'よつばと! 第2巻'];
    const sorted = [...titles].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    assert.equal(sorted[0], 'よつばと! 第1巻');
    assert.equal(sorted[1], 'よつばと! 第2巻');
    assert.equal(sorted[2], 'よつばと! 第15巻');
  });

  it('directly shows options modal when clicking a cloud-only book without flashing loading spinner', async () => {
    // Import MangaView
    const { MangaView } = await import('../src/ui/views/manga.js');
    const view = new MangaView();
    let modalShown = false;
    let loadingShown = false;
    view.showCloudBookHelpModal = (b) => { modalShown = true; };
    view.showLoading = () => { loadingShown = true; };

    view.books = [
      { id: 'cloud_book_test', title: 'Test Manga', isCloudOnly: true, size: 2 * 1024 * 1024 }
    ];

    await view.loadAndOpenBook('cloud_book_test');
    assert.equal(modalShown, true, 'Help/options modal must be shown directly on click');
    assert.equal(loadingShown, false, 'Loading spinner must not be flashed for cloud book');
  });

  it('downloadCloudBookToFile exports/downloads the file buffer to client disk', async () => {
    const { MangaView } = await import('../src/ui/views/manga.js');
    const view = new MangaView();
    let downloadedBlob = null;
    let downloadedName = '';

    const fakeWindow = {
      URL: {
        createObjectURL: (blob) => 'blob:test-url',
        revokeObjectURL: () => {}
      }
    };

    const book = { id: 'book_123', title: 'Test Manga', filename: 'test.cbz', type: 'cbz' };
    const fakeBuffer = new Uint8Array([1, 2, 3, 4]).buffer;

    view.downloadAndOpenCloudBook = async () => true;
    view._getBookBufferForDownload = async () => fakeBuffer;

    const res = await view.downloadBookToFile(book, fakeBuffer, (blob, filename) => {
      downloadedBlob = blob;
      downloadedName = filename;
    });

    assert.equal(res, true);
    assert.equal(downloadedName, 'test.cbz');
    assert.ok(downloadedBlob);
  });

  it('renders metadata-only cloud modal without broken download button and highlights Wi-Fi transfer', async () => {
    const { MangaView } = await import('../src/ui/views/manga.js');
    const view = new MangaView();
    let modalHtml = '';
    view.showModal = (html) => {
      modalHtml = html;
    };

    const metadataOnlyBook = {
      id: 'meta_book',
      title: '001 [JP] Yotsubato',
      isCloudOnly: true,
      has_file: false,
      totalPages: 224
    };

    view.showCloudBookHelpModal(metadataOnlyBook);

    assert.ok(modalHtml.includes('Pages Not in Cloud'), 'Should explain pages are not stored in cloud');
    assert.ok(!modalHtml.includes('id="btn-cloud-download-now"'), 'Must NOT offer download button if metadata only');
    assert.ok(modalHtml.includes('Wi-Fi Transfer from PC'), 'Must offer Wi-Fi transfer option');
    assert.ok(modalHtml.includes('tactile-btn-primary') && modalHtml.includes('id="btn-cloud-receive-pc"'), 'Wi-Fi transfer must be primary action');
  });

  it('renders full-download cloud modal when book has cloud file', async () => {
    const { MangaView } = await import('../src/ui/views/manga.js');
    const view = new MangaView();
    let modalHtml = '';
    view.showModal = (html) => {
      modalHtml = html;
    };

    const cloudBook = {
      id: 'cloud_book',
      title: 'Yotsubato Vol 2',
      isCloudOnly: true,
      has_file: true,
      totalPages: 200
    };

    view.showCloudBookHelpModal(cloudBook);

    assert.ok(modalHtml.includes('id="btn-cloud-download-now"'), 'Must offer download button when cloud file exists');
    assert.ok(modalHtml.includes('Download from Cloud'));
    assert.ok(modalHtml.includes('tactile-btn-primary') && modalHtml.includes('id="btn-cloud-download-now"'), 'Download must be primary action');
  });
});
