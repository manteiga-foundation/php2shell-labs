// The passive half: read what the host itself says. One home-page request plus PHP's
// version-disclosure "egg" query. No payload, one ordinary visit's worth of traffic.
// The engine connects to the RESOLVED address and sends the host name in the Host header.

import * as http from 'node:http';
import * as https from 'node:https';
import { extractPhpVersion, type PhpVersion } from './versions';

export const PHP_EGG_QUERY = '?=PHPE9568F34-D428-11d2-A769-00AA001ACF42';

export type Fingerprint =
  | {
      ok: true;
      status: number;
      serverSoftware: string | null;
      poweredBy: string | null;
      /** The PHP version the host advertises, or null when hidden. */
      versionText: string | null;
      version: PhpVersion | null;
      /** PHP's credit/logo endpoint answered: PHP is running even if the version is hidden. */
      egg: boolean;
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

  // The egg: only PHP answers the credit query with a logo. Even with expose_php off, the
  // response differs; with it on (the common case on old hosts) it also carries the version.
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
  };
}
