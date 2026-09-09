const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { afterEach, test } = require('node:test');

const children = new Set();
afterEach(() => {
  for (const child of children) child.kill('SIGTERM');
  children.clear();
});

function freePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function getJson(port, pathname) {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: '127.0.0.1', port, path: pathname }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        try {
          resolve({ status: response.statusCode, body: JSON.parse(body) });
        } catch (error) {
          reject(error);
        }
      });
    });
    request.once('error', reject);
  });
}

async function eventually(operation, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw lastError || new Error('operation timed out');
}

test('wrapper starts the upstream command shape and reports backend readiness', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paperclip-wrapper-'));
  const loader = path.join(root, 'server/node_modules/tsx/dist/loader.mjs');
  const backend = path.join(root, 'server/dist/index.js');
  fs.mkdirSync(path.dirname(loader), { recursive: true });
  fs.mkdirSync(path.dirname(backend), { recursive: true });
  fs.writeFileSync(loader, 'export {};\n');
  fs.writeFileSync(backend, `
    const http = require('node:http');
    const server = http.createServer((req, res) => {
      if (req.url === '/api/health') {
        res.writeHead(200, {'content-type': 'application/json'});
        return res.end(JSON.stringify({ok: true, commit: 'fixture'}));
      }
      res.writeHead(404); res.end();
    });
    server.listen(Number(process.env.PORT), process.env.HOST);
    process.on('SIGTERM', () => server.close(() => process.exit(0)));
  `);

  const externalPort = await freePort();
  const internalPort = await freePort();
  const child = spawn(process.execPath, [path.resolve('src/server.js')], {
    env: {
      ...process.env,
      PORT: String(externalPort),
      PAPERCLIP_INTERNAL_PORT: String(internalPort),
      PAPERCLIP_BACKEND_CWD: root,
      PAPERCLIP_HOME: path.join(root, 'home'),
      SETUP_AUTO_BOOTSTRAP: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(child);

  let logs = '';
  child.stdout.on('data', (chunk) => { logs += chunk; });
  child.stderr.on('data', (chunk) => { logs += chunk; });

  const response = await eventually(async () => {
    const result = await getJson(externalPort, '/wrapper/healthz');
    if (!result.body.backendReachable) throw new Error('backend not ready');
    return result;
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, {
    ok: true,
    component: 'setup-wrapper',
    version: 'setup-wrapper',
    backendReachable: true,
  });
  assert.match(logs, /launching backend: node --import \.\/server\/node_modules\/tsx\/dist\/loader\.mjs server\/dist\/index\.js/);

  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
  children.delete(child);
  fs.rmSync(root, { recursive: true, force: true });
});
