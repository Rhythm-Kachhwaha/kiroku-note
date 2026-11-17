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

test('ReviewPlayer renders bury, suspend, and undo controls', () => {
  const cards = [
    { card_id: 1, expression: '雨宿り', reading: 'あまやどり', meaning: 'shelter from rain' }
  ];
  const player = new ReviewPlayer({ queue: cards });
  const html = player.render();
  
  assert.ok(html.includes('btn-player-undo'));
  assert.ok(html.includes('btn-player-bury'));
  assert.ok(html.includes('btn-player-suspend'));
  assert.ok(html.includes('player-toast-banner'));
});

test('ReviewPlayer renders deck overview stage with Animata counters, table columns, and Study Now button', () => {
  const dummyRouter = { navigateToTab: () => {} };
  const player = new ReviewPlayer(dummyRouter);
  player.deckStats = {
    deck_name: 'N3 vocabs',
    new_count: 20,
    learn_count: 14,
    due_count: 554,
    total_studied_today: 5,
    studied_seconds_today: 26.19,
    seconds_per_card: 5.24
  };

  const html = player.render();
  assert.ok(html.includes('review-overview-card'));
  assert.ok(html.includes('deck-overview-table'));
  assert.ok(html.includes('col-new'));
  assert.ok(html.includes('col-learn'));
  assert.ok(html.includes('col-due'));
  assert.ok(html.includes('animata-counter'));
  assert.ok(html.includes('data-target="20"'));
  assert.ok(html.includes('data-target="14"'));
  assert.ok(html.includes('data-target="554"'));
  assert.ok(html.includes('Studied 5 cards in 26.19 seconds today (5.24s/card)'));
  assert.ok(html.includes('btn-study-now'));
  assert.ok(html.includes('btn-overview-settings'));
  assert.ok(!html.includes('btn-stage-deck-options'));
});
