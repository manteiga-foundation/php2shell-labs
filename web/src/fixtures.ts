// Emulated data for the views: recorded scans (neutral host names) and emulated metrics.
// Everything the views can show is exercised here before any backend is wired.

import type { ScanEvent, ScanResult } from '../../engine/events';
import exposed from './fixtures/exposed.json';
import hidden from './fixtures/hidden.json';
import noPatch from './fixtures/no-patch.json';
import notPhp from './fixtures/not-php.json';
import protectedHost from './fixtures/protected.json';

export interface ScanFixture {
  events: ScanEvent[];
  result: ScanResult;
}

export const SCAN_FIXTURES: Record<string, ScanFixture> = {
  'no-patch': noPatch as unknown as ScanFixture,
  exposed: exposed as unknown as ScanFixture,
  hidden: hidden as unknown as ScanFixture,
  'not-php': notPhp as unknown as ScanFixture,
  protected: protectedHost as unknown as ScanFixture,
};

export const FIXTURE_NAMES = Object.keys(SCAN_FIXTURES);

/** The metrics the private view shows, generated deterministically for 30 days. */
export interface MetricsData {
  generatedAt: string;
  totals: { scans: number; hosts: number; cacheHits: number; sharedOpens: number; pdfDownloads: number; failures: number; validations?: number; medianScore?: number; countries?: number };
  days: { date: string; scans: number; hosts: number; stages: Record<string, number>; failures: number; validations?: number; p50: number; p95: number }[];
  failures: { reason: string; count: number }[];
  referrers: { source: string; count: number }[];
  countries: { country: string; count: number }[];
  signals: { label: string; detail: string }[];
  hosts: HostRow[];
}

export interface HostRow {
  host: string;
  port: number;
  stage: string;
  score: number;
  scans: number;
  lastId: string;
  lastAt: string;
}

/** Filler rows for the demo, so a long list pages: neutral names, a stage each, deterministic. */
function extraHosts(n: number, from: string): HostRow[] {
  const stages = ['no-patch', 'exposed', 'hidden', 'protected'];
  const scores: Record<string, number> = { 'no-patch': 15, exposed: 35, hidden: 50, protected: 100 };
  return Array.from({ length: Math.min(500, Math.max(0, Math.trunc(n))) }, (_, i) => {
    const stage = stages[i % stages.length];
    const at = new Date(Date.parse(from + 'T12:00:00Z') - i * 3600_000).toISOString();
    return { host: `host-${String(i + 1).padStart(3, '0')}.example`, port: 443, stage, score: scores[stage], scans: 1 + (i % 9), lastId: `demo-${stage}`, lastAt: at };
  });
}

export function demoMetrics(now = new Date('2026-10-23T12:00:00Z'), hostCount = 0): MetricsData {
  let seed = 7;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const days: MetricsData['days'] = [];
  for (let i = 29; i >= 0; i--) {
    const date = new Date(now.getTime() - i * 86400_000).toISOString().slice(0, 10);
    const growth = 1 + (29 - i) / 12;
    const scans = Math.round((40 + rand() * 60) * growth);
    const hosts = Math.round(scans * (0.55 + rand() * 0.2));
    const failures = Math.round(scans * (0.03 + rand() * 0.04));
    const ok = scans - failures;
    const protectedShare = 0.3 + (29 - i) * 0.005;
    const noPatchShare = 0.18 - (29 - i) * 0.002;
    const exposedShare = 0.2 - (29 - i) * 0.002;
    const notPhpShare = 0.15;
    const stages: Record<string, number> = {
      'no-patch': Math.round(ok * noPatchShare),
      exposed: Math.round(ok * exposedShare),
      hidden: 0,
      'not-affected': Math.round(ok * 0.02),
      protected: Math.round(ok * protectedShare),
      'not-php': Math.round(ok * notPhpShare),
    };
    stages.hidden = ok - stages['no-patch'] - stages.exposed - stages['not-affected'] - stages.protected - stages['not-php'];
    days.push({ date, scans, hosts, stages, failures, validations: Math.round(scans * 0.12), p50: Math.round(300 + rand() * 200), p95: Math.round(1200 + rand() * 900) });
  }
  const totals = days.reduce(
    (t, d) => ({
      ...t,
      scans: t.scans + d.scans,
      hosts: t.hosts + d.hosts,
      cacheHits: t.cacheHits + Math.round(d.scans * 0.3),
      sharedOpens: t.sharedOpens + Math.round(d.scans * 0.18),
      pdfDownloads: t.pdfDownloads + Math.round(d.scans * 0.07),
      failures: t.failures + d.failures,
      validations: (t.validations ?? 0) + (d.validations ?? 0),
    }),
    { scans: 0, hosts: 0, cacheHits: 0, sharedOpens: 0, pdfDownloads: 0, failures: 0, validations: 0, medianScore: 50, countries: 14 } as MetricsData['totals'],
  );
  return {
    generatedAt: now.toISOString(),
    totals,
    days,
    failures: [
      { reason: 'Host does not resolve', count: Math.round(totals.failures * 0.46) },
      { reason: 'Connection timed out', count: Math.round(totals.failures * 0.27) },
      { reason: 'Refused: not a public address', count: Math.round(totals.failures * 0.17) },
      { reason: 'Port not allowed', count: Math.round(totals.failures * 0.1) },
    ],
    referrers: [
      { source: 'Direct', count: Math.round(totals.scans * 0.41) },
      { source: 'linkedin.com', count: Math.round(totals.scans * 0.24) },
      { source: 'Search', count: Math.round(totals.scans * 0.2) },
      { source: 'github.com', count: Math.round(totals.scans * 0.09) },
      { source: 'Other', count: Math.round(totals.scans * 0.06) },
    ],
    countries: [
      { country: 'United States', count: Math.round(totals.scans * 0.38) },
      { country: 'Germany', count: Math.round(totals.scans * 0.13) },
      { country: 'Brazil', count: Math.round(totals.scans * 0.11) },
      { country: 'France', count: Math.round(totals.scans * 0.09) },
      { country: 'Other', count: Math.round(totals.scans * 0.29) },
    ],
    hosts: [
      { host: 'protected.example', port: 443, stage: 'protected', score: 100, scans: 12, lastId: 'demo-protected', lastAt: days[29].date + 'T10:12:00Z' },
      { host: 'hidden.example', port: 443, stage: 'hidden', score: 50, scans: 7, lastId: 'demo-hidden', lastAt: days[28].date + 'T22:05:00Z' },
      { host: 'exposed.example', port: 443, stage: 'exposed', score: 35, scans: 2, lastId: 'demo-exposed', lastAt: days[28].date + 'T09:30:00Z' },
      { host: 'no-patch.example', port: 80, stage: 'no-patch', score: 15, scans: 4, lastId: 'demo-no-patch', lastAt: days[27].date + 'T15:02:00Z' },
      { host: 'not-php.example', port: 80, stage: 'not-php', score: 0, scans: 1, lastId: 'demo-not-php', lastAt: days[26].date + 'T08:44:00Z' },
      ...extraHosts(hostCount, days[25].date),
    ],
    signals: [
      { label: 'Validation consent', detail: 'About one scan in eight runs the exploit validation; four of five of those reproduce the bailout on hosts already placed by their version.' },
      { label: 'Ports requested', detail: '8080 asked 31 times, 8443 asked 12 times. Demand for the next allowlist.' },
      { label: 'Hidden versions', detail: 'A fifth of PHP hosts hide the version header; the validation is the only way to place them.' },
    ],
  };
}
