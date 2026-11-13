'use strict';
// Server-side job sources that offer public feeds or APIs. No scraping of sites that forbid it.
const UA = 'Autojobber/1.0 (personal job search; contact via account owner)';
const MAX_AGE_DAYS = 30;
const fresh = (d) => !d || isNaN(Date.parse(d)) || Date.now() - Date.parse(d) < MAX_AGE_DAYS * 864e5;
const strip = (h) => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&amp;|&#\d+;/g, ' ').replace(/\s+/g, ' ').trim();

async function getJson(url, headers = {}) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function remotive() {
  const out = [];
  for (const q of ['devops', 'site reliability', 'cloud engineer', 'platform engineer']) {
    const d = await getJson(`https://remotive.com/api/remote-jobs?search=${encodeURIComponent(q)}&limit=50`);
    for (const j of d.jobs || []) {
      out.push({ company: j.company_name, title: j.title, url: j.url, source: 'remotive', location: j.candidate_required_location || 'Remote',
        salary: j.salary || '', description: strip(j.description).slice(0, 6000), posted: j.publication_date });
    }
  }
  return out;
}

async function remoteok() {
  const d = await getJson('https://remoteok.com/api');
  return d.filter((j) => j && j.position).map((j) => ({
    company: j.company, title: j.position, url: j.url || `https://remoteok.com/remote-jobs/${j.slug}`, source: 'remoteok',
    location: j.location || 'Remote', salary: j.salary_min ? `$${j.salary_min}-$${j.salary_max}` : '',
    description: strip(j.description).slice(0, 6000), posted: j.date }));
}

async function weworkremotely() {
  const r = await fetch('https://weworkremotely.com/categories/remote-devops-sysadmin-jobs.rss', { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const xml = await r.text();
  const out = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const tag = (n) => ((m[1].match(new RegExp(`<${n}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${n}>`)) || [])[1] || '').trim();
    const full = tag('title');
    const i = full.indexOf(':');
    out.push({ company: i > 0 ? full.slice(0, i).trim() : 'Unknown', title: i > 0 ? full.slice(i + 1).trim() : full, url: tag('link'),
      source: 'weworkremotely', location: tag('region') || 'Remote', salary: '', description: strip(tag('description')).slice(0, 6000), posted: tag('pubDate') });
  }
  return out;
}

async function adzuna() {
  const id = process.env.ADZUNA_APP_ID, key = process.env.ADZUNA_APP_KEY;
  if (!id || !key) throw new Error('ADZUNA_APP_ID / ADZUNA_APP_KEY not set');
  const out = [];
  for (const q of ['senior devops engineer remote', 'site reliability engineer remote', 'azure devops engineer remote', 'cloud engineer remote', 'platform engineer remote']) {
    const d = await getJson(`https://api.adzuna.com/v1/api/jobs/us/search/1?app_id=${id}&app_key=${key}&results_per_page=50&what=${encodeURIComponent(q)}&salary_min=90000&max_days_old=${MAX_AGE_DAYS}&content-type=application/json`);
    for (const j of d.results || []) {
      const text = `${j.title} ${j.description}`;
      out.push({ company: (j.company || {}).display_name || 'Unknown', title: j.title, url: j.redirect_url, source: 'adzuna',
        location: /remote/i.test(text) ? `Remote (${(j.location || {}).display_name || 'US'})` : (j.location || {}).display_name || '',
        salary: j.salary_min ? `$${Math.round(j.salary_min)}-$${Math.round(j.salary_max)}` : '', description: strip(j.description), posted: j.created });
    }
  }
  return out;
}

const SOURCES = { remotive, remoteok, weworkremotely, adzuna };

async function fetchAll() {
  const jobs = [];
  const report = [];
  for (const [name, fn] of Object.entries(SOURCES)) {
    try {
      const rows = (await fn()).filter((j) => j.title && j.url && fresh(j.posted));
      jobs.push(...rows);
      report.push({ source: name, fetched: rows.length });
    } catch (e) {
      report.push({ source: name, fetched: 0, error: String(e.message || e) });
    }
  }
  return { jobs, report };
}

module.exports = { fetchAll, SOURCES };
