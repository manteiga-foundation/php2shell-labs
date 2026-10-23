import { afterAll, describe, expect, test } from 'bun:test';
import { scan, type ScanEvent } from '../engine/scan';
import { TargetError } from '../engine/target';
import { phpLike, startFixture } from './fixture-http';

const servers: ReturnType<typeof startFixture>[] = [];
afterAll(async () => {
  for (const s of servers) await s.stop();
});

function fixture(handler: Parameters<typeof startFixture>[0]): number {
  const s = startFixture(handler);
  servers.push(s);
  return s.port;
}

describe('scan against the HTTP fixture', () => {
  test('streams start, one probe per question, the fingerprint, the assessment and done', async () => {
    const port = fixture(phpLike('7.1.26'));
    const events: ScanEvent[] = [];
    const result = await scan({ host: '127.0.0.1', port }, { allowPrivate: true, onEvent: (e) => events.push(e) });

    expect(events[0]).toMatchObject({ type: 'start', target: { host: '127.0.0.1', port }, address: '127.0.0.1', validate: false });
    expect(events.map((e) => e.type)).toEqual(['start', 'fingerprint', 'probe', 'probe', 'assessment', 'done']);
    const probes = events.filter((e) => e.type === 'probe');
    expect(probes[0]).toMatchObject({ id: 'home', answer: 'yes' });
    expect(probes[1]).toMatchObject({ id: 'egg', answer: 'yes' });

    expect(result.findings.versionText).toBe('7.1.26');
    expect(result.findings.egg).toBe('yes');
    expect(result.findings.validation).toBeNull();
    expect(result.assessment.stage).toBe('no-patch');
    expect(result.validate).toBe(false);
    expect(result.ms).toBeLessThan(10000);
  });

  test('a consented validation runs after the fingerprint and lands triggered', async () => {
    const threshold = 1024 * 1024;
    const port = fixture(async (req) => {
      if (req.method === 'POST') {
        const body = new Uint8Array(await req.arrayBuffer());
        if (body.length >= threshold) return new Response(null, { status: 200 });
        return new Response('Authentication type is wrong.', { status: 401 });
      }
      return phpLike('7.1.26')(req);
    });
    const events: ScanEvent[] = [];
    const result = await scan(
      { host: '127.0.0.1', port },
      { allowPrivate: true, validate: true, payloadBytes: 2 * 1024 * 1024, baselineBytes: 64 * 1024, onEvent: (e) => events.push(e) },
    );
    expect(events.map((e) => e.type)).toEqual(['start', 'fingerprint', 'probe', 'probe', 'validation', 'probe', 'assessment', 'done']);
    expect(events.find((e) => e.type === 'probe' && e.id === 'validation')).toMatchObject({ answer: 'yes' });
    expect(result.validate).toBe(true);
    expect(result.findings.validation?.verdict).toBe('triggered');
    expect(result.assessment.stage).toBe('no-patch');
    expect(result.assessment.notes.some((n) => n.id === 'validation-reproduced')).toBe(true);
  });

  test('the validation is skipped, even with consent, when nothing answered as PHP', async () => {
    const port = fixture(() => new Response('ok', { headers: { Server: 'nginx/1.24.0' } }));
    const events: ScanEvent[] = [];
    const result = await scan({ host: '127.0.0.1', port }, { allowPrivate: true, validate: true, onEvent: (e) => events.push(e) });
    expect(events.some((e) => e.type === 'validation')).toBe(false);
    expect(result.findings.validation).toBeNull();
    expect(result.assessment.stage).toBe('not-php');
  });

  test('a private address is refused unless the caller allows it', async () => {
    const port = fixture(phpLike('8.3.36'));
    await expect(scan({ host: '127.0.0.1', port })).rejects.toBeInstanceOf(TargetError);
  });

  test('a closed port is reported as unreachable, not thrown', async () => {
    const result = await scan({ host: '127.0.0.1', port: 1 }, { allowPrivate: true, timeoutMs: 1500 });
    expect(result.assessment.stage).toBe('unreachable');
    expect(result.findings.reachable).toBe(false);
  });
});
