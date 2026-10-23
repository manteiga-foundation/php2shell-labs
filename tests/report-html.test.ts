import { describe, expect, test } from 'bun:test';
import { renderReportHtml, REPORT_PAGES } from '../engine/report-html';
import noPatchFixture from '../web/src/fixtures/no-patch.json';
import protectedFixture from '../web/src/fixtures/protected.json';
import notPhpFixture from '../web/src/fixtures/not-php.json';
import type { ScanResult } from '../engine/events';

const when = new Date('2026-10-23T12:00:00Z');
const SHARE = 'https://php2shell-labs.taptok-test.workers.dev/r/abc';
const fixture = (f: { result: unknown }) => f.result as ScanResult;

describe('the PDF report HTML (five landscape pages)', () => {
  test('renders one slide per page with the host, the stage word, the share link and the page indicators', () => {
    const html = renderReportHtml(fixture(noPatchFixture), { generatedAt: when, shareUrl: SHARE });
    expect((html.match(/class="slide/g) ?? []).length).toBe(REPORT_PAGES);
    expect(html).toContain('no-patch.example:80');
    expect(html).toContain('NO PATCH');
    expect(html).toContain(`1 <span class="page-total">/ ${REPORT_PAGES}</span>`);
    expect(html).toContain(`${REPORT_PAGES} <span class="page-total">/ ${REPORT_PAGES}</span>`);
    expect(html).toContain('@page');
    expect(html).toContain('size: 11in 8.5in');
    expect(html).toContain(SHARE);
    expect(html).toContain('CVE-2026-109618');
  });

  test('the probe table has one row per question, and the validation evidence reads as a warning, never as a pass', () => {
    const html = renderReportHtml(fixture(noPatchFixture), { generatedAt: when, shareUrl: null });
    expect((html.match(/data-probe=/g) ?? []).length).toBe(3);
    expect(html).toMatch(/data-probe="Exploit validation">.*?class="answer warn">Bailout reproduced/s);
    expect(html).toContain('401');
    expect(html).toContain('48 MB');
  });

  test('without consent the validation row is still listed, as not run, and the method page says how to consent', () => {
    const html = renderReportHtml(fixture(protectedFixture), { generatedAt: when, shareUrl: null });
    expect((html.match(/data-probe=/g) ?? []).length).toBe(3);
    expect(html).toMatch(/data-probe="Exploit validation">.*?class="answer dim">Not run/s);
    expect(html).toContain('consent');
  });

  test('says the verdict and the one next step, never a letter grade, and never leaks placeholders', () => {
    for (const f of [noPatchFixture, protectedFixture, notPhpFixture]) {
      const result = fixture(f);
      const html = renderReportHtml(result, { generatedAt: when, shareUrl: null });
      expect(html).toContain(result.assessment.verdict);
      expect(html).toContain(result.assessment.nextStep.title);
      expect(html).not.toMatch(/undefined|NaN|\[object|null,|null of 100/);
      expect(html).not.toMatch(/\bgrade\b/i);
    }
  });

  test('a host that is not PHP has no number: the ring shows the word alone', () => {
    const html = renderReportHtml(fixture(notPhpFixture), { generatedAt: when, shareUrl: null });
    expect(html).toContain('NOT PHP');
    expect(html).not.toContain('of 100');
    expect(html).toContain('No score');
  });

  test('escapes what comes from the network (server headers)', () => {
    const result = JSON.parse(JSON.stringify(noPatchFixture.result)) as ScanResult;
    result.findings.serverSoftware = '<script>alert(1)</script>';
    const html = renderReportHtml(result, { generatedAt: when, shareUrl: null });
    expect(html).not.toContain('<script>alert(1)');
    expect(html).toContain('&lt;script&gt;');
  });

  test('uses only the bundled fonts, so the render is the same on every machine', () => {
    const html = renderReportHtml(fixture(protectedFixture), { generatedAt: when, shareUrl: null, fontBase: '/fonts' });
    expect(html).not.toContain('fonts.googleapis.com');
    expect(html).toContain("url('/fonts/");
  });
});
