'use strict';
const crypto = require('crypto');
const path = require('path');
const express = require('express');
const { createStore } = require('./lib/store');
const { runSearch } = require('./lib/run');

const PORT = process.env.PORT || 3000;
const PASSWORD = process.env.APP_PASSWORD || '';
const SECRET = process.env.SESSION_SECRET || '';
const AGENT_TOKEN = process.env.AGENT_TOKEN || '';
const PROD = process.env.NODE_ENV === 'production';
if (PROD && (!PASSWORD || SECRET.length < 16 || AGENT_TOKEN.length < 16)) {
  console.error('Set APP_PASSWORD, SESSION_SECRET (16+ chars) and AGENT_TOKEN (16+ chars).');
  process.exit(1);
}

const STATUSES = ['queued', 'approved', 'applying', 'ready', 'blocked', 'applied', 'skipped'];
const store = createStore();
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: false, limit: '5kb' }));

const eq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const sign = (v) => crypto.createHmac('sha256', SECRET || 'dev-secret').update(v).digest('hex');
const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]));
function authed(req) {
  const [ts, sig] = String(cookies(req).aj || '').split('.');
  return !!ts && !!sig && eq(sig, sign(ts)) && Date.now() - Number(ts) < 30 * 864e5;
}
const needSession = (req, res, next) => (authed(req) ? next() : res.status(401).json({ error: 'login required' }));
const bearer = (token) => (req, res, next) => {
  const t = (req.headers.authorization || '').replace(/^Bearer /, '');
  return token && eq(t, token) ? next() : res.status(401).json({ error: 'bad token' });
};

const loginPage = (err) => `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Autojobber</title>
<style>body{font:16px system-ui;display:grid;place-items:center;min-height:100vh;margin:0;background:#fbfbfa;color:#1d2227}
form{display:grid;gap:12px;width:min(320px,90vw)}input,button{font:inherit;padding:10px;border-radius:6px;border:1px solid #ccd}
button{background:#0a63c9;color:#fff;border-color:#0a63c9;cursor:pointer}p{color:#b3261e;margin:0}</style>
<form method=post action=/login><h1>Autojobber</h1>${err ? '<p>Wrong password.</p>' : ''}<input type=password name=password placeholder=Password autofocus required><button>Sign in</button></form>`;

app.get('/healthz', (req, res) => res.send('ok'));
app.get('/', (req, res) => (authed(req) ? res.sendFile(path.join(__dirname, 'public', 'index.html')) : res.status(200).send(loginPage(false))));
app.post('/login', (req, res) => {
  if (PASSWORD && eq(req.body.password || '', PASSWORD)) {
    const ts = String(Date.now());
    res.setHeader('Set-Cookie', `aj=${ts}.${sign(ts)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 86400}${PROD ? '; Secure' : ''}`);
    return res.redirect('/');
  }
  return res.status(401).send(loginPage(true));
});
app.post('/logout', (req, res) => { res.setHeader('Set-Cookie', 'aj=; Path=/; Max-Age=0'); res.redirect('/'); });

app.get('/api/jobs', needSession, async (req, res) => res.json({ jobs: await store.list(), lastRun: await store.lastRun() }));
app.post('/api/jobs/:key/status', needSession, async (req, res) => {
  const { status, note } = req.body || {};
  if (!STATUSES.includes(status)) return res.status(400).json({ error: 'bad status' });
  const job = await store.setStatus(req.params.key, status, String(note || '').slice(0, 500));
  return job ? res.json({ job }) : res.status(404).json({ error: 'no such job' });
});

let running = false;
async function search() {
  if (running) return { busy: true };
  running = true;
  try { return await runSearch(store); } finally { running = false; }
}
app.post('/api/search', needSession, async (req, res) => { try { res.json(await search()); } catch (e) { res.status(500).json({ error: String(e.message) }); } });

// Used by the Claude in Chrome agent that fills in applications.
app.get('/api/agent/approved', bearer(AGENT_TOKEN), async (req, res) => res.json({ jobs: (await store.list()).filter((j) => j.status === 'approved') }));
app.post('/api/agent/jobs/:key', bearer(AGENT_TOKEN), async (req, res) => {
  const { status, note } = req.body || {};
  if (!['applying', 'ready', 'blocked'].includes(status)) return res.status(400).json({ error: 'agents may only set applying, ready or blocked' });
  const job = await store.setStatus(req.params.key, status, String(note || '').slice(0, 500));
  return job ? res.json({ job }) : res.status(404).json({ error: 'no such job' });
});

// Daily search at 12:07 UTC (7:07am Eastern), plus a catch-up if the server was asleep.
async function tick() {
  const now = new Date();
  if (now.getUTCHours() * 60 + now.getUTCMinutes() < 12 * 60 + 7) return;
  const last = await store.lastRun();
  if (last && new Date(last.at).toISOString().slice(0, 10) === now.toISOString().slice(0, 10)) return;
  try { console.log('daily search', JSON.stringify(await search())); } catch (e) { console.error('daily search failed', e.message); }
}

if (require.main === module) {
  store.init().then(() => {
    app.listen(PORT, () => console.log(`Autojobber on ${PORT}`));
    setInterval(() => tick().catch((e) => console.error(e.message)), 60000);
  }).catch((e) => { console.error('startup failed', e); process.exit(1); });
}
module.exports = { app, store };
