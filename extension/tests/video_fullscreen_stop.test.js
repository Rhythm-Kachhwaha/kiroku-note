import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EXT_DIR = path.resolve(__dirname, '..');

test('HudPopup reparents into document.fullscreenElement so subtitle clicks show in fullscreen', () => {
  const hudPopupSrc = fs.readFileSync(path.join(EXT_DIR, 'content/hud/hud-popup.js'), 'utf8');
  assert.match(hudPopupSrc, /_syncMountTarget\s*\(/);
  assert.match(hudPopupSrc, /document\.fullscreenElement/);
  assert.match(hudPopupSrc, /fullscreenchange/);
});

test('VideoMiningController handles MINING_MODE_CHANGED and uses non-orange active subtitle highlight', () => {
  const vmSrc = fs.readFileSync(path.join(EXT_DIR, 'content/video-mining.js'), 'utf8');
  assert.match(vmSrc, /setMiningEnabled\s*\(/);
  assert.match(vmSrc, /message\?\.type === "MINING_MODE_CHANGED"/);
  assert.match(vmSrc, /GET_MINING_MODE/);
  const activeBlock = vmSrc.match(/\.video-sub-token\.is-active[\s\S]{0,300}\}/)?.[0] || '';
  assert.ok(activeBlock.length > 0, 'Expected .video-sub-token.is-active style block');
  assert.ok(!activeBlock.includes('#D94B38'), 'Active subtitle token must not use harsh orange #D94B38');
});
