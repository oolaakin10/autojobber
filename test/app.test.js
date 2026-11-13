'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { decide, maxAnnual } = require('../lib/gate');
const { scoreJob } = require('../lib/score');
const { runSearch } = require('../lib/run');
const { memoryStore } = require('../lib/store');

test('maxAnnual parses ranges, k, hourly', () => {
  assert.strictEqual(maxAnnual('$133,100-$170,900'), 170900);
  assert.strictEqual(maxAnnual('from $100,000 a year'), 100000);
  assert.strictEqual(maxAnnual('$90k - $120k'), 120000);
  assert.strictEqual(maxAnnual('$30 - $40 an hour'), 83200);
  assert.strictEqual(maxAnnual(''), null);
});
test('gate: remote only, salary floor, titles', () => {
  const ok = { title: 'Senior Azure DevOps Engineer', company: 'A', location: 'Remote', salary: '$120,000', score: 80 };
  assert.strictEqual(decide(ok).decision, 'queue');
  assert.strictEqual(decide({ ...ok, location: 'Atlanta, GA' }).decision, 'skip');
  assert.strictEqual(decide({ ...ok, location: 'Remote or hybrid in Dallas' }).decision, 'skip');
  assert.strictEqual(decide({ ...ok, salary: '$70,000-$89,000' }).decision, 'skip');
  assert.strictEqual(decide({ ...ok, salary: '$80,000-$120,000' }).decision, 'queue');
  assert.strictEqual(decide({ ...ok, title: 'DevOps Engineer - AI Trainer' }).decision, 'skip');
  assert.strictEqual(decide({ ...ok, title: 'Account Executive' }).decision, 'skip');
  assert.strictEqual(decide({ ...ok, location: 'Europe' }).decision, 'skip');
  assert.strictEqual(decide({ ...ok, salary: '' }).decision, 'queue');
  assert.match(decide({ ...ok, salary: '' }).reasons[0], /salary not listed/);
  assert.strictEqual(decide({ ...ok, score: 50 }).decision, 'skip');
});
test('score rewards matching skills', () => {
  const hi = scoreJob('Senior Azure DevOps Engineer', 'terraform kubernetes aks ansible github actions ci/cd');
  const lo = scoreJob('DevOps Engineer', 'php wordpress');
  assert.ok(hi.score > lo.score && hi.score >= 80);
});
test('runSearch stores only passing jobs and dedupes', async () => {
  const store = memoryStore();
  const rows = [
    { company: 'Good Co', title: 'Senior Azure DevOps Engineer', url: 'u1', source: 't', location: 'Remote', salary: '$130,000', description: 'terraform azure devops kubernetes' },
    { company: 'Good Co', title: 'Senior Azure DevOps Engineer', url: 'u1', source: 't', location: 'Remote', salary: '$130,000', description: '' },
    { company: 'Low Co', title: 'DevOps Engineer', url: 'u2', source: 't', location: 'Remote', salary: '$60,000', description: 'azure' },
    { company: 'Office Co', title: 'DevOps Engineer', url: 'u3', source: 't', location: 'Austin, TX', salary: '$150,000', description: 'azure' },
  ];
  const fetcher = async () => ({ jobs: rows, report: [] });
  const s1 = await runSearch(store, fetcher);
  assert.strictEqual(s1.added, 1);
  assert.strictEqual((await store.list()).length, 1);
  const s2 = await runSearch(store, fetcher);
  assert.strictEqual(s2.added, 0);
  assert.strictEqual(s2.duplicates, 1);
});
test('http: login required, status updates, agent limited', async () => {
  process.env.APP_PASSWORD = 'pw'; process.env.AGENT_TOKEN = 'agent-token-agent-token';
  delete require.cache[require.resolve('../server')];
  const { app, store } = require('../server');
  await store.insertNew({ key: 'k1', company: 'C', title: 'T', url: 'u', source: 's', location: 'Remote', salary: '', score: 90, notes: '', status: 'queued' });
  const srv = app.listen(0);
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    assert.strictEqual((await fetch(base + '/api/jobs')).status, 401);
    const bad = await fetch(base + '/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'password=nope', redirect: 'manual' });
    assert.strictEqual(bad.status, 401);
    const good = await fetch(base + '/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'password=pw', redirect: 'manual' });
    assert.strictEqual(good.status, 302);
    const cookie = good.headers.get('set-cookie').split(';')[0];
    const H = { cookie, 'Content-Type': 'application/json' };
    assert.strictEqual((await fetch(base + '/api/jobs/k1/status', { method: 'POST', headers: H, body: JSON.stringify({ status: 'approved' }) })).status, 200);
    assert.strictEqual((await fetch(base + '/api/jobs/k1/status', { method: 'POST', headers: H, body: JSON.stringify({ status: 'bogus' }) })).status, 400);
    const A = { Authorization: 'Bearer agent-token-agent-token', 'Content-Type': 'application/json' };
    const approved = await (await fetch(base + '/api/agent/approved', { headers: A })).json();
    assert.strictEqual(approved.jobs.length, 1);
    assert.strictEqual((await fetch(base + '/api/agent/jobs/k1', { method: 'POST', headers: A, body: JSON.stringify({ status: 'applied' }) })).status, 400);
    assert.strictEqual((await fetch(base + '/api/agent/jobs/k1', { method: 'POST', headers: A, body: JSON.stringify({ status: 'ready', note: 'filled' }) })).status, 200);
    assert.strictEqual((await fetch(base + '/api/agent/approved')).status, 401);
  } finally { srv.close(); }
});
