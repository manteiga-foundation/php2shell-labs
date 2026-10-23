import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { chromium, type Browser, type Locator, type Page } from 'playwright';
import { MESSAGES } from '../web/src/i18n/messages';
import { startVite, type ViteServer } from './vite';

// The views, in real Chromium, against the emulated scans (?demo=<fixture> replays a recorded
// event stream with short delays, so the live behaviour is deterministic and offline).

let vite: ViteServer;
let browser: Browser;

async function open(path: string, viewport = { width: 1440, height: 900 }, locale = 'en-US'): Promise<{ page: Page; errors: string[] }> {
  const context = await browser.newContext({ viewport, locale });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(vite.url + path);
  return { page, errors };
}

/** Waits until the locator's first match is visible and carries the text (Arwes keeps entering nodes hidden). */
async function see(locator: Locator, text?: string | RegExp, timeout = 10000): Promise<void> {
  const target = text === undefined ? locator.first() : locator.filter({ hasText: text }).first();
  await target.waitFor({ state: 'visible', timeout });
}

const exact = (s: string) => new RegExp(`^\\s*${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);

beforeAll(async () => {
  vite = await startVite();
  browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
});
afterAll(async () => {
  await browser?.close();
  vite?.stop();
});

describe('view 1: entry', () => {
  test('the question, one field, one button, the consent box off; nothing starts without a valid host', async () => {
    const { page, errors } = await open('/');
    await see(page.getByRole('heading', { level: 1 }), exact('Is your server exposed to PHP2Shell?'));
    // The top bar: the name with "By Manteiga Foundation" small under it; Source, How we score, API, each with an icon.
    await see(page.getByTestId('byline'), exact('By Manteiga Foundation'));
    expect(await page.getByTestId('byline').getAttribute('href')).toBe('https://manteiga.org');
    const nav = page.getByRole('navigation', { name: 'Site' });
    expect(await nav.getByRole('link').allTextContents()).toEqual(['Source', 'How we score', 'API']);
    expect(await nav.locator('a svg').count()).toBe(3);
    expect(await nav.getByRole('link', { name: 'Source' }).getAttribute('href')).toBe('https://github.com/manteiga-foundation/php2shell-labs');
    expect(await nav.getByRole('link', { name: 'API' }).getAttribute('href')).toBe('/api');
    expect(await page.getByRole('contentinfo').getByRole('link', { name: 'Manteiga Foundation' }).getAttribute('href')).toBe('https://manteiga.org');
    // The consent box: a real checkbox, off by default, with the 48 MB disclosure beside it.
    const consent = page.getByTestId('consent');
    await see(consent);
    expect(await consent.isChecked()).toBe(false);
    await see(page.getByText(/about 48 MB/));
    // Below the field: the questions people ask, answered in a list, "what is PHP2Shell" first.
    await see(page.getByRole('heading', { name: 'Questions' }));
    const questions = page.getByTestId('faq-question');
    expect(await questions.count()).toBe(8);
    await see(questions.first(), /What is PHP2Shell/);
    await see(page.getByTestId('faq'), /CVE-2026-109618/);
    await see(page.getByTestId('faq'), /--private/);
    const field = page.getByRole('textbox', { name: 'Host' });
    await see(field);
    await see(page.getByRole('button', { name: 'Test' }));
    await field.fill('not a host');
    await page.getByRole('button', { name: 'Test' }).click();
    await see(page.getByRole('alert'), /not a valid host name/);
    expect(page.url()).toBe(vite.url + '/');
    expect(errors).toEqual([]);
    await page.context().close();
  });

  test('ticking the consent box carries it into the scan address; an http:// paste means port 80', async () => {
    const { page, errors } = await open('/?demo=no-patch');
    const field = page.getByRole('textbox', { name: 'Host' });
    await see(field);
    await field.fill('http://no-patch.example/index.php');
    await page.getByTestId('consent').check();
    await field.press('Enter');
    await see(page.getByTestId('ring'));
    expect(new URL(page.url()).search).toBe('?host=no-patch.example%3A80&validate=1&demo=no-patch');
    expect(errors).toEqual([]);
    await page.context().close();
  });

  test('the page carries the words a search engine and a link preview need', async () => {
    const { page } = await open('/');
    expect(await page.title()).toContain('PHP2Shell Labs');
    expect(await page.locator('meta[name="description"]').getAttribute('content')).toContain('CVE-2026-109618');
    expect(await page.locator('meta[property="og:title"]').getAttribute('content')).toContain('PHP2Shell');
    expect(await page.locator('meta[property="og:image"]').getAttribute('content')).toBeTruthy();
    await see(page.getByText(/one ordinary visit to the host you enter/i));
    await page.context().close();
  });
});

describe('view 2: the live report', () => {
  test('Enter starts the scan; the ring lands on the stage word; the validation evidence reads as a warning', async () => {
    const { page, errors } = await open('/?demo=no-patch');
    const field = page.getByRole('textbox', { name: 'Host' });
    await see(field);
    await field.fill('no-patch.example:80');
    await field.press('Enter');
    await see(page.getByTestId('ring'));
    const words: string[] = [];
    for (let i = 0; i < 80; i++) {
      const w = ((await page.getByTestId('stage-word').textContent()) ?? '').trim();
      if (w && words.at(-1) !== w) words.push(w);
      if (w === 'NO PATCH' && (await page.getByTestId('next-step').count()) > 0) break;
      await page.waitForTimeout(50);
    }
    expect(words.at(-1)).toBe('NO PATCH');
    expect(words[0]).toBe('UNREACHABLE'); // the ring starts empty and settles once the host has answered
    await see(page.getByTestId('score'), exact('15'));
    await see(page.getByRole('heading', { level: 1 }), exact('Exposed to PHP2Shell'));
    await see(page.getByTestId('verdict'), /no patch available/);
    await see(page.getByTestId('next-step'), /Upgrade to a supported PHP branch/);
    await see(page.getByRole('heading', { name: 'Recommendations' }));
    await see(page.getByRole('heading', { name: 'Technical details' }));
    await see(page.getByTestId('version-card'), /PHP 7\.1\.26/);
    await see(page.getByTestId('version-card'), /end-of-life/);
    await see(page.getByTestId('validation-card'), /Bailout reproduced/);
    await see(page.getByTestId('validation-card'), /empty 200/);
    // The reproduced bailout is amber, the colour of a warning, never the green of a pass.
    const stateColor = await page.evaluate("getComputedStyle(document.querySelector('[data-testid=validation-card] .state')).color");
    const hiddenColor = await page.evaluate("(() => { const s = document.createElement('span'); s.style.color = 'var(--stage-hidden)'; document.body.appendChild(s); const c = getComputedStyle(s).color; s.remove(); return c; })()");
    expect(stateColor).toBe(hiddenColor);
    expect(await page.getByTestId('probe-row').count()).toBe(3);
    await see(page.getByRole('button', { name: 'Download report' }));
    // The PDF is prepared while the dialog is open, with a visible progress state (the renderer can
    // take seconds when cold); the download itself is a blob, so the tab never navigates away.
    await page.route('**/api/report/*.pdf', async (route) => {
      await new Promise((r) => setTimeout(r, 1200));
      await route.fulfill({ status: 200, contentType: 'application/pdf', headers: { 'content-disposition': 'attachment; filename="php2shell-exposure-no-patch.example.pdf"' }, body: '%PDF-1.4 fake' });
    });
    await page.getByRole('button', { name: 'Download report' }).click();
    await see(page.getByRole('dialog'), /five-page PDF/);
    await see(page.getByTestId('pdf-progress'), /Preparing/);
    expect(await page.getByTestId('download-only').isDisabled()).toBe(true);
    await see(page.getByTestId('download-only'), exact('Download PDF'), 15000);
    expect(await page.getByTestId('download-only').isDisabled()).toBe(false);
    await see(page.getByTestId('pdf-progress'), /ready/i);
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download-only').click()]);
    expect(download.suggestedFilename()).toBe('php2shell-exposure-no-patch.example.pdf');
    expect(page.url()).toContain('/scan?host=no-patch.example'); // the tab stayed on the report
    expect(errors).toEqual([]);
    await page.context().close();
  });

  test('a protected host reads "Not exposed"; without consent the validation card says not run and the recommendations do not ask for it', async () => {
    const { page } = await open('/scan?host=protected.example&demo=protected');
    await see(page.getByTestId('stage-word'), exact('PROTECTED'));
    await see(page.getByTestId('score'), exact('100'));
    await see(page.getByRole('heading', { level: 1 }), exact('Not exposed'));
    await see(page.getByTestId('next-step'), /Nothing to do today/);
    await see(page.getByTestId('validation-card'), /Not run/);
    expect(await page.getByTestId('validation-card').textContent()).not.toMatch(/reproduced/i);
    expect(await page.getByText('The validation did not run').count()).toBe(0);
    expect(await page.getByTestId('probe-row').count()).toBe(2);
    await page.context().close();
  });

  test('an exposed host without consent is told how to reproduce the condition; a host that is not PHP shows no number', async () => {
    const { page } = await open('/scan?host=exposed.example&demo=exposed');
    await see(page.getByTestId('stage-word'), exact('EXPOSED'));
    await see(page.getByTestId('next-step'), /Install your branch/);
    await see(page.getByTestId('version-card'), /Fixed in: 8\.2\.35/);
    await see(page.getByText('The validation did not run'));
    await page.goto(vite.url + '/scan?host=not-php.example:80&demo=not-php');
    await see(page.getByTestId('stage-word'), exact('NOT PHP'));
    await see(page.getByRole('heading', { level: 1 }), exact('Not a PHP host'));
    expect(((await page.getByTestId('score').textContent()) ?? '').trim()).toBe('');
    await see(page.getByTestId('ring'), /no score/);
    await page.context().close();
  });

  test('on a phone the ring sits above the summary and nothing overflows sideways', async () => {
    const { page } = await open('/?demo=hidden', { width: 390, height: 844 });
    const field = page.getByRole('textbox', { name: 'Host' });
    await see(field);
    await field.fill('hidden.example');
    await field.press('Enter');
    await see(page.getByTestId('stage-word'), exact('HIDDEN'));
    await see(page.getByTestId('score'), exact('50'));
    await see(page.getByRole('heading', { level: 1 }), exact('Version hidden'));
    const ring = await page.getByTestId('ring').boundingBox();
    const summary = await page.getByTestId('summary').boundingBox();
    expect(ring!.y + ring!.height).toBeLessThanOrEqual(summary!.y + 1);
    const overflow = await page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth');
    expect(overflow).toBeLessThanOrEqual(0);
    await page.context().close();
  });

  test('a shared result opens finished, with the call to action to check another host', async () => {
    const { page, errors } = await open('/r/demo-protected');
    await see(page.getByTestId('stage-word'), exact('PROTECTED'));
    await see(page.getByRole('link', { name: /check your own host/i }));
    expect(errors).toEqual([]);
    await page.context().close();
  });
});

describe('view 3: the private metrics view', () => {
  test('counts first, trends second, failures third, from emulated data', async () => {
    const { page, errors } = await open('/metrics?demo=1');
    await see(page.getByRole('heading', { level: 1 }), exact('Metrics'));
    await see(page.getByTestId('metric-scans'), /\d/);
    await see(page.getByTestId('metric-hosts'), /\d/);
    await see(page.getByTestId('metric-pdfs'), /\d/);
    await see(page.getByTestId('metric-validations'), /\d/);
    await see(page.getByTestId('metric-share'), /^\s*\d+%\s*$/);
    // Twelve counts in two full rows of six at 1440.
    const counts = (await page.evaluate("[...document.querySelector('.metrics .counts').querySelectorAll('.count')].map(c => Math.round(c.getBoundingClientRect().top))")) as number[];
    expect(counts.length).toBe(12);
    expect(new Set(counts).size).toBe(2);
    await see(page.getByRole('heading', { name: 'Exposure over time' }));
    await see(page.getByRole('heading', { name: 'Failures' }));
    expect(await page.getByTestId('trend-day').count()).toBeGreaterThan(7);
    await see(page.getByRole('heading', { name: 'Hosts tested' }));
    const rows = page.getByTestId('host-row');
    expect(await rows.count()).toBeGreaterThan(3);
    const first = rows.first();
    await see(first.getByTestId('host-stage'), /NO PATCH|EXPOSED|HIDDEN|NOT AFFECTED|PROTECTED|NOT PHP/);
    await see(first.getByTestId('host-score'), /^\s*\d+\s*$/);
    expect(await first.getByRole('link').getAttribute('href')).toMatch(/^\/r\/[A-Za-z0-9_-]+$/);
    expect(errors).toEqual([]);
    await page.context().close();
  });

  test('the hosts table: search, stage chips, sortable columns, and an .xlsx export', async () => {
    const { page, errors } = await open('/metrics?demo=1');
    await see(page.getByRole('heading', { name: 'Hosts tested' }));
    const rows = page.getByTestId('host-row');
    const all = await rows.count();
    expect(all).toBe(5);
    await see(page.getByTestId('hosts-count'), new RegExp(`1\u2013${all} of ${all}`));
    const order = async () => (await page.evaluate("[...document.querySelectorAll('[data-testid=host-row] td:first-child')].map(td => td.textContent.trim())")) as string[];
    expect(await order()).toEqual(['protected.example', 'hidden.example', 'exposed.example', 'no-patch.example:80', 'not-php.example:80']);
    const search = page.getByRole('searchbox', { name: 'Search hosts' });
    await search.fill('hidden');
    expect(await rows.count()).toBe(1);
    await search.fill('');
    expect(await rows.count()).toBe(all);
    await page.getByRole('button', { name: /^No patch 1$/ }).click();
    expect(await rows.count()).toBe(1);
    await see(rows.first().getByTestId('host-stage'), exact('NO PATCH'));
    await page.getByRole('button', { name: /^No patch 1$/ }).click();
    expect(await rows.count()).toBe(all);
    const scores = async () => (await page.getByTestId('host-score').allTextContents()).map((t) => Number(t.trim()));
    const nonIncreasing = (ns: number[]) => ns.every((n, i) => i === 0 || ns[i - 1] >= n);
    await page.getByRole('button', { name: 'Score' }).click();
    expect(nonIncreasing(await scores())).toBe(true);
    await page.getByRole('button', { name: 'Stage' }).click();
    expect((await order())[0]).toBe('no-patch.example:80'); // worst first, by the ladder
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('hosts-export').click()]);
    expect(download.suggestedFilename()).toMatch(/^php2shell-labs-hosts-\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(page.url()).toContain('/metrics');
    expect(errors).toEqual([]);
    await page.context().close();
  });

  test('view 4: the API page tells an agent how to scan, consent, read, and fetch the PDF', async () => {
    const { page, errors } = await open('/api');
    await see(page.getByRole('heading', { level: 1 }), exact('The API'));
    await see(page.getByTestId('api-scan'), /POST \/api\/scan/);
    await see(page.getByTestId('api-scan'), /validate: true/);
    await see(page.getByTestId('api-scan'), /Accept: application\/json/);
    await see(page.getByTestId('api-result'), /GET \/api\/result\//);
    await see(page.getByTestId('api-report'), /GET \/api\/report\//);
    await see(page.getByTestId('api-limits'), /4 validations/);
    expect(await page.getByRole('link', { name: 'openapi.json' }).getAttribute('href')).toBe('/openapi.json');
    expect(await page.getByRole('link', { name: 'llms.txt' }).getAttribute('href')).toBe('/llms.txt');
    expect(errors).toEqual([]);
    await page.context().close();
  });
});

describe('languages: detected, chosen, remembered', () => {
  const pathOf = (page: Page) => new URL(page.url()).pathname + new URL(page.url()).search;

  test('a Spanish browser lands on /es/ in Spanish; the selector, the questions and the refusals follow', async () => {
    const es = MESSAGES.es;
    const { page, errors } = await open('/', undefined, 'es-MX');
    await see(page.getByRole('heading', { level: 1 }), exact(es.entry.h1));
    expect(pathOf(page)).toBe('/es/');
    expect(await page.evaluate('document.documentElement.lang')).toBe('es');
    const selector = page.getByRole('combobox', { name: es.shell.language });
    expect(await selector.inputValue()).toBe('es');
    expect(await selector.locator('option').allTextContents()).toEqual(['English', 'Español', 'Português', 'Français', 'Deutsch', '日本語']);
    await see(page.getByRole('heading', { name: es.entry.questions }));
    await see(page.getByText(es.entry.consent));
    await page.getByRole('textbox', { name: es.entry.hostLabel }).fill('not a host');
    await page.getByRole('button', { name: es.entry.test }).click();
    await see(page.getByRole('alert'), exact(es.errors.target['invalid-host']));
    expect(errors).toEqual([]);
    await page.context().close();
  });

  test('the selector translates the report in place, without scanning again, and the choice is remembered', async () => {
    const fr = MESSAGES.fr;
    const { page, errors } = await open('/scan?host=no-patch.example:80&demo=no-patch');
    await see(page.getByTestId('next-step'), /Upgrade to a supported PHP branch/, 15000);
    await page.getByRole('combobox', { name: 'Language' }).selectOption('fr');
    expect(pathOf(page)).toBe('/fr/scan?host=no-patch.example:80&demo=no-patch');
    // The finished report is re-worded at once; a new scan would hide the next step for seconds.
    await see(page.getByTestId('next-step'), fr.report.steps.upgrade.title, 400);
    await see(page.getByTestId('stage-word'), exact(fr.stage.label['no-patch']));
    await see(page.getByRole('heading', { level: 1 }), exact(fr.report.headingExposed));
    await see(page.getByTestId('verdict'), fr.report.verdict['no-patch']);
    // Label and value are joined the French way, with a no-break space before the colon.
    await see(page.getByTestId('version-card'), new RegExp(`${fr.report.version.php}\\u00a0: PHP 7\\.1\\.26`));
    expect(await page.title()).toBe(`${fr.titles.done('no-patch.example', fr.stage.label['no-patch'])} · PHP2Shell Labs`);
    expect(await page.evaluate('document.documentElement.lang')).toBe('fr');
    // An unprefixed address now opens in French: the choice beats the browser's English.
    await page.goto(vite.url + '/');
    await see(page.getByRole('heading', { level: 1 }), exact(fr.entry.h1));
    expect(pathOf(page)).toBe('/fr/');
    await page.getByRole('combobox', { name: fr.shell.language }).selectOption('en');
    expect(pathOf(page)).toBe('/');
    await page.reload();
    await see(page.getByRole('heading', { level: 1 }), exact('Is your server exposed to PHP2Shell?'));
    expect(pathOf(page)).toBe('/');
    expect(errors).toEqual([]);
    await page.context().close();
  });

  test('a shared link keeps its language whatever the browser speaks', async () => {
    const es = MESSAGES.es;
    const { page, errors } = await open('/es/r/demo-hidden', undefined, 'de-DE');
    await see(page.getByTestId('stage-word'), exact(es.stage.label.hidden));
    expect(pathOf(page)).toBe('/es/r/demo-hidden');
    await see(page.getByTestId('next-step'), es.report.steps['find-version'].title);
    await see(page.getByRole('link', { name: es.report.checkOwn }));
    expect(await page.getByRole('link', { name: es.report.checkOwn }).getAttribute('href')).toBe('/es/');
    expect(errors).toEqual([]);
    await page.context().close();
  });

  test("a refusal from the edge is said in the reader's language, from its code", async () => {
    const ja = MESSAGES.ja;
    const { page } = await open('/ja/scan?host=example.com');
    await page.route('**/api/scan', (route) =>
      route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: 'Too many validations from your address this hour.', code: 'rate-validation' }) }),
    );
    await page.reload();
    await see(page.getByRole('heading', { level: 1 }), exact(ja.report.headingNotRun));
    await see(page.getByTestId('verdict'), exact(ja.errors.scan['rate-validation']()));
    await page.context().close();
  });

  test('on a phone, in the longest words of every language, the selector stays and the ring word fits', async () => {
    const ringFit = (page: Page) =>
      page.evaluate(`(() => {
        const ring = document.querySelector('[data-testid="ring"] svg').getBoundingClientRect();
        const word = document.querySelector('[data-testid="stage-word"]').getBoundingClientRect();
        const r = ring.width / 2, cx = ring.left + r, cy = ring.top + r;
        // Every corner of the word's box sits inside the track circle (radius 110 of 130), with a margin.
        const inner = r * (104 / 130);
        const corners = [[word.left, word.top], [word.right, word.top], [word.left, word.bottom], [word.right, word.bottom]];
        return { inside: corners.every(([x, y]) => Math.hypot(x - cx, y - cy) <= inner) };
      })()`);
    const { page, errors } = await open('/scan?host=example.com', { width: 390, height: 844 });
    await page.route('**/api/scan', (route) => route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: 'busy', code: 'engine-busy' }) }));
    for (const prefix of ['', '/de', '/es', '/fr', '/pt', '/ja'] as const) {
      const locale = prefix === '' ? 'en' : (prefix.slice(1) as keyof typeof MESSAGES);
      const labels = MESSAGES[locale].stage.label;
      // The refused scan shows the unreachable word; the other words are measured by swapping the demo fixture.
      await page.goto(`${vite.url}${prefix}/scan?host=example.com`);
      await see(page.getByTestId('stage-word'), exact(labels.unreachable));
      expect({ locale, word: labels.unreachable, ...((await ringFit(page)) as { inside: boolean }) }).toEqual({ locale, word: labels.unreachable, inside: true });
      for (const demo of ['no-patch', 'not-affected'] as const) {
        const fixture = demo === 'not-affected' ? 'protected' : demo;
        await page.goto(`${vite.url}${prefix}/scan?host=x.example&demo=${fixture}`);
        await see(page.getByTestId('stage-word'), exact(labels[fixture === 'protected' ? 'protected' : 'no-patch']), 15000);
        const word = labels[fixture === 'protected' ? 'protected' : 'no-patch'];
        expect({ locale, word, ...((await ringFit(page)) as { inside: boolean }) }).toEqual({ locale, word, inside: true });
      }
      await see(page.getByRole('combobox', { name: MESSAGES[locale].shell.language }));
      const overflow = await page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth');
      expect({ locale, overflow: overflow as number }).toEqual({ locale, overflow: 0 });
    }
    expect(errors).toEqual([]);
    await page.context().close();
  });
});
