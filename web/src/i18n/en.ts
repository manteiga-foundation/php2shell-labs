// The English words of the web, and the shape every other language follows (`Messages`). The
// report's verdicts, next steps, notes and stage words are the engine's own, so the page, the
// API and the terminal say the same thing in English. Data only: the edge imports this file.
//
// Conventions the tests rely on: functions take positional strings and numbers, except
// `errors.scan`, which takes the edge's params object. Inline markup in long texts: [text](href)
// for a link and `code` for code, rendered by `Rich` (web/src/i18n/react.tsx).

import { NOTE_TEXT, STAGE_LABEL, STAGE_MEANING, STEPS, VERDICT, type NextStepId } from '../../../engine/assess';
import { TARGET_ERRORS } from '../../../engine/target';

/** What the edge and the page can say went wrong with a scan, by code. */
export const SCAN_ERROR_CODES = [
  'port-not-allowed',
  'rate-caller',
  'rate-host',
  'rate-validation',
  'rate',
  'no-address',
  'not-public',
  'engine-busy',
  'engine-failed',
  'start-failed',
  'connection-lost',
  'expired',
  'load-failed',
  'no-demo',
] as const;
export type ScanErrorCode = (typeof SCAN_ERROR_CODES)[number];
export interface ScanErrorParams {
  host?: string;
  port?: number;
  allowed?: number[];
  address?: string;
  status?: number;
}

const steps = Object.fromEntries(Object.entries(STEPS).map(([id, s]) => [id, { title: s.title, detail: s.detail }])) as Record<NextStepId, { title: string; detail: string }>;

export const en = {
  meta: {
    title: 'PHP2Shell Labs: is your server exposed to PHP2Shell?',
    description:
      'Test any public host for PHP2Shell, the PHP remote-code-execution pair CVE-2026-109618 and CVE-2026-109619. One ordinary visit tells you where the host stands and what to do next; an optional, consent-gated validation reproduces the condition once.',
    ogTitle: 'PHP2Shell Labs: is your server exposed? Test your host',
    ogDescription: 'Where does your host stand on PHP2Shell? A plain-language report with the one next step, in about a second.',
    twitterDescription: 'Where does your host stand on PHP2Shell? A plain-language report with the one next step.',
    shareTitle: (host: string, stage: string) => `${host} is ${stage}`,
    shareDescription: (verdict: string, step: string) => `${verdict} Next step: ${step}.`,
  },
  shell: {
    byline: 'By Manteiga Foundation',
    source: 'Source',
    howWeScore: 'How we score',
    api: 'API',
    language: 'Language',
    footerScope:
      'PHP2Shell Labs answers one question: is this host exposed to PHP2Shell (CVE-2026-109618, CVE-2026-109619)? It reads what the host says of itself and, with your consent, reproduces the out-of-memory condition once. It is not a general PHP audit.',
    footerLicense:
      'Open source under the MIT license. A [Manteiga Foundation](https://manteiga.org) project. [API](/api) for scripts, services and agents. Abuse or questions: hello@manteiga.org',
  },
  titles: {
    metrics: 'Metrics',
    api: 'API',
    done: (host: string, stage: string) => `${host}: ${stage.toLowerCase()}`,
    testing: (host: string) => `Testing ${host}`,
  },
  entry: {
    h1: 'Is your server exposed to PHP2Shell?',
    sub: 'Type a host name. We make one ordinary visit, read what it tells every visitor about its PHP, and tell you where it stands on the PHP2Shell flaw and what to do next.',
    hostLabel: 'Host',
    test: 'Test',
    consent: 'Also run the exploit validation',
    consentHint:
      'Sends one large request (about 48 MB) that reproduces the out-of-memory condition the flaw lives in. Nothing is executed on the host and no exploit code is sent. Off by default.',
    notice: 'The exposure test is one ordinary visit to the host you enter, as a browser would make it. The validation runs only when you tick the box. Only test hosts you are allowed to connect to.',
    questions: 'Questions',
    faq: [
      {
        q: 'What is PHP2Shell?',
        a: 'Two flaws in PHP itself, disclosed on 21 October 2026 and tracked as CVE-2026-109618 and CVE-2026-109619. When a request runs out of memory during startup, PHP fails to clean up safely and later uses memory it already released. No password is needed to reach the condition on a PHP site that answers web requests, and the outcome can be remote code execution. The fixed releases are 8.5.12, 8.4.27, 8.3.36 and 8.2.35.',
      },
      {
        q: 'What does the exposure test do to my host?',
        a: "One ordinary visit, as a browser would make it, plus PHP's old logo query: two requests from one address, in about a second. It reads what every visitor can already see (the Server and X-Powered-By headers, a PHP session cookie, links to .php pages) and compares the PHP version against the fixed releases. No payload is sent, and nothing is stored about the host except the result you see.",
      },
      {
        q: 'What does the exploit validation do, and why is it off by default?',
        a: 'Two posted requests: a small one that reaches the application, and one large (about 48 MB) chunked request that pushes PHP past its memory limit during request startup, the exact condition the flaw lives in. If the host answers the large request with an empty success the application never wrote, the condition is reproduced. No exploit code is sent and nothing runs on the host; still, it is a large request to someone else\u2019s server, so it runs only with your consent, and four times an hour per caller.',
      },
      {
        q: 'My host says Hidden. Is that good?',
        a: 'Hiding the version header (expose_php = Off) is good hygiene, but it does not patch anything: a host that hides its version is treated as exposed until you know otherwise. Read the version on the server (`php -v`) and, if it is 5.4 through 8.5.11, install the fixed release; or tick the validation to reproduce the condition without knowing the version.',
      },
      {
        q: 'Why does my report say No patch?',
        a: 'The PHP branch the host runs (8.1 or older) is end-of-life: it no longer receives fixes from the PHP project, so there is no patched build to install. The way out is an upgrade to a supported branch and its fixed release. Some distributions with long-term support backport fixes to their own packages; the version header cannot show that, which is what the validation is for.',
      },
      {
        q: 'My site is behind a CDN or a load balancer. What am I testing?',
        a: 'Whatever answers at the public address. A CDN that caches the home page may hide the origin\u2019s headers, so a Not PHP or Hidden result behind a CDN says little about the origin; the validation, which posts to the application, usually reaches it. If the application is served from another host name or port, test that one.',
      },
      {
        q: 'Can I test hosts on my own network?',
        a: 'Not from this page: the public service refuses private, loopback and link-local addresses before connecting. Clone the repository and run the same engine from your terminal with `bun run scan host --private`; the result and the rubric are identical, and `--validate` gives the consent there.',
      },
      {
        q: 'Can scripts and other services use this?',
        a: 'Yes, free and without a key: [the API](/api) answers one JSON object per scan, with the share and PDF links. Twenty scans per caller and six per host in an hour; validations need `validate: true` and are limited to four per caller per hour.',
      },
    ],
  },
  stage: {
    label: STAGE_LABEL,
    meaning: STAGE_MEANING,
  },
  report: {
    ringOf: 'of 100',
    ringScanning: 'scanning',
    ringNoScore: 'no score',
    ringAria: (stage: string, score: string) => `${stage}, ${score}`,
    probesLive: (n: number) => `${n} probes answered`,
    probesDone: (n: number, ms: number) => `${n} probes in ${ms} ms`,
    stopped: 'stopped',
    complete: 'complete',
    headingTesting: 'Testing',
    headingNotRun: 'Scan not run',
    headingSafe: 'Not exposed',
    headingExposed: 'Exposed to PHP2Shell',
    headingHidden: 'Version hidden',
    headingNotPhp: 'Not a PHP host',
    headingUnreachable: 'Unreachable',
    liveVerdict: 'The host is answering. The ring fills as the picture settles; the verdict follows the last answer.',
    verdict: VERDICT,
    standing: 'Standing',
    nextStep: 'The one next step',
    steps,
    notes: NOTE_TEXT,
    download: 'Download report',
    share: 'Share link',
    copied: 'Link copied',
    copyPrompt: 'Copy this link',
    checkOwn: 'Check your own host',
    checkAnother: 'Check another host',
    recommendations: 'Recommendations',
    consentTitle: 'The validation did not run',
    consentBody: 'The exposure test reads only what the host says of itself. To reproduce the condition once, test again with the validation box ticked.',
    technical: 'Technical details',
    detailsSummary: 'Every probe, the requests, and the rubric',
    /** Between a label and its value in the cards ("PHP: 7.1.26"). */
    sep: ': ',
    yes: 'yes',
    no: 'no',
    none: 'none',
    notMeasured: 'not measured',
    version: {
      title: 'Version · exposure',
      patched: 'Fixed release',
      vulnerable: 'Inside the affected range, fix available',
      noPatch: 'Inside the affected range, end-of-life branch',
      belowRange: 'Older than the flaw',
      hidden: 'PHP runs, version hidden',
      absent: 'Nothing answered as PHP',
      unknown: 'Not read',
      body: 'PHP2Shell lives in PHP 5.4.0 through 8.5.11. What the host advertises places it on the ladder; a fixed release ends the matter.',
      php: 'PHP',
      hiddenValue: 'hidden',
      branch: 'Branch',
      eol: 'end-of-life',
      supported: 'supported',
      fixedIn: 'Fixed in',
      server: 'Server',
      egg: 'Signs of PHP',
      answered: 'answered',
      silent: 'silent',
      signs: { cookie: 'a PHPSESSID cookie', links: 'links to .php pages', logo: 'the PHP logo', none: 'none seen' },
    },
    validation: {
      title: 'Validation · evidence',
      triggered: 'Bailout reproduced',
      notTriggered: 'Bailout not reproduced within 48 MB',
      notRun: 'Not run',
      bodyTriggered: 'The large request died during PHP\u2019s startup and the server answered with an empty success the application never wrote: the condition the flaw lives in, reproduced once.',
      bodyNotTriggered: 'The large request was answered like the small one. The memory limit may sit above 48 MB; the version still decides.',
      bodyNotRun: 'The validation runs only with your consent. It sends one large request and judges the answer; nothing is executed on the host.',
      signature: 'Signature',
      control: 'Control request',
      large: 'Large request',
      answer: (status: number, bytes: number) => `HTTP ${status}, ${bytes} bytes back`,
      sent: (mb: number, s: string) => `${mb} MB in ${s} s`,
    },
    foundations: {
      title: 'Foundations · hygiene',
      inPlace: (n: number) => `${n} of 4 in place`,
      body: 'The habits that make the next flaw cheap: a host that answers, a supported branch, a version you know.',
      reachable: 'Answers an ordinary visit',
      phpPresent: 'PHP present',
      versionDisclosed: 'Version disclosed to visitors',
      supportedBranch: 'Supported PHP branch',
    },
    probes: {
      probe: 'Probe',
      answer: 'Answer',
      said: 'What the host said',
      ms: 'ms',
      answered: 'answered',
      noAnswer: 'no answer',
      reproduced: 'reproduced',
      notReproduced: 'not reproduced',
      noImage: 'none seen',
      waiting: 'waiting',
      home: 'One ordinary visit',
      egg: 'Signs of PHP',
      validation: 'Exploit validation',
    },
    rubric: (score: string, stage: string) => `Score ${score}: the stage word carries the number (${stage}). No patch 15, Exposed 35, Hidden 50, Not affected 80, Protected 100; Not PHP and Unreachable carry none.`,
    stages: 'Stages',
    standards: 'References: CVE-2026-109618 and CVE-2026-109619 (disclosed 21 October 2026); PHP fixed releases 8.5.12, 8.4.27, 8.3.36, 8.2.35; PHP supported-versions schedule.',
    printFooter: 'A Manteiga Foundation project',
  },
  dialog: {
    title: 'Download the report',
    bodyPdf: 'A five-page PDF, print-ready: cover, executive summary, where the host stands, technical details, method and references.',
    bodyPrint: 'The report prints to PDF from your browser.',
    preparing: 'Preparing the PDF.',
    preparingSlow: 'Preparing the PDF. The first one after a quiet spell takes up to twenty seconds while the renderer starts.',
    ready: (kb: number) => `PDF ready, ${kb} KB.`,
    error: 'The PDF could not be prepared right now. Reload the page to try again, or print from your browser.',
    downloadPdf: 'Download PDF',
    preparingButton: 'Preparing',
    print: 'Print',
    cancel: 'Cancel',
  },
  errors: {
    target: { ...TARGET_ERRORS } as Record<keyof typeof TARGET_ERRORS, string>,
    scan: {
      'port-not-allowed': (p: ScanErrorParams) => {
        const allowed = p.allowed ?? [80, 443];
        return `The public scanner tests port${allowed.length > 1 ? 's' : ''} ${allowed.join(' and ')} only. Port ${p.port} was asked for and noted.`;
      },
      'rate-caller': () => 'Too many scans from your address. Please wait a few minutes.',
      'rate-host': () => 'This host was tested several times in the last hour. The last result is shown when it is fresh; please try again shortly.',
      'rate-validation': () => 'Too many validations from your address this hour. The exposure test still runs without the box ticked.',
      rate: () => 'Too many scans right now. Try again in a moment.',
      'no-address': (p: ScanErrorParams) => `${p.host} does not resolve to any address.`,
      'not-public': (p: ScanErrorParams) => `${p.host} resolves to ${p.address}, which is not a public Internet address. The public scanner tests only public hosts.`,
      'engine-busy': () => 'The scanner is busy. Please try again in a moment.',
      'engine-failed': () => 'The scanner could not run. Please try again in a moment.',
      'start-failed': (p: ScanErrorParams) => `The scan could not start (${p.status}).`,
      'connection-lost': () => 'The connection to the scanner was lost.',
      expired: () => 'This result has expired or never existed. Results are kept for 30 days.',
      'load-failed': (p: ScanErrorParams) => `The result could not be loaded (${p.status}).`,
      'no-demo': () => 'There is no such demo result.',
    } satisfies Record<ScanErrorCode, (p: ScanErrorParams) => string>,
  },
};

export type Messages = typeof en;
