// The passive half: read what the host itself says. RED first.

import { fingerprint } from '../engine/fingerprint';
import { phpLike, startFixture } from './fixture-http';
import { afterAll, describe, expect, test } from 'bun:test';

const servers: ReturnType<typeof startFixture>[] = [];
afterAll(async () => {
  for (const s of servers) await s.stop();
});

function fixture(handler: Parameters<typeof startFixture>[0]): string {
  const s = startFixture(handler);
  servers.push(s);
  return `127.0.0.1:${s.port}`;
}

describe('fingerprint', () => {
  test('reads the PHP version from X-Powered-By and confirms the egg', async () => {
    const target = fixture(phpLike('7.1.26'));
    const [host, port] = target.split(':');
    const fp = await fingerprint(host, Number(port), false);
    expect(fp.ok).toBe(true);
    if (!fp.ok) return;
    expect(fp.versionText).toBe('7.1.26');
    expect(fp.egg).toBe(true);
    expect(fp.serverSoftware).toBeDefined();
  });

  test('falls back to the Server header when X-Powered-By is absent', async () => {
    const target = fixture(phpLike('5.2.6', { poweredBy: false, server: 'Apache/2.2.8 (Win32) PHP/5.2.6' }));
    const [host, port] = target.split(':');
    const fp = await fingerprint(host, Number(port), false);
    expect(fp.ok).toBe(true);
    if (!fp.ok) return;
    expect(fp.versionText).toBe('5.2.6');
  });

  test('the egg proves PHP even when the version is hidden', async () => {
    const target = fixture(phpLike('8.3.0', { egg: true, poweredBy: false }));
    const [host, port] = target.split(':');
    const fp = await fingerprint(host, Number(port), false);
    expect(fp.ok).toBe(true);
    if (!fp.ok) return;
    expect(fp.egg).toBe(true);
    expect(fp.versionText).toBeNull();
  });

  test('a non-PHP host reports no version and no egg', async () => {
    const target = fixture(() => new Response('ok', { headers: { Server: 'nginx/1.24.0' } }));
    const [host, port] = target.split(':');
    const fp = await fingerprint(host, Number(port), false);
    expect(fp.ok).toBe(true);
    if (!fp.ok) return;
    expect(fp.egg).toBe(false);
    expect(fp.versionText).toBeNull();
    expect(fp.serverSoftware).toBe('nginx/1.24.0');
  });

  test('a refused connection is reported, not thrown', async () => {
    const fp = await fingerprint('127.0.0.1', 9, false, 500);
    expect(fp).toEqual({ ok: false, error: 'unreachable' });
  });
});
