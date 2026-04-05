import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Calculate Lines of Code inside src/ and ui/ (excluding unnecessary assets)
function countLines(dir) {
  let total = 0;
  let files;
  try {
    files = readdirSync(dir);
  } catch (e) {
    return 0; // directory might not exist yet
  }
  
  for (const f of files) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) {
      total += countLines(p);
    } else if (p.endsWith('.ts') || p.endsWith('.js') || p.endsWith('.css') || p.endsWith('.html')) {
      const content = readFileSync(p, 'utf-8');
      total += content.split('\n').length;
    }
  }
  return total;
}

const locSrc = countLines('./src');
const locUi = countLines('./ui');
const totalLoc = locSrc + locUi;

console.log(`[Metric Update] Current SoulClaw LOC: ${totalLoc.toLocaleString()}`);

const OPENCLAW_LOC = 562804;
const roi = ((totalLoc / OPENCLAW_LOC) * 100).toFixed(2);

// UPDATE ui/index.html
let html = readFileSync('./ui/index.html', 'utf-8');
html = html.replace(
  /<div style="font-size:1\.8rem; font-weight:900; color:#2e7d32">[\d,]+<\/div>/, 
  `<div style="font-size:1.8rem; font-weight:900; color:#2e7d32">${totalLoc.toLocaleString()}</div>`
);
html = html.replace(
  /<div style="font-size:1\.5rem; font-weight:700; color:#c62828">[\d.]+%(?:[^<]*)<\/div>/, 
  `<div style="font-size:1.5rem; font-weight:700; color:#c62828">${roi}%</div>`
);
writeFileSync('./ui/index.html', html, 'utf-8');

// UPDATE DESIGN-EN.md
let design = readFileSync('./SoulClaw-docs/DESIGN-EN.md', 'utf-8');
design = design.replace(/\*\*Current [\d,]+ Lines\*\*/g, `**Current ${totalLoc.toLocaleString()} Lines**`);
writeFileSync('./SoulClaw-docs/DESIGN-EN.md', design, 'utf-8');

// UPDATE 00-design.md (Chinese version)
try {
  let zhDesign = readFileSync('./SoulClaw-docs/zh/00-design.md', 'utf-8');
  zhDesign = zhDesign.replace(/\*\*目前代码量(.*?)([\d,]+) 行\*\*/g, `**目前代码量$1${totalLoc.toLocaleString()} 行**`);
  writeFileSync('./SoulClaw-docs/zh/00-design.md', zhDesign, 'utf-8');
} catch(e) {}

// Optional configuration in JSON format for the UI panel (future proofing)
console.log(`[Metric Update] Efficiency ROI stands at ${roi}% compared to OpenClaw's massive ${OPENCLAW_LOC.toLocaleString()} codebase.`);
