import { describe, expect, test } from 'bun:test';
import { banner, colorMode, plain, renderReport, summary } from '../engine/terminal';
import type { ScanResult } from '../engine/events';
import protectedFixture from '../web/src/fixtures/protected.json';
import exposedFixture from '../web/src/fixtures/exposed.json';
import noPatchFixture from '../web/src/fixtures/no-patch.json';
import notPhpFixture from '../web/src/fixtures/not-php.json';

// The terminal renderer: what `bun run scan` prints. Pure text in, so the tests read it as a
// reader would; colours are a mode and strip cleanly.

const protectedR = protectedFixture.result as unknown as ScanResult;
const exposedR = exposedFixture.result as unknown as ScanResult;
const noPatchR = noPatchFixture.result as unknown as ScanResult;
const notPhpR = notPhpFixture.result as unknown as ScanResult;
const wide = { mode: 'none' as const, columns: 120 };

describe('colour mode', () => {
  test('follows NO_COLOR, the TTY and COLORTERM', () => {
    expect(colorMode({ NO_COLOR: '1', COLORTERM: 'truecolor' }, true)).toBe('none');
    expect(colorMode({}, false)).toBe('none');
    expect(colorMode({ COLORTERM: 'truecolor' }, true)).toBe('truecolor');
    expect(colorMode({}, true)).toBe('256');
    expect(colorMode({ FORCE_COLOR: '3' }, false)).toBe('truecolor');
  });
});

describe('the banner', () => {
  test('is block letters when the terminal is wide, one line when it is not, with the version', () => {
    const big = banner('0.2.0', wide);
    expect(big.split('\n').length).toBeGreaterThan(6);
    expect(big).toContain('PHP2SHELL EXPOSURE');
    expect(big).toContain('v0.2.0');
    const small = banner('0.2.0', { mode: 'none', columns: 40 });
    expect(small).toContain('P 2 S H E L L');
    expect(small.split('\n').length).toBeLessThan(6);
  });

  test('colours strip back to the plain text', () => {
    const coloured = banner('0.2.0', { mode: 'truecolor', columns: 120 });
    expect(coloured).toContain('\x1b[');
    expect(plain(coloured)).toBe(banner('0.2.0', wide));
  });
});

describe('a report', () => {
  test('leads with the host, the stage word and the score, then the verdict and the one next step', () => {
    const out = renderReport(protectedR, wide);
    const lines = out.split('\n').map((l) => l.trimEnd());
    const head = lines.find((l) => l.includes('protected.example'))!;
    expect(head).toMatch(/PROTECTED/);
    expect(head).toMatch(/100 \/ 100/);
    expect(out).toContain(protectedR.assessment.verdict);
    expect(out).toContain('Next step');
    expect(out).toContain(protectedR.assessment.nextStep.title);
  });

  test('has the three cards in order and the probes after them; a reproduced bailout reads as the warning it is', () => {
    const out = renderReport(noPatchR, wide);
    const i = (s: string) => out.indexOf(s);
    expect(i('Version')).toBeGreaterThan(-1);
    expect(i('Version')).toBeLessThan(i('Validation'));
    expect(i('Validation')).toBeLessThan(i('Foundations'));
    expect(i('Foundations')).toBeLessThan(i('Probes'));
    expect(out).toMatch(/Foundations\s+\d of 4 in place/);
    expect(out).toContain('PHP 7.1.26');
    expect(out).toMatch(/bailout reproduced/);
    const coloured = renderReport(noPatchR, { ...wide, mode: 'truecolor' });
    expect(coloured).toMatch(/\x1b\[38;2;200;128;0m[^\n]*bailout reproduced/);
  });

  test('the validation card says it did not run without consent, never that the host passed', () => {
    const out = renderReport(exposedR, wide);
    expect(out).toMatch(/Validation\s+not run/);
    expect(out).not.toMatch(/not triggered/);
  });

  test('the score breakdown and the step detail appear only with --verbose', () => {
    const quiet = renderReport(protectedR, wide);
    const verbose = renderReport(protectedR, { ...wide, verbose: true });
    expect(quiet).not.toContain('Score breakdown');
    expect(verbose).toContain('Score breakdown');
    expect(verbose).toContain(protectedR.assessment.nextStep.detail.slice(0, 40));
  });

  test('a no-patch host says so in the stage word and the next step', () => {
    const out = renderReport(noPatchR, wide);
    expect(out).toContain('NO PATCH');
    expect(out).toContain('Upgrade to a supported PHP branch');
  });

  test('a host that is not PHP shows the stage word without a number', () => {
    const out = renderReport(notPhpR, wide);
    expect(out).toContain('NOT PHP');
    expect(out).not.toMatch(/\d+ \/ 100/);
  });

  test('fits 80 columns without a line running over', () => {
    for (const r of [noPatchR, exposedR, protectedR, notPhpR]) {
      const out = renderReport(r, { mode: 'none', columns: 80, verbose: true });
      for (const line of out.split('\n')) expect(line.length, line).toBeLessThanOrEqual(80);
    }
  });

  test('a share link is shown when given', () => {
    const out = renderReport(protectedR, { ...wide, share: { url: 'https://php2shell-labs.example/r/abc', pdf: 'https://php2shell-labs.example/api/report/abc.pdf' } });
    expect(out).toContain('php2shell-labs.example/r/abc');
    expect(out).toContain('abc.pdf');
  });
});

describe('the summary', () => {
  test('is one line per host, worst first, with a count by stage', () => {
    const out = summary([protectedR, exposedR, noPatchR], wide);
    const lines = out.split('\n').filter((l) => /example/.test(l));
    expect(lines.length).toBe(3);
    expect(lines[0]).toContain('NO PATCH');
    expect(lines[2]).toContain('PROTECTED');
    expect(out).toMatch(/1 exposed/);
    expect(out).toMatch(/1 protected/);
  });
});
