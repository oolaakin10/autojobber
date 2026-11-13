'use strict';
// Provisional fit score from the title and posting text, based on skills that appear on the resume.
const SKILLS = [['azure devops', 6], ['azure', 4], ['terraform', 4], ['kubernetes', 3], ['aks', 3], ['ansible', 3], ['github actions', 3],
  ['jenkins', 2], ['argocd', 3], ['helm', 2], ['gitops', 3], ['ci/cd', 3], ['devsecops', 3], ['docker', 2], ['aws', 2], ['prometheus', 2],
  ['grafana', 2], ['powershell', 1], ['python', 1], ['bash', 1], ['key vault', 2], ['arm template', 2], ['xl release', 3], ['xl deploy', 3],
  ['openshift', 2], ['entra', 1]];

function scoreJob(title, text) {
  const t = String(title || '').toLowerCase();
  const body = `${t} ${String(text || '').toLowerCase()}`;
  let s = 45;
  if (/senior|sr\./.test(t)) s += 8;
  if (/azure/.test(t)) s += 10;
  if (/devops|devsecops|sre|site reliability|platform|cloud/.test(t)) s += 8;
  const hits = [];
  let bonus = 0;
  for (const [k, w] of SKILLS) if (body.includes(k)) { bonus += w; hits.push(k); }
  s += Math.min(bonus, 30);
  if (/staff|principal|\blead\b/.test(t)) s -= 8;
  if (/ts\/sci|security clearance|secret clearance|active clearance/.test(body)) s -= 15;
  return { score: Math.max(0, Math.min(100, Math.round(s))), hits };
}

module.exports = { scoreJob };
