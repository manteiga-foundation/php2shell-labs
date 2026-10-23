// The edge's routes against the real schema (bun:sqlite standing in for D1), a stub resolver and
// a stub engine that answers the recorded fixture streams. The rules under test are the ones
// that matter for PHP2Shell: consent travels as a boolean, a consented validation never comes
// from the cache and has its own hourly limit, results get ids, previews and one-answer JSON.
import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import worker, { type Env } from '../worker/src/index';
import { SCAN_FIXTURES } from '../web/src/fixtures';

const ORIGIN = 'https://php2shell-labs.taptok-test.workers.dev';

/** D1's prepare/bind/first/run/all over a memory SQLite with worker/schema.sql applied. */
function d1(): D1Database {
  const db = new Database(':memory:');
  db.exec(require('node:fs').readFileSync('worker/schema.sql', 'utf8'));
  const statement = (sql: string, params: unknown[] = []) => ({
    bind: (...p: unknown[]) => statement(sql, p),
    first: async <T>() => (db.query(sql).get(...(params as never[])) as T | null) ?? null,
    run: async () => {
      db.query(sql).run(...(params as never[]));
      return { success: true, meta: {} };
    },
    all: async <T>() => ({ results: db.query(sql).all(...(params as never[])) as T[], success: true, meta: {} }),
  });
  return { prepare: (sql: string) => statement(sql) } as unknown as D1Database;
}

function engineStream(fixture: string): Response {
  const f = SCAN_FIXTURES[fixture];
  const lines = [...f.events, { type: 'result', result: f.result }].map((e) => JSON.stringify(e)).join('\n') + '\n';
  return new Response(lines, { headers: { 'content-type': 'application/x-ndjson' } });
}

const realFetch = globalThis.fetch;
let engineCalls: { host: string; port: number; validate: boolean }[] = [];
let env: Env;
let waits: Promise<unknown>[] = [];
const ctx = { waitUntil: (p: Promise<unknown>) => void waits.push(p), passThroughOnException: () => undefined } as unknown as ExecutionContext;
const settle = async () => {
  await Promise.all(waits);
  waits = [];
};

beforeEach(() => {
  engineCalls = [];
  env = {
    DB: d1(),
    ASSETS: { fetch: async () => new Response('<!doctype html><html><head><title>PHP2Shell Labs</title><meta name="description" content="x"><meta property="og:title" content="x"><meta property="og:image" content="x"></head><body></body></html>', { headers: { 'content-type': 'text/html; charset=utf-8' } }) } as unknown as Fetcher,
    ENGINE_URL: 'https://engine.test',
    ENGINE_TOKEN: 'test-token',
    RENDER_URL: '',
    RENDER_TOKEN: '',
    PUBLIC_ORIGIN: ORIGIN,
    ALLOWED_PORTS: '80,443',
  };
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith('https://cloudflare-dns.com/')) {
      const name = new URL(url).searchParams.get('name') ?? '';
      const type = new URL(url).searchParams.get('type');
      if (name === 'nowhere.example') return Response.json({ Status: 3 });
      if (name === 'intranet.example') return Response.json({ Status: 0, Answer: type === 'A' ? [{ type: 1, data: '10.0.0.8' }] : [] });
      return Response.json({ Status: 0, Answer: type === 'A' ? [{ type: 1, data: '93.184.216.34' }] : [] });
    }
    if (url === 'https://engine.test/scan') {
      const body = JSON.parse(String(init?.body)) as { host: string; port: number; validate: boolean };
      engineCalls.push(body);
      if (body.host === 'busy.example') return Response.json({ error: 'busy' }, { status: 429 });
      return engineStream(body.host.split('.')[0]);
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const scan = (body: unknown, headers: Record<string, string> = {}) =>
  worker.fetch(new Request(`${ORIGIN}/api/scan`, { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.7', ...headers }, body: JSON.stringify(body) }), env, ctx);
const events = async (res: Response) => (await res.text()).trim().split('\n').map((l) => JSON.parse(l) as { type: string; id?: string; cached?: boolean });

describe('POST /api/scan', () => {
  test('consent is the boolean true and nothing else; the engine receives it with the resolved target', async () => {
    const res = await scan({ host: 'no-patch.example:80', validate: 'yes' });
    expect(res.status).toBe(200);
    const types = (await events(res)).map((e) => e.type);
    expect(types.slice(0, 2)).toEqual(['start', 'fingerprint']);
    expect(types.slice(-2)).toEqual(['result', 'saved']);
    expect(engineCalls).toEqual([{ host: 'no-patch.example', port: 80, validate: false }]);
    await settle();
    const row = await env.DB.prepare('SELECT stage, score, validate, cache_hit FROM scans').first<{ stage: string; score: number; validate: number; cache_hit: number }>();
    expect(row).toEqual({ stage: 'no-patch', score: 15, validate: 0, cache_hit: 0 });
  });

  test('a fresh exposure result is answered from the cache; a consented request for the same host runs the engine again', async () => {
    await events(await scan({ host: 'exposed.example' }));
    await settle();
    const second = await events(await scan({ host: 'exposed.example' }));
    expect(second.map((e) => e.type)).toEqual(['result', 'saved']);
    expect(second[1].cached).toBe(true);
    expect(engineCalls.length).toBe(1);
    const third = await events(await scan({ host: 'exposed.example', validate: true }));
    expect(third.map((e) => e.type).slice(-2)).toEqual(['result', 'saved']); // fresh: a full stream, not the two cached lines
    expect(engineCalls.at(-1)).toEqual({ host: 'exposed.example', port: 443, validate: true });
    await settle();
    const rows = await env.DB.prepare('SELECT validate, cache_hit FROM scans ORDER BY rowid').all<{ validate: number; cache_hit: number }>();
    expect(rows.results).toEqual([{ validate: 0, cache_hit: 0 }, { validate: 0, cache_hit: 1 }, { validate: 1, cache_hit: 0 }]);
  });

  test('validations have their own hourly limit per caller, and a 429 names it by code', async () => {
    for (let i = 0; i < 4; i++) {
      const res = await scan({ host: `hidden.example`, validate: true });
      expect(res.status).toBe(200);
      await res.text();
    }
    const refused = await scan({ host: 'hidden.example', validate: true });
    expect(refused.status).toBe(429);
    expect(refused.headers.get('retry-after')).toMatch(/^\d+$/);
    expect(((await refused.json()) as { code: string }).code).toBe('rate-validation');
    // Without consent the same caller still scans.
    const plain = await scan({ host: 'hidden.example' });
    expect(plain.status).toBe(200);
    await plain.text();
  });

  test('refusals: a port outside the allowlist, a name that does not resolve, a private address, a busy engine', async () => {
    const port = await scan({ host: 'example.com:8080' });
    expect(port.status).toBe(400);
    expect(((await port.json()) as { code: string }).code).toBe('port-not-allowed');
    const none = await scan({ host: 'nowhere.example' });
    expect(((await none.json()) as { code: string }).code).toBe('no-address');
    const priv = await scan({ host: 'intranet.example' });
    expect(((await priv.json()) as { code: string; params: { address: string } }).params.address).toBe('10.0.0.8');
    const busy = await scan({ host: 'busy.example' });
    expect(busy.status).toBe(429);
    expect(((await busy.json()) as { code: string }).code).toBe('engine-busy');
    await settle();
    const failures = await env.DB.prepare('SELECT reason FROM failures ORDER BY id').all<{ reason: string }>();
    expect(failures.results.map((f: { reason: string }) => f.reason)).toEqual(['Port not allowed', 'Host does not resolve', 'Refused: not a public address', 'Engine busy']);
  });

  test('Accept: application/json, and the GET form, answer once with the id, the links and the result', async () => {
    const res = await scan({ host: 'protected.example' }, { accept: 'application/json' });
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const body = (await res.json()) as { id: string; url: string; pdf: string; cached: boolean; result: { assessment: { stage: string } } };
    expect(body.id).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(body.url).toBe(`${ORIGIN}/r/${body.id}`);
    expect(body.pdf).toBe(`${ORIGIN}/api/report/${body.id}.pdf`);
    expect(body.result.assessment.stage).toBe('protected');
    await settle();
    const get = await worker.fetch(new Request(`${ORIGIN}/api/scan?host=protected.example&validate=1`, { headers: { 'cf-connecting-ip': '198.51.100.8' } }), env, ctx);
    const again = (await get.json()) as { cached: boolean };
    expect(again.cached).toBe(false); // validate=1 is consent: never the cache
    expect(engineCalls.at(-1)?.validate).toBe(true);
  });
});

describe('results and pages', () => {
  test('/api/result/<id> is the stored result; /r/<id> carries its preview and noindex; a stranger is the plain page', async () => {
    const saved = (await events(await scan({ host: 'no-patch.example:80' }))).find((e) => e.type === 'saved')!;
    await settle();
    const result = await worker.fetch(new Request(`${ORIGIN}/api/result/${saved.id}`), env, ctx);
    expect(result.status).toBe(200);
    expect(((await result.json()) as { target: { host: string } }).target.host).toBe('no-patch.example');
    const page = await (await worker.fetch(new Request(`${ORIGIN}/es/r/${saved.id}`), env, ctx)).text();
    expect(page).toContain('<meta name="robots" content="noindex"');
    expect(page).toContain(`/og/no-patch.png`);
    expect(page).toContain('no-patch.example');
    expect(page).toMatch(/<html lang="es"/);
    const stranger = await worker.fetch(new Request(`${ORIGIN}/r/AAAAAAAAAAAA`), env, ctx);
    expect(stranger.status).toBe(200);
    expect(await stranger.text()).not.toContain('noindex');
    expect((await worker.fetch(new Request(`${ORIGIN}/api/result/AAAAAAAAAAAA`), env, ctx)).status).toBe(404);
  });

  test('metrics count validations and the six stages; the view is closed without Access', async () => {
    await (await scan({ host: 'no-patch.example:80', validate: true })).text();
    await (await scan({ host: 'protected.example' })).text();
    await settle();
    const forbidden = await worker.fetch(new Request(`${ORIGIN}/api/metrics`), env, ctx);
    expect(forbidden.status).toBe(403);
    const res = await worker.fetch(new Request(`${ORIGIN}/api/metrics`, { headers: { 'cf-access-jwt-assertion': 'x' } }), env, ctx);
    const m = (await res.json()) as { totals: { scans: number; validations: number }; days: { stages: Record<string, number>; validations: number }[]; hosts: { host: string; stage: string }[] };
    expect(m.totals.scans).toBe(2);
    expect(m.totals.validations).toBe(1);
    expect(m.days[0].stages).toEqual({ 'no-patch': 1, exposed: 0, hidden: 0, 'not-affected': 0, protected: 1, 'not-php': 0, unreachable: 0 });
    expect(m.hosts.map((h) => h.stage).sort()).toEqual(['no-patch', 'protected']);
  });

  test('the sitemap lists the entry page in every language and nothing unlisted', async () => {
    const xml = await (await worker.fetch(new Request(`${ORIGIN}/sitemap.xml`), env, ctx)).text();
    expect(xml.match(/<url>/g)?.length).toBe(7);
    expect(xml).not.toContain('/r/');
  });
});
