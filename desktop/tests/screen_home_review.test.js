import test from 'node:test';
import assert from 'node:assert/strict';
import { HomeScreenController } from '../src/ui/views/home.js';
import { ReviewPlayer } from '../src/ui/views/review_player.js';

test('HomeScreenController renders review widget with streak, due count, and settings button', () => {
  const controller = new HomeScreenController();
  controller.dueReviewsCount = 12;
  controller.dailyStreak = 5;
  
  const widgetHtml = controller.renderReviewLauncherWidget();
  assert.ok(widgetHtml.includes('12'));
  assert.ok(widgetHtml.includes('5 day streak'));
  assert.ok(widgetHtml.includes('Start Review'));
  assert.ok(widgetHtml.includes('Increase Today'));
  assert.ok(widgetHtml.includes('review-settings-trigger'));
  assert.ok(widgetHtml.includes('review-deck-select'));
});

test('ReviewPlayer renders as dedicated screen with back button and brutalist card', () => {
  const cards = [
    {
      card_id: 42,
      expression: '名前',
      reading: 'なまえ',
      meaning: 'name',
      deck_name: 'N3 vocabs',
      image: 'ankiminer_img_test.jpg'
    }
  ];
  const player = new ReviewPlayer({ queue: cards, apiBase: 'http://127.0.0.1:21828' });
  const html = player.render();

  assert.ok(html.includes('review-screen-stage'));
  assert.ok(html.includes('btn-player-back'));
  assert.ok(html.includes('N3 vocabs'));
  assert.ok(html.includes('名前'));
  assert.ok(html.includes('card-media-frame'));
  assert.ok(html.includes('http://127.0.0.1:21828/api/media/ankiminer_img_test.jpg'));
});
