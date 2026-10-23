// The live report: a pure reducer from the scan's event stream to what the views render.
// Shared with nothing DOM-bound so bun test can replay fixtures against it.

import { assess, emptyFindings, type Assessment, type Findings } from '../../engine/assess';
import type { ScanEvent, ScanResult } from '../../engine/events';
import type { ScanErrorParams } from './i18n/en';

/** An error carries English words for scripts, and a code with params the page says in the reader's language. */
export type ErrorEvent = { type: 'error'; error: string; code?: string; params?: ScanErrorParams };

export type StreamEvent = ScanEvent | { type: 'result'; result: ScanResult } | { type: 'saved'; id: string } | ErrorEvent;

export interface ProbeRow {
  id: string;
  label: string;
  answer: 'yes' | 'no' | 'error';
  detail: string;
  ms: number;
}

export interface ReportState {
  status: 'idle' | 'scanning' | 'done' | 'error';
  host: string | null;
  port: number | null;
  address: string | null;
  startedAt: string | null;
  /** Whether the reader consented to the validation for this scan. */
  validate: boolean;
  findings: Findings;
  assessment: Assessment;
  probes: ProbeRow[];
  result: ScanResult | null;
  shareId: string | null;
  error: string | null;
  errorCode: string | null;
  errorParams: ScanErrorParams;
  ms: number | null;
}

export function initialReport(): ReportState {
  const findings = emptyFindings();
  return {
    status: 'idle',
    host: null,
    port: null,
    address: null,
    startedAt: null,
    validate: false,
    findings,
    assessment: assess(findings),
    probes: [],
    result: null,
    shareId: null,
    error: null,
    errorCode: null,
    errorParams: {},
    ms: null,
  };
}

function cloneFindings(f: Findings): Findings {
  return { ...f, validation: f.validation ? { ...f.validation } : null, errors: [...f.errors] };
}

export function applyEvent(state: ReportState, event: StreamEvent): ReportState {
  switch (event.type) {
    case 'start':
      return {
        ...initialReport(),
        status: 'scanning',
        host: event.target.host,
        port: event.target.port,
        address: event.address,
        startedAt: event.startedAt,
        validate: event.validate,
      };
    case 'probe': {
      const findings = cloneFindings(state.findings);
      const { id, answer } = event;
      // Probe rows are the table; the findings come from the fingerprint and validation events, except a host that never answered.
      if (id === 'home' && answer === 'error') findings.reachable = false;
      if (answer === 'error') findings.errors.push(`${id}: ${event.detail}`);
      const probes = [...state.probes.filter((p) => p.id !== id), { id, label: event.label, answer, detail: event.detail, ms: event.ms }];
      return { ...state, findings, probes, assessment: assess(findings) };
    }
    case 'fingerprint': {
      const findings = cloneFindings(state.findings);
      const fp = event.fingerprint;
      findings.reachable = true;
      findings.status = fp.status;
      findings.serverSoftware = fp.serverSoftware;
      findings.poweredBy = fp.poweredBy;
      findings.version = fp.version;
      findings.versionText = fp.versionText;
      findings.egg = fp.egg ? 'yes' : 'no';
      return { ...state, findings, assessment: assess(findings) };
    }
    case 'validation': {
      const findings = cloneFindings(state.findings);
      findings.validation = { ...event.validation };
      return { ...state, findings, assessment: assess(findings) };
    }
    case 'assessment':
      return { ...state, assessment: event.assessment };
    case 'result':
      return {
        ...state,
        status: 'done',
        result: event.result,
        findings: event.result.findings,
        assessment: event.result.assessment,
        ms: event.result.ms,
        host: event.result.target.host,
        port: event.result.target.port,
        address: event.result.address,
        startedAt: event.result.startedAt,
        validate: event.result.validate,
      };
    case 'saved':
      return { ...state, shareId: event.id };
    case 'done':
      return { ...state, status: state.status === 'error' ? 'error' : 'done', ms: state.ms ?? event.ms };
    case 'error':
      return { ...state, status: 'error', error: event.error, errorCode: event.code ?? null, errorParams: event.params ?? {} };
    default:
      return state;
  }
}

/** A finished report rebuilt from a stored result (the shared /r/<id> view). */
export function reportFromResult(result: ScanResult, shareId: string | null = null): ReportState {
  return applyEvent({ ...initialReport(), shareId }, { type: 'result', result });
}
