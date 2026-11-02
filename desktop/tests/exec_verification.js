const { spawn } = require('child_process');
const path = require('path');
const electronPath = require('../node_modules/electron');

console.log('Spawning Electron verification runner...');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, [path.resolve(__dirname, 'run_verification.js')], {
  env,
  stdio: 'pipe'
});

child.stdout.on('data', d => console.log('[STDOUT]', d.toString()));
child.stderr.on('data', d => console.error('[STDERR]', d.toString()));

child.on('close', code => {
  console.log('Verification finished with exit code:', code);
});

