import { describe, expect, test } from 'bun:test';
import { addressesFromDoh, cacheServes, decideRateLimit, isFresh, newShareId, previewFor, RATE_LIMITS, scanError } from '../worker/src/policy';
import protectedFixture from '../web/src/fixtures/protected.json';
import noPatchFixture from '../web/src/fixtures/no-patch.json';
import { MESSAGES } from '../web/src/i18n/messages';

const ORIGIN = 'https://php2shell-labs.example';

describe('edge policy', () => {
  test('DNS-over-HTTPS answers are reduced to addresses, CNAMEs skipped', () => {
    const doh = { Status: 0, Answer: [{ name: 'www.example.', type: 5, data: 'example.' }, { name: 'example.', type: 1, data: '93.184.216.34' }, { name: 'example.', type: 28, data: '2606:2800:21f:cb07:6820:80da:af6b:8b2c' }] };
    expect(addressesFromDoh(doh)).toEqual(['93.184.216.34', '2606:2800:21f:cb07:6820:80da:af6b:8b2c']);
    expect(addressesFromDoh({ Status: 3 })).toEqual([]);
  });

  test('rate limits: a caller gets a burst, then waits; a host is not hammered; validations are tighter still', () => {
    const now = 1_000_000;
    expect(decideRateLimit({ kind: 'caller', count: 0, windowStart: now, now })).toEqual({ allowed: true });
    expect(decideRateLimit({ kind: 'caller', count: RATE_LIMITS.caller.max, windowStart: now, now })).toMatchObject({ allowed: false });
    const retry = decideRateLimit({ kind: 'caller', count: RATE_LIMITS.caller.max, windowStart: now, now }) as { allowed: false; retryAfterS: number };
    expect(retry.retryAfterS).toBeGreaterThan(0);
    // The window expired: counting starts again.
    expect(decideRateLimit({ kind: 'caller', count: 999, windowStart: now - RATE_LIMITS.caller.windowS * 1000 - 1, now })).toEqual({ allowed: true, reset: true });
    expect(decideRateLimit({ kind: 'host', count: RATE_LIMITS.host.max, windowStart: now, now })).toMatchObject({ allowed: false });
    expect(RATE_LIMITS.validation.max).toBeLessThan(RATE_LIMITS.caller.max);
    expect(decideRateLimit({ kind: 'validation', count: RATE_LIMITS.validation.max, windowStart: now, now })).toMatchObject({ allowed: false });
    expect(RATE_LIMITS.caller.windowS).toBe(3600);
  });

  test('a cached result is fresh for 24 hours', () => {
    const created = Date.parse('2026-10-23T10:00:00Z');
    expect(isFresh(created, Date.parse('2026-10-23T22:00:00Z'))).toBe(true);
    expect(isFresh(created, Date.parse('2026-10-24T10:00:01Z'))).toBe(false);
  });

  test('a consented validation always runs fresh; a plain exposure request is served from any fresh result', () => {
    const created = Date.parse('2026-10-23T10:00:00Z');
    const now = Date.parse('2026-10-23T11:00:00Z');
    expect(cacheServes({ requestValidate: false, createdAtMs: created, nowMs: now })).toBe(true);
    expect(cacheServes({ requestValidate: true, createdAtMs: created, nowMs: now })).toBe(false);
    expect(cacheServes({ requestValidate: false, createdAtMs: created, nowMs: now + 2 * 86400_000 })).toBe(false);
  });

  test('share ids are short, URL-safe and unpredictable', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newShareId()));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{12}$/);
  });

  test('the link preview carries the host, the stage word and the verdict', () => {
    const p = previewFor(protectedFixture.result as never, 'abc123XYZ_-1', ORIGIN);
    expect(p.title).toBe('protected.example is PROTECTED · PHP2Shell Labs');
    expect(p.description).toContain('not exposed to PHP2Shell');
    expect(p.image).toBe(`${ORIGIN}/og/protected.png`);
    expect(p.url).toBe(`${ORIGIN}/r/abc123XYZ_-1`);
    const q = previewFor(noPatchFixture.result as never, 'abc123XYZ_-1', ORIGIN);
    expect(q.title).toBe('no-patch.example:80 is NO PATCH · PHP2Shell Labs');
    expect(q.image).toBe(`${ORIGIN}/og/no-patch.png`);
  });

  test('a shared link opened in another language previews in that language, at its own address', () => {
    const es = MESSAGES.es;
    const p = previewFor(protectedFixture.result as never, 'abc123XYZ_-1', ORIGIN, 'es');
    expect(p.title).toBe(`${es.meta.shareTitle('protected.example', es.stage.label.protected)} · PHP2Shell Labs`);
    expect(p.description).toContain(es.report.verdict.protected);
    expect(p.description).toContain(es.report.steps['keep-current'].title);
    expect(p.url).toBe(`${ORIGIN}/es/r/abc123XYZ_-1`);
  });

  test('a refusal carries English words for scripts and a code with params for the page', () => {
    expect(scanError('port-not-allowed', { port: 8443, allowed: [80, 443] })).toEqual({
      error: 'The public scanner tests ports 80 and 443 only. Port 8443 was asked for and noted.',
      code: 'port-not-allowed',
      params: { port: 8443, allowed: [80, 443] },
    });
    expect(scanError('rate-caller')).toEqual({ error: 'Too many scans from your address. Please wait a few minutes.', code: 'rate-caller', params: {} });
    expect(scanError('rate-validation').error).toMatch(/validations/);
    expect(scanError('not-public', { host: 'a.example', address: '10.0.0.1' }).error).toBe(
      'a.example resolves to 10.0.0.1, which is not a public Internet address. The public scanner tests only public hosts.',
    );
  });
});
