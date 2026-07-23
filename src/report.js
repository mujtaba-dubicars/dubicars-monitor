import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const RUNS_DIR = process.env.RUN_OUT_DIR || 'docs/runs';
const OUT = process.env.REPORT_OUT || 'docs/index.html';
const RETENTION_DAYS = Number(process.env.RETENTION_DAYS || 1);
const TEMPLATE = path.join(__dirname, 'report-template.html');

// Load run files, pruning (and deleting) anything older than the retention window.
function loadRuns() {
  if (!fs.existsSync(RUNS_DIR)) return [];
  const cutoff = Date.now() - RETENTION_DAYS * 86400 * 1000;
  const runs = [];
  for (const f of fs.readdirSync(RUNS_DIR)) {
    if (!f.endsWith('.json')) continue;
    const full = path.join(RUNS_DIR, f);
    let obj;
    try {
      obj = JSON.parse(fs.readFileSync(full, 'utf8'));
    } catch {
      continue;
    }
    const t = Date.parse(obj.timestamp);
    if (Number.isNaN(t)) continue;
    if (t < cutoff) {
      fs.unlinkSync(full); // prune old run
      continue;
    }
    runs.push(obj);
  }
  runs.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)); // newest first
  return runs;
}

function windowLabel(days) {
  if (days <= 1) return 'last 24 hours';
  if (days < 1) return `last ${Math.round(days * 24)} hours`;
  return `last ${days} days`;
}

function build(runs) {
  const template = fs.readFileSync(TEMPLATE, 'utf8');
  // Escape "<" so any "</script>" or "<" inside data can't break the inline script.
  const runsJson = JSON.stringify(runs).replace(/</g, '\\u003c');
  return template
    .replace('__RUNS__', runsJson)
    .replace('__GENERATED__', new Date().toISOString())
    .replace(/__WINDOW__/g, windowLabel(RETENTION_DAYS));
}

const runs = loadRuns();
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, build(runs));
// Serve raw HTML as-is on GitHub Pages (skip Jekyll processing).
fs.writeFileSync(path.join(path.dirname(OUT), '.nojekyll'), '');
console.log(`Report built: ${OUT} (${runs.length} run(s), ${RETENTION_DAYS}-day window)`);
