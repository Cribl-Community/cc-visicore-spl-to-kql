import { useMemo, useRef, useState } from 'react';
import { Alert, Button, Checkbox, EmptyState, Tag, Text } from '@capra/core';
import { readArchive } from '../knowledge/archive';
import { dataModelFromJson, knowledgeFromFiles } from '../knowledge/conf';
import { emptyKnowledge, knowledgeSummary, mergeKnowledge, type Knowledge } from '../knowledge/types';

interface Props {
  knowledge: Knowledge | null;
  onChange: (k: Knowledge | null) => void;
  applyShim: boolean;
  onApplyShimChange: (v: boolean) => void;
  /** Sourcetypes referenced by the current SPL, to show which ones are covered. */
  sourcetypes: string[];
  persistError: string | null;
}

function isBundle(obj: unknown): obj is Knowledge {
  return !!obj && typeof obj === 'object' && 'props' in (obj as Knowledge) && 'transforms' in (obj as Knowledge);
}

/** Load one user-supplied file into a Knowledge object. */
async function loadFile(file: File): Promise<Knowledge> {
  const name = file.name;
  const lower = name.toLowerCase();
  if (/\.(tgz|spl|tar\.gz|tar)$/.test(lower)) {
    const files = await readArchive(file);
    if (!files.length) throw new Error(`${name}: no props/transforms/eventtypes/tags/macros or data model files found in the archive.`);
    return knowledgeFromFiles(files, name.replace(/\.(tgz|spl|tar\.gz|tar)$/, ''));
  }
  const text = await file.text();
  if (lower.endsWith('.json')) {
    const parsed = JSON.parse(text) as unknown;
    if (isBundle(parsed)) return { ...emptyKnowledge(), ...parsed, sources: parsed.sources?.length ? parsed.sources : [name] };
    if (parsed && typeof parsed === 'object' && 'objects' in (parsed as object)) {
      const k = emptyKnowledge();
      const dm = dataModelFromJson(text, name.replace(/\.json$/i, ''));
      k.models[dm.name] = dm;
      k.sources = [name];
      return k;
    }
    throw new Error(`${name}: not a knowledge bundle or a data model definition.`);
  }
  if (lower.endsWith('.conf')) return knowledgeFromFiles([{ path: `/default/${name}`, text }], name);
  throw new Error(`${name}: unsupported file type. Upload .tgz/.spl app packages, .conf files, data model .json files, or a knowledge.json bundle.`);
}

export function KnowledgePanel({ knowledge, onChange, applyShim, onApplyShimChange, sourcetypes, persistError }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const summary = useMemo(() => (knowledge ? knowledgeSummary(knowledge) : null), [knowledge]);

  const onFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true);
    setError(null);
    let merged = knowledge ?? emptyKnowledge();
    const errors: string[] = [];
    for (const f of Array.from(list)) {
      try {
        merged = mergeKnowledge(merged, await loadFile(f));
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
    if (errors.length) setError(errors.join(' · '));
    if (merged.sources.length) onChange(merged);
    setBusy(false);
    if (inputRef.current) inputRef.current.value = '';
  };

  const covered = sourcetypes.filter((s) => knowledge?.props[s]);
  const uncovered = sourcetypes.filter((s) => !knowledge?.props[s]);

  return (
    <div className="knowledge">
      <div className="knowledge-toolbar">
        <div>
          <Text variant="body-sm-normal">
            Load Splunk knowledge objects so the translation reproduces search-time fields in Cribl: field extractions (props/transforms), CIM aliases and calculated fields, lookups, eventtypes, tags and data models.
          </Text>
          <Text as="p" variant="body-xs-normal" color="subtle">
            Accepts app/TA packages (.tgz, .spl), individual .conf files, data model .json files, or a knowledge.json bundle built with <code>npm run knowledge</code> from Splunk's etc/system and etc/apps folders.
          </Text>
        </div>
        <div className="panel-actions">
          <input ref={inputRef} type="file" multiple accept=".tgz,.spl,.tar,.gz,.conf,.json" aria-label="Splunk knowledge files" className="visually-hidden-input" onChange={(e) => void onFiles(e.target.files)} />
          <Button size="sm" variant="primary" pending={busy} onClick={() => inputRef.current?.click()}>
            Load files
          </Button>
          {knowledge && (
            <Button size="sm" variant="tertiary" appearance="danger" onClick={() => onChange(null)}>
              Remove all
            </Button>
          )}
        </div>
      </div>
      {error && <Alert appearance="danger" title="Some files could not be loaded">{error}</Alert>}
      {persistError && (
        <Alert appearance="warning" title="Knowledge is loaded for this session only">
          {persistError}
        </Alert>
      )}
      <Checkbox checked={applyShim} onChange={(e) => onApplyShimChange(e.target.checked)}>
        Apply Splunk search-time field stages to translations
      </Checkbox>
      {!knowledge || !summary ? (
        <EmptyState title="No Splunk knowledge loaded" description="Without it, field names pass through unchanged and data models cannot be translated." size="md" />
      ) : (
        <>
          <div className="summary">
            <Tag color="success">{`${summary.sourcetypes} sourcetypes`}</Tag>
            <Tag color="default">{`${summary.extractions} extractions`}</Tag>
            <Tag color="default">{`${summary.aliases} aliases`}</Tag>
            <Tag color="default">{`${summary.evals} calculated fields`}</Tag>
            <Tag color="default">{`${summary.lookups} lookups`}</Tag>
            <Tag color="default">{`${summary.eventtypes} eventtypes`}</Tag>
            <Tag color="info">{`${summary.models} data models`}</Tag>
            <Tag color="default">{`${summary.macros} macros`}</Tag>
          </div>
          <Text variant="body-xs-normal" color="subtle">{`Sources: ${knowledge.sources.join(', ')}`}</Text>
          {sourcetypes.length > 0 && (
            <div className="summary">
              <Text variant="body-sm-semibold">Current query:</Text>
              {covered.map((s) => (
                <Tag key={s} color="success" size="sm">{`${s} ✓`}</Tag>
              ))}
              {uncovered.map((s) => (
                <Tag key={s} color="warning" size="sm">{`${s}: no knowledge`}</Tag>
              ))}
            </div>
          )}
          <div className="knowledge-grid">
            <div>
              <Text variant="body-sm-semibold">Sourcetypes with search-time fields</Text>
              <ul className="knowledge-list">
                {Object.values(knowledge.props)
                  .sort((a, b) => a.sourcetype.localeCompare(b.sourcetype))
                  .map((s) => (
                    <li key={s.sourcetype}>
                      <code>{s.sourcetype}</code>
                      <Text variant="body-xs-normal" color="subtle">
                        {` ${s.extracts.length + s.reports.length} extractions · ${s.aliases.reduce((n, a) => n + a.pairs.length, 0)} aliases · ${s.evals.length} evals · ${s.lookups.length} lookups`}
                      </Text>
                    </li>
                  ))}
              </ul>
            </div>
            <div>
              <Text variant="body-sm-semibold">Data models</Text>
              <ul className="knowledge-list">
                {Object.values(knowledge.models)
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((m) => (
                    <li key={m.name}>
                      <code>{m.name}</code>
                      <Text variant="body-xs-normal" color="subtle">{` ${m.objects.map((o) => o.name).join(', ')}`}</Text>
                    </li>
                  ))}
              </ul>
              <Text variant="body-sm-semibold">Eventtypes and tags</Text>
              <ul className="knowledge-list">
                {knowledge.eventtypes
                  .filter((e) => e.search)
                  .slice(0, 100)
                  .map((e) => (
                    <li key={e.name}>
                      <code>{e.name}</code>
                      <Text variant="body-xs-normal" color="subtle">{` ${e.tags.length ? 'tags: ' + e.tags.join(', ') + ' · ' : ''}${e.search}`}</Text>
                    </li>
                  ))}
              </ul>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
