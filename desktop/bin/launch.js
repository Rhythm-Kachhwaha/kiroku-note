#!/usr/bin/env node
/**
 * Kiroku Note - Desktop Launcher
 * Ensures clean environment variables (clearing ELECTRON_RUN_AS_NODE if set in developer shell).
 */

const { spawn } = require('child_process');
const electronPath = require('electron');
const path = require('path');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const appPath = path.resolve(__dirname, '..');
const child = spawn(electronPath, [appPath, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env,
  windowsHide: false
});

child.on('close', (code) => {
  process.exit(code ?? 0);
});

