'use strict';
// Postgres store (DATABASE_URL) with an in-memory fallback for local runs and tests.
const FIELDS = ['key', 'company', 'title', 'url', 'source', 'location', 'salary', 'score', 'notes', 'status', 'agent_note', 'created_at', 'updated_at', 'approved_at'];

function memoryStore() {
  const jobs = new Map();
  let runs = [];
  return {
    async init() {},
    async list() { return [...jobs.values()].sort((a, b) => (b.score || 0) - (a.score || 0)); },
    async get(key) { return jobs.get(key) || null; },
    async insertNew(j) {
      if (jobs.has(j.key)) return false;
      const now = new Date().toISOString();
      jobs.set(j.key, { agent_note: '', approved_at: null, ...j, created_at: now, updated_at: now });
      return true;
    },
    async setStatus(key, status, note) {
      const j = jobs.get(key);
      if (!j) return null;
      j.status = status; j.updated_at = new Date().toISOString();
      if (status === 'approved') j.approved_at = j.updated_at;
      j.agent_note = note || '';
      return j;
    },
    async logRun(r) { runs.unshift({ ...r, at: new Date().toISOString() }); runs = runs.slice(0, 50); },
    async lastRun() { return runs[0] || null; },
  };
}

function pgStore(url) {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: url, ssl: /render\.com|sslmode=require/.test(url) ? { rejectUnauthorized: false } : false });
  const cols = FIELDS.join(',');
  return {
    async init() {
      await pool.query(`CREATE TABLE IF NOT EXISTS jobs (
        key TEXT PRIMARY KEY, company TEXT, title TEXT, url TEXT, source TEXT, location TEXT, salary TEXT,
        score INT, notes TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'queued', agent_note TEXT DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(), approved_at TIMESTAMPTZ)`);
      await pool.query(`CREATE TABLE IF NOT EXISTS runs (id SERIAL PRIMARY KEY, at TIMESTAMPTZ DEFAULT now(), summary JSONB)`);
    },
    async list() { return (await pool.query(`SELECT ${cols} FROM jobs ORDER BY score DESC NULLS LAST, created_at DESC`)).rows; },
    async get(key) { return (await pool.query(`SELECT ${cols} FROM jobs WHERE key=$1`, [key])).rows[0] || null; },
    async insertNew(j) {
      const r = await pool.query(
        `INSERT INTO jobs (key,company,title,url,source,location,salary,score,notes,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (key) DO NOTHING`,
        [j.key, j.company, j.title, j.url, j.source, j.location, j.salary, j.score, j.notes, j.status]);
      return r.rowCount === 1;
    },
    async setStatus(key, status, note) {
      const r = await pool.query(
        `UPDATE jobs SET status=$2, agent_note=$3, updated_at=now(), approved_at=CASE WHEN $2='approved' THEN now() ELSE approved_at END WHERE key=$1 RETURNING ${cols}`,
        [key, status, note || '']);
      return r.rows[0] || null;
    },
    async logRun(r) { await pool.query('INSERT INTO runs (summary) VALUES ($1)', [JSON.stringify(r)]); },
    async lastRun() {
      const r = (await pool.query('SELECT at, summary FROM runs ORDER BY id DESC LIMIT 1')).rows[0];
      return r ? { ...r.summary, at: r.at } : null;
    },
  };
}

module.exports = { createStore: () => (process.env.DATABASE_URL ? pgStore(process.env.DATABASE_URL) : memoryStore()), memoryStore };
