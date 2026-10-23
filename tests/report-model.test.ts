import { describe, expect, test } from 'bun:test';
import { applyEvent, initialReport, type ReportState } from '../web/src/report-model';
import protectedFixture from '../web/src/fixtures/protected.json';
import noPatchFixture from '../web/src/fixtures/no-patch.json';
import hiddenFixture from '../web/src/fixtures/hidden.json';
import notPhpFixture from '../web/src/fixtures/not-php.json';
import type { ScanEvent } from '../engine/scan';

function replay(fixture: unknown): ReportState[] {
  const f = fixture as { events: unknown[]; result: unknown };
  // The engine's HTTP face appends the result after the events; fixtures store them apart.
  const events = [...(f.events as ScanEvent[]), { type: 'result', result: f.result } as never];
  const states: ReportState[] = [initialReport()];
  for (const e of events) states.push(applyEvent(states.at(-1)!, e));
  return states;
}

describe('report model: the live report built from the event stream', () => {
  test('before any event the ring is empty and the status is idle', () => {
    const s = initialReport();
    expect(s.status).toBe('idle');
    expect(s.assessment.score).toBeNull();
    expect(s.assessment.stage).toBe('unreachable');
    expect(s.probes).toHaveLength(0);
  });

  test('replaying a fixture ends at the stage and score the engine computed, with one probe row per probe', () => {
    for (const [fixture, probes] of [
      [protectedFixture, 2],
      [noPatchFixture, 3],
    ] as const) {
      const last = replay(fixture).at(-1)!;
      expect(last.status).toBe('done');
      expect(last.assessment.stage as string).toBe(fixture.result.assessment.stage);
      expect(last.assessment.score).toBe(fixture.result.assessment.score);
      expect(last.probes).toHaveLength(probes);
      expect(last.validate).toBe(fixture.result.validate);
    }
  });

  test('the score never decreases while events arrive, and ends where the engine did', () => {
    for (const fixture of [protectedFixture, noPatchFixture, hiddenFixture]) {
      const scores = replay(fixture).map((s) => s.assessment.score ?? 0);
      for (let i = 1; i < scores.length; i++) expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1]);
      expect(scores.at(-1)).toBe(fixture.result.assessment.score);
    }
  });

  test('the fingerprint event fills the findings, so the stage word is live before the engine assesses', () => {
    const events = protectedFixture.events as ScanEvent[];
    let s = applyEvent(initialReport(), events[0]);
    expect(s.status).toBe('scanning');
    s = applyEvent(s, events.find((e) => e.type === 'fingerprint')!);
    expect(s.findings.versionText).toBe('8.3.36');
    expect(s.assessment.stage).toBe('protected');
  });

  test('a host that answered with no PHP sign is not-php once the fingerprint is in; probe rows alone never change the word', () => {
    const events = notPhpFixture.events as ScanEvent[];
    let s = applyEvent(initialReport(), events[0]);
    s = applyEvent(s, events.find((e) => e.type === 'probe' && e.id === 'home')!);
    expect(s.assessment.stage).toBe('unreachable');
    expect(s.probes).toHaveLength(1);
    s = applyEvent(s, events.find((e) => e.type === 'fingerprint')!);
    expect(s.findings.reachable).toBe(true);
    expect(s.assessment.stage).toBe('not-php');
  });

  test('the validation event lands in the findings and the note follows', () => {
    const events = noPatchFixture.events as ScanEvent[];
    let s = initialReport();
    for (const e of events) {
      s = applyEvent(s, e);
      if (e.type === 'validation') break;
    }
    expect(s.findings.validation?.verdict).toBe('triggered');
    expect(s.assessment.notes.some((n) => n.id === 'validation-reproduced')).toBe(true);
  });

  test('an in-band error ends the report with the message', () => {
    const s = applyEvent(initialReport(), { type: 'error', error: 'refused' } as never);
    expect(s.status).toBe('error');
    expect(s.error).toBe('refused');
  });

  test("an error keeps its code and params, so the page can say it in the reader's language", () => {
    const s = applyEvent(initialReport(), { type: 'error', error: 'Port 8443 ...', code: 'port-not-allowed', params: { port: 8443, allowed: [80, 443] } });
    expect(s.error).toBe('Port 8443 ...');
    expect(s.errorCode).toBe('port-not-allowed');
    expect(s.errorParams).toEqual({ port: 8443, allowed: [80, 443] });
    expect(applyEvent(initialReport(), { type: 'error', error: 'plain' })).toMatchObject({ errorCode: null, errorParams: {} });
  });
});
