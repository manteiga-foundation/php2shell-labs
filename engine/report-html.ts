// The PDF report: landscape Letter pages in the spirit of the medet.ink archetypes (one .slide
// per page, left accent bar, faint grid, section title light + black, divider, cards, footer with
// the public-result block and the page indicator), in PHP2Shell Labs' own identity. Pure: a
// ScanResult in, an HTML document out. The renderer prints it with Chromium.

import { STAGE_LABEL, STAGE_MEANING, type Assessment, type Findings, type Stage } from './assess';
import type { ScanResult } from './events';
import type { PhpSign } from './fingerprint';

export const REPORT_PAGES = 5;

export const FONT_FILES = ['titillium-web-latin-400-normal.woff2', 'titillium-web-latin-600-normal.woff2', 'titillium-web-latin-700-normal.woff2', 'jetbrains-mono-latin-400-normal.woff2'] as const;
export type FontFile = (typeof FONT_FILES)[number];

export interface ReportOptions {
  generatedAt: Date;
  shareUrl: string | null;
  /** Where the bundled fonts come from: a URL prefix (`/fonts` by default) or, for a self-contained document, a map of file name to data URL. */
  fontBase?: string;
  fontUrls?: Partial<Record<FontFile, string>>;
  /** Optional client or organization name for the cover. Escaped like everything else. */
  preparedFor?: string | null;
}

const esc = (v: unknown): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const STAGE_COLOUR: Record<Stage, string> = {
  unreachable: '#64748B',
  'not-php': '#94A3B8',
  'no-patch': '#D9463B',
  exposed: '#E0633F',
  hidden: '#C9961E',
  'not-affected': '#1F9D6B',
  protected: '#157A54',
};

const INK = '#0A2540';
const BASE = '#1034A6';
const GOLD = '#B8902E';

const CVES = 'CVE-2026-109618 and CVE-2026-109619';
const FIXED = '8.5.12, 8.4.27, 8.3.36 and 8.2.35';

function dateLine(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function hostOf(result: ScanResult): string {
  const { host, port } = result.target;
  return port === 443 ? host : `${host}:${port}`;
}

function yesNo(v: boolean | null, yes: string, no: string, unknown = 'Not measured'): string {
  return v === null ? unknown : v ? yes : no;
}

const mb = (bytes: number) => `${Math.round(bytes / 1_048_576)} MB`;
const kb = (bytes: number) => (bytes >= 1_048_576 ? mb(bytes) : bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} bytes`);

/** The ring: the score's share of the circle, or the full track in the stage's colour when there is no score. */
function ring(stage: Stage, score: number | null, size: number, stroke: number): string {
  const r = size / 2 - stroke;
  const c = 2 * Math.PI * r;
  const offset = score === null ? 0 : c * (1 - Math.max(0, Math.min(100, score)) / 100);
  return `<svg class="ring" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#E2E8F0" stroke-width="${stroke}"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${STAGE_COLOUR[stage]}" stroke-width="${stroke}" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}" transform="rotate(-90 ${size / 2} ${size / 2})"${score === null ? ' opacity="0.35"' : ''}/>
  </svg>`;
}

function footer(page: number, result: ScanResult, when: Date): string {
  return `<div class="footer">
    <div class="footer-info">
      <div class="confidential-block"><strong>Public result.</strong> This report describes the PHP2Shell exposure of ${esc(hostOf(result))} as observed from the public Internet on ${esc(dateLine(when))}. It contains no private data and may be shared.</div>
      <div class="footer-bottom-row"><span class="footer-mark"></span><span class="footer-line"><strong>PHP2Shell Labs</strong> · PHP2Shell exposure report · A Manteiga Foundation project</span><span class="tag">${esc(CVES)}</span></div>
    </div>
    <div class="footer-right"><span class="page-indicator">${page} <span class="page-total">/ ${REPORT_PAGES}</span></span></div>
  </div>`;
}

function slide(page: number, result: ScanResult, when: Date, body: string, extraClass = ''): string {
  return `<div class="slide ${extraClass}" data-page="${page}">
    <div class="content">${body}</div>
    ${footer(page, result, when)}
  </div>`;
}

function title(light: string, strong: string): string {
  return `<h2 class="section-title">${esc(light)} <strong>${esc(strong)}</strong></h2><div class="divider"></div>`;
}

/** The ladder as the reader climbs it: the scored stages, worst first. */
const STAGES: Stage[] = ['no-patch', 'exposed', 'hidden', 'not-affected', 'protected'];

function ladder(stage: Stage): string {
  const index = STAGES.indexOf(stage);
  return `<div class="ladder">${STAGES.map(
    (s, i) => `<div class="rung ${i === index ? 'current' : index >= 0 && i < index ? 'passed' : ''}" style="--rung:${STAGE_COLOUR[s]}">
      <div class="rung-word">${esc(STAGE_LABEL[s])}</div>
      <div class="rung-desc">${esc(STAGE_MEANING[s])}</div>
      ${i === index ? '<div class="rung-marker">This host</div>' : ''}
    </div>`,
  ).join('')}</div>`;
}

function card(heading: string, state: string, stateColour: string, text: string, items: string[]): string {
  return `<div class="card">
    <h3>${esc(heading)}</h3>
    <div class="state" style="color:${stateColour}">${esc(state)}</div>
    <p>${esc(text)}</p>
    <ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>
  </div>`;
}

const SIGN_WORDS: Record<PhpSign, string> = { cookie: 'A PHPSESSID cookie', links: 'Links to .php pages', logo: 'The PHP logo' };
const signWords = (signs: PhpSign[]) => signs.map((s) => SIGN_WORDS[s]).join('; ');

function probeRows(f: Findings): string {
  const rows: { label: string; kind: string; answer: string; cls: string }[] = [];
  rows.push({
    label: 'One ordinary visit',
    kind: 'GET /, the request a browser makes',
    answer: f.reachable === true ? `Answered ${f.status ?? ''}${f.serverSoftware ? ` · ${f.serverSoftware}` : ''}${f.poweredBy ? ` · ${f.poweredBy}` : ''}`.trim() : f.reachable === false ? 'No answer' : 'Not measured',
    cls: f.reachable === true ? 'yes' : f.reachable === false ? 'err' : 'dim',
  });
  rows.push({
    label: 'Signs of PHP',
    kind: 'A PHPSESSID cookie, .php links on the page, the logo query (PHP 5.4 and older)',
    answer: f.egg === 'yes' ? 'The logo query answered with the PHP image' : f.signs.length ? signWords(f.signs) : f.egg === 'no' ? 'None: no cookie, no .php links, no logo' : f.egg === 'error' ? 'No answer' : 'Not measured',
    cls: f.egg === 'yes' || f.signs.length ? 'yes' : f.egg === 'no' ? 'no' : f.egg === 'error' ? 'err' : 'dim',
  });
  const v = f.validation;
  // The reproduced bailout is a warning about the host, never a pass.
  rows.push({
    label: 'Exploit validation',
    kind: v ? `One ${kb(v.baseline.bodyBytes)} control request, then one ${mb(v.payload.sentBytes)} chunked request` : 'With consent only',
    answer: v ? (v.verdict === 'triggered' ? `Bailout reproduced: ${v.signature}` : `Not reproduced: ${v.signature}`) : 'Not run',
    cls: v ? (v.verdict === 'triggered' ? 'warn' : 'no') : 'dim',
  });
  return rows
    .map((r) => `<tr data-probe="${esc(r.label)}"><td>${esc(r.label)}<div class="kind">${esc(r.kind)}</div></td><td class="answer ${r.cls}">${esc(r.answer)}</td></tr>`)
    .join('');
}

function evidenceRows(f: Findings): string {
  const v = f.validation;
  if (!v) return '<tr><td colspan="4" class="dim">The validation did not run: it needs the consent box on the web, --validate on the command line or validate: true on the API.</td></tr>';
  return `<tr><td class="dim">Control</td><td class="mono">${esc(kb(v.baseline.bodyBytes))} posted</td><td class="mono">${v.baseline.status}</td><td class="mono">${esc(kb(v.baseline.bodyBytes))} body</td></tr>
    <tr><td class="dim">Payload</td><td class="mono">${esc(mb(v.payload.sentBytes))} chunked, ${(v.payload.ms / 1000).toFixed(1)} s</td><td class="mono">${v.payload.status}</td><td class="mono">${esc(kb(v.payload.bodyBytes))} body</td></tr>`;
}

function heading(a: Assessment): string {
  switch (a.stage) {
    case 'no-patch':
    case 'exposed':
      return 'Exposed to PHP2Shell';
    case 'hidden':
      return 'Version hidden';
    case 'not-affected':
      return 'Not affected';
    case 'protected':
      return 'Not exposed';
    case 'not-php':
      return 'Not a PHP host';
    default:
      return 'Unreachable';
  }
}

function execParagraphs(result: ScanResult, a: Assessment): string[] {
  const host = hostOf(result);
  const v = result.findings.validation;
  const p1 = `On ${dateLine(new Date(result.startedAt))}, PHP2Shell Labs tested ${host} (${result.address}) from the public Internet: one ordinary visit and PHP's old logo query, the traffic a browser visit causes${v ? `, and, with the operator's consent, the exploit validation: one control request of ${kb(v.baseline.bodyBytes)} and one chunked request of ${mb(v.payload.sentBytes)}` : ''}. The question was a narrow one: is this host exposed to PHP2Shell (${CVES}), and what is the next step.`;
  const p2 =
    a.stage === 'unreachable' || a.stage === 'not-php'
      ? a.verdict
      : a.stage === 'protected'
        ? `${a.verdict} The fixed releases (${FIXED}) close both CVEs; the host runs one of them or newer.`
        : a.stage === 'not-affected'
          ? `${a.verdict} The flaw was introduced in PHP 5.4; the branch this host runs predates it. It is, however, long out of support.`
          : a.stage === 'hidden'
            ? `${a.verdict} ${v ? (a.validation.status === 'triggered' ? 'The validation reproduced the out-of-memory bailout, which places the host inside the affected range.' : 'The validation did not reproduce the bailout within the 48 MB test; the version remains the open question.') : 'The validation, which can place a hidden version, did not run.'}`
            : `${a.verdict} ${a.stage === 'no-patch' ? `No fixed release exists for the ${a.version.branch ?? 'this'} branch.` : `The fixed release for this branch is ${a.version.fixedRelease ?? 'available'}.`}${v ? (a.validation.status === 'triggered' ? ' The exploit validation reproduced the out-of-memory bailout, confirming the version.' : ' The exploit validation did not reproduce the bailout within 48 MB; the version still places the host inside the range.') : ''}`;
  const p3 = `PHP2Shell is a pair of flaws in how PHP reads a large multipart request: a crafted upload drives the process out of memory and, chained with the second flaw, to code execution. The version decides exposure; the validation is evidence that refines it. This report measures PHP2Shell only, not general PHP hygiene. The stage name is the summary${a.score !== null ? `; the score under it (${a.score} of 100) is for those who want a number` : ''}.`;
  return [p1, p2, p3];
}

export function renderReportHtml(result: ScanResult, options: ReportOptions): string {
  const { generatedAt, shareUrl, fontBase = '/fonts', fontUrls = {}, preparedFor = null } = options;
  const font = (file: FontFile) => fontUrls[file] ?? `${fontBase}/${file}`;
  const a = result.assessment;
  const f = result.findings;
  const host = hostOf(result);
  const colour = STAGE_COLOUR[a.stage];
  const fo = a.foundations;
  const inPlace = [fo.reachable, fo.phpPresent, fo.versionDisclosed, fo.supportedBranch].filter((v) => v === true).length;
  const scoreBlock = a.score === null ? `<div class="of">No score</div>` : `<div class="num">${a.score}</div><div class="of">of 100</div>`;
  const vs = a.version;
  const versionState =
    vs.status === 'patched' ? 'Fixed release' : vs.status === 'vulnerable' ? 'Inside the affected range' : vs.status === 'no-patch' ? 'Affected, end-of-life branch' : vs.status === 'below-range' ? 'Older than the flaw' : vs.status === 'hidden' ? 'Hidden' : vs.status === 'absent' ? 'No PHP seen' : 'Not read';
  const versionColour = vs.status === 'patched' ? STAGE_COLOUR.protected : vs.status === 'vulnerable' ? STAGE_COLOUR.exposed : vs.status === 'no-patch' ? STAGE_COLOUR['no-patch'] : vs.status === 'below-range' ? STAGE_COLOUR['not-affected'] : vs.status === 'hidden' ? STAGE_COLOUR.hidden : INK;
  const val = a.validation;
  const validationState = val.status === 'triggered' ? 'Bailout reproduced' : val.status === 'not-triggered' ? 'Not reproduced' : 'Not run';
  const validationColour = val.status === 'triggered' ? STAGE_COLOUR.hidden : INK;

  const cover = `<div class="slide cover" data-page="1">
    <div class="cover-body">
      <div class="brand"><span class="mark"></span>PHP2Shell Labs</div>
      <div class="cover-kicker">PHP2Shell exposure report</div>
      <h1 class="cover-host">${esc(host)}</h1>
      <div class="cover-meta">${esc(dateLine(generatedAt))}${preparedFor ? ` · Prepared for ${esc(preparedFor)}` : ''}</div>
      <div class="cover-grid">
        <div class="cover-ring">${ring(a.stage, a.score, 260, 18)}<div class="cover-ring-text"><div class="word" style="color:${colour}">${esc(STAGE_LABEL[a.stage])}</div>${scoreBlock}</div></div>
        <div class="cover-verdict">
          <div class="cover-heading">${esc(heading(a))}</div>
          <p>${esc(a.verdict)}</p>
          <div class="next"><div class="label">The one next step</div><div class="title">${esc(a.nextStep.title)}</div></div>
        </div>
      </div>
    </div>
    <div class="footer cover-footer">
      <div class="footer-info">
        <div class="confidential-block"><strong>Public result.</strong> Observed from the public Internet; contains no private data and may be shared.${shareUrl ? ` Live result: ${esc(shareUrl)}` : ''}</div>
        <div class="footer-bottom-row"><span class="footer-mark"></span><span class="footer-line"><strong>PHP2Shell Labs</strong> · A Manteiga Foundation project · manteiga.org</span></div>
      </div>
      <div class="footer-right"><span class="page-indicator">1 <span class="page-total">/ ${REPORT_PAGES}</span></span></div>
    </div>
  </div>`;

  const summary = slide(
    2,
    result,
    generatedAt,
    `${title('Executive', 'summary')}
    <div class="exec-text">${execParagraphs(result, a)
      .map((p) => `<p>${esc(p)}</p>`)
      .join('')}</div>
    <div class="rating-card">
      <div class="rating-callout"><div class="label">The one next step</div><div class="title">${esc(a.nextStep.title)}</div><p>${esc(a.nextStep.detail)}</p></div>
      <div class="rating-visual">${ring(a.stage, a.score, 140, 14)}<div class="rating-visual-text" style="color:${colour}">${esc(STAGE_LABEL[a.stage])}${a.score !== null ? `<br><span class="rating-score">${a.score}</span>` : ''}</div><div class="rating-label">Exposure</div></div>
    </div>
    <div class="legend-container">${STAGES.map(
      (st) => `<div class="legend-item ${st === a.stage ? 'current' : ''}" style="--rung:${STAGE_COLOUR[st]}"><div class="legend-dot"></div><div class="legend-content"><div class="legend-title">${esc(STAGE_LABEL[st])}</div><div class="legend-desc">${esc(STAGE_MEANING[st])}</div></div></div>`,
    ).join('')}</div>`,
  );

  const findings = slide(
    3,
    result,
    generatedAt,
    `${title('Where the host', 'stands')}
    ${ladder(a.stage)}
    <div class="cards">
      ${card(
        'Version · exposure',
        versionState,
        versionColour,
        'The version decides. PHP 5.4 through 8.5.11 contains the flaw; the fixed releases close it; branches 8.1 and older will never receive it.',
        [
          `PHP: ${vs.text ?? (vs.status === 'hidden' ? 'hidden (expose_php off or a proxy)' : vs.status === 'absent' ? 'none seen' : 'not read')}`,
          `Branch: ${vs.branch ?? 'unknown'}${vs.eol === true ? ' (end-of-life)' : vs.eol === false ? ' (supported)' : ''}`,
          `Fixed in: ${vs.fixedRelease ?? (vs.status === 'no-patch' ? 'no release; upgrade the branch' : 'n/a')}`,
          `Server: ${f.serverSoftware ?? 'not stated'}`,
          `X-Powered-By: ${f.poweredBy ?? 'not stated'}`,
        ],
      )}
      ${card(
        'Validation · evidence',
        validationState,
        validationColour,
        val.status === 'not-run'
          ? 'Runs only with the operator\'s consent: one small control request and one chunked request of about 48 MB, judged by the answer. Nothing is executed on the host.'
          : val.status === 'triggered'
            ? 'The host answered the large request the way a process dying out of memory does. Evidence that refines the version, never a pass.'
            : 'The host answered the large request like the small one. The memory limit may sit above 48 MB; the version still decides.',
        f.validation
          ? [
              `Control: ${f.validation.baseline.status}, ${kb(f.validation.baseline.bodyBytes)} body`,
              `Payload: ${mb(f.validation.payload.sentBytes)} in ${(f.validation.payload.ms / 1000).toFixed(1)} s`,
              `Answer: ${f.validation.payload.status}, ${kb(f.validation.payload.bodyBytes)} body`,
              `Signature: ${f.validation.signature}`,
            ]
          : ['Consent: not given for this scan', 'Web: the box under the host field', 'CLI: --validate', 'API: validate: true'],
      )}
      ${card(
        'Foundations · hygiene',
        `${inPlace} of 4 in place`,
        INK,
        'The habits that make the next flaw cheap: a host that answers, a known runtime, a version you can read, a branch that still receives fixes.',
        [
          `Answers an ordinary request: ${yesNo(fo.reachable, 'yes', 'no')}`,
          `PHP identified: ${yesNo(fo.phpPresent, 'yes', 'no')}`,
          `Version disclosed: ${yesNo(fo.versionDisclosed, 'yes', 'no')}`,
          `Supported branch: ${yesNo(fo.supportedBranch, 'yes', 'no, end-of-life')}`,
        ],
      )}
    </div>`,
  );

  const technical = slide(
    4,
    result,
    generatedAt,
    `${title('Technical', 'details')}
    <div class="two-col">
      <div>
        <h4>Probes</h4>
        <table class="table"><thead><tr><th>Probe</th><th>Answer</th></tr></thead><tbody>${probeRows(f)}</tbody></table>
        <h4>Headers read</h4>
        <p class="small">Status ${f.status ?? 'none'}${f.serverSoftware ? `; Server: ${esc(f.serverSoftware)}` : ''}${f.poweredBy ? `; X-Powered-By: ${esc(f.poweredBy)}` : ''}. Scan time ${result.ms} ms from ${esc(result.address)}, port ${result.target.port}.${f.errors.length ? ` Probes without an answer: ${f.errors.length}.` : ''}</p>
      </div>
      <div>
        <h4>Validation evidence</h4>
        <table class="table evidence"><thead><tr><th>Request</th><th>Sent</th><th>Status</th><th>Answer</th></tr></thead><tbody>${evidenceRows(f)}</tbody></table>
        ${a.notes.length ? `<h4>Notes</h4><ul class="small">${a.notes.map((n) => `<li>${esc(n.text)}</li>`).join('')}</ul>` : ''}
      </div>
    </div>`,
  );

  const method = slide(
    5,
    result,
    generatedAt,
    `${title('Method, rubric and', 'references')}
    <div class="two-col">
      <div>
        <h4>How the host was tested</h4>
        <p class="small">The exposure test is passive: one ordinary GET of the front page reads the Server and X-Powered-By headers, together with a PHP session cookie and links to .php pages, and one GET of PHP's logo query (?=PHPE9568F34-D428-11d2-A769-00AA001ACF42), which PHP 5.4 and older answer with an image and their version; PHP 5.5 removed it. A version is read from the headers when the host discloses one. The advertised version is compared with the fixed releases (${FIXED}). No exploit code is sent.</p>
        <h4>The validation, with consent</h4>
        <p class="small">With the operator's consent the engine sends one small multipart POST as a control, then one chunked multipart POST of about 48 MB, and compares the two answers. A PHP inside the affected range dies out of memory on the large request and answers with an empty 200 where the control answered otherwise; that signature is reported as evidence. The host's memory limit can sit above the test size, so "not reproduced" does not clear a vulnerable version.</p>
        <h4>What the report does not say</h4>
        <p class="small">A hidden version is not a patch. A distribution may backport the fix without changing the version header; in that case the host is protected and the report says exposed, which only the operator can resolve. The report measures PHP2Shell alone; it is not a statement about other flaws.</p>
      </div>
      <div>
        <h4>${a.score === null ? 'No score' : `Score ${a.score} of 100`}</h4>
        <p class="small">One number per stage, so the stage is the summary: no patch 15, exposed 35, hidden 50, not affected 80, protected 100. A host that is unreachable or not PHP has no score. The validation moves a hidden host to exposed when it reproduces the bailout; it never raises a score.</p>
        <h4>The stages</h4>
        <table class="table stages"><tbody>${STAGES.map((st) => `<tr><td class="stage-word" style="color:${STAGE_COLOUR[st]}">${esc(STAGE_LABEL[st])}</td><td>${esc(STAGE_MEANING[st])}</td></tr>`).join('')}</tbody></table>
        <h4>References</h4>
        <p class="small">${CVES} (PHP, disclosed 21 October 2026). Fixed releases: PHP ${FIXED}. PHP branch support dates: php.net/supported-versions. Full rubric: the scoring page of PHP2Shell Labs, github.com/manteiga-foundation/php2shell-labs.</p>
        <h4>Re-test</h4>
        <p class="small">Results are a snapshot. Re-test after any change${shareUrl ? `; this result stays at ${esc(shareUrl)}` : ''}.</p>
      </div>
    </div>`,
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${esc(host)} · PHP2Shell exposure report · PHP2Shell Labs</title>
<style>
@font-face { font-family: 'Titillium Web'; font-weight: 400; src: url('${font('titillium-web-latin-400-normal.woff2')}') format('woff2'); }
@font-face { font-family: 'Titillium Web'; font-weight: 600; src: url('${font('titillium-web-latin-600-normal.woff2')}') format('woff2'); }
@font-face { font-family: 'Titillium Web'; font-weight: 700; src: url('${font('titillium-web-latin-700-normal.woff2')}') format('woff2'); }
@font-face { font-family: 'JetBrains Mono'; font-weight: 400; src: url('${font('jetbrains-mono-latin-400-normal.woff2')}') format('woff2'); }
@page { size: 11in 8.5in; margin: 0; }
* { margin: 0; padding: 0; box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
html, body { font-family: 'Titillium Web', sans-serif; font-size: 12px; line-height: 1.4; background: white; color: ${INK}; }
.slide { width: 11in; height: 8.5in; position: relative; overflow: hidden; page-break-after: always; page-break-inside: avoid; background: linear-gradient(145deg, #FFFFFF 0%, #F8FAFC 50%, #F1F5F9 100%); display: flex; flex-direction: column; }
.slide:last-child { page-break-after: auto; }
.slide::before { content: ''; position: absolute; left: 0; top: 0; width: 8px; height: 100%; background: linear-gradient(180deg, ${BASE} 0%, #4A6BD8 45%, ${GOLD} 100%); }
.slide::after { content: ''; position: absolute; inset: 0; background-image: linear-gradient(rgba(16,52,166,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(16,52,166,0.035) 1px, transparent 1px); background-size: 48px 48px; pointer-events: none; }
.content { flex: 1; display: flex; flex-direction: column; padding: 0.3in 0.8in 0; position: relative; z-index: 1; min-height: 0; }
.section-title { font-size: 32px; font-weight: 300; letter-spacing: -0.3px; text-transform: uppercase; margin-bottom: 12px; }
.section-title strong { font-weight: 700; }
.divider { width: 80px; height: 5px; background: linear-gradient(90deg, ${GOLD}, ${BASE}); border-radius: 2.5px; margin-bottom: 20px; }
h4 { font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #475569; margin: 14px 0 8px; }
h4:first-child { margin-top: 0; }
.small { font-size: 12px; color: #475569; line-height: 1.6; }
.table.stages td { font-size: 11px; }
.table.stages .stage-word { font-weight: 700; letter-spacing: 1px; white-space: nowrap; }
ul.small { padding-left: 16px; }
.mono { font-family: 'JetBrains Mono', monospace; font-size: 10px; }
.dim { color: #94A3B8; }

/* Cover */
.cover .cover-body { flex: 1; padding: 0.7in 0.9in 0; position: relative; z-index: 1; display: flex; flex-direction: column; }
.brand { display: flex; align-items: center; gap: 10px; font-size: 13px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; color: ${BASE}; }
.mark, .footer-mark { display: inline-block; width: 18px; height: 18px; border-radius: 50%; border: 2.5px solid ${GOLD}; box-shadow: inset 0 0 0 3px white, inset 0 0 0 5px ${BASE}; }
.footer-mark { width: 14px; height: 14px; border-width: 2px; box-shadow: inset 0 0 0 2px white, inset 0 0 0 4px ${BASE}; }
.cover-kicker { margin-top: 0.55in; font-size: 14px; font-weight: 600; letter-spacing: 3px; text-transform: uppercase; color: #64748B; }
.cover-host { font-family: 'JetBrains Mono', monospace; font-size: 44px; font-weight: 400; letter-spacing: -0.5px; margin-top: 8px; word-break: break-all; }
.cover-meta { font-size: 13px; color: #64748B; margin-top: 6px; }
.cover-grid { display: flex; align-items: center; gap: 0.6in; margin-top: 0.45in; }
.cover-ring { position: relative; width: 260px; height: 260px; flex: none; }
.cover-ring .ring { position: absolute; inset: 0; }
.cover-ring-text { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
.cover-ring-text .word { font-size: 20px; font-weight: 700; letter-spacing: 3px; }
.cover-ring-text .num { font-family: 'JetBrains Mono', monospace; font-size: 64px; line-height: 1; margin-top: 4px; }
.cover-ring-text .of { font-size: 10px; letter-spacing: 2px; text-transform: uppercase; color: #94A3B8; margin-top: 4px; }
.cover-verdict { flex: 1; }
.cover-heading { font-size: 34px; font-weight: 700; letter-spacing: -0.3px; }
.cover-verdict p { font-size: 15px; color: #475569; line-height: 1.55; margin-top: 10px; }
.next { margin-top: 16px; padding: 12px 16px; border-left: 4px solid ${GOLD}; background: rgba(184,144,46,0.07); }
.next .label { font-size: 9px; letter-spacing: 2px; text-transform: uppercase; color: ${GOLD}; font-weight: 700; }
.next .title { font-size: 15px; font-weight: 600; margin-top: 2px; }

/* Executive summary */
.exec-text { font-size: 13.5px; line-height: 1.6; color: #475569; }
.exec-text p { margin-bottom: 10px; }
.rating-card { background: white; padding: 20px 36px; border-radius: 12px; box-shadow: 0 8px 30px rgba(0,0,0,0.04); border: 1px solid #E2E8F0; display: flex; align-items: center; justify-content: space-between; gap: 40px; margin-top: 10px; }
.rating-callout { flex: 1; }
.rating-callout .label { font-size: 9px; letter-spacing: 2px; text-transform: uppercase; color: ${GOLD}; font-weight: 700; }
.rating-callout .title { font-size: 17px; font-weight: 700; margin: 4px 0 8px; }
.rating-callout p { font-size: 12px; color: #475569; line-height: 1.55; }
.rating-visual { position: relative; width: 140px; height: 140px; flex: none; display: flex; align-items: center; justify-content: center; }
.rating-visual .ring { position: absolute; inset: 0; }
.rating-visual-text { position: relative; font-size: 10px; font-weight: 700; text-align: center; text-transform: uppercase; letter-spacing: 1px; line-height: 1.3; }
.rating-score { font-family: 'JetBrains Mono', monospace; font-size: 26px; color: ${INK}; letter-spacing: 0; }
.rating-label { position: absolute; bottom: -20px; font-size: 9px; color: #94A3B8; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; }

/* Stage legend (summary page) */
.legend-container { display: flex; gap: 10px; margin-top: auto; margin-bottom: 8px; }
.legend-item { flex: 1; display: flex; gap: 10px; align-items: flex-start; background: #F8FAFC; padding: 12px 14px; border-radius: 8px; border: 1px solid #F1F5F9; }
.legend-item.current { background: white; border-color: var(--rung); box-shadow: 0 8px 30px rgba(0,0,0,0.05); }
.legend-dot { width: 12px; height: 12px; border-radius: 50%; background: var(--rung); flex: none; margin-top: 2px; }
.legend-title { font-size: 10px; font-weight: 700; letter-spacing: 1px; color: var(--rung); }
.legend-desc { font-size: 10px; color: #64748B; line-height: 1.4; margin-top: 2px; }

/* Ladder and cards */
.ladder { display: flex; gap: 10px; margin: 10px 0 18px; }
.rung { flex: 1; position: relative; padding: 14px 16px 14px; border-radius: 8px; background: #F8FAFC; border: 1px solid #E2E8F0; border-top: 4px solid var(--rung); opacity: 0.55; }
.rung.passed { opacity: 0.8; }
.rung.current { opacity: 1; background: white; box-shadow: 0 8px 30px rgba(0,0,0,0.06); }
.rung-word { font-size: 12px; font-weight: 700; letter-spacing: 1.5px; color: var(--rung); }
.rung-desc { font-size: 11px; color: #64748B; margin-top: 5px; line-height: 1.45; }
.rung-marker { position: absolute; top: -22px; right: 10px; font-size: 8px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: white; background: var(--rung); padding: 3px 7px; border-radius: 3px; }
.cards { display: flex; gap: 14px; flex: 1; margin-bottom: 14px; }
.card { flex: 1; display: flex; flex-direction: column; background: white; border-radius: 12px; border: 1px solid #E2E8F0; box-shadow: 0 8px 30px rgba(0,0,0,0.04); padding: 20px 22px; }
.card h3 { font-size: 9px; letter-spacing: 1.5px; text-transform: uppercase; color: #64748B; font-weight: 700; }
.card .state { font-size: 16px; font-weight: 700; margin: 8px 0 8px; }
.card p { font-size: 12px; color: #64748B; line-height: 1.5; }
.card ul { margin-top: auto; padding-top: 14px; padding-left: 16px; font-size: 12px; color: #475569; line-height: 1.65; }

/* Tables */
.two-col { display: flex; gap: 0.5in; min-height: 0; }
.two-col > div { flex: 1; min-width: 0; }
.table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
.table th, .table td { text-align: left; padding: 4px 8px; border-bottom: 1px solid #E2E8F0; vertical-align: top; }
.table th { font-size: 8.5px; letter-spacing: 1px; text-transform: uppercase; color: #94A3B8; font-weight: 700; }
.table .kind { font-size: 8.5px; color: #94A3B8; }
.table .answer { font-weight: 600; }
.table .answer.yes { color: ${STAGE_COLOUR.protected}; }
.table .answer.no { color: #94A3B8; }
.table .answer.err { color: ${STAGE_COLOUR['no-patch']}; }
.table .answer.warn { color: ${STAGE_COLOUR.hidden}; }
.table.evidence td { font-size: 10px; }

/* Footer */
.footer { padding: 0.12in 0.8in 0.28in 0.8in; display: flex; justify-content: space-between; align-items: flex-end; position: relative; z-index: 1; }
.footer-info { display: flex; flex-direction: column; gap: 6px; max-width: 760px; }
.confidential-block { font-size: 8.5px; color: #64748B; line-height: 1.5; }
.confidential-block strong { color: #475569; text-transform: uppercase; letter-spacing: 0.5px; }
.footer-bottom-row { display: flex; align-items: center; gap: 10px; }
.footer-line { font-size: 9.5px; color: #94A3B8; }
.footer-line strong { font-weight: 600; color: ${BASE}; }
.tag { font-size: 7px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; padding: 3px 6px; border-radius: 3px; background: rgba(16,52,166,0.08); color: ${BASE}; border: 1px solid rgba(16,52,166,0.15); white-space: nowrap; }
.footer-right { display: flex; align-items: center; margin-bottom: 2px; }
.page-indicator { font-size: 12px; font-weight: 700; color: ${BASE}; }
.page-total { font-size: 12px; font-weight: 400; color: #94A3B8; }
.cover-footer { padding-left: 0.9in; }

@media screen { html { background: #64748B; } body { padding: 0.5in; background: #64748B; } .slide { margin: 0 auto 0.5in; box-shadow: 0 4px 6px rgba(0,0,0,0.05), 0 10px 40px rgba(0,0,0,0.15); } }
@media print { * { box-shadow: none !important; filter: none !important; } }
</style>
</head>
<body>
${cover}
${summary}
${findings}
${technical}
${method}
</body>
</html>`;
}
