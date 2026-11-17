import test from 'node:test';
import assert from 'node:assert/strict';
import { ReviewPlayer } from '../src/ui/views/review_player.js';

test('ReviewPlayer initializes and renders front of card', () => {
  const cards = [
    {
      card_id: 1,
      expression: '木漏れ日',
      reading: 'こもれび',
      meaning: 'Sunlight filtering through trees',
      example_sentence: '木漏れ日の中で本を読む。',
      image: 'data:image/jpeg;base64,...',
      intervals: { again: '<10m', hard: '1d', good: '3d', easy: '6d' }
    }
  ];
  
  const player = new ReviewPlayer({ queue: cards });
  const html = player.render();
  
  assert.ok(html.includes('木漏れ日'));
  assert.ok(html.includes('brutalist-card'));
  assert.ok(html.includes('Show Answer'));
});

test('ReviewPlayer renders back when flipped', () => {
  const cards = [
    {
      card_id: 1,
      expression: '木漏れ日',
      reading: 'こもれび',
      meaning: 'Sunlight filtering through trees',
      example_sentence: '木漏れ日の中で本を読む。',
      intervals: { again: '<10m', hard: '1d', good: '3d', easy: '6d' }
    }
  ];
  
  const player = new ReviewPlayer({ queue: cards });
  player.isFlipped = true;
  const html = player.render();
  
  assert.ok(html.includes('こもれび'));
  assert.ok(html.includes('Sunlight filtering through trees'));
  assert.ok(html.includes('Again'));
  assert.ok(html.includes('Easy'));
  assert.ok(html.includes('6d'));
});
