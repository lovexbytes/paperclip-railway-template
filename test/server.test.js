const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { afterEach, test } = require('node:test');

const children = new Set();
const tempDirs = new Set();

afterEach(() => {
  for (const child of children) {
    try { process.kill(-child.pid, 'SIGKILL'); } catch {}
  }
  children.clear();
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
  tempDirs.clear();
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

function getJson(port, pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: '127.0.0.1',
      port,
      path: pathname,
      method: options.method || 'GET',
      headers: options.headers || {},
    }, (response) => {
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
    request.end(options.body);
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
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw lastError || new Error('operation timed out');
}

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'paperclip-wrapper-'));
  tempDirs.add(root);
  const loader = path.join(root, 'server/node_modules/tsx/dist/loader.mjs');
  const backend = path.join(root, 'server/dist/index.js');
  fs.mkdirSync(path.dirname(loader), { recursive: true });
  fs.mkdirSync(path.dirname(backend), { recursive: true });
  fs.writeFileSync(loader, 'export {};\n');
  fs.writeFileSync(backend, `
    const fs = require('node:fs');
    const http = require('node:http');
    const readyAt = Date.now() + Number(process.env.FIXTURE_HEALTH_DELAY_MS || 0);
    const server = http.createServer((req, res) => {
      if (req.url === '/api/health' && Date.now() >= readyAt) {
        res.writeHead(200, {'content-type': 'application/json'});
        return res.end(JSON.stringify({ok: true, commit: 'fixture'}));
      }
      res.writeHead(503, {'content-type': 'application/json'});
      res.end(JSON.stringify({ok: false}));
    });
    server.listen(Number(process.env.PORT), process.env.HOST);
    process.on('SIGTERM', () => {
      if (process.env.FIXTURE_SIGNAL_FILE) fs.writeFileSync(process.env.FIXTURE_SIGNAL_FILE, 'SIGTERM');
      server.close();
      setTimeout(() => process.exit(0), 50);
    });
  `);
  return { root };
}

async function startWrapper(fixture, extraEnv = {}) {
  const [externalPort, internalPort] = await Promise.all([freePort(), freePort()]);
  const child = spawn(process.execPath, [path.resolve('src/server.js')], {
    env: {
      ...process.env,
      PORT: String(externalPort),
      PAPERCLIP_INTERNAL_PORT: String(internalPort),
      PAPERCLIP_BACKEND_CWD: fixture.root,
      PAPERCLIP_HOME: path.join(fixture.root, 'home'),
      PAPERCLIP_DEPLOYMENT_MODE: 'authenticated',
      PAPERCLIP_DEPLOYMENT_EXPOSURE: 'public',
      SETUP_TOKEN: 'test-setup-token',
      SETUP_AUTO_BOOTSTRAP: 'false',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  children.add(child);
  let logs = '';
  child.stdout.on('data', (chunk) => { logs += chunk; });
  child.stderr.on('data', (chunk) => { logs += chunk; });
  return { child, externalPort, getLogs: () => logs };
}

test('wrapper starts the upstream command shape and reports backend readiness', async () => {
  const running = await startWrapper(makeFixture());
  const response = await eventually(async () => {
    const result = await getJson(running.externalPort, '/wrapper/healthz');
    if (result.status !== 200) throw new Error('backend not ready');
    return result;
  });

  assert.deepEqual(response.body, {
    ok: true,
    component: 'setup-wrapper',
    version: 'setup-wrapper',
    backendReachable: true,
  });
  assert.match(running.getLogs(), /launching backend: node --import \.\/server\/node_modules\/tsx\/dist\/loader\.mjs server\/dist\/index\.js/);
});

test('public authenticated setup fails closed when SETUP_TOKEN is missing', async () => {
  const running = await startWrapper(makeFixture(), { SETUP_TOKEN: '' });
  await new Promise((resolve) => running.child.once('exit', resolve));
  children.delete(running.child);
  assert.notEqual(running.child.exitCode, 0);
  assert.match(running.getLogs(), /SETUP_TOKEN is required/);
});

test('public authenticated setup treats a whitespace-only SETUP_TOKEN as missing', async () => {
  const running = await startWrapper(makeFixture(), { SETUP_TOKEN: '   ' });
  await new Promise((resolve) => running.child.once('exit', resolve));
  children.delete(running.child);
  assert.notEqual(running.child.exitCode, 0);
  assert.match(running.getLogs(), /SETUP_TOKEN is required/);
});

test('Railway readiness returns 503 until the backend is healthy', async () => {
  const running = await startWrapper(makeFixture(), { FIXTURE_HEALTH_DELAY_MS: '5000' });
  const response = await eventually(() => getJson(running.externalPort, '/wrapper/healthz'));
  assert.equal(response.status, 503);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.backendReachable, false);
});

test('shutdown signals the backend immediately even when an HTTP connection remains open', async () => {
  const signalFile = path.join(os.tmpdir(), `paperclip-signal-${process.pid}-${Date.now()}`);
  const running = await startWrapper(makeFixture(), { FIXTURE_SIGNAL_FILE: signalFile });
  await eventually(async () => {
    const response = await getJson(running.externalPort, '/wrapper/healthz');
    if (response.status !== 200) throw new Error('not ready');
  });

  const socket = net.connect(running.externalPort, '127.0.0.1');
  await new Promise((resolve) => socket.once('connect', resolve));
  socket.write('GET / HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n');
  running.child.kill('SIGTERM');
  await eventually(() => {
    assert.equal(fs.readFileSync(signalFile, 'utf8'), 'SIGTERM');
  }, 1000);
  socket.destroy();
  fs.rmSync(signalFile, { force: true });
});

test('bootstrap invite creation serializes concurrent generators before reading state', () => {
  const source = fs.readFileSync(path.resolve('src/server.js'), 'utf8');
  const beginAt = source.indexOf("await client.query('BEGIN')");
  const lockAt = source.indexOf('pg_advisory_xact_lock', beginAt);
  const adminReadAt = source.indexOf('FROM instance_user_roles', beginAt);
  const inviteWriteAt = source.indexOf('UPDATE invites', beginAt);

  assert.notEqual(beginAt, -1);
  assert.notEqual(lockAt, -1);
  assert.ok(lockAt > beginAt, 'lock must be transaction-scoped');
  assert.ok(lockAt < adminReadAt, 'lock must be acquired before checking onboarding state');
  assert.ok(lockAt < inviteWriteAt, 'lock must be acquired before revoking or inserting invites');
});

test('stored bootstrap URL is accepted only while its database invite is live', async () => {
  const { validateStoredBootstrapUrl } = require('../src/bootstrap');
  const liveClient = {
    query: async (sql, values) => {
      assert.match(sql, /accepted_at IS NULL/);
      assert.match(sql, /revoked_at IS NULL/);
      assert.match(sql, /expires_at > NOW\(\)/);
      assert.equal(values[0], 'bootstrap_ceo');
      assert.match(values[1], /^[a-f0-9]{64}$/);
      return { rowCount: 1 };
    },
  };
  assert.equal(
    await validateStoredBootstrapUrl('https://paperclip.example/invite/pcp_bootstrap_secret', liveClient),
    true,
  );
  assert.equal(
    await validateStoredBootstrapUrl('https://paperclip.example/not-an-invite', liveClient),
    false,
  );
  assert.equal(
    await validateStoredBootstrapUrl('https://paperclip.example/invite/pcp_bootstrap_secret', { query: async () => ({ rowCount: 0 }) }),
    false,
  );
});

test('database outage does not delete or replace a persisted bootstrap invite', async () => {
  const fixture = makeFixture();
  const setupDir = path.join(fixture.root, 'home', 'setup');
  const inviteFile = path.join(setupDir, 'bootstrap-invite.txt');
  const storedUrl = 'https://paperclip.example/invite/pcp_bootstrap_existing';
  fs.mkdirSync(setupDir, { recursive: true });
  fs.writeFileSync(inviteFile, `${storedUrl}\n`);

  const running = await startWrapper(fixture, {
    DATABASE_URL: 'postgresql://127.0.0.1:1/unavailable',
  });
  await eventually(async () => {
    const response = await getJson(running.externalPort, '/wrapper/healthz');
    if (response.status !== 200) throw new Error('not ready');
  });

  const response = await getJson(running.externalPort, '/setup/api/bootstrap', {
    method: 'POST',
    headers: { 'x-setup-token': 'test-setup-token' },
  });
  assert.equal(response.status, 500);
  assert.equal(response.body.error, 'Unable to validate stored bootstrap invite');
  assert.equal(fs.readFileSync(inviteFile, 'utf8').trim(), storedUrl);
});
