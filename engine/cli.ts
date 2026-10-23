// `bun run scan <host> [...]`: the engine from the terminal, rendered by engine/terminal.ts.
//
//   --validate    consent to the exploit validation (one ~48 MB request to the host)
//   --verbose     the score's parts, the next step's detail, the notes
//   --share       also record the scan through the public API and print the share and PDF links
//   --json        the ScanResult as JSON on stdout (one per line), nothing else
//   --private     allow non-public addresses (your own network)
//   --no-banner   skip the banner
// Exit code 1 when any host is exposed (Exposed, No patch or Hidden), 0 otherwise: CI-friendly.
// Colours follow the terminal: NO_COLOR, FORCE_COLOR and COLORTERM are honoured.

import { scan } from './scan';
import { ENGINE_VERSION } from './server';
import { parseTarget, TargetError } from './target';
import { banner, colorMode, renderReport, summary, type TerminalOptions } from './terminal';
import type { ScanResult } from './events';

const PUBLIC_ORIGIN = process.env.PHP2SHELL_ORIGIN ?? 'https://php2shell-labs.taptok-test.workers.dev';
const EXPOSED_STAGES = new Set(['exposed', 'no-patch', 'hidden']);

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const hosts = args.filter((a) => !a.startsWith('--'));
if (hosts.length === 0 || flags.has('--help')) {
  console.error('usage: bun run scan <host[:port]> [...] [--validate] [--verbose] [--share] [--json] [--private] [--no-banner]');
  process.exit(hosts.length === 0 ? 2 : 0);
}

const json = flags.has('--json');
const validate = flags.has('--validate');
const o: TerminalOptions = {
  mode: json ? 'none' : colorMode(process.env, process.stdout.isTTY ?? false),
  columns: process.stdout.columns ?? 100,
  verbose: flags.has('--verbose'),
};
const write = (s: string) => process.stdout.write(s + '\n');

if (!json && !flags.has('--no-banner')) write(banner(ENGINE_VERSION, o));

const results: ScanResult[] = [];
for (const raw of hosts) {
  try {
    const target = parseTarget(raw);
    const result = await scan(target, { allowPrivate: flags.has('--private'), validate });
    results.push(result);
    if (json) {
      write(JSON.stringify(result));
      continue;
    }
    const share = flags.has('--share') ? await shareScan(target.host, target.port, validate) : null;
    write(renderReport(result, { ...o, share }));
  } catch (e) {
    if (e instanceof TargetError) write(json ? JSON.stringify({ error: e.message, host: raw }) : `  refused: ${e.message}`);
    else if (e instanceof Error) write(json ? JSON.stringify({ error: e.message, host: raw }) : `  ${raw}: ${e.message}`);
    else throw e;
  }
}
if (!json && results.length > 1) write(summary(results, o));
process.exit(results.some((r) => EXPOSED_STAGES.has(r.assessment.stage)) ? 1 : 0);

/** Records the scan through the public API (the public rate limits apply) and returns its links. */
async function shareScan(host: string, port: number, validate: boolean): Promise<{ url: string; pdf: string } | null> {
  try {
    const res = await fetch(`${PUBLIC_ORIGIN}/api/scan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ host: port === 443 ? host : `${host}:${port}`, validate }),
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { url?: string; pdf?: string };
    return body.url && body.pdf ? { url: body.url, pdf: body.pdf } : null;
  } catch {
    return null;
  }
}
