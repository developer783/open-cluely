'use strict';

// Open-Cluely team server.
//
// Keeps the team's Gemini and AssemblyAI keys on the server so app users can
// use them without ever seeing them. The desktop app talks to this server
// instead of Google / AssemblyAI directly:
//
//   POST /gemini/v1beta/models/<model>:generateContent        -> Google, key added here
//   POST /gemini/v1beta/models/<model>:streamGenerateContent  -> Google, streamed back
//   POST /assemblyai/token                                     -> short-lived streaming token
//   GET  /health                                               -> liveness check (no auth)
//
// Every request except /health must carry a valid `x-access-code` header.
// No dependencies: Node 18+ only.

const http = require('http');
const crypto = require('crypto');
const { Readable } = require('stream');

loadDotEnv();

const PORT = Number.parseInt(process.env.PORT || '8787', 10);
const GEMINI_API_KEYS = splitList(process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY);
const ASSEMBLYAI_API_KEY = String(process.env.ASSEMBLYAI_API_KEY || '').trim();
const ACCESS_CODES = splitList(process.env.ACCESS_CODES);
const ALLOWED_MODELS = splitList(process.env.ALLOWED_MODELS ||
  'gemini-3.5-flash-lite,gemini-3.1-flash-lite-preview,gemini-3.5-flash,gemini-3.8-flash,gemini-3-flash-preview');
const RATE_LIMIT_PER_MINUTE = Number.parseInt(process.env.RATE_LIMIT_PER_MINUTE || '30', 10);
const MAX_BODY_BYTES = Number.parseInt(process.env.MAX_BODY_MB || '25', 10) * 1024 * 1024;

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com';
const ASSEMBLYAI_TOKEN_URL = 'https://streaming.assemblyai.com/v3/token';
const GEMINI_PATH = /^\/gemini\/(v1beta|v1)\/models\/([A-Za-z0-9._-]+):(generateContent|streamGenerateContent|countTokens)$/;

let geminiKeyIndex = 0;
const rateWindows = new Map();

function loadDotEnv() {
  // Minimal .env support for running locally; hosting platforms set real env vars.
  const fs = require('fs');
  const path = require('path');
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  }
}

function splitList(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function sendError(res, status, message) {
  // Same shape as Google's errors so the app's Gemini SDK surfaces the message.
  sendJson(res, status, { error: { code: status, message } });
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function authorize(req) {
  const code = String(req.headers['x-access-code'] || '').trim();
  if (!code) return null;
  return ACCESS_CODES.find((allowed) => safeEqual(allowed, code)) || null;
}

function withinRateLimit(code) {
  const now = Date.now();
  const window = rateWindows.get(code) || { start: now, count: 0 };
  if (now - window.start >= 60_000) {
    window.start = now;
    window.count = 0;
  }
  window.count += 1;
  rateWindows.set(code, window);
  return window.count <= RATE_LIMIT_PER_MINUTE;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Request too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function proxyGemini(req, res, match) {
  const [, apiVersion, model, task] = match;
  if (ALLOWED_MODELS.length && !ALLOWED_MODELS.includes(model)) {
    sendError(res, 403, `Model "${model}" is not enabled on the team server.`);
    return;
  }
  if (GEMINI_API_KEYS.length === 0) {
    sendError(res, 503, 'Team server has no Gemini key configured.');
    return;
  }

  const body = await readBody(req);
  const query = task === 'streamGenerateContent' ? '?alt=sse' : '';
  const target = `${GEMINI_BASE_URL}/${apiVersion}/models/${model}:${task}${query}`;

  // Try each key once; move on when a key is rate-limited or rejected.
  let lastResponse = null;
  for (let attempt = 0; attempt < GEMINI_API_KEYS.length; attempt += 1) {
    const key = GEMINI_API_KEYS[geminiKeyIndex % GEMINI_API_KEYS.length];
    const upstream = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body
    });

    if ([401, 403, 429].includes(upstream.status) && attempt < GEMINI_API_KEYS.length - 1) {
      geminiKeyIndex += 1;
      await upstream.body?.cancel();
      continue;
    }
    lastResponse = upstream;
    break;
  }

  res.writeHead(lastResponse.status, {
    'Content-Type': lastResponse.headers.get('content-type') || 'application/json'
  });
  if (lastResponse.body) {
    Readable.fromWeb(lastResponse.body).pipe(res);
  } else {
    res.end();
  }
}

async function issueAssemblyToken(res) {
  if (!ASSEMBLYAI_API_KEY) {
    sendError(res, 503, 'Team server has no AssemblyAI key configured.');
    return;
  }
  const upstream = await fetch(`${ASSEMBLYAI_TOKEN_URL}?expires_in_seconds=60`, {
    headers: { Authorization: ASSEMBLYAI_API_KEY }
  });
  const data = await upstream.json().catch(() => ({}));
  if (!upstream.ok || !data.token) {
    sendError(res, 502, data.error || 'Could not get an AssemblyAI token.');
    return;
  }
  sendJson(res, 200, { token: data.token });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, {
        ok: true,
        gemini: GEMINI_API_KEYS.length > 0,
        assemblyai: Boolean(ASSEMBLYAI_API_KEY)
      });
      return;
    }

    const code = authorize(req);
    if (!code) {
      sendError(res, 401, 'Team access code is missing or invalid. Check it in Settings.');
      return;
    }
    if (!withinRateLimit(code)) {
      sendError(res, 429, 'Team server rate limit reached. Wait a minute and try again.');
      return;
    }

    const geminiMatch = req.method === 'POST' && url.pathname.match(GEMINI_PATH);
    if (geminiMatch) {
      await proxyGemini(req, res, geminiMatch);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/assemblyai/token') {
      await issueAssemblyToken(res);
      return;
    }

    sendError(res, 404, 'Not found');
  } catch (error) {
    console.error(`[team-server] ${req.method} ${url.pathname} failed:`, error.message);
    if (!res.headersSent) {
      sendError(res, error.status || 502, error.status ? error.message : 'Team server could not reach the AI provider.');
    } else {
      res.end();
    }
  }
});

if (ACCESS_CODES.length === 0) {
  console.error('[team-server] ACCESS_CODES is empty; refusing to start an open proxy.');
  process.exit(1);
}

server.listen(PORT, () => {
  console.log(`[team-server] Listening on port ${PORT}`);
  console.log(`[team-server] Gemini keys: ${GEMINI_API_KEYS.length}, AssemblyAI: ${ASSEMBLYAI_API_KEY ? 'yes' : 'no'}, access codes: ${ACCESS_CODES.length}`);
});
