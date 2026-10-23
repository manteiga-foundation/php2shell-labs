// A configurable HTTP fixture the engine tests talk to, in this process.

export type FixtureServer = {
  port: number;
  stop(): Promise<void>;
};

/** Start a Bun.serve on a random loopback port. `handler` sees every request. */
export function startFixture(
  handler: (req: Request) => Response | Promise<Response>,
): FixtureServer {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: handler,
  });
  return {
    port: server.port ?? 0,
    stop: async () => {
      await server.stop(true);
    },
  };
}

/** The header shape rest.vulnweb.com showed us: X-Powered-By + the PHP egg. */
export function phpLike(version: string, opts: { egg?: boolean; poweredBy?: boolean; server?: string; cookie?: boolean } = {}) {
  const egg = opts.egg ?? true;
  const poweredBy = opts.poweredBy ?? true;
  return (req: Request): Response => {
    const url = new URL(req.url);
    if (egg && url.search.startsWith('?=PHPE9568F34')) {
      return new Response('GIF89a', {
        headers: {
          'Content-Type': 'image/gif',
          ...(poweredBy ? { 'X-Powered-By': `PHP/${version}` } : {}),
        },
      });
    }
    return new Response('<html>home</html>', {
      headers: {
        'Content-Type': 'text/html',
        ...(opts.server ? { Server: opts.server } : {}),
        ...(poweredBy ? { 'X-Powered-By': `PHP/${version}` } : {}),
        ...(opts.cookie ? { 'Set-Cookie': 'PHPSESSID=0123456789abcdef; path=/; HttpOnly' } : {}),
      },
    });
  };
}
