import { useEffect, useState } from 'react';
import { STAGE_LABEL } from '../../../engine/assess';
import { loadMetrics } from '../api';
import { Panel } from '../components/Panel';
import { HostsTable } from '../components/HostsTable';
import type { MetricsData } from '../fixtures';

const STAGES = ['no-patch', 'exposed', 'hidden', 'not-affected', 'protected', 'not-php'] as const;
/** The stages that carry a score: the share below counts PHP hosts only. */
const SCORED = ['no-patch', 'exposed', 'hidden', 'not-affected', 'protected'] as const;

export function Metrics() {
  const [data, setData] = useState<MetricsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    loadMetrics().then((d) => ('error' in d ? setError(d.error) : setData(d)));
  }, []);

  if (error) {
    return (
      <main className="metrics">
        <h1>Metrics</h1>
        <p className="alert" role="alert">
          {error}
        </p>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="metrics">
        <h1>Metrics</h1>
        <p className="notice">Loading.</p>
      </main>
    );
  }

  const last = data.days.at(-1)!;
  // Over the 30 days: the share of PHP hosts that landed Protected or Not affected, and the share answered from cache.
  const sum = (d: MetricsData['days'][number], stages: readonly string[]) => stages.reduce((t, s) => t + (d.stages[s] ?? 0), 0);
  const staged = data.days.reduce((t, d) => t + sum(d, SCORED), 0);
  const good = data.days.reduce((t, d) => t + sum(d, ['protected', 'not-affected']), 0);
  const goodShare = staged ? Math.round((good / staged) * 100) : 0;
  const repeat = data.totals.scans ? Math.round((data.totals.cacheHits / data.totals.scans) * 100) : 0;
  const maxScans = Math.max(...data.days.map((d) => d.scans));
  const share = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
  const protectedShareFirst = share(sum(data.days[0], ['protected', 'not-affected']), sum(data.days[0], SCORED));
  const protectedShareLast = share(sum(last, ['protected', 'not-affected']), sum(last, SCORED));

  return (
    <main className="metrics">
      <div>
        <h1>Metrics</h1>
        <p className="notice">
          Private. Daily aggregates for the last 30 days; nothing about who scanned beyond country. Generated {new Date(data.generatedAt).toUTCString()}.
        </p>
      </div>

      <section className="section">
        <h2>Use</h2>
        <div className="counts">
          <Count label="Scans, 30 days" value={data.totals.scans} testId="metric-scans" />
          <Count label="Unique hosts" value={data.totals.hosts} testId="metric-hosts" />
          <Count label="Cache hits" value={data.totals.cacheHits} />
          <Count label="Shared links opened" value={data.totals.sharedOpens} />
          <Count label="Reports downloaded" value={data.totals.pdfDownloads ?? 0} testId="metric-pdfs" />
          <Count label="Failures, 30 days" value={data.totals.failures} />
          <Count label="Scans today" value={last.scans} />
          <Count label="Not exposed, PHP hosts, 30 days" value={`${goodShare}%`} testId="metric-share" />
          <Count label="Median score, 30 days" value={data.totals.medianScore ?? 0} />
          <Count label="Repeat tests" value={`${repeat}%`} />
          <Count label="Countries, 30 days" value={data.totals.countries ?? 0} />
          <Count label="Exploit validations, 30 days" value={data.totals.validations ?? 0} testId="metric-validations" />
        </div>
      </section>

      <section className="section">
        <h2>Exposure over time</h2>
        <p className="notice">
          PHP hosts not exposed: {protectedShareFirst}% thirty days ago, {protectedShareLast}% today. Bars are scans per day by stage.
        </p>
        <div className="trend" role="img" aria-label="Scans per day by stage, last 30 days">
          {data.days.map((d) => (
            <div key={d.date} className="day" data-testid="trend-day" title={`${d.date}: ${d.scans} scans`}>
              {STAGES.map((s) => (
                <div key={s} className="seg" style={{ height: `${(d.stages[s] / maxScans) * 100}%`, background: `var(--stage-${s})` }} />
              ))}
            </div>
          ))}
        </div>
        <div className="legend">
          {STAGES.map((s) => (
            <span key={s}>
              <span className="swatch" style={{ background: `var(--stage-${s})` }} />
              {STAGE_LABEL[s]}
            </span>
          ))}
        </div>
      </section>

      <section className="section">
        <h2>Hosts tested</h2>
        <HostsTable hosts={data.hosts} generatedAt={data.generatedAt} />
      </section>

      <section className="section">
        <h2>Health</h2>
        <div className="counts">
          <Count label="Probe time p50, today" value={`${last.p50} ms`} />
          <Count label="Probe time p95, today" value={`${last.p95} ms`} />
          <Count label="Failure rate, today" value={`${share(last.failures, last.scans)}%`} />
        </div>
      </section>

      <section className="section">
        <h2>Failures</h2>
        <p className="notice">Last 30 days, by reason.</p>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Reason</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody>
              {data.failures.map((f) => (
                <tr key={f.reason}>
                  <td>{f.reason}</td>
                  <td className="mono">{f.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <h2>Where scans come from</h2>
        <div className="cards">
          <Panel>
            <h3>Referrers</h3>
            <ul>
              {data.referrers.map((r) => (
                <li key={r.source}>
                  {r.source}: {r.count}
                </li>
              ))}
            </ul>
          </Panel>
          <Panel>
            <h3>Countries</h3>
            <ul>
              {data.countries.map((c) => (
                <li key={c.country}>
                  {c.country}: {c.count}
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </section>

      <section className="section">
        <h2>Signals to improve the tool</h2>
        <div className="cards">
          {data.signals.map((s) => (
            <Panel key={s.label}>
              <h3>{s.label}</h3>
              <p>{s.detail}</p>
            </Panel>
          ))}
        </div>
      </section>
    </main>
  );
}

function Count({ label, value, testId }: { label: string; value: number | string; testId?: string }) {
  return (
    <Panel className="count" corners>
      <div className="label">{label}</div>
      <div className="value" data-testid={testId}>
        {typeof value === 'number' ? value.toLocaleString('en-US') : value}
      </div>
    </Panel>
  );
}
