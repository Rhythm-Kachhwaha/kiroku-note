import test from 'node:test';
import assert from 'node:assert/strict';
import { HomeScreenController } from '../src/ui/views/home.js';

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
});
