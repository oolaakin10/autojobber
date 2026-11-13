'use strict';
const { decide } = require('./gate');
const { scoreJob } = require('./score');
const { fetchAll } = require('./search');

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const keyOf = (j) => `${slug(j.company)}_${slug(j.title)}`;

// Fetch, filter, score and store new jobs. Only jobs that pass the gate are stored.
async function runSearch(store, fetcher = fetchAll) {
  const { jobs, report } = await fetcher();
  const skips = {};
  let added = 0, duplicates = 0;
  const seen = new Set();
  for (const j of jobs) {
    const key = keyOf(j);
    if (seen.has(key)) continue;
    seen.add(key);
    const { score, hits } = scoreJob(j.title, j.description);
    const d = decide({ ...j, score });
    if (d.decision === 'skip') { const r = d.reasons[0].replace(/\$[\d,]+/g, '$'); skips[r] = (skips[r] || 0) + 1; continue; }
    const notes = [`Provisional score from title and posting text. Matched: ${hits.slice(0, 8).join(', ') || 'none'}.`, ...d.reasons.map((r) => r)]
      .join(' ');
    const created = await store.insertNew({ key, company: j.company, title: j.title, url: j.url, source: j.source, location: j.location,
      salary: j.salary, score, notes, status: 'queued' });
    if (created) added++; else duplicates++;
  }
  const summary = { added, duplicates, skipped: skips, sources: report };
  await store.logRun(summary);
  return summary;
}

module.exports = { runSearch, keyOf };
