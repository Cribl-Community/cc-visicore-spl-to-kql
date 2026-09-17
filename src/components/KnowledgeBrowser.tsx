import { useMemo, useState, type ReactNode } from 'react';
import { EmptyState, Tag, Text, TextField, ToggleButtonGroup } from '@capra/core';
import type { Knowledge, SourcetypeKnowledge, Transform } from '../knowledge/types';

type Category = 'sourcetypes' | 'extractions' | 'aliases' | 'evals' | 'lookups' | 'eventtypes' | 'models' | 'macros';

/** One selectable entry in the left-hand list. */
interface Item {
  id: string;
  title: string;
  /** Short secondary text shown under the title. */
  hint?: string;
  /** Extra text the filter box searches (definitions, tags, field names). */
  haystack: string;
  detail: () => ReactNode;
}

const aliasCount = (s: SourcetypeKnowledge) => s.aliases.reduce((n, a) => n + a.pairs.length, 0);
const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="kb-section">
      <Text variant="body-xs-semibold" color="subtle">
        {count === undefined ? title : `${title} (${count})`}
      </Text>
      {children}
    </section>
  );
}

/** Name/definition rows; the definition is monospace and wraps. */
function DefTable({ rows }: { rows: { name: ReactNode; def: ReactNode; key: string }[] }) {
  return (
    <table className="kb-table">
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <th scope="row">{r.name}</th>
            <td>{r.def}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function transformDef(t: Transform | undefined): string {
  if (!t) return 'not in the loaded transforms';
  if (t.regex) return `${t.sourceKey && t.sourceKey !== '_raw' ? `[${t.sourceKey}] ` : ''}${t.regex}${t.format ? `   FORMAT ${t.format}` : ''}`;
  if (t.delims) return `DELIMS ${t.delims.map((d) => JSON.stringify(d)).join(' ')}${t.fields?.length ? `   FIELDS ${t.fields.join(', ')}` : ''}`;
  if (t.filename) return `lookup file ${t.filename}${t.matchType ? `   ${t.matchType}` : ''}`;
  if (t.collection) return `KV store collection ${t.collection}`;
  return '';
}

function extractionRows(s: SourcetypeKnowledge, k: Knowledge) {
  return [
    ...s.extracts.map((e) => ({ key: `e-${e.name}`, name: `EXTRACT-${e.name}`, def: `${e.regex}${e.inField ? `   in ${e.inField}` : ''}` })),
    ...s.reports.flatMap((r) => r.transforms.map((tn) => ({ key: `r-${r.name}-${tn}`, name: `REPORT-${r.name} → ${tn}`, def: transformDef(k.transforms[tn]) }))),
  ];
}

const aliasRows = (s: SourcetypeKnowledge) =>
  s.aliases.flatMap((a) => a.pairs.map((p) => ({ key: `${a.name}-${p.from}-${p.to}`, name: p.to, def: `${p.asNew ? 'ASNEW ' : ''}← ${p.from}` })));
const evalRows = (s: SourcetypeKnowledge) => s.evals.map((e, i) => ({ key: `${e.field}-${i}`, name: e.field, def: e.expr }));
const lookupRows = (s: SourcetypeKnowledge, k: Knowledge) =>
  s.lookups.map((l) => ({ key: l.name, name: `LOOKUP-${l.name}`, def: `${l.spec}${k.transforms[l.spec.trim().split(/\s+/)[0]] ? `\n${transformDef(k.transforms[l.spec.trim().split(/\s+/)[0]])}` : ''}` }));

function SourcetypeDetail({ s, k, only }: { s: SourcetypeKnowledge; k: Knowledge; only?: Category }) {
  const show = (c: Category) => !only || only === c;
  const ex = extractionRows(s, k);
  const al = aliasRows(s);
  const ev = evalRows(s);
  const lk = lookupRows(s, k);
  return (
    <>
      {show('extractions') && ex.length > 0 && (
        <Section title="Field extractions" count={ex.length}>
          <DefTable rows={ex} />
        </Section>
      )}
      {show('aliases') && al.length > 0 && (
        <Section title="Field aliases" count={al.length}>
          <DefTable rows={al} />
        </Section>
      )}
      {show('evals') && ev.length > 0 && (
        <Section title="Calculated fields" count={ev.length}>
          <DefTable rows={ev} />
        </Section>
      )}
      {show('lookups') && lk.length > 0 && (
        <Section title="Automatic lookups" count={lk.length}>
          <DefTable rows={lk} />
        </Section>
      )}
      {!only && s.kvMode && (
        <Section title="KV_MODE">
          <code>{s.kvMode}</code>
        </Section>
      )}
    </>
  );
}

function buildItems(k: Knowledge, category: Category): Item[] {
  const sts = Object.values(k.props).sort((a, b) => a.sourcetype.localeCompare(b.sourcetype));
  // The per-sourcetype categories list only the sourcetypes that define that kind of object.
  const perSourcetype = (count: (s: SourcetypeKnowledge) => number, word: [string, string?], rows: (s: SourcetypeKnowledge) => { name: ReactNode; def: ReactNode }[]): Item[] =>
    sts
      .filter((s) => count(s) > 0)
      .map((s) => ({
        id: s.sourcetype,
        title: s.sourcetype,
        hint: plural(count(s), ...word),
        haystack: rows(s).map((r) => `${String(r.name)} ${String(r.def)}`).join(' '),
        detail: () => <SourcetypeDetail s={s} k={k} only={category} />,
      }));
  switch (category) {
    case 'sourcetypes':
      return sts.map((s) => ({
        id: s.sourcetype,
        title: s.sourcetype,
        hint: [plural(s.extracts.length + s.reports.length, 'extraction'), plural(aliasCount(s), 'alias', 'aliases'), plural(s.evals.length, 'eval'), plural(s.lookups.length, 'lookup')]
          .filter((part) => !part.startsWith('0 '))
          .join(' · '),
        haystack: '',
        detail: () => <SourcetypeDetail s={s} k={k} />,
      }));
    case 'extractions':
      return perSourcetype((s) => s.extracts.length + s.reports.length, ['extraction'], (s) => extractionRows(s, k));
    case 'aliases':
      return perSourcetype(aliasCount, ['alias', 'aliases'], aliasRows);
    case 'evals':
      return perSourcetype((s) => s.evals.length, ['calculated field'], evalRows);
    case 'lookups':
      return perSourcetype((s) => s.lookups.length, ['lookup'], (s) => lookupRows(s, k));
    case 'eventtypes':
      return [...k.eventtypes]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((e) => ({
          id: e.name,
          title: e.name,
          hint: e.tags.length ? `tags: ${e.tags.join(', ')}` : undefined,
          haystack: `${e.search} ${e.tags.join(' ')}`,
          detail: () => (
            <>
              <Section title="Search">{e.search ? <pre className="kb-code">{e.search}</pre> : <Text variant="body-xs-normal" color="subtle">No search defined (tags only).</Text>}</Section>
              <Section title="Tags" count={e.tags.length}>
                <div className="summary">{e.tags.length ? e.tags.map((t) => <Tag key={t} size="sm" color="default">{t}</Tag>) : <Text variant="body-xs-normal" color="subtle">None</Text>}</div>
              </Section>
            </>
          ),
        }));
    case 'models':
      return Object.values(k.models)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((m) => ({
          id: m.name,
          title: m.name,
          hint: plural(m.objects.length, 'dataset'),
          haystack: m.objects.map((o) => `${o.name} ${o.fields.map((f) => f.name).join(' ')}`).join(' '),
          detail: () => (
            <>
              {m.objects.map((o) => (
                <details key={o.name} className="kb-object" open={m.objects.length === 1}>
                  <summary>
                    <code>{`${m.name}.${o.name}`}</code>
                    <Text variant="body-xs-normal" color="subtle">{` ${o.parent ? `child of ${o.parent} · ` : ''}${plural(o.fields.length, 'field')}${o.calculations.length ? ` · ${plural(o.calculations.length, 'calculation')}` : ''}`}</Text>
                  </summary>
                  {o.constraints.length > 0 && (
                    <Section title="Constraints">
                      <pre className="kb-code">{o.constraints.join('\n')}</pre>
                    </Section>
                  )}
                  {o.fields.length > 0 && (
                    <Section title="Fields" count={o.fields.length}>
                      <div className="summary">
                        {o.fields.map((f) => (
                          <Tag key={f.name} size="sm" color="default">{f.type ? `${f.name}: ${f.type}` : f.name}</Tag>
                        ))}
                      </div>
                    </Section>
                  )}
                  {o.calculations.length > 0 && (
                    <Section title="Calculated fields" count={o.calculations.length}>
                      <DefTable rows={o.calculations.map((c, i) => ({ key: String(i), name: c.outputFields.join(', '), def: `${c.type}: ${c.expression ?? c.lookupName ?? ''}${c.inputField ? `   in ${c.inputField}` : ''}` }))} />
                    </Section>
                  )}
                </details>
              ))}
            </>
          ),
        }));
    case 'macros':
      return Object.entries(k.macros ?? {})
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, def]) => ({
          id: name,
          title: name,
          haystack: def,
          detail: () => (
            <Section title="Definition">
              <pre className="kb-code">{def || '(empty)'}</pre>
            </Section>
          ),
        }));
  }
}

const LABELS: Record<Category, string> = {
  sourcetypes: 'Sourcetypes',
  extractions: 'Extractions',
  aliases: 'Aliases',
  evals: 'Calculated fields',
  lookups: 'Lookups',
  eventtypes: 'Eventtypes',
  models: 'Data models',
  macros: 'Macros',
};

interface Props {
  knowledge: Knowledge;
  summary: Record<string, number>;
  /** Sourcetypes used by the current SPL; they are listed first and marked. */
  inQuery: string[];
}

/** Category chips → filterable list → full definition of the selected object. */
export function KnowledgeBrowser({ knowledge, summary, inQuery }: Props) {
  const [category, setCategory] = useState<Category>('sourcetypes');
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<Partial<Record<Category, string>>>({});

  const counts: Record<Category, number> = {
    sourcetypes: summary.sourcetypes,
    extractions: summary.extractions,
    aliases: summary.aliases,
    evals: summary.evals,
    lookups: summary.lookups,
    eventtypes: summary.eventtypes,
    models: summary.models,
    macros: summary.macros,
  };
  const categories = (Object.keys(LABELS) as Category[]).map((key) => ({ key, text: `${LABELS[key]} (${counts[key] ?? 0})` }));

  const items = useMemo(() => {
    const all = buildItems(knowledge, category);
    const used = new Set(inQuery);
    // Sourcetypes of the current query float to the top of sourcetype-based lists.
    return category === 'eventtypes' || category === 'models' || category === 'macros' ? all : [...all.filter((i) => used.has(i.id)), ...all.filter((i) => !used.has(i.id))];
  }, [knowledge, category, inQuery]);
  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? items.filter((i) => i.title.toLowerCase().includes(q) || i.hint?.toLowerCase().includes(q) || i.haystack.toLowerCase().includes(q)) : items;
  }, [items, filter]);
  const current = visible.find((i) => i.id === selected[category]) ?? visible[0];

  return (
    <div className="kb">
      <ToggleButtonGroup
        aria-label="Knowledge object type"
        selectedKeys={[category]}
        disallowEmptySelection
        onSelectionChange={(keys) => {
          const key = [...keys][0];
          if (!key) return;
          setCategory(key as Category);
          setFilter('');
        }}
        items={categories}
      />
      <div className="kb-body">
        <div className="kb-master">
          <TextField aria-label={`Filter ${LABELS[category].toLowerCase()}`} size="sm" value={filter} onChange={setFilter} placeholder={`Filter ${LABELS[category].toLowerCase()} by name or definition`} />
          <Text variant="body-xs-normal" color="subtle">
            {filter.trim() ? `${visible.length} of ${items.length}` : `${items.length}`} {category === 'sourcetypes' || category === 'eventtypes' || category === 'models' || category === 'macros' ? LABELS[category].toLowerCase() : `sourcetypes with ${LABELS[category].toLowerCase()}`}
          </Text>
          <ul className="kb-list" role="listbox" aria-label={LABELS[category]}>
            {visible.map((i) => (
              <li key={i.id} role="option" aria-selected={i.id === current?.id}>
                <button type="button" className={`kb-item${i.id === current?.id ? ' is-selected' : ''}`} onClick={() => setSelected((s) => ({ ...s, [category]: i.id }))}>
                  <span className="kb-item-title">
                    <code>{i.title}</code>
                    {inQuery.includes(i.id) && category !== 'eventtypes' && category !== 'models' && category !== 'macros' && (
                      <Tag size="sm" color="success">in query</Tag>
                    )}
                  </span>
                  {i.hint && <span className="kb-item-hint">{i.hint}</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="kb-detail">
          {current ? (
            <>
              <div className="kb-detail-head">
                <Text variant="body-md-semibold">
                  <code>{current.title}</code>
                </Text>
                {current.hint && <Text variant="body-xs-normal" color="subtle">{current.hint}</Text>}
              </div>
              {current.detail()}
            </>
          ) : (
            <EmptyState title="Nothing matches" description={filter.trim() ? 'No object matches the filter.' : `The loaded knowledge has no ${LABELS[category].toLowerCase()}.`} size="md" />
          )}
        </div>
      </div>
    </div>
  );
}
