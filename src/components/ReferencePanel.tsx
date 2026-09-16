import { useMemo, useState } from 'react';
import { Collapse, Tag, Text, TextField, ToggleButtonGroup } from '@capra/core';
import { KQL_CATALOG, type CatalogEntry } from '../data/kql-catalog';
import { CHEATSHEET } from '../data/cheatsheet';
import type { KustoDocs } from '../api';

type Mode = 'cheatsheet' | 'catalog';

/** Merge the live docs bundle (when loaded) over the bundled snapshot. */
function useCatalog(live: KustoDocs | null): CatalogEntry[] {
  return useMemo(() => {
    if (!live) return KQL_CATALOG;
    const byName = new Map(KQL_CATALOG.map((e) => [`${e.k}:${e.n}`, e]));
    const category = new Map<string, string>();
    for (const g of live.catalog) for (const i of g.items) category.set(`${i.kind}:${i.name}`, g.label);
    const out: CatalogEntry[] = [];
    for (const d of live.docs) {
      if (d.kind !== 'operator' && d.kind !== 'function') continue;
      const key = `${d.kind}:${d.name}`;
      const snap = byName.get(key);
      out.push({
        n: d.name,
        k: d.kind,
        c: category.get(key) ?? snap?.c ?? '',
        d: d.shortDescription?.trim() ?? snap?.d ?? '',
        s: snap?.s ?? '',
        u: `https://docs.cribl.io/search/${(d.metadata?.slug ?? '/' + d.name).replace(/^\//, '')}`,
      });
    }
    return out.sort((a, b) => a.k.localeCompare(b.k) || a.n.localeCompare(b.n));
  }, [live]);
}

export function ReferencePanel({ live, liveError }: { live: KustoDocs | null; liveError: string | null }) {
  const [mode, setMode] = useState<Mode>('cheatsheet');
  const [q, setQ] = useState('');
  const catalog = useCatalog(live);
  const needle = q.trim().toLowerCase();

  const filtered = useMemo(
    () => (needle ? catalog.filter((e) => e.n.toLowerCase().includes(needle) || e.d.toLowerCase().includes(needle) || e.c.toLowerCase().includes(needle)) : catalog),
    [catalog, needle],
  );
  const groups = useMemo(() => {
    const m = new Map<string, CatalogEntry[]>();
    for (const e of filtered) {
      const k = e.c || (e.k === 'operator' ? 'Operators' : 'Functions');
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(e);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  const cheat = useMemo(
    () =>
      CHEATSHEET.map((s) => ({
        ...s,
        rows: needle ? s.rows.filter((r) => r.spl.toLowerCase().includes(needle) || r.kql.toLowerCase().includes(needle) || (r.note ?? '').toLowerCase().includes(needle)) : s.rows,
      })).filter((s) => s.rows.length),
    [needle],
  );

  return (
    <div className="reference">
      <div className="reference-toolbar">
        <ToggleButtonGroup
          aria-label="Reference view"
          size="sm"
          selectedKeys={[mode]}
          disallowEmptySelection
          onSelectionChange={(keys) => {
            const k = [...keys][0];
            if (k) setMode(k as Mode);
          }}
          items={[
            { key: 'cheatsheet', text: 'SPL → KQL cheat sheet' },
            { key: 'catalog', text: `Cribl KQL catalog (${catalog.length})` },
          ]}
        />
        <TextField aria-label="Filter reference" placeholder="Filter…" value={q} onChange={setQ} size="sm" />
      </div>
      {mode === 'catalog' && (
        <Text variant="body-xs-normal" color="subtle">
          {live ? 'Loaded from this Cribl tenant (the same bundle that powers Search autocomplete).' : liveError ? `Using the bundled snapshot; live docs unavailable (${liveError}).` : 'Using the bundled snapshot.'}
        </Text>
      )}
      {mode === 'cheatsheet' ? (
        <div className="cheat">
          {cheat.map((s) => (
            <Collapse key={s.title} title={s.title} defaultExpanded>
              <table className="cheat-table">
                <thead>
                  <tr>
                    <th>SPL</th>
                    <th>Cribl Search KQL</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {s.rows.map((r) => (
                    <tr key={r.spl}>
                      <td>
                        <code>{r.spl}</code>
                      </td>
                      <td>
                        <code>{r.kql}</code>
                      </td>
                      <td>{r.note ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Collapse>
          ))}
          {!cheat.length && <Text color="subtle">No cheat-sheet rows match “{q}”.</Text>}
        </div>
      ) : (
        <div className="catalog">
          {groups.map(([label, entries]) => (
            <Collapse key={label} title={`${label} (${entries.length})`} defaultExpanded={!!needle}>
              <ul className="catalog-list">
                {entries.map((e) => (
                  <li key={`${e.k}:${e.n}`} className="catalog-item">
                    <div className="catalog-head">
                      <a href={e.u} target="_blank" rel="noopener noreferrer" className="link">
                        <code>{e.n}</code>
                      </a>
                      <Tag size="sm" color={e.k === 'operator' ? 'info' : 'default'}>
                        {e.k}
                      </Tag>
                    </div>
                    <Text variant="body-sm-normal">{e.d}</Text>
                    {e.s && <pre className="code code-sm">{e.s}</pre>}
                  </li>
                ))}
              </ul>
            </Collapse>
          ))}
          {!groups.length && <Text color="subtle">No operators or functions match “{q}”.</Text>}
        </div>
      )}
    </div>
  );
}
