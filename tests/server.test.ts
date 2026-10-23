import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createEngineServer, type EngineServer } from '../engine/server';
import { phpLike, startFixture } from './fixture-http';

async function readNdjson(res: Response): Promise<Record<string, unknown>[]> {
  const text = await res.text();
  return text
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

describe('engine HTTP server', () => {
  let fixture: ReturnType<typeof startFixture>;
  let engine: EngineServer;
  let open: EngineServer;
  beforeAll(() => {
    fixture = startFixture(async (req) => {
      if (req.method === 'POST') {
        const body = new Uint8Array(await req.arrayBuffer());
        if (body.length >= 1024 * 1024) return new Response(null, { status: 200 });
        return new Response('Authentication type is wrong.', { status: 401 });
      }
      return phpLike('7.1.26')(req);
    });
    engine = createEngineServer({ port: 0, token: 'test-token', allowPrivate: true, maxConcurrent: 2, payloadBytes: 2 * 1024 * 1024, baselineBytes: 64 * 1024 });
    open = createEngineServer({ port: 0, token: 'test-token' });
  });
  afterAll(async () => {
    await fixture.stop();
    engine.stop();
    open.stop();
  });

  const post = (url: string, body: unknown) =>
    fetch(`${url}/scan`, { method: 'POST', headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' }, body: JSON.stringify(body) });

  test('health answers without a token and names the version', async () => {
    const res = await fetch(`${engine.url}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, version: expect.stringMatching(/^\d+\.\d+\.\d+$/) });
  });

  test('a scan without the token is refused', async () => {
    const res = await fetch(`${engine.url}/scan`, { method: 'POST', body: JSON.stringify({ host: '127.0.0.1', port: fixture.port }) });
    expect(res.status).toBe(401);
  });

  test('a scan streams NDJSON events and ends with the result', async () => {
    const res = await post(engine.url, { host: '127.0.0.1', port: fixture.port });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/x-ndjson');
    const lines = await readNdjson(res);
    expect(lines[0]).toMatchObject({ type: 'start', validate: false });
    expect(lines.filter((l) => l.type === 'probe')).toHaveLength(2);
    const last = lines.at(-1)!;
    expect(last.type).toBe('result');
    expect((last.result as { assessment: { stage: string } }).assessment.stage).toBe('no-patch');
  });

  test('the validation runs only when the request carries consent', async () => {
    const without = await readNdjson(await post(engine.url, { host: '127.0.0.1', port: fixture.port }));
    expect(without.some((l) => l.type === 'validation')).toBe(false);
    const withConsent = await readNdjson(await post(engine.url, { host: '127.0.0.1', port: fixture.port, validate: true }));
    expect(withConsent.some((l) => l.type === 'validation')).toBe(true);
    expect((withConsent.at(-1)!.result as { validate: boolean }).validate).toBe(true);
  });

  test('an invalid target is a 400 with the reason, not a stream', async () => {
    const res = await post(engine.url, { host: 'exa mple.com' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('host name') });
  });

  test('the public engine never scans a private address, whatever the caller says', async () => {
    const res = await post(open.url, { host: '127.0.0.1', port: fixture.port, allowPrivate: true });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('not a public Internet address') });
  });

  test('more scans than the concurrency cap are answered 429, and the slot is held for the stream', async () => {
    const silent = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data() {}, open() {} } });
    try {
      const slow = () => post(engine.url, { host: '127.0.0.1', port: silent.port, timeoutMs: 1500 });
      const a = slow();
      const b = slow();
      await Bun.sleep(100);
      const c = await slow();
      expect(c.status).toBe(429);
      const [ra, rb] = await Promise.all([a, b]);
      expect(ra.status).toBe(200);
      expect(rb.status).toBe(200);
      await Promise.all([ra.text(), rb.text()]);
    } finally {
      silent.stop(true);
    }
  });
});
