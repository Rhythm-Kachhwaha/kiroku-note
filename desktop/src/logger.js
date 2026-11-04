/**
 * Guarded diagnostic logger for the Electron main process.
 *
 * Writes lines to an append-only log file under the app user-data directory
 * (preferred), falling back to process.stdout only when that stream is
 * writable. Closed-pipe / destroyed-stream failures (EPIPE and related
 * stream codes) are suppressed so a terminal whose pipe has closed - for
 * example a packaged app launched from the Start Menu - cannot crash the
 * main process through a recurring timer log. Any other error is allowed
 * to propagate so genuine problems stay visible.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const CLOSED_STREAM_CODES = new Set(['EPIPE', 'ERR_STREAM_DESTROYED', 'ERR_STREAM_PREMATURE_CLOSE']);

function _defaultLogFilePath() {
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(base, 'KirokuNote', 'logs', 'desktop.log');
}

/**
 * @param {object} [options]
 * @param {string} [options.logFilePath] - default %LOCALAPPDATA%/KirokuNote/logs/desktop.log
 * @param {object} [options.fileStream]  - injected writable stream (mainly for tests)
 * @returns {{log: Function, warn: Function, error: Function, destroy: Function}}
 */
function createLogger(options = {}) {
  const logFilePath = options.logFilePath || _defaultLogFilePath();
  let fileStream = options.fileStream || null;

  if (!fileStream) {
    try {
      const dir = path.dirname(logFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fileStream = fs.createWriteStream(logFilePath, { flags: 'a' });
    } catch (_) {
      fileStream = null;
    }
  }

  function _writeStream(stream, chunk) {
    if (!stream) return false;
    try {
      stream.write(chunk);
      return true;
    } catch (err) {
      if (err && CLOSED_STREAM_CODES.has(err.code)) return false;
      throw err;
    }
  }

  function entry(level, message) {
    const line = `[${new Date().toISOString()}] [${level}] ${message}\n`;
    let written = _writeStream(fileStream, line);

    // Unpackaged/dev mode: also emit to stdout when it is writable.
    if (!written && process.stdout && process.stdout.writable) {
      try {
        process.stdout.write(line);
        written = true;
      } catch (err) {
        if (err && CLOSED_STREAM_CODES.has(err.code)) return;
        throw err;
      }
    }
  }

  return {
    log(message) {
      entry('Main', message);
    },
    warn(message) {
      entry('Warn', message);
    },
    error(message) {
      entry('Error', message);
    },
    destroy() {
      if (fileStream && fileStream !== options.fileStream) {
        try {
          fileStream.end();
        } catch (_) {}
      }
      fileStream = null;
    }
  };
}

module.exports = { createLogger };
