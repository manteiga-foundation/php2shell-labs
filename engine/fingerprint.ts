// The passive half: read what the host itself says. One home-page request plus PHP's
// version-disclosure "egg" query. No payload, one ordinary visit's worth of traffic.
// The engine connects to the RESOLVED address and sends the host name in the Host header.

import * as http from 'node:http';
import * as https from 'node:https';
import { extractPhpVersion, type PhpVersion } from './versions';

export const PHP_EGG_QUERY = '?=PHPE9568F34-D428-11d2-A769-00AA001ACF42';

/** The passive signs that PHP runs, beyond a version in a header: the session cookie, links to .php files, the logo egg (PHP 5.4 and older). */
export type PhpSign = 'cookie' | 'links' | 'logo';

/** Reads the signs of PHP in one answer: a PHPSESSID cookie, .php links or form actions in the page. */
export function phpSigns(headers: Record<string, string>, body: Buffer): PhpSign[] {
  const signs: PhpSign[] = [];
  if (/(^|,\s*)PHPSESSID=/i.test(headers['set-cookie'] ?? '')) signs.push('cookie');
  if ((headers['content-type'] ?? '').includes('html') && /(?:href|action|src)=["']?[^"'\s>]*\.php(?:[?"'\s>]|$)/i.test(body.subarray(0, 512 * 1024).toString('latin1'))) signs.push('links');
  return signs;
}

export type Fingerprint =
  | {
      ok: true;
      status: number;
      serverSoftware: string | null;
      poweredBy: string | null;
      /** The PHP version the host advertises, or null when hidden. */
      versionText: string | null;
      version: PhpVersion | null;
      /** PHP's logo endpoint answered with an image: PHP 5.4 or older with expose_php on. Removed in PHP 5.5. */
      egg: boolean;
      /** The signs of PHP in the home page's answer, so a hidden version on a modern host is not mistaken for no PHP. */
      signs: PhpSign[];
    }
  | { ok: false; error: 'unreachable' };

export type HttpResponse = {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
};

/** One HTTP(S) request to a resolved address. Never resolves the host again. */
export function request(
  host: string,
  port: number,
  tls: boolean,
  path: string,
  timeoutMs = 10000,
  address?: string,
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const lib = tls ? https : http;
    const req = lib.request(
      {
        host: address ?? host,
        port,
        path,
        method: 'GET',
        headers: { Host: host, 'User-Agent': 'PHP2Shell-Labs (+https://github.com/manteiga-foundation/php2shell-labs)' },
        servername: tls ? host : undefined,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const headers: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) {
            headers[k] = Array.isArray(v) ? v.join(', ') : (v as string);
          }
          resolve({ status: res.statusCode ?? 0, headers, body: Buffer.concat(chunks) });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

/** The passive fingerprint: home page plus the PHP egg query. */
export async function fingerprint(
  host: string,
  port: number,
  tls: boolean,
  timeoutMs = 10000,
  address?: string,
): Promise<Fingerprint> {
  let home: HttpResponse;
  try {
    home = await request(host, port, tls, '/', timeoutMs, address);
  } catch {
    return { ok: false, error: 'unreachable' };
  }

  const serverSoftware = home.headers['server'] ?? null;
  const poweredBy = home.headers['x-powered-by'] ?? null;
  const version = extractPhpVersion({ server: serverSoftware ?? undefined, poweredBy: poweredBy ?? undefined });
  const signs = phpSigns(home.headers, home.body);

  // The egg: PHP 5.4 and older with expose_php on answer the logo query with an image, and the
  // version with it. PHP 5.5 removed the easter eggs, so "no" says nothing about a modern host.
  let egg = false;
  try {
    const eggRes = await request(host, port, tls, `/${PHP_EGG_QUERY}`, timeoutMs, address);
    egg = (eggRes.headers['content-type'] ?? '').startsWith('image/');
    if (!version) {
      const eggVersion = extractPhpVersion({
        server: eggRes.headers['server'] ?? undefined,
        poweredBy: eggRes.headers['x-powered-by'] ?? undefined,
      });
      if (eggVersion) {
        return {
          ok: true,
          status: home.status,
          serverSoftware,
          poweredBy,
          versionText: `${eggVersion.major}.${eggVersion.minor}.${eggVersion.patch}`,
          version: eggVersion,
          egg,
          signs: egg ? [...signs, 'logo'] : signs,
        };
      }
    }
  } catch {
    // The egg is a bonus, never a failure.
  }

  return {
    ok: true,
    status: home.status,
    serverSoftware,
    poweredBy,
    versionText: version ? `${version.major}.${version.minor}.${version.patch}` : null,
    version,
    egg,
    signs: egg ? [...signs, 'logo'] : signs,
  };
}
