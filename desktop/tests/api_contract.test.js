const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const fixturePath = path.join(__dirname, 'fixtures', 'openapi.json');

/**
 * Normalizes template literals like `/api/cards/${encodeURIComponent(id)}`
 * to OpenAPI path parameters like `/api/cards/{card_id}`.
 */
function normalizePath(rawPath, openapiPaths) {
  // If the rawPath already matches an openapi path directly
  if (openapiPaths.has(rawPath)) {
    return rawPath;
  }

  // Replace ${...} interpolations with a regex pattern to find the best matching openapi path
  // E.g., /api/cards/${...} matches /api/cards/{card_id}
  const regexPattern = '^' + rawPath
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // escape regex symbols
    .replace(/\\\\\$\\\{[^}]+\\\}/g, '([^/]+)') // match interpolated vars
    .replace(/\\\$\\\{[^}]+\\\}/g, '([^/]+)')
    + '$';

  const rx = new RegExp(regexPattern);
  for (const candidate of openapiPaths) {
    // Convert openapi {param} to regex match
    const openapiRx = new RegExp('^' + candidate.replace(/\{[^}]+\}/g, '([^/]+)') + '$');
    // If a dummy replaced string matches candidate
    const dummy = rawPath.replace(/\$\{[^}]+\}/g, 'dummy_param');
    if (openapiRx.test(dummy)) {
      return candidate;
    }
  }

  return rawPath;
}

/**
 * Statically extracts endpoints and methods from client JS source.
 */
function extractClientEndpoints(filePath, openapiPaths) {
  const content = fs.readFileSync(filePath, 'utf8');
  const endpoints = [];

  // Pattern 1: this.request('path', { method: 'METHOD' }) or this.request(`path`, { method: 'METHOD' })
  // or this.request('path') (default GET)
  const reqRegex = /this\.request\(\s*[`'"]([^`'"]+)[`'"](?:\s*,\s*\{([^}]+)\})?/g;
  let match;
  while ((match = reqRegex.exec(content)) !== null) {
    const rawPath = match[1];
    const optionsBlock = match[2] || '';
    let method = 'GET';
    const methodMatch = /method:\s*['"]([A-Za-z]+)['"]/i.exec(optionsBlock);
    if (methodMatch) {
      method = methodMatch[1].toUpperCase();
    }
    const resolvedPath = normalizePath(rawPath, openapiPaths);
    endpoints.push({
      file: path.basename(filePath),
      rawPath,
      path: resolvedPath,
      method
    });
  }

  // Pattern 2: StudyClient / StudyApi request objects:
  // { method: 'METHOD', path: '...' } or { method: 'METHOD', path: `...` }
  const objRegex = /method:\s*['"]([A-Z]+)['"]\s*,\s*path:\s*[`'"]([^`'"]+)[`'"]/g;
  while ((match = objRegex.exec(content)) !== null) {
    const method = match[1].toUpperCase();
    const rawPath = match[2];
    const resolvedPath = normalizePath(rawPath, openapiPaths);
    endpoints.push({
      file: path.basename(filePath),
      rawPath,
      path: resolvedPath,
      method
    });
  }

  // Inverse order: path: '...', method: '...'
  const invRegex = /path:\s*[`'"]([^`'"]+)[`'"]\s*,\s*method:\s*['"]([A-Z]+)['"]/g;
  while ((match = invRegex.exec(content)) !== null) {
    const rawPath = match[1];
    const method = match[2].toUpperCase();
    const resolvedPath = normalizePath(rawPath, openapiPaths);
    endpoints.push({
      file: path.basename(filePath),
      rawPath,
      path: resolvedPath,
      method
    });
  }

  return endpoints;
}

test('CONTRACT TEST: api_client.js and study_client.js endpoints exist in OpenAPI fixture', () => {
  assert.equal(fs.existsSync(fixturePath), true, 'OpenAPI fixture does not exist: fixtures/openapi.json');
  const openapi = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const openapiPaths = new Set(Object.keys(openapi.paths));

  const apiClientPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'services', 'api_client.js');
  const studyClientPath = path.join(repoRoot, 'desktop', 'src', 'ui', 'services', 'study_client.js');

  const clientEndpoints = [
    ...extractClientEndpoints(apiClientPath, openapiPaths),
    ...extractClientEndpoints(studyClientPath, openapiPaths)
  ];

  assert.ok(clientEndpoints.length > 20, `Expected at least 20 extracted client calls, found ${clientEndpoints.length}`);

  const missing = [];
  for (const ep of clientEndpoints) {
    if (!openapi.paths[ep.path]) {
      missing.push(`[${ep.file}] Route path not found in OpenAPI: ${ep.method} ${ep.rawPath} -> ${ep.path}`);
      continue;
    }
    const methodsOnPath = openapi.paths[ep.path];
    const lowerMethod = ep.method.toLowerCase();
    if (!methodsOnPath[lowerMethod]) {
      missing.push(`[${ep.file}] Method ${ep.method} not allowed on OpenAPI path ${ep.path} (available: ${Object.keys(methodsOnPath).join(', ')})`);
    }
  }

  if (missing.length > 0) {
    assert.fail(`Client contract violation! The following endpoints do not exist on FastAPI backend:\n${missing.join('\n')}`);
  }
});

test('CONTRACT TEST: Live FastAPI app matches OpenAPI fixture without drift', () => {
  const result = spawnSync('python', ['-c', `
import json, sys
from pathlib import Path
repo_root = Path(r"${repoRoot.replace(/\\/g, '\\\\')}")
sys.path.insert(0, str(repo_root / "backend"))
sys.path.insert(0, str(repo_root))
from app.main import app
schema = app.openapi()
print(json.dumps(schema))
`], {
    env: { ...process.env, PYTHONPATH: `${path.join(repoRoot, 'backend')};${repoRoot}` },
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024
  });

  assert.equal(result.status, 0, `Failed to extract live OpenAPI schema: ${result.stderr}`);
  const liveSchema = JSON.parse(result.stdout);
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

  const livePaths = Object.keys(liveSchema.paths).sort();
  const fixturePaths = Object.keys(fixture.paths).sort();

  // Assert all live paths exist in fixture and vice versa
  assert.deepEqual(livePaths, fixturePaths, 'OpenAPI paths drifted! Did a backend route change or get removed?');

  for (const p of livePaths) {
    const liveMethods = Object.keys(liveSchema.paths[p]).sort();
    const fixtureMethods = Object.keys(fixture.paths[p]).sort();
    assert.deepEqual(liveMethods, fixtureMethods, `Methods on path ${p} drifted!`);
  }
});

