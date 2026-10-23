// How `bun run scan` looks in the terminal, in the spirit of QRL's: a P2SHELL banner in gold
// faces with Egyptian-blue shadows, then one report per host that reads top-down the way the web
// page does: the host, the stage word and the score; the verdict; the one next step; the three
// cards; the probes; the score's parts with --verbose.
//
// Truecolor where the terminal says it has it (COLORTERM), the nearest of the 256 colours
// otherwise, plain text when the output is not a terminal or NO_COLOR is set. No dependencies.

import { STAGE_LABEL, STAGES, type Assessment, type Stage } from './assess';
import type { ScanResult } from './events';

export type ColorMode = 'none' | '256' | 'truecolor';

const C = {
  goldLight: '#f3dfa2',
  gold: '#e0b85c',
  amber: '#c88000',
  blue: '#5b7be0',
  paleBlue: '#9fb6ff',
  text: '#dfe7f5',
  dim: '#7a879c',
  red: '#e05a4f',
  green: '#43b48a',
  mint: '#8fe0c0',
} as const;

const STAGE_COLOUR: Record<Stage, string> = {
  unreachable: C.dim,
  'not-php': C.dim,
  'no-patch': C.red,
  exposed: C.red,
  hidden: C.gold,
  'not-affected': C.green,
  protected: C.mint,
};

export function colorMode(env: Record<string, string | undefined>, isTTY: boolean): ColorMode {
  if (env.NO_COLOR) return 'none';
  if (env.FORCE_COLOR === '0') return 'none';
  const truecolor = env.COLORTERM === 'truecolor' || env.COLORTERM === '24bit' || env.FORCE_COLOR === '3';
  if (!isTTY && env.FORCE_COLOR === undefined) return 'none';
  return truecolor ? 'truecolor' : '256';
}

const LEVELS6 = [0, 95, 135, 175, 215, 255];
const nearest6 = (v: number) => LEVELS6.reduce((best, l, i) => (Math.abs(l - v) < Math.abs(LEVELS6[best] - v) ? i : best), 0);
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];

function paint(text: string, hex: string, mode: ColorMode, extra = ''): string {
  if (mode === 'none' || !text) return text;
  const [r, g, b] = rgb(hex);
  const fg = mode === 'truecolor' ? `38;2;${r};${g};${b}` : `38;5;${16 + 36 * nearest6(r) + 6 * nearest6(g) + nearest6(b)}`;
  return `\x1b[${extra}${fg}m${text}\x1b[0m`;
}

/** The text without its colours. */
export const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
const width = (s: string) => plain(s).length;
const padEnd = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - width(s)));

// The block letters (ANSI Shadow): P 2 S H E L L. Faces are █, shadows the box-drawing strokes.
const LETTERS: Record<string, string[]> = {
  P: ['██████╗ ', '██╔══██╗', '██████╔╝', '██╔═══╝ ', '██║     ', '╚═╝     '],
  '2': ['██████╗ ', '╚════██╗', ' █████╔╝', '██╔═══╝ ', '███████╗', '╚══════╝'],
  S: ['███████╗', '██╔════╝', '███████╗', '╚════██║', '███████║', '╚══════╝'],
  H: ['██╗  ██╗', '██║  ██║', '███████║', '██╔══██║', '██║  ██║', '╚═╝  ╚═╝'],
  E: ['███████╗', '██╔════╝', '█████╗  ', '██╔══╝  ', '███████╗', '╚══════╝'],
  L: ['██╗     ', '██║     ', '██║     ', '██║     ', '███████╗', '╚══════╝'],
};
const BANNER = [0, 1, 2, 3, 4, 5].map((row) => [...'P2SHELL'].map((ch) => LETTERS[ch][row]).join(''));
const BANNER_WIDTH = Math.max(...BANNER.map((r) => r.length));
const FACE = ['#f3dfa2', '#ecd088', '#e6c271', '#e0b85c', '#d6a243', '#c88000'];
const bannerRow = (row: string, i: number, mode: ColorMode) => row.replace(/(█+)|([^█ ]+)/g, (_m, face: string, shadow: string) => (face ? paint(face, FACE[i], mode, '1;') : paint(shadow, C.blue, mode)));

export interface TerminalOptions {
  mode: ColorMode;
  columns: number;
  verbose?: boolean;
  share?: { url: string; pdf: string } | null;
}

export function banner(version: string, o: TerminalOptions): string {
  const { mode } = o;
  const wide = o.columns >= BANNER_WIDTH + 4;
  const title = wide ? BANNER.map((r, i) => '  ' + bannerRow(r, i, mode)) : ['  ' + paint('P 2 S H E L L', C.gold, mode, '1;')];
  return ['', ...title, `  ${paint('PHP2SHELL EXPOSURE', C.paleBlue, mode)}  ${paint('·', C.dim, mode)}  ${paint(`v${version}`, C.dim, mode)}  ${paint('·', C.dim, mode)}  ${paint('php2shell labs', C.dim, mode)}`, ''].join('\n');
}

const hostOf = (r: ScanResult) => (r.target.port === 443 ? r.target.host : `${r.target.host}:${r.target.port}`);

/** Breaks a sentence into lines that fit, each with the indent. */
function wrap(text: string, indent: number, columns: number): string[] {
  const max = Math.max(20, columns - indent);
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if (line && line.length + 1 + word.length > max) {
      out.push(' '.repeat(indent) + line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(' '.repeat(indent) + line);
  return out;
}

const yes = (mode: ColorMode) => paint('✓', C.green, mode);
const no = (mode: ColorMode) => paint('✗', C.dim, mode);
const warnMark = (mode: ColorMode) => paint('!', C.amber, mode, '1;');

function mark(v: boolean | null, mode: ColorMode): string {
  return v === null ? paint('·', C.dim, mode) : v ? yes(mode) : no(mode);
}

/** Cells laid in columns that fit the width; each cell is already coloured, widths measured plain. */
function grid(cells: string[], indent: number, columns: number, gap = 3): string[] {
  const widest = Math.max(...cells.map(width));
  const per = Math.max(1, Math.floor((columns - indent + gap) / (widest + gap)));
  const rows: string[] = [];
  for (let i = 0; i < cells.length; i += per) rows.push(' '.repeat(indent) + cells.slice(i, i + per).map((c, j, arr) => (j === arr.length - 1 ? c : padEnd(c, widest + gap))).join('').trimEnd());
  return rows;
}

function label(text: string, mode: ColorMode): string {
  return paint(text.padEnd(14), C.paleBlue, mode);
}

/** A "key  value" line, the value wrapped onto indented lines when it does not fit. */
function fact(key: string, value: string, colour: string, mode: ColorMode, columns: number): string[] {
  const head = `    ${key.padEnd(12)}`;
  if (head.length + value.length <= columns) return [`    ${paint(key.padEnd(12), C.dim, mode)}${paint(value, colour, mode)}`];
  return [`    ${paint(key, C.dim, mode)}`, ...wrap(value, 16, columns).map((l) => paint(l, colour, mode))];
}

const scoreText = (a: Assessment) => (a.score === null ? '' : `${a.score} / 100`);

export function renderReport(r: ScanResult, o: TerminalOptions): string {
  const { mode, columns } = o;
  const a = r.assessment;
  const f = r.findings;
  const colour = STAGE_COLOUR[a.stage];
  const out: string[] = [];
  const rule = '  ' + paint('─'.repeat(Math.min(columns - 4, 72)), C.blue, mode);

  // The head: host, stage word, score.
  out.push(rule);
  const headParts = [paint(hostOf(r), C.goldLight, mode, '1;'), paint(STAGE_LABEL[a.stage], colour, mode, '1;'), paint(scoreText(a), C.text, mode), paint(`${r.address} · ${r.ms} ms`, C.dim, mode)].filter((p) => width(p) > 0);
  out.push(`  ${paint('◆', colour, mode)} ${headParts.join('  ')}`);
  out.push(...wrap(a.verdict, 4, columns).map((l) => paint(l, C.text, mode)));
  out.push('');
  out.push(`    ${paint('Next step', C.gold, mode, '1;')}  ${paint(a.nextStep.title, C.goldLight, mode)}`);
  if (o.verbose) out.push(...wrap(a.nextStep.detail, 15, columns).map((l) => paint(l, C.dim, mode)));
  out.push('');

  // Version: the card that decides.
  const v = a.version;
  const vState =
    v.status === 'patched'
      ? paint('fixed release', C.green, mode)
      : v.status === 'vulnerable'
        ? paint('inside the affected range, fix available', C.red, mode)
        : v.status === 'no-patch'
          ? paint('inside the affected range, end-of-life branch', C.red, mode)
          : v.status === 'below-range'
            ? paint('older than the flaw', C.green, mode)
            : v.status === 'hidden'
              ? paint('PHP runs, version hidden', C.gold, mode)
              : v.status === 'absent'
                ? paint('nothing answered as PHP', C.dim, mode)
                : paint('not read', C.dim, mode);
  out.push(`  ${label('Version', mode)}${vState}`);
  out.push(...fact('PHP', v.text ? `PHP ${v.text}` : v.status === 'hidden' ? 'hidden' : 'none', v.text ? C.text : C.dim, mode, columns));
  if (v.branch) out.push(...fact('branch', `${v.branch}${v.eol ? ' (end-of-life)' : ''}${v.fixedRelease ? ` · fixed in ${v.fixedRelease}` : ''}`, v.eol ? C.amber : C.text, mode, columns));
  if (f.serverSoftware) out.push(...fact('server', f.serverSoftware, C.text, mode, columns));
  out.push('');

  // Validation: evidence, consent-gated.
  const val = a.validation;
  const valState =
    val.status === 'triggered'
      ? `${warnMark(mode)} ${paint('bailout reproduced', C.amber, mode)}`
      : val.status === 'not-triggered'
        ? paint('bailout not reproduced within 48 MB', C.text, mode)
        : paint('not run (no consent)', C.dim, mode);
  out.push(`  ${label('Validation', mode)}${valState}`);
  if (f.validation) {
    out.push(...fact('signature', f.validation.signature, C.text, mode, columns));
    out.push(...fact('requests', `${f.validation.baseline.status} on ${Math.round(f.validation.baseline.bodyBytes)} B back · ${f.validation.payload.status} after ${Math.round(f.validation.payload.sentBytes / 1048576)} MB in ${(f.validation.payload.ms / 1000).toFixed(1)} s`, C.dim, mode, columns));
  }
  out.push('');

  // Foundations.
  const fo = a.foundations;
  const items: [string, boolean | null][] = [
    ['answers an ordinary visit', fo.reachable],
    ['PHP present', fo.phpPresent],
    ['version disclosed', fo.versionDisclosed],
    ['supported branch', fo.supportedBranch],
  ];
  const inPlace = items.filter(([, x]) => x === true).length;
  out.push(`  ${label('Foundations', mode)}${paint(`${inPlace} of 4 in place`, C.text, mode)}`);
  out.push(...grid(items.map(([t, x]) => `${mark(x, mode)} ${paint(t, x === true ? C.text : C.dim, mode)}`), 4, columns));
  out.push('');

  // Probes.
  out.push(`  ${label('Probes', mode)}${paint(f.validation ? 'one visit, the credit query, two posted requests' : 'one visit and the credit query, nothing more', C.dim, mode)}`);
  const probeCell = (name: string, state: 'yes' | 'no' | 'error' | 'none', good = true) => {
    const m = state === 'yes' ? (good ? yes(mode) : warnMark(mode)) : state === 'no' ? no(mode) : state === 'error' ? paint('?', C.red, mode) : paint('·', C.dim, mode);
    return `${m} ${paint(name, state === 'yes' ? (good ? C.text : C.amber) : C.dim, mode)}`;
  };
  out.push(
    ...grid(
      [
        probeCell(`home page HTTP ${f.status ?? '-'}`, f.reachable === true ? 'yes' : f.reachable === false ? 'error' : 'none'),
        probeCell('PHP credit endpoint', f.egg === 'untested' ? 'none' : f.egg),
        probeCell('exploit validation', f.validation ? (f.validation.verdict === 'triggered' ? 'yes' : 'no') : 'none', false),
      ],
      4,
      columns,
    ),
  );
  if (f.errors.length) out.push(`    ${paint(`${f.errors.length} probe${f.errors.length === 1 ? '' : 's'} without an answer`, C.amber, mode)}`);

  if (o.verbose) {
    out.push('');
    out.push(`  ${label('Score breakdown', mode).trimEnd()}`);
    out.push(`    ${paint('Stage'.padEnd(24), C.dim, mode)}${paint(`${String(a.points.stage).padStart(3)} / 100`, a.points.stage === 100 ? C.green : a.points.stage === 0 ? C.dim : C.text, mode)}`);
    for (const n of a.notes) out.push(...wrap(`note: ${n.text}`, 4, columns).map((l) => paint(l, C.dim, mode)));
  }

  if (o.share) {
    out.push('');
    out.push(`  ${label('Share', mode)}${paint(o.share.url, C.goldLight, mode, '4;')}`);
    out.push(`  ${label('PDF', mode)}${paint(o.share.pdf, C.dim, mode)}`);
  }
  out.push(rule);
  return out.join('\n');
}

const STAGE_ORDER: Stage[] = [...STAGES];

/** Several hosts: one line each, worst first, and the count by stage. */
export function summary(results: ScanResult[], o: TerminalOptions): string {
  const { mode } = o;
  const sorted = [...results].sort((x, y) => STAGE_ORDER.indexOf(x.assessment.stage) - STAGE_ORDER.indexOf(y.assessment.stage) || (x.assessment.score ?? 0) - (y.assessment.score ?? 0));
  const w = Math.max(...sorted.map((r) => hostOf(r).length));
  const out = ['', `  ${paint(`${results.length} hosts`, C.paleBlue, mode, '1;')}`];
  for (const r of sorted) {
    const a: Assessment = r.assessment;
    out.push(`  ${paint('◆', STAGE_COLOUR[a.stage], mode)} ${padEnd(paint(hostOf(r), C.text, mode), w + 2)}${padEnd(paint(STAGE_LABEL[a.stage], STAGE_COLOUR[a.stage], mode, '1;'), 14)}${paint(a.score === null ? '  -' : String(a.score).padStart(3), C.text, mode)}  ${paint(a.nextStep.title, C.dim, mode)}`);
  }
  const counts = STAGE_ORDER.map((s) => [s, results.filter((r) => r.assessment.stage === s).length] as const).filter(([, n]) => n > 0);
  out.push(`  ${counts.map(([s, n]) => paint(`${n} ${s}`, STAGE_COLOUR[s], mode)).join(paint(' · ', C.dim, mode))}`);
  out.push('');
  return out.join('\n');
}
