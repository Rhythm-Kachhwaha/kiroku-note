const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createLogger } = require('../src/logger');

test('electron_epipe: logger writes to the log file stream', async () => {
  const logFile = path.join(__dirname, 'epipe_logger_probe.log');
  if (fs.existsSync(logFile)) fs.unlinkSync(logFile);

  const log = createLogger({ logFilePath: logFile });
  log.log('probe message');
  log.warn('probe warning');
  log.destroy();

  // createWriteStream opens the underlying file asynchronously; poll briefly.
  let contents = '';
  let exists = false;
  for (let i = 0; i < 50; i += 1) {
    if (fs.existsSync(logFile)) {
      exists = true;
      contents = fs.readFileSync(logFile, 'utf8');
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  assert.ok(exists, 'log file was created');
  assert.ok(contents.includes('probe message'), 'log message written to file');
  assert.ok(contents.includes('probe warning'), 'log warning written to file');

  fs.unlinkSync(logFile);
});

test('electron_epipe: logger suppresses EPIPE from a closed writable stream', () => {
  let writes = 0;
  const closedStream = {
    writable: true,
    write() {
      writes += 1;
      throw Object.assign(new Error('broken pipe'), { code: 'EPIPE' });
    }
  };

  const log = createLogger({ logFilePath: 'unused', fileStream: closedStream });

  // A closed pipe must not throw and must not take the caller down.
  assert.doesNotThrow(() => log.log('diagnostic after pipe closed'));
  assert.doesNotThrow(() => log.error('another timer tick'));
  assert.equal(writes, 2, 'write attempts were made but EPIPE was swallowed');
});

test('electron_epipe: logger tolerates a destroyed stream (ERR_STREAM_DESTROYED)', () => {
  const destroyedStream = {
    writable: false,
    write() {
      throw Object.assign(new Error('stream destroyed'), { code: 'ERR_STREAM_DESTROYED' });
    }
  };

  const log = createLogger({ logFilePath: 'unused', fileStream: destroyedStream });
  assert.doesNotThrow(() => log.log('stream already destroyed'));
});

test('electron_epipe: non-EPIPE errors still surface', () => {
  const failingStream = {
    writable: true,
    write() {
      throw Object.assign(new Error('unexpected disk failure'), { code: 'ERR_UNKNOWN' });
    }
  };

  const log = createLogger({ logFilePath: 'unused', fileStream: failingStream });
  assert.throws(() => log.log('should propagate'), /unexpected disk failure/);
});
