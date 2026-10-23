// The scan's event contract: what the engine streams and what every renderer (web, CLI, the
// edge) consumes. Types only; no runtime imports, so the web can type-check without Bun.

import type { Assessment, Findings, ValidationEvidence } from './assess';
import type { Target } from './target';
import type { PhpVersion } from './versions';

export interface FingerprintWire {
  status: number;
  serverSoftware: string | null;
  poweredBy: string | null;
  versionText: string | null;
  version: PhpVersion | null;
  egg: boolean;
}

export type ScanEvent =
  | { type: 'start'; target: Target; address: string; startedAt: string; validate: boolean }
  | { type: 'probe'; id: 'home' | 'egg' | 'validation'; label: string; answer: 'yes' | 'no' | 'error'; detail: string; ms: number }
  | { type: 'fingerprint'; fingerprint: FingerprintWire; ms: number }
  | { type: 'validation'; validation: ValidationEvidence }
  | { type: 'assessment'; assessment: Assessment }
  | { type: 'done'; ms: number };

export interface ScanResult {
  target: Target;
  address: string;
  startedAt: string;
  ms: number;
  /** Whether the caller consented to the validation (it still skips when nothing answered as PHP). */
  validate: boolean;
  findings: Findings;
  assessment: Assessment;
}
