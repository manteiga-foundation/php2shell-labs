// The exposure ladder. Pure: findings in, assessment out. The rubric lives here and in
// docs/scoring.md; change both together.
//
// The one idea the tool rests on: the version decides. PHP2Shell (CVE-2026-109618 and
// CVE-2026-109619) lives in PHP 5.4.0 through 8.5.11 and the fixed releases are known, so what a
// host advertises places it on the ladder; the consent-gated validation is evidence that refines
// a hidden version and never contradicts a known one. Runs on partial findings too: the live
// report re-assesses after every event and every rule must read sensibly half-way.

import type { PhpSign } from './fingerprint';
import { classifyPhpVersion, FIXED_RELEASES, type PhpVersion } from './versions';

export type ProbeAnswer = 'yes' | 'no' | 'error' | 'untested';

export interface ValidationEvidence {
  verdict: 'triggered' | 'not-triggered';
  baseline: { status: number; bodyBytes: number };
  payload: { status: number; bodyBytes: number; sentBytes: number; ms: number };
  /** The observed difference, in one sentence. */
  signature: string;
}

export interface Findings {
  /** The host answered one ordinary request; null until the first probe returns. */
  reachable: boolean | null;
  status: number | null;
  serverSoftware: string | null;
  poweredBy: string | null;
  /** The PHP version the host advertises; null when hidden or not yet read. */
  version: PhpVersion | null;
  versionText: string | null;
  /** PHP's logo endpoint answered with an image: PHP 5.4 or older with expose_php on (removed in 5.5). */
  egg: ProbeAnswer;
  /** The other passive signs of PHP: a PHPSESSID cookie, .php links on the page, the logo. */
  signs: PhpSign[];
  /** Consent-gated; null when it did not run. */
  validation: ValidationEvidence | null;
  errors: string[];
}

export function emptyFindings(): Findings {
  return {
    reachable: null,
    status: null,
    serverSoftware: null,
    poweredBy: null,
    version: null,
    versionText: null,
    egg: 'untested',
    signs: [],
    validation: null,
    errors: [],
  };
}

export const STAGES = ['unreachable', 'not-php', 'no-patch', 'exposed', 'hidden', 'not-affected', 'protected'] as const;
export type Stage = (typeof STAGES)[number];

/** The word the reader sees. Direct, for an executive audience; the technical names live in the details. */
export const STAGE_LABEL: Record<Stage, string> = {
  unreachable: 'UNREACHABLE',
  'not-php': 'NOT PHP',
  'no-patch': 'NO PATCH',
  exposed: 'EXPOSED',
  hidden: 'HIDDEN',
  'not-affected': 'NOT AFFECTED',
  protected: 'PROTECTED',
};

/** What each stage means in one line, for legends and the rubric. */
export const STAGE_MEANING: Record<Stage, string> = {
  unreachable: 'The host did not answer an ordinary web request. Nothing was measured.',
  'not-php': 'Nothing on this host answered as PHP. PHP2Shell does not apply to it.',
  'no-patch': 'PHP 5.4 through 8.1: inside the affected range on an end-of-life branch. No patch will come; only an upgrade removes the flaw.',
  exposed: 'PHP 8.2 through 8.5.11: inside the affected range, and a fixed release exists for the branch.',
  hidden: 'PHP runs but does not say which version. If it is 5.4 through 8.5.11, it is exposed.',
  'not-affected': 'PHP older than 5.4: the vulnerable code does not exist in it.',
  protected: 'A fixed PHP release (8.5.12, 8.4.27, 8.3.36, 8.2.35) or newer.',
};

export interface Note {
  id: string;
  text: string;
}

export interface NextStep {
  id: string;
  title: string;
  detail: string;
}

export interface Assessment {
  stage: Stage;
  /** 0-100; null when nothing is measurable (unreachable, not PHP). The stage is what the reader acts on. */
  score: number | null;
  verdict: string;
  nextStep: NextStep;
  version: {
    status: 'patched' | 'vulnerable' | 'no-patch' | 'below-range' | 'hidden' | 'absent' | 'unknown';
    text: string | null;
    branch: string | null;
    /** The first fixed build of the host's branch, when one exists. */
    fixedRelease: string | null;
    eol: boolean | null;
  };
  validation: {
    status: 'triggered' | 'not-triggered' | 'not-run';
    signature: string | null;
  };
  foundations: {
    reachable: boolean | null;
    phpPresent: boolean | null;
    versionDisclosed: boolean | null;
    supportedBranch: boolean | null;
  };
  notes: Note[];
  points: Record<string, number>;
}

export type NextStepId = 'check-address' | 'none' | 'upgrade' | 'patch' | 'find-version' | 'plan-upgrade' | 'keep-current';

/** The next steps in English. The web says them in the reader's language by id; the API and the terminal use these words. */
export const STEPS: Record<NextStepId, NextStep> = {
  'check-address': {
    id: 'check-address',
    title: 'Check the address',
    detail: 'No web server answered at this host and port. Check the name, and that the port is open to the Internet.',
  },
  none: {
    id: 'none',
    title: 'Nothing to do for PHP2Shell',
    detail: 'Nothing on this host answered as PHP, so the flaw does not apply. If PHP runs behind this address on another port or path, test that one.',
  },
  upgrade: {
    id: 'upgrade',
    title: 'Upgrade to a supported PHP branch',
    detail: 'The branch this host runs is end-of-life and will never receive the PHP2Shell fix. Move to 8.3 or newer and take its fixed release; distributions with long-term support may backport the fix to their own packages, which the version header will not show.',
  },
  patch: {
    id: 'patch',
    title: "Install your branch's fixed PHP release",
    detail: 'The fixed releases are 8.5.12, 8.4.27, 8.3.36 and 8.2.35. A package update and a restart of PHP is the whole change; test again afterwards and the report turns Protected.',
  },
  'find-version': {
    id: 'find-version',
    title: 'Find out which PHP this host runs',
    detail: 'A hidden version header does not patch the flaw. Read the version on the server (php -v) and, if it is 5.4 through 8.5.11, install the fixed release today. The consent-gated validation on this page can reproduce the condition without knowing the version.',
  },
  'plan-upgrade': {
    id: 'plan-upgrade',
    title: 'Nothing to do about PHP2Shell; plan an upgrade',
    detail: 'The vulnerable code does not exist in this PHP, but the branch has been end-of-life for years and carries other known flaws. Plan the upgrade on its own merits.',
  },
  'keep-current': {
    id: 'keep-current',
    title: 'Nothing to do today',
    detail: 'The host runs a fixed release. Keep PHP inside the fixed releases as part of normal patching, and consider hiding the version header (expose_php = Off) now that it no longer helps you.',
  },
};

/** The verdict in one sentence, per stage (English; the web translates by stage). */
export const VERDICT: Record<Stage, string> = {
  unreachable: 'No web server answered at this address.',
  'not-php': 'This host does not appear to run PHP, so PHP2Shell does not apply to it.',
  'no-patch': 'This host is exposed to PHP2Shell with no patch available: its PHP branch is end-of-life, so only an upgrade removes the flaw.',
  exposed: 'This host is exposed to PHP2Shell: it runs a PHP version inside the affected range, and a fixed release exists for its branch.',
  hidden: 'This host runs PHP but hides its version. Treat it as exposed until you know otherwise.',
  'not-affected': 'This host is not affected by PHP2Shell: its PHP is older than the vulnerable code.',
  protected: 'This host is not exposed to PHP2Shell: its PHP is a fixed release.',
};

export const NOTE_IDS = ['eol-branch', 'validation-reproduced', 'validation-not-reproduced', 'validation-disagrees'] as const;
export type NoteId = (typeof NOTE_IDS)[number];

/** The notes in English; the validation signature is the only variable part. */
export const NOTE_TEXT: Record<NoteId, (detail: string) => string> = {
  'eol-branch': () => 'This PHP branch has been end-of-life for years. This report measures PHP2Shell only; it is not a clean bill of health.',
  'validation-reproduced': (signature) => `The exploit validation reproduced the out-of-memory bailout on this host: ${signature}.`,
  'validation-not-reproduced': () =>
    'The bailout was not reproduced within the 48 MB test (the memory limit may sit above it). The version still places this host inside the affected range.',
  'validation-disagrees': () =>
    'The validation signature disagrees with the version the host advertises: either the application answers large requests with empty 200s on its own, or the host is not what its headers claim. Check by hand.',
};

const SCORE: Record<Stage, number | null> = {
  unreachable: null,
  'not-php': null,
  'no-patch': 15,
  exposed: 35,
  hidden: 50,
  'not-affected': 80,
  protected: 100,
};

const versionText = (v: PhpVersion) => `${v.major}.${v.minor}.${v.patch}`;

export function assess(f: Findings): Assessment {
  const notes: Note[] = [];
  const note = (id: NoteId, detail = '') => notes.push({ id, text: NOTE_TEXT[id](detail) });

  const phpHeader = f.poweredBy !== null && /php/i.test(f.poweredBy);
  // PHP is present when any sign says so; absent only once the egg has answered no and nothing else said PHP.
  const phpPresent: boolean | null = f.version !== null || phpHeader || f.egg === 'yes' || f.signs.length > 0 ? true : f.egg === 'no' ? false : null;
  const cls = f.version ? classifyPhpVersion(f.version) : null;
  const branch = f.version ? `${f.version.major}.${f.version.minor}` : null;
  const fixed = branch && FIXED_RELEASES[branch] ? versionText(FIXED_RELEASES[branch]) : null;
  const eol: boolean | null = cls === null ? null : cls === 'no-patch' || cls === 'below-range';

  let stage: Stage;
  if (f.reachable !== true) stage = 'unreachable';
  else if (cls === 'patched') stage = 'protected';
  else if (cls === 'vulnerable') stage = 'exposed';
  else if (cls === 'no-patch') stage = 'no-patch';
  else if (cls === 'below-range') stage = 'not-affected';
  else if (phpPresent === false) stage = 'not-php';
  else stage = 'hidden';

  if (stage === 'not-affected') note('eol-branch');

  // The validation is evidence about the host, not a rung of its own.
  const v = f.validation;
  if (v) {
    const inRange = stage === 'exposed' || stage === 'no-patch' || stage === 'hidden';
    if (v.verdict === 'triggered') {
      if (inRange) {
        note('validation-reproduced', v.signature);
        if (stage === 'hidden') stage = 'exposed';
      } else note('validation-disagrees');
    } else if (inRange) note('validation-not-reproduced');
  }

  let nextStep: NextStep;
  if (stage === 'unreachable') nextStep = STEPS['check-address'];
  else if (stage === 'not-php') nextStep = STEPS.none;
  else if (stage === 'no-patch') nextStep = STEPS.upgrade;
  else if (stage === 'exposed') nextStep = STEPS.patch;
  else if (stage === 'hidden') nextStep = STEPS['find-version'];
  else if (stage === 'not-affected') nextStep = STEPS['plan-upgrade'];
  else nextStep = STEPS['keep-current'];

  const score = SCORE[stage];
  const points: Record<string, number> = { stage: score ?? 0 };

  return {
    stage,
    score,
    verdict: VERDICT[stage],
    nextStep,
    version: {
      status: cls ?? (phpPresent === true ? 'hidden' : phpPresent === false ? 'absent' : 'unknown'),
      text: f.versionText,
      branch,
      fixedRelease: fixed,
      eol,
    },
    validation: {
      status: v ? v.verdict : 'not-run',
      signature: v ? v.signature : null,
    },
    foundations: {
      reachable: f.reachable,
      phpPresent,
      versionDisclosed: f.reachable === true ? f.version !== null : null,
      supportedBranch: eol === null ? null : !eol,
    },
    notes,
    points,
  };
}
