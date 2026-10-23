// Records the stage fixtures the web, the terminal tests and the PDF replay: a real engine run
// against the in-process HTTP fixture per stage, the loopback address replaced by an example
// host so the files read like the public tool's output. Run: bun run scripts/record-fixture.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import { scan, type ScanEvent, type ScanResult } from '../engine/scan';
import { phpLike, startFixture } from '../tests/fixture-http';

type Handler = Parameters<typeof startFixture>[0];

const threshold = 1024 * 1024;
const validating =
  (version: string): Handler =>
  async (req) => {
    if (req.method === 'POST') {
      const body = new Uint8Array(await req.arrayBuffer());
      if (body.length >= threshold) return new Response(null, { status: 200 });
      return new Response('Authentication type is wrong.', { status: 401 });
    }
    return phpLike(version)(req);
  };

const FIXTURES: Record<string, { host: string; handler: Handler; validate: boolean }> = {
  'no-patch': { host: 'no-patch.example', handler: validating('7.1.26'), validate: true },
  exposed: { host: 'exposed.example', handler: phpLike('8.2.34'), validate: false },
  hidden: { host: 'hidden.example', handler: phpLike('8.3.1', { poweredBy: false, server: 'Apache/2.4.58 (Ubuntu)' }), validate: false },
  protected: { host: 'protected.example', handler: phpLike('8.3.36', { server: 'nginx/1.26.2' }), validate: false },
  'not-php': { host: 'not-php.example', handler: () => new Response('<html>home</html>', { headers: { Server: 'nginx/1.24.0', 'Content-Type': 'text/html' } }), validate: true },
};

mkdirSync('web/src/fixtures', { recursive: true });
for (const [name, spec] of Object.entries(FIXTURES)) {
  const server = startFixture(spec.handler);
  const events: ScanEvent[] = [];
  const result: ScanResult = await scan(
    { host: '127.0.0.1', port: server.port },
    { allowPrivate: true, validate: spec.validate, baselineBytes: 64 * 1024, payloadBytes: 2 * 1024 * 1024, onEvent: (e) => events.push(e) },
  );
  await server.stop();
  const text = JSON.stringify({ events, result }).replace(/127\.0\.0\.1/g, '203.0.113.10');
  // The target host is the example name and the port the public one; the address stays a documentation IP.
  const json = JSON.parse(text) as { events: ScanEvent[]; result: ScanResult };
  const port = spec.validate ? 80 : 443;
  json.result.target = { host: spec.host, port };
  for (const e of json.events) if (e.type === 'start') e.target = { host: spec.host, port };
  if (json.result.findings.validation) json.result.findings.validation.payload.sentBytes = 48 * 1024 * 1024;
  for (const e of json.events) if (e.type === 'validation') e.validation.payload.sentBytes = 48 * 1024 * 1024;
  writeFileSync(`web/src/fixtures/${name}.json`, JSON.stringify(json, null, 2) + '\n');
  console.log(`${name}: ${json.result.assessment.stage} ${json.result.assessment.score} (${json.events.length} events)`);
}
