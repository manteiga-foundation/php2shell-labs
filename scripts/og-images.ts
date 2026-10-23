// Link-preview images, one per stage plus the default: 1200x630, rendered from a template in
// Chromium. `bun run scripts/og-images.ts` writes web/public/og/*.png.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

interface Card {
  word: string;
  colour: string;
  line: string;
  score: string;
  /** The title on the right, with the stage word coloured; the ring's fill and caption when they differ from the score. */
  h1?: string;
  pct?: number;
  of?: string;
}

const STAGES: Record<string, Card> = {
  default: { word: 'IS YOUR SERVER EXPOSED?', colour: '#e0b85c', line: 'Test any public host for PHP2Shell (CVE-2026-109618, CVE-2026-109619).', score: '' },
  'no-patch': { word: 'NO PATCH', colour: '#e05a4f', h1: 'This host has <span style="color:#e05a4f">no patch</span>', line: 'PHP 5.4 through 8.1: inside the affected range on an end-of-life branch. Only an upgrade removes the flaw.', score: '15' },
  exposed: { word: 'EXPOSED', colour: '#e8775f', h1: 'This host is <span style="color:#e8775f">exposed</span>', line: 'Inside the affected range, and a fixed release exists for the branch.', score: '35' },
  hidden: { word: 'HIDDEN', colour: '#e0b85c', h1: 'This host <span style="color:#e0b85c">hides</span> its PHP version', line: 'PHP runs but hides its version. Treated as exposed until known otherwise.', score: '50' },
  'not-affected': { word: 'NOT AFFECTED', colour: '#43b48a', h1: 'This host is <span style="color:#43b48a">not affected</span>', line: 'PHP older than 5.4: the vulnerable code does not exist in it.', score: '80' },
  protected: { word: 'PROTECTED', colour: '#8fe0c0', h1: 'This host is <span style="color:#8fe0c0">protected</span>', line: 'A fixed PHP release (8.5.12, 8.4.27, 8.3.36, 8.2.35) or newer.', score: '100' },
  'not-php': { word: 'NOT PHP', colour: '#9aa8d8', h1: 'This host is <span style="color:#9aa8d8">not PHP</span>', line: 'Nothing on this host answered as PHP. PHP2Shell does not apply to it.', score: '' },
  unreachable: { word: 'UNREACHABLE', colour: '#6b7698', h1: 'This host is <span style="color:#6b7698">unreachable</span>', line: 'No web server answered at this address.', score: '' },
};

function html(stage: string): string {
  const s = STAGES[stage];
  const isDefault = stage === 'default';
  const pct = s.pct ?? (s.score ? Number(s.score) : 100);
  const C = 2 * Math.PI * 150;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;width:1200px;height:630px;background:#060c22;color:#eef2ff;font-family:'Titillium Web','Helvetica Neue',Arial,sans-serif;position:relative;overflow:hidden}
  .grid{position:absolute;inset:0;background-image:linear-gradient(rgba(120,140,220,.10) 1px,transparent 1px),linear-gradient(90deg,rgba(120,140,220,.10) 1px,transparent 1px);background-size:48px 48px}
  .glow{position:absolute;inset:0;background:radial-gradient(ellipse at 20% 50%,rgba(16,52,166,.55),transparent 55%)}
  .ring{position:absolute;left:90px;top:115px;width:400px;height:400px}
  .ring svg{transform:rotate(-90deg)}
  .centre{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px}
  .word{font-weight:700;letter-spacing:.14em;font-size:${s.word.length > 10 ? 26 : s.word.length > 7 ? 30 : 40}px;color:${s.colour};text-align:center;padding:0 40px}
  .num{font-family:JetBrains Mono,Menlo,monospace;font-size:84px;line-height:1}
  .of{font-size:16px;letter-spacing:.2em;color:#9aa8d8}
  .text{position:absolute;left:560px;top:150px;width:560px}
  .brand{font-size:22px;letter-spacing:.14em;text-transform:uppercase;color:#c7d0f0;display:flex;align-items:center;gap:14px}
  .mark{width:26px;height:26px;border:3px solid #e0b85c;border-radius:50%;box-shadow:inset 0 0 0 5px #060c22,inset 0 0 0 7px #6f86d6}
  h1{font-size:${isDefault ? 64 : 54}px;line-height:1.1;margin:28px 0 20px;font-weight:700}
  p{font-size:26px;line-height:1.35;color:#c7d0f0;margin:0}
  .url{position:absolute;left:560px;bottom:60px;font-size:22px;color:#e0b85c;letter-spacing:.04em}
  </style></head><body><div class="grid"></div><div class="glow"></div>
  <div class="ring"><svg viewBox="0 0 400 400" width="400" height="400">
    <circle cx="200" cy="200" r="190" fill="none" stroke="rgba(150,170,230,.35)" stroke-width="2" stroke-dasharray="3 9"/>
    <circle cx="200" cy="200" r="150" fill="none" stroke="rgba(150,170,230,.18)" stroke-width="10"/>
    <circle cx="200" cy="200" r="150" fill="none" stroke="${s.colour}" stroke-width="16" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct / 100)}"/>
  </svg><div class="centre">${isDefault ? `<div class="word" style="font-size:34px">PHP2SHELL<br>LABS</div>` : `<div class="word">${s.word}</div>${s.score ? `<div class="num">${s.score}</div><div class="of">${s.of ?? 'OF 100'}</div>` : ''}`}</div></div>
  <div class="text"><div class="brand"><span class="mark"></span>PHP2Shell Labs</div>
  <h1>${s.h1 ?? (isDefault ? 'Is your server exposed to PHP2Shell?' : `This host is <span style="color:${s.colour}">${s.word.toLowerCase()}</span>`)}</h1>
  <p>${s.line}</p></div>
  <div class="url">php2shell labs · manteiga.org</div>
  </body></html>`;
}

mkdirSync('web/public/og', { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
for (const stage of Object.keys(STAGES)) {
  await page.setContent(html(stage));
  await page.waitForTimeout(150);
  await page.screenshot({ path: `web/public/og/${stage}.png` });
  console.log(`web/public/og/${stage}.png`);
}
await browser.close();
