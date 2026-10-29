/**
 * Kiroku Note - Desktop Persistent Storage
 * Persists extension settings and preferences to %LOCALAPPDATA%\KirokuNote\desktop-storage.json.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

class DesktopStore {
  constructor(options = {}) {
    this.storagePath = options.storagePath || this._defaultStoragePath();
    this.data = {};
    this.load();
  }

  _defaultStoragePath() {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const dir = path.join(localAppData, 'KirokuNote');
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch (_) {}
    }
    return path.join(dir, 'desktop-storage.json');
  }

  load() {
    try {
      if (fs.existsSync(this.storagePath)) {
        const raw = fs.readFileSync(this.storagePath, 'utf8');
        this.data = JSON.parse(raw);
      } else {
        this.data = {};
      }
    } catch (err) {
      this.data = {};
    }
    return this.data;
  }

  save() {
    try {
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.storagePath, JSON.stringify(this.data, null, 2), 'utf8');
      return true;
    } catch (err) {
      return false;
    }
  }

  get(keys) {
    if (!keys) return { ...this.data };

    const result = {};
    if (typeof keys === 'string') {
      if (Object.prototype.hasOwnProperty.call(this.data, keys)) {
        result[keys] = this.data[keys];
      }
      return result;
    }

    if (Array.isArray(keys)) {
      for (const k of keys) {
        if (Object.prototype.hasOwnProperty.call(this.data, k)) {
          result[k] = this.data[k];
        }
      }
      return result;
    }

    if (typeof keys === 'object') {
      for (const [k, defaultVal] of Object.entries(keys)) {
        result[k] = Object.prototype.hasOwnProperty.call(this.data, k)
          ? this.data[k]
          : defaultVal;
      }
      return result;
    }

    return result;
  }

  set(items) {
    if (!items || typeof items !== 'object') return;
    Object.assign(this.data, items);
    this.save();
  }

  remove(keys) {
    const keyList = Array.isArray(keys) ? keys : [keys];
    for (const k of keyList) {
      delete this.data[k];
    }
    this.save();
  }

  clear() {
    this.data = {};
    this.save();
  }
}

module.exports = { DesktopStore };

