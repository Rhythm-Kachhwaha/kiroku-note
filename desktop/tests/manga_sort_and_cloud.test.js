import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

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
});
