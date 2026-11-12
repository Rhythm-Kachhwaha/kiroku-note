/**
 * Kiroku Note Desktop — Backend IPC HTTP Proxy
 * Validates IPC API requests, waits for backend readiness during startup or
 * recovery, and forwards requests over loopback HTTP.
 */

const http = require('http');

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PATCH', 'PUT', 'DELETE']);

function isConnectionRefused(res) {
  if (!res || res.success || res.status !== 0) return false;
  const errCode = res.error?.errCode || '';
  const msg = res.error?.message || '';
  return errCode === 'ECONNREFUSED' || /ECONNREFUSED/i.test(msg);
}

function executeHttpRequest({ host, port, fullPath, upperMethod, requestHeaders, requestPayload, timeoutMs, agent }) {
  return new Promise((resolve) => {
    const requestOptions = {
      hostname: host,
      port,
      path: fullPath,
      method: upperMethod,
      headers: requestHeaders,
      timeout: timeoutMs,
      agent
    };

    const httpRequest = http.request(requestOptions, (httpResponse) => {
      const chunks = [];
      httpResponse.on('data', (chunk) => chunks.push(chunk));
      httpResponse.on('end', () => {
        const buffer = Buffer.concat(chunks);
        let parsedData = null;
        const contentType = httpResponse.headers['content-type'] || '';
        if (contentType.includes('application/json')) {
          try {
            parsedData = JSON.parse(buffer.toString('utf8'));
          } catch (_) {
            parsedData = buffer.toString('utf8');
          }
        } else {
          parsedData = buffer.toString('utf8');
        }

        const isSuccess = httpResponse.statusCode >= 200 && httpResponse.statusCode < 300;
        if (isSuccess) {
          resolve({
            success: true,
            status: httpResponse.statusCode,
            headers: httpResponse.headers,
            data: parsedData
          });
        } else {
          resolve({
            success: false,
            status: httpResponse.statusCode,
            headers: httpResponse.headers,
            data: parsedData,
            error: {
              statusCode: httpResponse.statusCode,
              message: (parsedData && (parsedData.detail || parsedData.message)) || ('HTTP ' + httpResponse.statusCode)
            }
          });
        }
      });
    });

    httpRequest.on('timeout', () => {
      httpRequest.destroy();
      resolve({
        success: false,
        status: 0,
        error: {
          code: 'TIMEOUT',
          message: 'Request to ' + fullPath.split('?')[0] + ' timed out after ' + timeoutMs + 'ms'
        }
      });
    });

    httpRequest.on('error', (err) => {
      resolve({
        success: false,
        status: 0,
        error: {
          code: 'NETWORK_ERROR',
          errCode: err.code || '',
          message: err.message
        }
      });
    });

    if (requestPayload) {
      httpRequest.write(requestPayload);
    }
    httpRequest.end();
  });
}

function sanitizeProxyResult(res) {
  if (res && res.error && 'errCode' in res.error) {
    const { errCode: _errCode, ...cleanError } = res.error;
    return { ...res, error: cleanError };
  }
  return res;
}

/**
 * Validates and forwards an IPC API request to the local FastAPI backend,
 * ensuring the backend is ready before sending and retrying once on ECONNREFUSED.
 */
async function forwardApiRequest({
  req = {},
  host = '127.0.0.1',
  port = 21828,
  getToken = () => '',
  agent = undefined,
  ensureBackendReady = null,
  isQuitting = () => false
}) {
  try {
    if (!req || typeof req !== 'object') {
      throw new Error('Invalid request payload');
    }

    const { method = 'GET', path: reqPath, query, body, headers = {}, timeoutMs = 15000 } = req;

    if (typeof reqPath !== 'string' || !reqPath.startsWith('/api/')) {
      throw new Error('Unauthorized or invalid API path: ' + reqPath);
    }

    if (reqPath.includes('..') || reqPath.includes('://')) {
      throw new Error('Path traversal or arbitrary URL not allowed');
    }

    const upperMethod = String(method).toUpperCase();
    if (!ALLOWED_METHODS.has(upperMethod)) {
      throw new Error('Method ' + method + ' is not permitted');
    }

    let fullPath = reqPath;
    if (query && typeof query === 'object') {
      const searchParams = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null) {
          searchParams.append(k, String(v));
        }
      }
      const qs = searchParams.toString();
      if (qs) {
        fullPath += (fullPath.includes('?') ? '&' : '?') + qs;
      }
    }

    const requestHeaders = {
      'Accept': 'application/json',
      'Origin': `http://127.0.0.1:${port}`,
      'Authorization': `Bearer ${getToken()}`,
      ...headers
    };

    let requestPayload = null;
    if (body !== undefined && body !== null) {
      if (typeof body === 'object') {
        requestPayload = JSON.stringify(body);
        if (!requestHeaders['Content-Type']) {
          requestHeaders['Content-Type'] = 'application/json';
        }
      } else {
        requestPayload = String(body);
      }
      requestHeaders['Content-Length'] = Buffer.byteLength(requestPayload);
    }

    const waitTimeoutMs = Math.max(timeoutMs, 25000);
    if (ensureBackendReady && !isQuitting()) {
      await ensureBackendReady(waitTimeoutMs);
    }

    const requestArgs = {
      host,
      port,
      fullPath,
      upperMethod,
      requestHeaders,
      requestPayload,
      timeoutMs,
      agent
    };

    let result = await executeHttpRequest(requestArgs);

    if (isConnectionRefused(result) && ensureBackendReady && !isQuitting()) {
      await ensureBackendReady(waitTimeoutMs, { forceCheck: true });
      result = await executeHttpRequest(requestArgs);
    }

    return sanitizeProxyResult(result);
  } catch (err) {
    return {
      success: false,
      error: {
        code: 'REQUEST_FAILED',
        message: err.message
      }
    };
  }
}

module.exports = { forwardApiRequest, isConnectionRefused };

