// The API page: what an agent or another service needs to scan a host, read a result and fetch
// the PDF, in one screen. The machine-readable twins are /openapi.json and /llms.txt.

const ORIGIN = 'https://php2shell-labs.taptok-test.workers.dev';

export function Api() {
  return (
    <main className="metrics api">
      <h1>The API</h1>
      <p className="notice">
        Open, no key. The same scanner the page uses, for scripts, services and agents. The exposure test makes one ordinary visit to the host you name; the validation sends one large request and runs only when you ask for it. Only test hosts you are allowed to connect to. Machine-readable:{' '}
        <a href="/openapi.json">openapi.json</a> and <a href="/llms.txt">llms.txt</a>.
      </p>

      <section className="section" data-testid="api-scan">
        <h2>Scan a host</h2>
        <p>
          <span className="mono">POST /api/scan</span> with <span className="mono">{'{"host": "example.com", "validate": false}'}</span>. By default the answer is a stream of newline-delimited JSON events, which is what the live page draws from. Send <span className="mono">Accept: application/json</span> to wait for the end and receive one object; or use the GET form from a shell. <span className="mono">validate: true</span> is your consent to the exploit validation (one request of about 48 MB to the host).
        </p>
        <pre className="code">{`curl '${ORIGIN}/api/scan?host=example.com'

curl -X POST ${ORIGIN}/api/scan \\
  -H 'content-type: application/json' -H 'accept: application/json' \\
  -d '{"host": "example.com", "validate": false}'`}</pre>
        <p>The one-object answer:</p>
        <pre className="code">{`{
  "id": "MC0EZMRdbWSP",
  "url": "${ORIGIN}/r/MC0EZMRdbWSP",
  "pdf": "${ORIGIN}/api/report/MC0EZMRdbWSP.pdf",
  "cached": false,
  "result": {
    "target": { "host": "example.com", "port": 443 },
    "address": "…", "startedAt": "…", "ms": 412, "validate": false,
    "findings": { "reachable": true, "versionText": "7.1.26", "poweredBy": "PHP/7.1.26", "egg": "yes", "validation": null, … },
    "assessment": {
      "stage": "no-patch",            // unreachable | not-php | no-patch | exposed | hidden | not-affected | protected
      "score": 15,                    // 0-100, PHP2Shell exposure only; null for not-php and unreachable
      "verdict": "…",
      "nextStep": { "id": "upgrade", "title": "Upgrade to a supported PHP branch", "detail": "…" },
      "version": { … }, "validation": { … }, "foundations": { … }, "notes": [ … ]
    }
  }
}`}</pre>
        <p>
          The stream form, <span className="mono">application/x-ndjson</span>, carries one event per line: <span className="mono">start</span>, <span className="mono">fingerprint</span> (what the host said of itself), one <span className="mono">probe</span> per question, <span className="mono">validation</span> when consented, <span className="mono">result</span> (the same object as above) and <span className="mono">saved</span> (the id). Partial findings can be assessed as they arrive; the page does exactly that to make the ring climb.
        </p>
      </section>

      <section className="section" data-testid="api-result">
        <h2>Read a stored result</h2>
        <p>
          <span className="mono">GET /api/result/&lt;id&gt;</span> returns the result as stored. Results never change; a new scan makes a new id. The human page for the same id is <span className="mono">/r/&lt;id&gt;</span>, unlisted, with an Open Graph preview for sharing.
        </p>
        <pre className="code">{`curl ${ORIGIN}/api/result/MC0EZMRdbWSP | jq .assessment.stage`}</pre>
      </section>

      <section className="section" data-testid="api-report">
        <h2>Fetch the PDF</h2>
        <p>
          <span className="mono">GET /api/report/&lt;id&gt;.pdf</span>: the five-page report (cover, executive summary, where the host stands, technical details, method and references), landscape Letter. The first render after a quiet spell can take up to twenty seconds while the renderer starts; afterwards it is cached.
        </p>
        <pre className="code">{`curl -OJ ${ORIGIN}/api/report/MC0EZMRdbWSP.pdf`}</pre>
      </section>

      <section className="section" data-testid="api-limits">
        <h2>Limits and conduct</h2>
        <ul className="plain">
          <li>20 scans per caller address and 6 per host in any hour; 4 validations per caller address in any hour. Over the limit: 429 with Retry-After in seconds.</li>
          <li>An exposure result under 24 hours old is answered from cache (cached: true). A consented validation always runs fresh.</li>
          <li>Public hosts on ports 80 and 443 only. Private, loopback, link-local and multicast addresses are refused at resolution, before any connection is made.</li>
          <li>CORS is open: Access-Control-Allow-Origin: * on every /api response, so a page on any origin can call it.</li>
          <li>Errors are JSON with an error field and the matching status: 400 for input and refused hosts, 429 for limits, 502 when the engine could not finish.</li>
          <li>No key today. If the open API is abused, keys will come first for high volumes; the free tier will remain.</li>
        </ul>
      </section>

      <section className="section">
        <h2>Reading a stage</h2>
        <ul className="plain">
          <li><span className="mono">no-patch</span>: PHP 5.4 through 8.1, inside the affected range on an end-of-life branch; only an upgrade removes the flaw.</li>
          <li><span className="mono">exposed</span>: PHP 8.2 through 8.5.11, inside the affected range; a fixed release exists for the branch.</li>
          <li><span className="mono">hidden</span>: PHP runs but hides its version; treated as exposed until known otherwise.</li>
          <li><span className="mono">not-affected</span>: PHP older than 5.4; the vulnerable code does not exist in it.</li>
          <li><span className="mono">protected</span>: a fixed release (8.5.12, 8.4.27, 8.3.36, 8.2.35) or newer.</li>
          <li><span className="mono">not-php</span> and <span className="mono">unreachable</span> carry no score.</li>
        </ul>
        <p>
          The rubric is in <a href="https://github.com/manteiga-foundation/php2shell-labs/blob/main/docs/scoring.md">docs/scoring.md</a>; the engine is a dependency-free module in the same repository, if running it yourself suits better than calling it.
        </p>
      </section>
    </main>
  );
}
