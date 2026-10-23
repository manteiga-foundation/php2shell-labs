// The views' only door to data. Live: the edge's /api. Demo (?demo=<fixture>): recorded events
// replayed with short delays, so every view can be built and tested offline.

import type { ScanResult } from '../../engine/events';
import { demoMetrics, SCAN_FIXTURES, type MetricsData } from './fixtures';
import type { ScanErrorCode, ScanErrorParams } from './i18n/en';
import { pacer } from './pace';
import type { StreamEvent } from './report-model';

export function demoName(): string | null {
  const demo = new URLSearchParams(window.location.search).get('demo');
  return demo && demo in SCAN_FIXTURES ? demo : demo === '1' ? 'no-patch' : null;
}

export interface ScanHandle {
  cancel(): void;
}

const DEMO_DELAY_MS = 90;
/** Live events are released to the view at this pace so a fast host still shows the ring climbing. */
const LIVE_PACE_MS = 70;

export function startScan(host: string, validate: boolean, onEvent: (e: StreamEvent) => void, onEnd: () => void): ScanHandle {
  const demo = demoName();
  if (demo) return replayFixture(demo, host, onEvent, onEnd);

  const controller = new AbortController();
  const paced = pacer<StreamEvent>(onEvent, onEnd, LIVE_PACE_MS, displayRank);
  (async () => {
    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ host, validate }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string; params?: ScanErrorParams };
        const fallback = res.status === 429 ? { code: 'rate', error: 'Too many scans right now. Try again in a moment.' } : { code: 'start-failed', error: `The scan could not start (${res.status}).` };
        paced.push({ type: 'error', error: body.error ?? fallback.error, code: body.code ?? (body.error ? undefined : fallback.code), params: { status: res.status, ...body.params } });
        return;
      }
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (line) paced.push(JSON.parse(line) as StreamEvent);
        }
      }
    } catch {
      if (!controller.signal.aborted) paced.push({ type: 'error', error: 'The connection to the scanner was lost.', code: 'connection-lost' });
    } finally {
      paced.end();
    }
  })();
  return {
    cancel: () => {
      controller.abort();
      paced.cancel();
    },
  };
}

/** The order the reader sees: the start, what the host said of itself, the probe rows, the validation, then the result. */
function displayRank(e: StreamEvent): number {
  switch (e.type) {
    case 'start':
      return 0;
    case 'fingerprint':
      return 1;
    case 'probe':
      return e.id === 'validation' ? 4 : e.id === 'home' ? 2 : 3;
    case 'validation':
      return 5;
    case 'assessment':
    case 'done':
      return 6;
    case 'result':
      return 7;
    case 'saved':
      return 8;
    default:
      return 9;
  }
}

function replayFixture(name: string, host: string, onEvent: (e: StreamEvent) => void, onEnd: () => void): ScanHandle {
  const fixture = SCAN_FIXTURES[name];
  const alias = fixture.result.target.host;
  // The typed host may carry a port; the fixture keeps its own port and takes only the name.
  const bare = host.replace(/:\d+$/, '');
  const rename = <T,>(v: T): T => JSON.parse(JSON.stringify(v).replaceAll(alias, bare)) as T;
  // Shown in the same order as a live scan.
  const recorded: StreamEvent[] = [...fixture.events.map(rename), { type: 'result', result: rename(fixture.result) }, { type: 'saved', id: `demo-${name}` }];
  const events = recorded
    .map((e, i) => ({ e, i }))
    .sort((a, b) => displayRank(a.e) - displayRank(b.e) || a.i - b.i)
    .map(({ e }) => e);
  let i = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const step = () => {
    if (i >= events.length) {
      onEnd();
      return;
    }
    onEvent(events[i++]);
    timer = setTimeout(step, DEMO_DELAY_MS);
  };
  timer = setTimeout(step, DEMO_DELAY_MS);
  return {
    cancel: () => {
      if (timer) clearTimeout(timer);
    },
  };
}

export type LoadError = { error: string; code: ScanErrorCode; params: ScanErrorParams };

export async function loadResult(id: string): Promise<{ result: ScanResult } | LoadError> {
  if (id.startsWith('demo-')) {
    const fixture = SCAN_FIXTURES[id.slice(5)];
    return fixture ? { result: fixture.result } : { error: 'There is no such demo result.', code: 'no-demo', params: {} };
  }
  const res = await fetch(`/api/result/${encodeURIComponent(id)}`);
  if (!res.ok) {
    return res.status === 404
      ? { error: 'This result has expired or never existed. Results are kept for 30 days.', code: 'expired', params: {} }
      : { error: `The result could not be loaded (${res.status}).`, code: 'load-failed', params: { status: res.status } };
  }
  return { result: (await res.json()) as ScanResult };
}

export async function loadMetrics(): Promise<MetricsData | { error: string }> {
  const params = new URLSearchParams(window.location.search);
  // ?demo=1 replays the emulated metrics; &hosts=<n> lengthens the hosts list, to see it page.
  if (params.has('demo')) return demoMetrics(undefined, Math.max(0, Number(params.get('hosts')) || 0));
  const res = await fetch('/api/metrics');
  if (!res.ok) return { error: `Metrics could not be loaded (${res.status}).` };
  return (await res.json()) as MetricsData;
}
