import { Animator, Animated } from '@arwes/react';
import { useEffect, useState } from 'react';
import type { Assessment, Findings, NextStepId, NoteId } from '../../../engine/assess';
import { Panel } from '../components/Panel';
import { Ring, stageColor } from '../components/Ring';
import type { Messages } from '../i18n/en';
import { HTML_LANG, localePath } from '../i18n/locales';
import { errorText, useI18n } from '../i18n/react';
import type { ReportState } from '../report-model';

const SAFE = new Set(['protected', 'not-affected']);
const EXPOSED = new Set(['exposed', 'no-patch']);
const PROBE_IDS = ['home', 'egg', 'validation'] as const;

function yesNo(v: boolean | null, yes: string, no: string, unknown: string): string {
  return v === null ? unknown : v ? yes : no;
}

/** The next step in the reader's words, by id; a step the catalogue does not know keeps the engine's words. */
function stepText(t: Messages, step: Assessment['nextStep']): { title: string; detail: string } {
  return t.report.steps[step.id as NextStepId] ?? step;
}

export function Report({ state, shared, onAnother }: { state: ReportState; shared: boolean; onAnother: () => void }) {
  const { t, locale } = useI18n();
  const r = t.report;
  const { assessment: a, findings: f } = state;
  const live = state.status === 'scanning';
  const safe = SAFE.has(a.stage);
  const settled = state.status === 'done' || state.status === 'error';
  const [dialog, setDialog] = useState(false);
  const [copied, setCopied] = useState(false);
  const step = stepText(t, a.nextStep);

  // A shared link opens in the language it was shared in.
  const shareUrl = state.shareId ? `${window.location.origin}${localePath(locale, `/r/${state.shareId}`)}` : null;
  const copyLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt(r.copyPrompt, shareUrl);
    }
  };

  const heading = live
    ? r.headingTesting
    : state.status === 'error'
      ? r.headingNotRun
      : safe
        ? r.headingSafe
        : EXPOSED.has(a.stage)
          ? r.headingExposed
          : a.stage === 'hidden'
            ? r.headingHidden
            : a.stage === 'not-php'
              ? r.headingNotPhp
              : r.headingUnreachable;
  const mark = safe ? '✓' : live ? '…' : a.stage === 'not-php' || a.stage === 'unreachable' ? '·' : '!';

  return (
    <Animator combine manager="stagger">
      <main className="report" data-stage={a.stage} style={{ ['--stage-color' as string]: stageColor(a.stage) }}>
        <aside className="aside">
          <Ring stage={a.stage} score={a.score} live={live} />
          <div className="target-line">
            <span className="nowrap">
              {state.host}
              {state.port && state.port !== 443 ? `:${state.port}` : ''}
            </span>
            {state.address ? <span className="nowrap"> · {state.address}</span> : ''}
          </div>
          <div className={`status-line ${live ? 'live' : ''}`}>
            {live ? r.probesLive(state.probes.length) : state.status === 'error' ? r.stopped : state.ms !== null ? r.probesDone(state.probes.length || 2, state.ms) : r.complete}
          </div>
        </aside>

        <div className="main">
          <Animator>
            <Animated as="section" className="summary" data-testid="summary" animated={['fade', ['y', 10, 0]]}>
              <h1>
                <span className="mark" aria-hidden="true" data-mark={mark} />
                {heading}
              </h1>
              {state.status === 'error' ? (
                <p className="verdict alert" role="alert" data-testid="verdict">
                  {errorText(t, state.error, state.errorCode, state.errorParams)}
                </p>
              ) : (
                <p className="verdict" data-testid="verdict">
                  {live ? r.liveVerdict : r.verdict[a.stage]}
                </p>
              )}
              {settled && state.status !== 'error' && (
                <div className="next" data-testid="next-step">
                  <div className="label">{a.stage === 'protected' ? r.standing : r.nextStep}</div>
                  <p className="title">{step.title}</p>
                  <p>{step.detail}</p>
                </div>
              )}
              <div className="actions">
                {settled && state.status !== 'error' && (
                  <button type="button" className="button" onClick={() => setDialog(true)}>
                    {r.download}
                  </button>
                )}
                {shareUrl && (
                  <button type="button" className="button ghost" onClick={copyLink}>
                    {copied ? r.copied : r.share}
                  </button>
                )}
                {shared ? (
                  <a className="button ghost" href={localePath(locale, '/')} onClick={(e) => { e.preventDefault(); onAnother(); }}>
                    {r.checkOwn}
                  </a>
                ) : (
                  settled && (
                    <a className="button ghost" href={localePath(locale, '/')} onClick={(e) => { e.preventDefault(); onAnother(); }}>
                      {r.checkAnother}
                    </a>
                  )
                )}
              </div>
            </Animated>
          </Animator>

          {settled && state.status !== 'error' && (
            <>
              <section className="section recommendations">
                <h2>{r.recommendations}</h2>
                <ol>
                  <li>
                    <strong>{step.title}</strong>
                    <span>{step.detail}</span>
                  </li>
                  {a.notes.map((n) => (
                    <li key={n.id}>
                      <span>{r.notes[n.id as NoteId]?.(f.validation?.signature ?? '') ?? n.text}</span>
                    </li>
                  ))}
                  {!f.validation && (a.stage === 'hidden' || EXPOSED.has(a.stage)) && (
                    <li>
                      <strong>{r.consentTitle}</strong>
                      <span>{r.consentBody}</span>
                    </li>
                  )}
                </ol>
              </section>

              <section className="section">
                <h2>{r.technical}</h2>
                <div className="cards">
                  <VersionCard a={a} f={f} />
                  <ValidationCard a={a} f={f} />
                  <FoundationsCard a={a} />
                </div>
                <details className="tech">
                  <summary>{r.detailsSummary}</summary>
                  <ProbeTable state={state} />
                  <Rubric a={a} />
                </details>
              </section>
            </>
          )}
        </div>
        {dialog && <DownloadDialog pdfUrl={state.shareId ? `/api/report/${state.shareId}.pdf` : null} onClose={() => setDialog(false)} />}
        <div className="print-footer">
          PHP2Shell Labs · {state.host} · {state.startedAt ? new Date(state.startedAt).toLocaleString(HTML_LANG[locale], { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' }) + ' UTC' : ''} · {r.printFooter}
        </div>
      </main>
    </Animator>
  );
}

function VersionCard({ a, f }: { a: Assessment; f: Findings }) {
  const { t } = useI18n();
  const r = t.report;
  const v = a.version;
  const w = r.version;
  const color =
    v.status === 'patched' || v.status === 'below-range'
      ? 'var(--stage-protected)'
      : v.status === 'hidden'
        ? 'var(--stage-hidden)'
        : v.status === 'vulnerable' || v.status === 'no-patch'
          ? 'var(--stage-exposed)'
          : 'var(--text)';
  const stateWord =
    v.status === 'patched' ? w.patched : v.status === 'vulnerable' ? w.vulnerable : v.status === 'no-patch' ? w.noPatch : v.status === 'below-range' ? w.belowRange : v.status === 'hidden' ? w.hidden : v.status === 'absent' ? w.absent : w.unknown;
  return (
    <Panel testId="version-card">
      <h3>{w.title}</h3>
      <div className="state" style={{ ['--state-color' as string]: color }}>
        {stateWord}
      </div>
      <p>{w.body}</p>
      <ul>
        <li>
          {w.php}{r.sep}{v.text ? `PHP ${v.text}` : v.status === 'hidden' ? w.hiddenValue : r.none}
        </li>
        {v.branch && (
          <li>
            {w.branch}{r.sep}{v.branch} ({v.eol ? w.eol : w.supported})
          </li>
        )}
        {v.fixedRelease && (
          <li>
            {w.fixedIn}{r.sep}{v.fixedRelease}
          </li>
        )}
        {f.serverSoftware && (
          <li>
            {w.server}{r.sep}{f.serverSoftware}
          </li>
        )}
        <li>
          {w.egg}{r.sep}
          {f.egg === 'yes' ? w.signs.logo : f.signs.length ? f.signs.map((s) => w.signs[s]).join(', ') : f.egg === 'no' ? w.signs.none : r.notMeasured}
        </li>
      </ul>
    </Panel>
  );
}

function ValidationCard({ a, f }: { a: Assessment; f: Findings }) {
  const { t } = useI18n();
  const r = t.report;
  const w = r.validation;
  const s = a.validation.status;
  const color = s === 'triggered' ? 'var(--stage-hidden)' : s === 'not-triggered' ? 'var(--text)' : 'var(--text-faint)';
  const v = f.validation;
  return (
    <Panel testId="validation-card">
      <h3>{w.title}</h3>
      <div className="state" style={{ ['--state-color' as string]: color }}>
        {s === 'triggered' ? w.triggered : s === 'not-triggered' ? w.notTriggered : w.notRun}
      </div>
      <p>{s === 'triggered' ? w.bodyTriggered : s === 'not-triggered' ? w.bodyNotTriggered : w.bodyNotRun}</p>
      {v && (
        <ul>
          <li>
            {w.signature}{r.sep}{v.signature}
          </li>
          <li>
            {w.control}{r.sep}{w.answer(v.baseline.status, v.baseline.bodyBytes)}
          </li>
          <li>
            {w.large}{r.sep}{w.answer(v.payload.status, v.payload.bodyBytes)}, {w.sent(Math.round(v.payload.sentBytes / 1048576), (v.payload.ms / 1000).toFixed(1))}
          </li>
        </ul>
      )}
    </Panel>
  );
}

function FoundationsCard({ a }: { a: Assessment }) {
  const { t } = useI18n();
  const r = t.report;
  const fo = a.foundations;
  const inPlace = [fo.reachable, fo.phpPresent, fo.versionDisclosed, fo.supportedBranch].filter((v) => v === true).length;
  return (
    <Panel testId="foundations-card">
      <h3>{r.foundations.title}</h3>
      <div className="state">{r.foundations.inPlace(inPlace)}</div>
      <p>{r.foundations.body}</p>
      <ul>
        <li>
          {r.foundations.reachable}{r.sep}{yesNo(fo.reachable, r.yes, r.no, r.notMeasured)}
        </li>
        <li>
          {r.foundations.phpPresent}{r.sep}{yesNo(fo.phpPresent, r.yes, r.no, r.notMeasured)}
        </li>
        <li>
          {r.foundations.versionDisclosed}{r.sep}{yesNo(fo.versionDisclosed, r.yes, r.no, r.notMeasured)}
        </li>
        <li>
          {r.foundations.supportedBranch}{r.sep}{yesNo(fo.supportedBranch, r.yes, r.no, r.notMeasured)}
        </li>
      </ul>
    </Panel>
  );
}

function ProbeTable({ state }: { state: ReportState }) {
  const { t } = useI18n();
  const p = t.report.probes;
  const rows = PROBE_IDS.map((id) => state.probes.find((row) => row.id === id) ?? null);
  const answerWord = (id: string, answer: 'yes' | 'no' | 'error') =>
    answer === 'error' ? p.noAnswer : id === 'validation' ? (answer === 'yes' ? p.reproduced : p.notReproduced) : id === 'egg' ? (answer === 'yes' ? p.answered : p.noImage) : p.answered;
  const answerClass = (id: string, answer: 'yes' | 'no' | 'error') => (id === 'validation' && answer === 'yes' ? 'warn' : answer);
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>{p.probe}</th>
            <th>{p.answer}</th>
            <th>{p.said}</th>
            <th>{p.ms}</th>
          </tr>
        </thead>
        <tbody>
          {PROBE_IDS.map((id, i) => {
            const row = rows[i];
            if (!row) {
              // The validation row is absent by design when there was no consent; the others are waiting.
              if (id === 'validation' && !state.validate) return null;
              return (
                <tr key={id} className="dim">
                  <td>{p[id]}</td>
                  <td className="answer">{p.waiting}</td>
                  <td />
                  <td />
                </tr>
              );
            }
            return (
              <tr key={id} data-testid="probe-row">
                <td>{p[id]}</td>
                <td className={`answer answer-${answerClass(id, row.answer)}`}>{answerWord(id, row.answer)}</td>
                <td className="dim">{row.detail}</td>
                <td className="dim">{row.ms}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Rubric({ a }: { a: Assessment }) {
  const { t } = useI18n();
  const r = t.report;
  return (
    <>
      <p className="probe-meta">{r.rubric(a.score === null ? r.ringNoScore : `${a.score} ${r.ringOf}`, t.stage.label[a.stage])}</p>
      <p className="probe-meta">
        {r.stages}{r.sep}{(['no-patch', 'exposed', 'hidden', 'not-affected', 'protected'] as const).map((s) => `${t.stage.label[s]}${r.sep}${t.stage.meaning[s]}`).join(' ')}
      </p>
      <p className="probe-meta">{r.standards}</p>
    </>
  );
}

function DownloadDialog({ pdfUrl, onClose }: { pdfUrl: string | null; onClose: () => void }) {
  const { t } = useI18n();
  const d = t.dialog;
  const pdf = usePreparedPdf(pdfUrl);
  const download = () => {
    if (pdfUrl) {
      if (pdf.status !== 'ready') return;
      const a = document.createElement('a');
      a.href = pdf.objectUrl;
      a.download = pdf.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      onClose();
    } else {
      onClose();
      setTimeout(() => window.print(), 50);
    }
  };
  const notReady = pdfUrl !== null && pdf.status !== 'ready';
  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="dl-title">
      <div className="dialog">
        <h2 id="dl-title">{d.title}</h2>
        <p>{pdfUrl ? d.bodyPdf : d.bodyPrint}</p>
        {pdfUrl && (
          <div className={`pdf-progress pdf-${pdf.status}`} data-testid="pdf-progress" role="status" aria-live="polite">
            <div className="pdf-bar" aria-hidden="true">
              <span />
            </div>
            <span className="pdf-text">
              {pdf.status === 'preparing' && (pdf.slow ? d.preparingSlow : d.preparing)}
              {pdf.status === 'ready' && d.ready(Math.max(1, Math.round(pdf.bytes / 1024)))}
              {pdf.status === 'error' && d.error}
            </span>
          </div>
        )}
        <div className="actions">
          <button type="button" className="button" onClick={download} data-testid="download-only" disabled={notReady}>
            {pdfUrl ? (pdf.status === 'preparing' ? d.preparingButton : d.downloadPdf) : d.print}
          </button>
          <button type="button" className="button ghost" onClick={onClose}>
            {d.cancel}
          </button>
        </div>
      </div>
    </div>
  );
}

type PreparedPdf = { status: 'preparing'; slow: boolean } | { status: 'ready'; objectUrl: string; filename: string; bytes: number } | { status: 'error' };

/** Fetches the PDF as soon as the dialog opens, so the wait overlaps the reader's decision. */
function usePreparedPdf(pdfUrl: string | null): PreparedPdf {
  const [state, setState] = useState<PreparedPdf>({ status: 'preparing', slow: false });
  useEffect(() => {
    if (!pdfUrl) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    const slowTimer = setTimeout(() => !cancelled && setState((s) => (s.status === 'preparing' ? { status: 'preparing', slow: true } : s)), 2500);
    (async () => {
      try {
        const res = await fetch(pdfUrl);
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        const filename = res.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] ?? 'php2shell-exposure.pdf';
        setState({ status: 'ready', objectUrl, filename, bytes: blob.size });
      } catch {
        if (!cancelled) setState({ status: 'error' });
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(slowTimer);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [pdfUrl]);
  return state;
}
