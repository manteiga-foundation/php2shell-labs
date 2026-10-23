// A scan: resolve, read what the host says of itself (one visit plus PHP's logo query), with
// consent reproduce the out-of-memory condition once, assess. Findings stream out as events so a
// report can build live.

import { assess, emptyFindings } from './assess';
import { fingerprint, type PhpSign } from './fingerprint';
import { resolveTarget } from './resolve';
import type { Target } from './target';
import { validate as runValidation } from './trigger';

export type { ScanEvent, ScanResult } from './events';
import type { ScanEvent, ScanResult } from './events';

export interface ScanOptions {
  allowPrivate?: boolean;
  timeoutMs?: number;
  /** Consent: the exploit validation runs only when this is true. */
  validate?: boolean;
  /** Body sizes of the validation's control and large requests; tests shrink them. */
  baselineBytes?: number;
  payloadBytes?: number;
  onEvent?: (event: ScanEvent) => void;
}

export async function scan(target: Target, options: ScanOptions = {}): Promise<ScanResult> {
  const { allowPrivate = false, timeoutMs = 10000, validate = false, onEvent = () => {} } = options;
  const started = performance.now();
  const startedAt = new Date().toISOString();
  const resolved = await resolveTarget(target, { allowPrivate });
  onEvent({ type: 'start', target, address: resolved.address, startedAt, validate });

  const findings = emptyFindings();
  // TLS on 443, clear text elsewhere: the public edge allows only 80 and 443, and the fixtures speak plain HTTP.
  const tls = target.port === 443;
  const since = (t: number) => Math.round(performance.now() - t);

  const t0 = performance.now();
  const fp = await fingerprint(target.host, target.port, tls, timeoutMs, resolved.address);
  if (!fp.ok) {
    findings.reachable = false;
    findings.errors.push(`home: ${fp.error}`);
    onEvent({ type: 'probe', id: 'home', label: 'One ordinary visit', answer: 'error', detail: 'no answer', ms: since(t0) });
  } else {
    findings.reachable = true;
    findings.status = fp.status;
    findings.serverSoftware = fp.serverSoftware;
    findings.poweredBy = fp.poweredBy;
    findings.version = fp.version;
    findings.versionText = fp.versionText;
    findings.egg = fp.egg ? 'yes' : 'no';
    findings.signs = fp.signs;
    const said = [fp.serverSoftware, fp.poweredBy].filter(Boolean).join(', ');
    // The fingerprint goes first: it decides the stage, so the live ring never shows a word the probes then take back.
    onEvent({
      type: 'fingerprint',
      fingerprint: { status: fp.status, serverSoftware: fp.serverSoftware, poweredBy: fp.poweredBy, versionText: fp.versionText, version: fp.version, egg: fp.egg, signs: fp.signs },
      ms: since(t0),
    });
    onEvent({ type: 'probe', id: 'home', label: 'One ordinary visit', answer: 'yes', detail: `HTTP ${fp.status}${said ? `, ${said}` : ', no server header'}`, ms: since(t0) });
    onEvent({
      type: 'probe',
      id: 'egg',
      label: 'Signs of PHP',
      answer: fp.egg || fp.signs.length > 0 ? 'yes' : 'no',
      detail: fp.egg ? 'the logo query answered with the PHP image' : fp.signs.length ? signsText(fp.signs) : 'no session cookie, no .php links, no logo',
      ms: since(t0),
    });
  }

  // The validation needs consent and a PHP host; nothing is sent to a host that did not answer as PHP.
  const phpPresent = fp.ok && (fp.version !== null || fp.egg || fp.signs.length > 0 || (fp.poweredBy !== null && /php/i.test(fp.poweredBy)));
  if (validate && phpPresent) {
    const t1 = performance.now();
    const v = await runValidation(target.host, target.port, tls, { address: resolved.address, baselineBytes: options.baselineBytes, payloadBytes: options.payloadBytes });
    if (!v.ok) {
      findings.errors.push(`validation: ${v.error}`);
      onEvent({ type: 'probe', id: 'validation', label: 'Exploit validation', answer: 'error', detail: v.error === 'timeout' ? 'the large request timed out' : 'the host dropped the connection', ms: since(t1) });
    } else {
      findings.validation = { verdict: v.verdict, baseline: v.baseline, payload: v.payload, signature: v.signature };
      onEvent({ type: 'validation', validation: findings.validation });
      onEvent({ type: 'probe', id: 'validation', label: 'Exploit validation', answer: v.verdict === 'triggered' ? 'yes' : 'no', detail: v.signature, ms: since(t1) });
    }
  }

  const assessment = assess(findings);
  onEvent({ type: 'assessment', assessment });
  const ms = since(started);
  onEvent({ type: 'done', ms });
  return { target, address: resolved.address, startedAt, ms, validate, findings, assessment };
}

/** The signs in words, for the probe row. */
function signsText(signs: PhpSign[]): string {
  const words: Record<PhpSign, string> = { cookie: 'a PHPSESSID cookie', links: '.php links on the page', logo: 'the PHP logo' };
  return signs.map((s) => words[s]).join(', ');
}
