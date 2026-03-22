#!/usr/bin/env node

const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const EXTERNAL_PORT = Number(process.env.PORT || 3100);
const INTERNAL_PORT = Number(process.env.PAPERCLIP_INTERNAL_PORT || 3101);
const HOST = process.env.HOST || '0.0.0.0';

const PAPERCLIP_HOME = process.env.PAPERCLIP_HOME || process.env.HOME || '/paperclip';
const SETUP_ENABLED = (process.env.SETUP_ENABLED || 'true').toLowerCase() !== 'false';
const SETUP_TOKEN = process.env.SETUP_TOKEN || '';
const SETUP_AUTO_BOOTSTRAP = (process.env.SETUP_AUTO_BOOTSTRAP || 'true').toLowerCase() !== 'false';

const setupDir = path.join(PAPERCLIP_HOME, 'setup');
const bootstrapFilePath = path.join(setupDir, 'bootstrap-invite.txt');

function ensureSetupDir() {
  fs.mkdirSync(setupDir, { recursive: true });
}

function readStoredBootstrapUrl() {
  try {
    return fs.readFileSync(bootstrapFilePath, 'utf8').trim();
  } catch {
    return '';
  }
}

function storeBootstrapUrl(url) {
  ensureSetupDir();
  fs.writeFileSync(bootstrapFilePath, `${url.trim()}\n`, { mode: 0o600 });
}

function getTokenFromRequest(reqUrl, headers) {
  const auth = headers.authorization || '';
  const authBearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  const setupHeader = headers['x-setup-token'] || '';
  const queryToken = reqUrl.searchParams.get('token') || '';
  return queryToken || setupHeader || authBearer;
}

function isSetupAuthorized(reqUrl, headers) {
  if (!SETUP_ENABLED) return true;
  if (!SETUP_TOKEN) return false;
  return getTokenFromRequest(reqUrl, headers) === SETUP_TOKEN;
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  });
  res.end(body);
}

function sendHtml(res, statusCode, html) {
  res.writeHead(statusCode, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(html),
    'cache-control': 'no-store'
  });
  res.end(html);
}

async function requestBackend(pathname, options = {}) {
  const backendUrl = `http://127.0.0.1:${INTERNAL_PORT}${pathname}`;
  const response = await fetch(backendUrl, {
    method: options.method || 'GET',
    headers: options.headers || {},
    body: options.body
  });

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return { ok: response.ok, status: response.status, data: await response.json() };
  }

  const text = await response.text();
  return { ok: response.ok, status: response.status, data: { text } };
}

async function createBootstrapInvite() {
  const candidateEndpoints = [
    '/api/setup/bootstrap',
    '/api/auth/bootstrap',
    '/api/bootstrap',
    '/api/invites/bootstrap'
  ];

  for (const endpoint of candidateEndpoints) {
    try {
      const result = await requestBackend(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}'
      });

      if (!result.ok || !result.data || typeof result.data !== 'object') {
        continue;
      }

      const inviteUrl =
        result.data.url ||
        result.data.inviteUrl ||
        result.data.invite_url ||
        result.data.link ||
        result.data.bootstrapUrl ||
        '';

      if (inviteUrl && typeof inviteUrl === 'string') {
        return inviteUrl;
      }
    } catch {
      // Try next endpoint silently.
    }
  }

  throw new Error('Unable to generate bootstrap invite from Paperclip API');
}

function renderSetupHtml() {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Paperclip Setup</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; max-width: 720px; margin: 40px auto; padding: 0 16px; color: #111; }
    .card { border: 1px solid #ddd; border-radius: 12px; padding: 20px; }
    .muted { color: #666; }
    code { background: #f5f5f5; padding: 2px 6px; border-radius: 6px; word-break: break-all; }
    button { border: 0; border-radius: 8px; background: #111; color: #fff; padding: 10px 14px; cursor: pointer; }
    button:disabled { opacity: 0.5; cursor: default; }
    .row { margin-top: 14px; }
  </style>
</head>
<body>
  <h1>Paperclip setup</h1>
  <p class="muted">This endpoint is token-protected. Use it once to retrieve the bootstrap invite.</p>

  <div class="card">
    <div class="row"><strong>Status:</strong> <span id="status">Loading…</span></div>
    <div class="row"><button id="bootstrapBtn">Generate / show bootstrap invite</button></div>
    <div class="row"><strong>Invite URL:</strong> <div><code id="invite">(none)</code></div></div>
  </div>

  <script>
    const token = new URLSearchParams(window.location.search).get('token') || '';
    const headers = token ? { 'x-setup-token': token } : {};

    async function loadStatus() {
      const r = await fetch('/setup/api/status' + (token ? ('?token=' + encodeURIComponent(token)) : ''), { headers });
      const j = await r.json();
      document.getElementById('status').textContent = j.backendReachable ? 'Paperclip reachable' : 'Paperclip not ready';
      if (j.bootstrapUrl) document.getElementById('invite').textContent = j.bootstrapUrl;
    }

    async function bootstrap() {
      const btn = document.getElementById('bootstrapBtn');
      btn.disabled = true;
      try {
        const r = await fetch('/setup/api/bootstrap' + (token ? ('?token=' + encodeURIComponent(token)) : ''), {
          method: 'POST',
          headers
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'request failed');
        document.getElementById('invite').textContent = j.bootstrapUrl || '(none)';
      } catch (e) {
        document.getElementById('invite').textContent = 'Error: ' + e.message;
      } finally {
        btn.disabled = false;
      }
    }

    document.getElementById('bootstrapBtn').addEventListener('click', bootstrap);
    loadStatus();
  </script>
</body>
</html>`;
}

function proxyToBackend(clientReq, clientRes) {
  const requestOptions = {
    hostname: '127.0.0.1',
    port: INTERNAL_PORT,
    path: clientReq.url,
    method: clientReq.method,
    headers: {
      ...clientReq.headers,
      host: `127.0.0.1:${INTERNAL_PORT}`
    }
  };

  const proxyReq = http.request(requestOptions, (proxyRes) => {
    clientRes.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
    proxyRes.pipe(clientRes);
  });

  proxyReq.on('error', () => {
    sendJson(clientRes, 502, { error: 'Paperclip backend unavailable' });
  });

  clientReq.pipe(proxyReq);
}

const backendEnv = {
  ...process.env,
  PORT: String(INTERNAL_PORT),
  HOST: '127.0.0.1'
};

const child = spawn('paperclipai', ['run'], {
  env: backendEnv,
  stdio: 'inherit'
});

child.on('exit', (code, signal) => {
  console.error(`[setup-wrapper] Paperclip process exited (code=${code}, signal=${signal || 'none'})`);
  process.exit(code || 1);
});

async function getStatusPayload() {
  let backendReachable = false;
  try {
    const backendHealth = await requestBackend('/api/health');
    backendReachable = backendHealth.ok;
  } catch {
    backendReachable = false;
  }

  const bootstrapUrl = readStoredBootstrapUrl();
  return {
    ok: true,
    setupEnabled: SETUP_ENABLED,
    backendReachable,
    bootstrapExists: Boolean(bootstrapUrl),
    bootstrapUrl: bootstrapUrl || undefined
  };
}

if (SETUP_AUTO_BOOTSTRAP) {
  setTimeout(async () => {
    try {
      if (!readStoredBootstrapUrl()) {
        const url = await createBootstrapInvite();
        storeBootstrapUrl(url);
      }
    } catch {
      // Ignore: setup endpoint can still create it later.
    }
  }, 4000);
}

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = reqUrl.pathname;

  if (pathname === '/setup/healthz') {
    return sendJson(res, 200, { ok: true });
  }

  const isSetupRoute = pathname === '/setup' || pathname.startsWith('/setup/api/');
  if (isSetupRoute && !isSetupAuthorized(reqUrl, req.headers)) {
    return sendJson(res, 401, { error: 'Unauthorized setup access' });
  }

  if (pathname === '/setup' && req.method === 'GET') {
    return sendHtml(res, 200, renderSetupHtml());
  }

  if (pathname === '/setup/api/status' && req.method === 'GET') {
    const payload = await getStatusPayload();
    return sendJson(res, 200, payload);
  }

  if (pathname === '/setup/api/bootstrap' && req.method === 'POST') {
    try {
      let bootstrapUrl = readStoredBootstrapUrl();
      if (!bootstrapUrl) {
        bootstrapUrl = await createBootstrapInvite();
        storeBootstrapUrl(bootstrapUrl);
      }
      return sendJson(res, 200, { ok: true, bootstrapUrl });
    } catch (error) {
      return sendJson(res, 500, {
        ok: false,
        error: 'Failed to generate bootstrap invite'
      });
    }
  }

  return proxyToBackend(req, res);
});

server.listen(EXTERNAL_PORT, HOST, () => {
  console.log(`[setup-wrapper] Listening on ${HOST}:${EXTERNAL_PORT}, backend on 127.0.0.1:${INTERNAL_PORT}`);
});

function shutdown(signal) {
  console.log(`[setup-wrapper] ${signal} received, shutting down...`);
  server.close(() => {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
    process.exit(0);
  });

  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
