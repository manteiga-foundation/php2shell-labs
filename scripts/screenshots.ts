// Screenshots of the three views against the emulated scans. `bun run scripts/screenshots.ts <port> [outDir]`.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const port = process.argv[2] ?? '5190';
const out = process.argv[3] ?? 'docs/screenshots';
mkdirSync(out, { recursive: true });
const base = `http://127.0.0.1:${port}`;

const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });

async function shot(name: string, path: string, viewport: { width: number; height: number }, ready?: (page: import('playwright').Page) => Promise<void>, fullPage = false) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.goto(base + path);
  await page.waitForTimeout(600);
  if (ready) await ready(page);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage });
  console.log(`${out}/${name}.png`);
  await context.close();
}

const desktop = { width: 1440, height: 900 };
const phone = { width: 390, height: 844 };

await shot('entry-1440', '/', desktop);
await shot('entry-390', '/', phone);
for (const [name, host] of [
  ['no-patch', 'no-patch.example:80'],
  ['exposed', 'exposed.example'],
  ['hidden', 'hidden.example'],
  ['protected', 'protected.example'],
  ['not-php', 'not-php.example:80'],
] as const) {
  await shot(`report-${name}-1440`, `/scan?host=${encodeURIComponent(host)}&demo=${name}`, desktop, async (page) => {
    await page.getByTestId('next-step').waitFor({ timeout: 10000 });
    await page.waitForTimeout(900);
  }, name === 'no-patch');
}
await shot('report-no-patch-390', '/scan?host=no-patch.example:80&demo=no-patch', phone, async (page) => {
  await page.getByTestId('next-step').waitFor({ timeout: 10000 });
  await page.waitForTimeout(900);
}, true);
await shot('report-live-1440', '/scan?host=no-patch.example:80&demo=no-patch', desktop, async (page) => {
  await page.waitForTimeout(400);
});
await shot('metrics-1440', '/metrics?demo=1', desktop, async (page) => {
  await page.getByTestId('trend-day').first().waitFor();
  await page.waitForTimeout(600);
}, true);
await browser.close();
