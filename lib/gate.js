'use strict';
// Deterministic job filter. Hosted app is always approval-first: the gate only decides skip vs queue.
const CFG = {
  salaryFloor: 90000,
  queueMin: 60,
  include: ['devops', 'site reliability', 'sre', 'cloud engineer', 'cloud architect', 'platform engineer', 'infrastructure engineer', 'devsecops'],
  exclude: ['intern', 'junior', 'entry level', 'sales', 'recruiter', 'manager', 'director', 'head of', 'trainer'],
  blocklist: [],
};

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasWord = (list, text) => list.find((w) => new RegExp('(^|[^a-z])' + esc(w) + '($|[^a-z])', 'i').test(text));

// Highest annual figure in a pay string. Hourly figures (< 1000) are scaled by 2080. null if no figure.
function maxAnnual(salary) {
  const vals = [];
  const re = /(\d[\d,]*\.?\d*)\s*(k\b)?/gi;
  let m;
  while ((m = re.exec(String(salary || '')))) {
    let v = parseFloat(m[1].replace(/,/g, ''));
    if (!isFinite(v)) continue;
    if (m[2]) v *= 1000;
    else if (v < 1000) v *= 2080;
    if (v >= 10000) vals.push(v);
  }
  return vals.length ? Math.max(...vals) : null;
}

function decide({ title = '', company = '', location = '', salary = '', score = 0 }, cfg = CFG) {
  if (hasWord(cfg.blocklist, company)) return { decision: 'skip', reasons: ['company on blocklist'] };
  const bad = hasWord(cfg.exclude, title);
  if (bad) return { decision: 'skip', reasons: [`excluded title term: ${bad}`] };
  if (!hasWord(cfg.include, title)) return { decision: 'skip', reasons: ['title not in target list'] };
  const where = `${location} ${title}`;
  if (!/remote|anywhere|worldwide/i.test(where) || /hybrid|on-?site|in[- ]office/i.test(where)) {
    return { decision: 'skip', reasons: ['not strictly remote'] };
  }
  const usOk = !location || /usa|u\.s\.|united states|north america|americas|worldwide|anywhere|\bus\b/i.test(location);
  const nonUs = /europe|emea|\buk\b|united kingdom|canada|apac|asia|latam|india|germany|australia|brazil|philippines|poland|portugal|spain|france|netherlands|ireland/i.test(location);
  if (/europe|emea|\buk\b|canada|apac|india|bulgaria|germany|latam/i.test(title) && !/usa|united states|\bus\b/i.test(title)) return { decision: 'skip', reasons: ['not US-eligible'] };
  if (nonUs && !usOk) return { decision: 'skip', reasons: ['not US-eligible'] };
  const top = maxAnnual(salary);
  if (top !== null && top < cfg.salaryFloor) return { decision: 'skip', reasons: [`pay tops out at $${Math.round(top).toLocaleString('en-US')}, below $${cfg.salaryFloor.toLocaleString('en-US')} floor`] };
  if (score < cfg.queueMin) return { decision: 'skip', reasons: [`score ${score} below ${cfg.queueMin}`] };
  const reasons = [];
  if (top === null) reasons.push('salary not listed');
  return { decision: 'queue', reasons };
}

module.exports = { CFG, decide, maxAnnual };
