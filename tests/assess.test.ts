import { describe, expect, test } from 'bun:test';
import { assess, emptyFindings, STAGE_LABEL, STAGE_MEANING, STAGES, STEPS, VERDICT, type Findings } from '../engine/assess';

/** A host that answered like rest.vulnweb.com did on 2026-10-23. */
function phpHost(version = '7.1.26', over: Partial<Findings> = {}): Findings {
  const f = emptyFindings();
  const [major, minor, patch] = version.split('.').map(Number);
  f.reachable = true;
  f.status = 200;
  f.serverSoftware = 'Apache/2.4.25 (Debian)';
  f.poweredBy = `PHP/${version}`;
  f.version = { major, minor, patch };
  f.versionText = version;
  f.egg = 'yes';
  return { ...f, ...over };
}

const triggered: Findings['validation'] = {
  verdict: 'triggered',
  baseline: { status: 401, bodyBytes: 29 },
  payload: { status: 200, bodyBytes: 0, sentBytes: 48 * 1024 * 1024, ms: 9200 },
  signature: 'an empty 200 where the application answered 401',
};

describe('assess: the exposure ladder', () => {
  test('nothing answered: unreachable, no score', () => {
    const a = assess(emptyFindings());
    expect(a.stage).toBe('unreachable');
    expect(a.score).toBeNull();
    expect(a.nextStep.id).toBe('check-address');
  });

  test('7.1.26: inside the range on an end-of-life branch, no patch, the step is an upgrade', () => {
    const a = assess(phpHost('7.1.26'));
    expect(a.stage).toBe('no-patch');
    expect(a.score).toBe(15);
    expect(a.nextStep.id).toBe('upgrade');
    expect(a.version.status).toBe('no-patch');
    expect(a.version.eol).toBe(true);
    expect(STEPS.upgrade.detail).toMatch(/8\.3/);
  });

  test('8.2.34: inside the range, a fixed release exists, the step names it', () => {
    const a = assess(phpHost('8.2.34'));
    expect(a.stage).toBe('exposed');
    expect(a.score).toBe(35);
    expect(a.nextStep.id).toBe('patch');
    expect(a.version.fixedRelease).toBe('8.2.35');
  });

  test('8.3.36: the fixed release is protected and there is nothing to do', () => {
    const a = assess(phpHost('8.3.36'));
    expect(a.stage).toBe('protected');
    expect(a.score).toBe(100);
    expect(a.nextStep.id).toBe('keep-current');
  });

  test('5.2.6: below the range, not affected, with the end-of-life note', () => {
    const a = assess(phpHost('5.2.6'));
    expect(a.stage).toBe('not-affected');
    expect(a.score).toBe(80);
    expect(a.nextStep.id).toBe('plan-upgrade');
    expect(a.notes.some((n) => n.id === 'eol-branch')).toBe(true);
  });

  test('PHP present (the egg answered) but no version: hidden, the step is to find out', () => {
    const a = assess(phpHost('7.1.26', { poweredBy: null, version: null, versionText: null }));
    expect(a.stage).toBe('hidden');
    expect(a.score).toBe(50);
    expect(a.nextStep.id).toBe('find-version');
  });

  test('a bare "X-Powered-By: PHP" counts as PHP present even before the egg answers', () => {
    const a = assess(phpHost('7.1.26', { poweredBy: 'PHP', version: null, versionText: null, egg: 'untested' }));
    expect(a.stage).toBe('hidden');
  });

  test('the host answered, no version and the egg not yet tested: hidden, never not-php (the live partial picture)', () => {
    const a = assess(phpHost('7.1.26', { poweredBy: null, version: null, versionText: null, egg: 'untested' }));
    expect(a.stage).toBe('hidden');
  });

  test('the host answered, no PHP sign anywhere and the egg said no: not PHP, no score', () => {
    const a = assess(phpHost('7.1.26', { poweredBy: null, version: null, versionText: null, egg: 'no', serverSoftware: 'nginx/1.24.0' }));
    expect(a.stage).toBe('not-php');
    expect(a.score).toBeNull();
    expect(a.nextStep.id).toBe('none');
  });

  test('a triggered validation with a hidden version lands on exposed, with the note', () => {
    const a = assess(phpHost('7.1.26', { poweredBy: null, version: null, versionText: null, validation: triggered }));
    expect(a.stage).toBe('exposed');
    expect(a.notes.some((n) => n.id === 'validation-reproduced')).toBe(true);
    expect(a.validation.status).toBe('triggered');
  });

  test('a triggered validation agrees with an in-range version and refines nothing', () => {
    const a = assess(phpHost('7.1.26', { validation: triggered }));
    expect(a.stage).toBe('no-patch');
    expect(a.notes.some((n) => n.id === 'validation-reproduced')).toBe(true);
  });

  test('a triggered validation that contradicts a patched version keeps the version and notes the disagreement', () => {
    const a = assess(phpHost('8.3.36', { validation: triggered }));
    expect(a.stage).toBe('protected');
    expect(a.notes.some((n) => n.id === 'validation-disagrees')).toBe(true);
  });

  test('a not-triggered validation never improves a version verdict', () => {
    const a = assess(phpHost('8.2.34', { validation: { ...triggered, verdict: 'not-triggered', signature: 'answered like the small one' } }));
    expect(a.stage).toBe('exposed');
    expect(a.notes.some((n) => n.id === 'validation-not-reproduced')).toBe(true);
  });

  test('the validation card says not run when there was no consent', () => {
    const a = assess(phpHost('8.2.34'));
    expect(a.validation.status).toBe('not-run');
  });
});

describe('the words the page, the API and the terminal share', () => {
  test('every stage has a label, a meaning and a verdict', () => {
    for (const id of STAGES) {
      expect(STAGE_LABEL[id].length).toBeGreaterThan(0);
      expect(STAGE_MEANING[id].length).toBeGreaterThan(20);
      expect(VERDICT[id].length).toBeGreaterThan(20);
    }
  });

  test('scores climb worse to better', () => {
    const s = (v: string) => assess(phpHost(v)).score!;
    expect(s('7.1.26')).toBeLessThan(s('8.2.34'));
    expect(s('8.2.34')).toBeLessThan(assess(phpHost('7.1.26', { poweredBy: null, version: null, versionText: null })).score!);
    expect(s('5.2.6')).toBeLessThan(s('8.3.36'));
  });

  test('no letter grades anywhere', () => {
    expect(Object.values(STAGE_LABEL).every((l) => l.length > 1)).toBe(true);
    const all = Object.values(STAGE_LABEL).join(' ') + ' ' + Object.values(STAGE_MEANING).join(' ');
    expect(all).not.toMatch(/\b[ABCDF][+-]\B|\bgrade\b/i);
  });
});
