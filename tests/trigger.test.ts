// The active half: one baseline request, one large chunked request, compare signatures.
// The fixture reproduces rest.vulnweb.com's measured behaviour: small bodies reach the
// application (401), bodies past the memory threshold die during request startup (empty 200).

import { validate } from '../engine/trigger';
import { startFixture } from './fixture-http';
import { afterAll, describe, expect, test } from 'bun:test';

const servers: ReturnType<typeof startFixture>[] = [];
afterAll(async () => {
  for (const s of servers) await s.stop();
});

/** Mimics the measured rest.vulnweb.com behaviour with a small threshold for tests. */
function oomFixture(thresholdBytes: number) {
  return startFixture(async (req) => {
    if (req.method !== 'POST') return new Response('method', { status: 405 });
    const body = new Uint8Array(await req.arrayBuffer());
    if (body.length >= thresholdBytes) {
      // Request died during startup: empty 200, the application never ran.
      return new Response(null, { status: 200, headers: { 'X-Powered-By': 'PHP/7.1.26' } });
    }
    return new Response('Authentication type is wrong.', { status: 401 });
  });
}

function healthyFixture() {
  return startFixture(async (req) => {
    if (req.method !== 'POST') return new Response('method', { status: 405 });
    await req.arrayBuffer();
    return new Response('Authentication type is wrong.', { status: 401 });
  });
}

describe('validate (the exploit validation)', () => {
  test('the out-of-memory bailout signature is detected', async () => {
    const s = oomFixture(2 * 1024 * 1024);
    servers.push(s);
    const v = await validate('127.0.0.1', s.port, false, {
      baselineBytes: 512 * 1024,
      payloadBytes: 3 * 1024 * 1024,
      timeoutMs: 15000,
    });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.verdict).toBe('triggered');
    expect(v.baseline.status).toBe(401);
    expect(v.payload.status).toBe(200);
    expect(v.payload.bodyBytes).toBe(0);
    expect(v.signature).toContain('401');
  });

  test('a host that answers the large body like the small one is not triggered', async () => {
    const s = healthyFixture();
    servers.push(s);
    const v = await validate('127.0.0.1', s.port, false, {
      baselineBytes: 512 * 1024,
      payloadBytes: 3 * 1024 * 1024,
      timeoutMs: 15000,
    });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.verdict).toBe('not-triggered');
    expect(v.baseline.status).toBe(401);
    expect(v.payload.status).toBe(401);
  });

  test('an empty 200 where the baseline returned a 200 WITH a body also triggers', async () => {
    const s = startFixture(async (req) => {
      if (req.method !== 'POST') return new Response('method', { status: 405 });
      const body = new Uint8Array(await req.arrayBuffer());
      if (body.length >= 1024 * 1024) return new Response(null, { status: 200 });
      return new Response('<html>app ran</html>', { status: 200 });
    });
    servers.push(s);
    const v = await validate('127.0.0.1', s.port, false, {
      baselineBytes: 64 * 1024,
      payloadBytes: 2 * 1024 * 1024,
      timeoutMs: 15000,
    });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.verdict).toBe('triggered');
  });

  test('an unreachable host is reported, not thrown', async () => {
    const v = await validate('127.0.0.1', 9, false, {
      baselineBytes: 1024,
      payloadBytes: 2048,
      timeoutMs: 500,
    });
    expect(v).toEqual({ ok: false, error: 'unreachable' });
  });

  test('a payload timeout is reported as a timeout, not a crash claim', async () => {
    // A server that never answers: every request stalls.
    const stall = startFixture(() => new Promise<Response>(() => undefined));
    servers.push(stall);
    const v = await validate('127.0.0.1', stall.port, false, {
      baselineBytes: 8,
      payloadBytes: 8,
      timeoutMs: 500,
    });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.error).toBe('timeout');
  });
});
