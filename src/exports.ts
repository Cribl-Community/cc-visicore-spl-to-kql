/**
 * Writes a KQL query performs when it runs: `export ... to lookup|lake|search <name>`. The run and save
 * dialogs name these so a user confirms exactly what will be created, replaced or appended to.
 */
export interface ExportTarget {
  kind: 'lookup' | 'lake' | 'search';
  name: string;
  /** Lookups only: create (fails if the lookup exists), overwrite or append. */
  mode?: 'create' | 'overwrite' | 'append';
}

const EXPORT_RE = /(?:^|\|)\s*export\b([^|]*?)\bto\s+(?:(lookup|lake|search)\s+)?("[^"]+"|[^\s|]+)/gim;

export function findExports(kql: string): ExportTarget[] {
  const out: ExportTarget[] = [];
  for (const m of kql.matchAll(EXPORT_RE)) {
    const kind = (m[2]?.toLowerCase() ?? 'lake') as ExportTarget['kind'];
    const name = m[3].replace(/^"|"$/g, '');
    const mode = /\bmode\s*=\s*(create|overwrite|append)\b/i.exec(m[1])?.[1]?.toLowerCase() as ExportTarget['mode'] | undefined;
    out.push(kind === 'lookup' ? { kind, name, mode: mode ?? 'create' } : { kind, name });
  }
  return out;
}

/** One sentence per target, naming exactly what is written. */
export function describeExport(t: ExportTarget): string {
  if (t.kind === 'lookup') {
    if (t.mode === 'overwrite') return `Replaces the entire contents of the lookup "${t.name}" (or creates it). The previous contents are not kept.`;
    if (t.mode === 'append') return `Appends rows to the lookup "${t.name}" (or creates it). Appended rows are not removed automatically.`;
    return `Creates the lookup "${t.name}"; the search fails if it already exists.`;
  }
  if (t.kind === 'search') return `Writes the results into the Search dataset "${t.name}". Written data is not removed automatically.`;
  return `Writes the results into the Lake dataset "${t.name}". Written data is not removed automatically.`;
}
