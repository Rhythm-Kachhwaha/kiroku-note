/**
 * Kiroku Note - Subprocess Lifecycle Supervisor
 * Manages the local FastAPI backend (spawning, health checks, port detection, and clean tree-kill shutdown).
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execSync } = require('child_process');

class ProcessManager {
  constructor(options = {}) {
    this.port = options.port || 21828;
    this.host = options.host || '127.0.0.1';
    this.healthPath = options.healthPath || '/api/health';
    this.repoRoot = options.repoRoot || path.resolve(__dirname, '..', '..');
    this.isPackaged = options.isPackaged !== undefined ? options.isPackaged : false;
    this.pythonExecutable = options.pythonExecutable || process.env.PYTHON_PATH || 'python';
    this.packagedExecutablePath = options.packagedExecutablePath || null;
    
    this.childProcess = null;
    this.isExternal = false;
    this.status = 'stopped'; // 'stopped' | 'starting' | 'running' | 'failed'
    this.logFileStream = null;

    this._setupLogStream();
  }

  get healthUrl() {
    return `http://${this.host}:${this.port}${this.healthPath}`;
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
      // Non-fatal if log directory cannot be created
      console.warn('[ProcessManager] Unable to initialize log file stream:', err.message);
    }
  }

  _log(message) {
    const timestamp = new Date().toISOString();
    const formatted = `[${timestamp}] [ProcessManager] ${message}\n`;
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
   * Performs an HTTP GET to verify backend health.
   * Resolves to true if status is 200, false otherwise.
   */
  isBackendHealthy(timeoutMs = 1200) {
    return new Promise((resolve) => {
      const req = http.get(this.healthUrl, { timeout: timeoutMs }, (res) => {
        let rawData = '';
        res.on('data', (chunk) => { rawData += chunk; });
        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve(true);
          } else {
            resolve(false);
          }
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
        process.resourcesPath ? path.join(process.resourcesPath, 'backend', 'KirokuNote.exe') : null,
        process.resourcesPath ? path.join(process.resourcesPath, 'KirokuNote.exe') : null,
        path.join(this.repoRoot, 'dist', 'KirokuNote', 'KirokuNote.exe')
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

    this._log('Backend is not running. Spawning backend process.');
    const cmdInfo = this.resolveBackendCommand();
    this._log(`Executing: ${cmdInfo.command} ${cmdInfo.args.join(' ')} (cwd: ${cmdInfo.cwd})`);

    const env = { ...process.env, PYTHONUNBUFFERED: '1', KIROKU_PORT: String(this.port) };

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
      const msg = data.toString();
      if (this.logFileStream) this.logFileStream.write(`[BACKEND-STDOUT] ${msg}`);
    });

    child.stderr.on('data', (data) => {
      const msg = data.toString();
      if (this.logFileStream) this.logFileStream.write(`[BACKEND-STDERR] ${msg}`);
    });

    child.on('error', (err) => {
      this._log(`Backend process error: ${err.message}`);
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
   * Polls the health endpoint until ready or timeout.
   */
  async waitForBackend(timeoutMs = 20000, intervalMs = 400) {
    const startTime = Date.now();
    this._log(`Waiting for backend readiness (timeout: ${timeoutMs}ms)...`);

    while (Date.now() - startTime < timeoutMs) {
      if (this.childProcess && this.status === 'failed') {
        throw new Error('Backend process terminated unexpectedly during startup.');
      }

      const isHealthy = await this.isBackendHealthy(intervalMs);
      if (isHealthy) {
        this.status = 'running';
        this._log(`Backend became healthy after ${Date.now() - startTime}ms.`);
        return true;
      }

      await new Promise((r) => setTimeout(r, intervalMs));
    }

    this.status = 'failed';
    throw new Error(`Backend readiness timed out after ${timeoutMs}ms.`);
  }

  /**
   * Cleanly terminates the backend process tree if owned by this supervisor.
   */
  stopBackend() {
    if (this.isExternal) {
      this._log('Backend is external. Skipping termination.');
      this.status = 'stopped';
      return;
    }

    if (!this.childProcess) {
      this._log('No active child process to stop.');
      this.status = 'stopped';
      return;
    }

    const pid = this.childProcess.pid;
    this._log(`Terminating backend process tree for PID ${pid}...`);

    try {
      if (process.platform === 'win32') {
        execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' });
        this._log(`Successfully executed taskkill /pid ${pid} /T /F`);
      } else {
        process.kill(-pid, 'SIGTERM');
      }
    } catch (err) {
      this._log(`Note: Process termination returned: ${err.message}`);
      try {
        this.childProcess.kill('SIGKILL');
      } catch (_) {}
    }

    this.childProcess = null;
    this.status = 'stopped';
  }
}

module.exports = { ProcessManager };

