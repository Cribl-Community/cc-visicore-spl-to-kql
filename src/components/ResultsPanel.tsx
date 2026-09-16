import { useMemo } from 'react';
import { Alert, EmptyState, Text } from '@capra/core';
import type { JobResults, SearchJob } from '../api';

const fmt = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

/** Column order: _time first, user fields next, other internal fields last. */
function orderColumns(rows: Record<string, unknown>[]): string[] {
  const keys = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) keys.add(k);
  const rank = (k: string) => (k === '_time' ? 0 : k.startsWith('_') ? 2 : 1);
  return [...keys].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)).slice(0, 60);
}

export function ResultsPanel({ job, results, error, running }: { job: SearchJob | null; results: JobResults | null; error: string | null; running: boolean }) {
  const columns = useMemo(() => (results ? orderColumns(results.rows) : []), [results]);

  if (error) return <Alert appearance="danger" title="Search failed">{error}</Alert>;
  if (running) return <EmptyState title="Running search…" description={job ? `Job ${job.id} is ${job.status}.` : 'Creating the search job.'} size="md" />;
  if (!results) return <EmptyState title="No results yet" description="Use Run in Cribl Search to execute the translated query and see results here." size="md" />;
  if (!results.rows.length) return <EmptyState title="No events matched" description="The search completed but returned no events. Check the dataset scope and time range." size="md" />;
  return (
    <div className="results">
      <div className="results-meta">
        <Text variant="body-sm-normal" color="subtle">
          {`Showing ${results.rows.length}${results.meta.totalEventCount !== undefined ? ` of ${results.meta.totalEventCount}` : ''} events${job ? ` · job ${job.id}` : ''}${
            results.meta.warnings?.length ? ` · ${results.meta.warnings.join('; ')}` : ''
          }`}
        </Text>
        {job && (
          <a href={`/search/jobs/${encodeURIComponent(job.id)}`} target="_top" className="link">
            Open in Cribl Search
          </a>
        )}
      </div>
      <div className="table-wrap">
        <table className="results-table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {results.rows.map((r, i) => (
              <tr key={i}>
                {columns.map((c) => (
                  <td key={c}>{fmt(r[c])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
