/**
 * Kiroku Note - Subprocess Lifecycle Supervisor
 * Manages the local FastAPI backend (spawning, ephemeral token generation,
 * health checks, authenticated Study API readiness, and clean shutdown).
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn, execSync, exec } = require('child_process');

class ProcessManager {
  constructor(options = {}) {
    this.port = options.port || (process.env.KIROKU_PORT ? parseInt(process.env.KIROKU_PORT, 10) : 21828);
    this.host = options.host || '127.0.0.1';
    this.healthPath = options.healthPath || '/api/health';
    this.studyCheckPath = options.studyCheckPath || '/api/study/v1/bank/summary';
    this.repoRoot = options.repoRoot || path.resolve(__dirname, '..', '..');
    this.isPackaged = options.isPackaged !== undefined ? options.isPackaged : false;
    this.pythonExecutable = options.pythonExecutable || process.env.PYTHON_PATH || 'python';
    this.packagedExecutablePath = options.packagedExecutablePath || null;

    // Ephemeral Bearer token - generated cryptographically, held only in memory
    this.apiToken = options.apiToken || this._generateEphemeralToken();

    this.childProcess = null;
    this.isExternal = false;
    this.status = 'stopped'; // 'stopped' | 'starting' | 'running' | 'failed'
    this.startupErrors = [];
    this.logFileStream = null;

    this._setupLogStream();
  }

  get healthUrl() {
    return `http://${this.host}:${this.port}${this.healthPath}`;
  }

  get studyCheckUrl() {
    return `http://${this.host}:${this.port}${this.studyCheckPath}`;
  }

  /**
   * Generates a 256-bit cryptographically secure URL-safe bearer token
   * equivalent to Python's secrets.token_urlsafe(32).
   */
  _generateEphemeralToken() {
    return crypto.randomBytes(32).toString('base64url');
  }

  /**
   * Accessor for ephemeral Bearer token (kept strictly in-memory).
   */
  getApiToken() {
    return this.apiToken;
  }

  /**
   * Regenerates a new ephemeral token.
   */
  refreshToken() {
    this.apiToken = this._generateEphemeralToken();
    return this.apiToken;
  }

  _setupLogStream() {
    try {
      const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
      const logDir = path.join(localAppData, 'KirokuNote', 'logs');
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
      const logFilePath = path.join(logDir, 'desktop_backend.log');
      this.logFileStream = fs.createWriteStream(logFilePath, { flags: 'a' });
    } catch (err) {
      console.warn('[ProcessManager] Unable to initialize log file stream:', err.message);
    }
  }

  _sanitize(message) {
    if (!message || typeof message !== 'string') return '';
    let sanitized = message;
    if (this.apiToken) {
      sanitized = sanitized.split(this.apiToken).join('[REDACTED_TOKEN]');
    }
    sanitized = sanitized.replace(/(KIROKU_STUDY_API_TOKEN=)[^\s"']+/gi, '$1[REDACTED]');
    sanitized = sanitized.replace(/(Bearer\s+)[A-Za-z0-9_-]{20,}/gi, '$1[REDACTED]');
    return sanitized;
  }

  _log(message) {
    const timestamp = new Date().toISOString();
    const sanitizedMsg = this._sanitize(message);
    const formatted = `[${timestamp}] [ProcessManager] ${sanitizedMsg}\n`;
    if (this.logFileStream) {
      try {
        this.logFileStream.write(formatted);
      } catch (_) {}
    }
    if (!this.isPackaged) {
      process.stdout.write(formatted);
    }
  }

  /**
   * Performs an unauthenticated HTTP GET to verify basic backend health.
   * Resolves to true if status is 200, false otherwise.
   */
  isBackendHealthy(timeoutMs = 1200) {
    return new Promise((resolve) => {
      const req = http.get(this.healthUrl, { timeout: timeoutMs }, (res) => {
        let rawData = '';
        res.on('data', (chunk) => { rawData += chunk; });
        res.on('end', () => {
          resolve(res.statusCode === 200);
        });
      });

      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    });
  }

  /**
   * Verifies that the Study API is reachable and authenticates with our ephemeral token.
   * Resolves to true if 200 OK.
   */
  isStudyApiAuthenticated(timeoutMs = 1500) {
    return new Promise((resolve) => {
      const headers = {};
      if (this.apiToken) {
        headers['Authorization'] = `Bearer ${this.apiToken}`;
      }

      const req = http.get(this.studyCheckUrl, { headers, timeout: timeoutMs }, (res) => {
        let rawData = '';
        res.on('data', (chunk) => { rawData += chunk; });
        res.on('end', () => {
          resolve(res.statusCode === 200);
        });
      });

      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    });
  }

  /**
   * Determines the command and arguments to start the backend.
   */
  resolveBackendCommand() {
    if (this.isPackaged) {
      const candidates = [
        this.packagedExecutablePath,
        process.resourcesPath ? path.join(process.resourcesPath, 'backend', 'KirokuNote', 'KirokuNote.exe') : null,
        process.resourcesPath ? path.join(process.resourcesPath, 'backend', 'KirokuNote.exe') : null,
        process.resourcesPath ? path.join(process.resourcesPath, 'KirokuNote', 'KirokuNote.exe') : null,
        process.resourcesPath ? path.join(process.resourcesPath, 'KirokuNote.exe') : null,
        path.join(path.dirname(process.execPath || ''), 'resources', 'backend', 'KirokuNote', 'KirokuNote.exe'),
        path.join(path.dirname(process.execPath || ''), 'resources', 'KirokuNote.exe'),
        path.join(path.dirname(process.execPath || ''), 'backend', 'KirokuNote', 'KirokuNote.exe'),
        path.join(path.dirname(process.execPath || ''), 'KirokuNote.exe'),
        path.join(this.repoRoot, 'dist', 'backend', 'KirokuNote', 'KirokuNote.exe'),
        path.join(this.repoRoot, 'dist', 'KirokuNote', 'KirokuNote.exe'),
        path.join(this.repoRoot, 'dist', 'desktop', 'resources', 'backend', 'KirokuNote', 'KirokuNote.exe')
      ].filter(Boolean);

      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
          return { command: candidate, args: [], cwd: path.dirname(candidate) };
        }
      }
      throw new Error('Packaged backend executable (KirokuNote.exe) not found in resource paths.');
    }

    const scriptPath = path.join(this.repoRoot, 'run_backend.py');
    if (!fs.existsSync(scriptPath)) {
      throw new Error(`Development backend entrypoint not found: ${scriptPath}`);
    }

    return {
      command: this.pythonExecutable,
      args: ['run_backend.py'],
      cwd: this.repoRoot
    };
  }

  /**
   * Starts the backend if not already running.
   * If already healthy, adopts the existing instance as external.
   */
  async startBackend() {
    this._log('Checking if backend is already running on port ' + this.port);
    const alreadyHealthy = await this.isBackendHealthy();

    if (alreadyHealthy) {
      this._log('Backend is already healthy on ' + this.healthUrl + '. Adopting existing instance.');
      this.isExternal = true;
      this.status = 'running';
      return { status: 'running', external: true, pid: null };
    }

    // Ensure we don't spawn duplicate child processes if one is currently active
    if (this.childProcess && !this.childProcess.killed) {
      this._log(`Backend child process PID ${this.childProcess.pid} already active.`);
      return { status: this.status, external: false, pid: this.childProcess.pid };
    }

    this._log('Backend is not running. Spawning backend process.');
    const cmdInfo = this.resolveBackendCommand();
    this._log(`Executing: ${cmdInfo.command} ${cmdInfo.args.join(' ')} (cwd: ${cmdInfo.cwd})`);

    this.startupErrors = [];

    // Environment: ephemeral token, unbuffered output, host and port bindings
    const env = {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      KIROKU_HOST: this.host,
      KIROKU_PORT: String(this.port),
      KIROKU_STUDY_API_TOKEN: this.apiToken
    };

    const child = spawn(cmdInfo.command, cmdInfo.args, {
      cwd: cmdInfo.cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: false
    });

    this.childProcess = child;
    this.isExternal = false;
    this.status = 'starting';

    child.stdout.on('data', (data) => {
      const msg = this._sanitize(data.toString());
      if (this.logFileStream) this.logFileStream.write(`[BACKEND-STDOUT] ${msg}`);
    });

    child.stderr.on('data', (data) => {
      const raw = data.toString();
      const msg = this._sanitize(raw);
      this.startupErrors.push(msg.trim());
      if (this.startupErrors.length > 20) this.startupErrors.shift();
      if (this.logFileStream) this.logFileStream.write(`[BACKEND-STDERR] ${msg}`);
    });

    child.on('error', (err) => {
      this._log(`Backend process error: ${this._sanitize(err.message)}`);
      this.status = 'failed';
    });

    child.on('exit', (code, signal) => {
      this._log(`Backend process exited with code=${code}, signal=${signal}`);
      if (this.status !== 'stopped') {
        this.status = 'failed';
      }
      this.childProcess = null;
    });

    return { status: 'starting', external: false, pid: child.pid };
  }

  /**
   * Polls the health endpoint and verifies authenticated Study API readiness.
   */
  async waitForBackend(timeoutMs = 25000, intervalMs = 400) {
    const startTime = Date.now();
    this._log(`Waiting for backend readiness (timeout: ${timeoutMs}ms)...`);

    while (Date.now() - startTime < timeoutMs) {
      if (this.childProcess === null && this.status === 'failed') {
        const errDetail = this.startupErrors.length > 0 ? `: ${this.startupErrors.join(' | ')}` : '';
        throw new Error(`Backend process terminated unexpectedly during startup${errDetail}`);
      }

      const isHealthy = await this.isBackendHealthy(intervalMs);
      if (isHealthy) {
        // Step 2: Verify authenticated Study API readiness
        const studyAuthOk = await this.isStudyApiAuthenticated(intervalMs);
        if (studyAuthOk) {
          this.status = 'running';
          this._log(`Backend and Study API became ready after ${Date.now() - startTime}ms.`);
          return true;
        }

        // If backend was adopted as external and failed study authentication,
        // it has a token mismatch and will never authenticate with our token.
        if (this.isExternal) {
          this.status = 'failed';
          throw new Error(
            `External backend on port ${this.port} is running but failed Study API authentication. ` +
            `The external instance does not accept the desktop authentication token. ` +
            `Please stop the external backend or restart Kiroku Desktop.`
          );
        }
      }

      await new Promise((r) => setTimeout(r, intervalMs));
    }

    this.status = 'failed';
    const errDetail = this.startupErrors.length > 0 ? `: ${this.startupErrors.join(' | ')}` : '';
    throw new Error(`Backend readiness timed out after ${timeoutMs}ms${errDetail}`);
  }

  /**
   * Gracefully terminates the backend process tree with bounded timeout
   * and force termination fallback.
   *
   * @param {number} [timeoutMs=2000] Bounded wait for graceful exit
   */
  async stopBackend(timeoutMs = 2000) {
    if (this.isExternal) {
      this._log('Backend is external. Skipping termination; preserving running status.');
      this.status = 'running';
      return;
    }

    if (!this.childProcess) {
      this._log('No active child process to stop.');
      this.status = 'stopped';
      return;
    }

    const pid = this.childProcess.pid;
    this._log(`Initiating graceful termination for backend process tree PID ${pid}...`);

    try {
      if (process.platform === 'win32') {
        // Graceful termination attempt via taskkill /T (without /F)
        await new Promise((resolve) => {
          exec(`taskkill /pid ${pid} /T`, { windowsHide: true }, () => resolve());
        });

        // Wait bounded timeout for exit
        const startTime = Date.now();
        while (Date.now() - startTime < timeoutMs) {
          if (!this.childProcess) break;
          await new Promise((r) => setTimeout(r, 100));
        }

        // Force termination fallback if still alive
        if (this.childProcess) {
          this._log(`Graceful shutdown timed out; executing forceful taskkill /pid ${pid} /T /F`);
          try {
            execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' });
          } catch (_) {}
        }
      } else {
        process.kill(-pid, 'SIGTERM');
        await new Promise((r) => setTimeout(r, 200));
        if (this.childProcess) {
          process.kill(-pid, 'SIGKILL');
        }
      }
    } catch (err) {
      this._log(`Note during process termination: ${this._sanitize(err.message)}`);
      try {
        if (this.childProcess) this.childProcess.kill('SIGKILL');
      } catch (_) {}
    }

    this.childProcess = null;
    this.status = 'stopped';
    this._log(`Backend process PID ${pid} stopped.`);
  }
}

module.exports = { ProcessManager };
