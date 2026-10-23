# Status

What is built, what is emulated, what comes next, and the open questions. Updated with every slice
that changes it; `AGENTS.md` stays the contract.

## Built

- Engine (`engine/`): target parser and refusal list (resolve first, refuse non-public, connect to
  the resolved address); the passive fingerprint (front page headers, PHPSESSID cookie, `.php`
  links, the logo query); the consent-gated validation (one control POST, one chunked POST of 48 MB,
  signature by comparison, never by fixed statuses); the ladder (`assess.ts`, rubric in
  `docs/scoring.md`); the scan streaming its events with the fingerprint first so the ring never
  shows a word it takes back; the HTTP face (`server.ts`: NDJSON, bearer token, concurrency cap
  held for the stream's life, 120 s idle timeout for the upload); the command line with the
  terminal renderer; the PDF pages (`report-html.ts`).
- Edge (`worker/`): validation with the engine's parser, DNS-over-HTTPS resolution and the refusal
  list again, rate limits per caller, per host and per caller for validations (D1 counters), the
  24 h exposure cache that never serves a consented validation, streaming pass-through with the
  share id appended, shared pages with rewritten previews and noindex, the one-answer API on POST
  with `Accept: application/json` and on GET, the PDF route cached per id, metrics, sitemap, the
  localized index for six language prefixes.
- Web (`web/`): entry with the consent box off by default and eight questions; the live report
  (ring, verdict, next step, recommendations, Version / Validation / Foundations cards, probe
  table, download dialog with PDF progress, share); shared results with the call to action; the
  private metrics view with the hosts table and .xlsx export; the API page. Six languages (en, es,
  pt, fr, de, ja) with the engine's English kept for the API and the terminal. Open Graph images per
  stage. One-column phone layout, ring word measured to fit in every language.
- Renderer (`render/`): one warm Chromium printing five landscape Letter pages with the bundled
  fonts; deterministic bytes for the same result.
- Tests: `bun run test:unit` (engine, policy, worker against bun:sqlite with the real schema,
  report model, i18n shape, openapi, README contract), `bun test tests/web.test.ts` (Chromium),
  `bun test tests/render.test.ts` (Chromium PDF).

## Emulated

- The web's `?demo=<stage>` replays a recorded fixture (`web/src/fixtures/*.json`, recorded by
  `scripts/record-fixture.ts` against in-process fixture servers); `/metrics?demo=1` shows invented
  counts.

## Live

- Edge: Worker `php2shell-labs` at https://php2shell-labs.taptok-test.workers.dev (D1 `php2shell`).
- Engine: Fly app `php2shell-engine` (iad), https://php2shell-engine.fly.dev.
- Renderer: Fly app `php2shell-render` (iad), https://php2shell-render.fly.dev, scales to zero.

## Findings worth keeping

- The logo query (`?=PHPE9568F34-...`) is PHP's easter egg, removed in PHP 5.5: on any modern host
  it answers no, which an earlier version of the engine read as "not PHP". The session cookie and
  `.php` links are the signs that remain; www.php.net, which hides its version, now reads Hidden.
- The validation control request's status drifts on the same host between runs (401 one hour,
  405 the next); the signature must compare the two answers, never assume a status.
- The refusal list rejects TEST-NET (203.0.113.0/24), so tests that stub the resolver must answer
  with a real public address.

## Next candidates

- A real domain for the edge instead of the workers.dev name.
- A study: a population of public PHP hosts, scanned with consent where it can be obtained,
  published with the method.
- Backport detection: Debian and Red Hat packages that carry the fix under an older version
  string, read from the distribution's own headers when they say so.

## Open questions

- Whether the 48 MB validation size should follow the host's `post_max_size` when the front page
  reveals it.
