import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Checkbox, IconButton, Menu, Modal, NumberField, SelectField, Tag, Text, TextArea, TextField, ToggleButtonGroup } from '@capra/core';
import { BookOutlined, CheckOutlined, CopyOutlined, HistoryOutlined, Play, ReloadOutlined, Bookmark } from '@capra/icons';
import {
  checkSyntax,
  currentUserId,
  getDocs,
  inCribl,
  listDatasets,
  listLookups,
  listMacros,
  loadHistory,
  loadPrefs,
  runQuery,
  saveHistory,
  savePrefs,
  saveSearch,
  savedSearchExists,
  type Dataset,
  type HistoryEntry,
  type JobResults,
  type KustoDocs,
  type SearchJob,
  type SyntaxCheck,
  type UserPrefs,
} from './api';
import { stripKqlComments, translate, type TranslationResult } from './translator';
import { EXAMPLES } from './examples';
import { NotesPanel } from './components/NotesPanel';
import { StagesPanel } from './components/StagesPanel';
import { ResultsPanel } from './components/ResultsPanel';
import { ReferencePanel } from './components/ReferencePanel';
import { HistoryPanel } from './components/HistoryPanel';

type Tab = 'notes' | 'stages' | 'results' | 'reference' | 'history';

interface EnvState {
  loading: boolean;
  error: string | null;
  datasets: Dataset[];
  lookups: string[];
  macros: string[];
  docs: KustoDocs | null;
  docsError: string | null;
}

const EMPTY_ENV: EnvState = { loading: false, error: null, datasets: [], lookups: [], macros: [], docs: null, docsError: null };
const DEFAULT_SPL = EXAMPLES[0].spl;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'spl_to_kql';

function App() {
  const live = inCribl();
  const [spl, setSpl] = useState(DEFAULT_SPL);
  const debouncedSpl = useDebounced(spl, 200);
  const [prefs, setPrefs] = useState<UserPrefs>({});
  const [userId, setUserId] = useState<string>('anonymous');
  const [env, setEnv] = useState<EnvState>(EMPTY_ENV);
  const [tab, setTab] = useState<Tab>('notes');
  const [copied, setCopied] = useState(false);
  // `kql` records which query the check belongs to, so a changed query shows as unchecked without an effect.
  const [syntaxState, setSyntax] = useState<{ kql: string; state: 'idle' | 'checking' | 'done'; result?: SyntaxCheck; error?: string }>({ kql: '', state: 'idle' });
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  // Run modal
  const [runOpen, setRunOpen] = useState(false);
  const [runEarliest, setRunEarliest] = useState('-1h');
  const [runLatest, setRunLatest] = useState('now');
  const [runLimit, setRunLimit] = useState(100);
  const [running, setRunning] = useState(false);
  const [job, setJob] = useState<SearchJob | null>(null);
  const [results, setResults] = useState<JobResults | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Save modal
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveId, setSaveId] = useState('');
  const [saveMsg, setSaveMsg] = useState<{ kind: 'success' | 'danger'; text: string } | null>(null);

  /* ---------------- environment discovery ---------------- */
  const loadEnv = useCallback(async () => {
    if (!live) return;
    setEnv((e) => ({ ...e, loading: true, error: null }));
    const [ds, lk, mc, docs] = await Promise.allSettled([listDatasets(), listLookups(), listMacros(), getDocs()]);
    const errs: string[] = [];
    const pick = <T,>(r: PromiseSettledResult<T>, label: string, fallback: T): T => {
      if (r.status === 'fulfilled') return r.value;
      errs.push(`${label}: ${(r.reason as Error).message}`);
      return fallback;
    };
    setEnv({
      loading: false,
      error: errs.length ? errs.join(' · ') : null,
      datasets: pick(ds, 'datasets', [] as Dataset[]),
      lookups: pick(lk, 'lookups', [] as { id: string }[]).map((l) => l.id),
      macros: pick(mc, 'macros', [] as { id: string }[]).map((m) => m.id),
      docs: docs.status === 'fulfilled' ? docs.value : null,
      docsError: docs.status === 'rejected' ? (docs.reason as Error).message : null,
    });
  }, [live]);

  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    (async () => {
      const id = await currentUserId();
      if (cancelled) return;
      setUserId(id);
      const [p, h] = await Promise.all([loadPrefs(id).catch(() => ({}) as UserPrefs), loadHistory(id).catch(() => [] as HistoryEntry[])]);
      if (cancelled) return;
      setPrefs(p);
      if (p.earliest) setRunEarliest(p.earliest);
      if (p.latest) setRunLatest(p.latest);
      setHistory(h);
    })();
    // Deferred so the initial render is not followed by a synchronous state update.
    const t = setTimeout(() => void loadEnv(), 0);
    return () => {
      clearTimeout(t);
      cancelled = true;
    };
  }, [live, loadEnv]);

  const updatePrefs = useCallback(
    (patch: Partial<UserPrefs>) => {
      setPrefs((prev) => {
        const next = { ...prev, ...patch };
        if (live) void savePrefs(userId, next).catch(() => undefined);
        return next;
      });
    },
    [live, userId],
  );

  /* ---------------- translation ---------------- */
  const result: TranslationResult = useMemo(
    () =>
      translate(debouncedSpl, {
        defaultDataset: prefs.defaultDataset || undefined,
        filtersAsWhere: !!prefs.filtersAsWhere,
        indexMap: prefs.indexMap,
        knownDatasets: env.datasets.length ? env.datasets.map((d) => d.id) : undefined,
        knownLookups: env.lookups.length ? env.lookups : undefined,
        knownMacros: env.macros.length ? env.macros : undefined,
      }),
    [debouncedSpl, prefs.defaultDataset, prefs.filtersAsWhere, prefs.indexMap, env.datasets, env.lookups, env.macros],
  );

  const syntax = syntaxState.kql === result.kql ? syntaxState : { kql: result.kql, state: 'idle' as const };

  const counts = useMemo(() => {
    const c = { error: 0, warning: 0, info: 0 };
    for (const n of result.notes) c[n.level]++;
    return c;
  }, [result.notes]);

  const hasQuery = result.kql.trim().length > 0;
  const plainKql = stripKqlComments(result.kql);

  /* ---------------- history ---------------- */
  const remember = useCallback(() => {
    if (!live || !hasQuery) return;
    setHistory((prev) => {
      const trimmed = spl.trim();
      const without = prev.filter((e) => e.spl !== trimmed);
      const entry: HistoryEntry = { id: `${Date.now()}`, ts: Date.now(), spl: trimmed, kql: result.kql, warnings: counts.warning, errors: counts.error };
      const next = [entry, ...without].slice(0, 50);
      void saveHistory(userId, next).catch(() => undefined);
      return next;
    });
  }, [live, hasQuery, spl, result.kql, counts, userId]);

  const clearHistory = useCallback(() => {
    setHistory([]);
    if (live) void saveHistory(userId, []).catch(() => undefined);
  }, [live, userId]);

  /* ---------------- actions ---------------- */
  const doCopy = async () => {
    if (await copyText(result.kql)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
      remember();
    }
  };

  const doCheck = async () => {
    const forKql = result.kql;
    setSyntax({ kql: forKql, state: 'checking' });
    try {
      const r = await checkSyntax(plainKql);
      setSyntax({ kql: forKql, state: 'done', result: r });
      remember();
    } catch (e) {
      setSyntax({ kql: forKql, state: 'done', error: (e as Error).message });
    }
  };

  /** Prefill the time range from the SPL's earliest/latest (if any) when a dialog opens. */
  const prefillTimeRange = () => {
    if (result.timeRange.earliest) setRunEarliest(result.timeRange.earliest);
    if (result.timeRange.latest) setRunLatest(result.timeRange.latest);
  };

  const doRun = async () => {
    setRunOpen(false);
    setTab('results');
    setRunning(true);
    setRunError(null);
    setResults(null);
    setJob(null);
    updatePrefs({ earliest: runEarliest, latest: runLatest });
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const r = await runQuery(plainKql, runEarliest, runLatest, { limit: runLimit, signal: ac.signal, onStatus: setJob });
      setJob(r.job);
      setResults(r.results);
      remember();
    } catch (e) {
      setRunError((e as Error).message);
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  const openRun = () => {
    prefillTimeRange();
    setRunOpen(true);
  };

  const openSave = () => {
    prefillTimeRange();
    const base = result.datasets[0] ? `${result.datasets[0]} from SPL` : 'Translated from SPL';
    setSaveName(base);
    setSaveId(slug(base));
    setSaveMsg(null);
    setSaveOpen(true);
  };

  const doSave = async () => {
    setSaveMsg(null);
    const id = slug(saveId || saveName);
    try {
      if (await savedSearchExists(id)) {
        setSaveMsg({ kind: 'danger', text: `A saved search with id "${id}" already exists. Choose a different id; this app never overwrites existing saved searches.` });
        return;
      }
      await saveSearch({ id, name: saveName || id, query: plainKql, earliest: runEarliest, latest: runLatest });
      setSaveMsg({ kind: 'success', text: `Saved search "${saveName || id}" (id ${id}) created in Cribl Search.` });
      setSaveOpen(false);
      remember();
    } catch (e) {
      setSaveMsg({ kind: 'danger', text: (e as Error).message });
    }
  };

  const loadHistoryEntry = (e: HistoryEntry) => {
    setSpl(e.spl);
    setTab('notes');
  };

  /* ---------------- derived UI bits ---------------- */
  const mapItems = useMemo(() => [{ id: '', label: '(use the index name as-is)' }, ...env.datasets.map((d) => ({ id: d.id, label: d.type ? `${d.id}  ·  ${d.type}` : d.id }))], [env.datasets]);
  const datasetItems = useMemo(() => [{ id: '', label: '(none — require index= in SPL)' }, ...env.datasets.map((d) => ({ id: d.id, label: d.type ? `${d.id}  ·  ${d.type}` : d.id }))], [env.datasets]);

  const refChips = useMemo(() => {
    const chips: { label: string; ok: boolean | null }[] = [];
    const known = (list: string[], v: string, loose = false) => (env.loading || !list.length ? null : list.some((k) => k === v || (loose && k.replace(/\.csv$/i, '') === v)));
    for (const d of result.datasets) chips.push({ label: `dataset ${d}`, ok: d.includes('*') ? null : known(env.datasets.map((x) => x.id), d) });
    for (const l of result.lookups) chips.push({ label: `lookup ${l}`, ok: known(env.lookups, l, true) });
    for (const m of result.macros) chips.push({ label: `macro ${m}`, ok: known(env.macros, m) });
    return chips;
  }, [result.datasets, result.lookups, result.macros, env]);

  const tabItems = [
    { key: 'notes', text: `Notes${result.notes.length ? ` (${result.notes.length})` : ''}` },
    { key: 'stages', text: `Stages${result.stages.length ? ` (${result.stages.length})` : ''}` },
    { key: 'results', text: results ? `Results (${results.rows.length})` : 'Results' },
    { key: 'reference', text: 'Reference', icon: BookOutlined },
    { key: 'history', text: `History${history.length ? ` (${history.length})` : ''}`, icon: HistoryOutlined },
  ];

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <Text as="h1" variant="heading-lg">
            SPL to KQL
          </Text>
          <Text as="p" variant="body-md-normal" color="subtle">
            Translate Splunk Search Processing Language into Cribl Search KQL. Every stage is explained, approximations are flagged, and the result can be checked, run, or saved in this tenant.
          </Text>
        </div>
        <div className="header-status">
          {live ? (
            env.loading ? (
              <Tag color="info">Loading tenant…</Tag>
            ) : env.error ? (
              <Tag color="warning">Partial tenant data</Tag>
            ) : (
              <Tag color="success">{`${env.datasets.length} datasets · ${env.lookups.length} lookups · ${env.macros.length} macros`}</Tag>
            )
          ) : (
            <Tag color="default">Offline: translation only</Tag>
          )}
          {live && <IconButton aria-label="Reload tenant metadata" icon={ReloadOutlined} size="sm" variant="tertiary" onClick={() => void loadEnv()} pending={env.loading} />}
        </div>
      </header>

      {env.error && (
        <Alert appearance="warning" title="Some tenant metadata could not be loaded">
          {env.error}. Translation still works; dataset, lookup and macro validation may be incomplete.
        </Alert>
      )}

      <section className="editors">
        <div className="panel">
          <div className="panel-header">
            <Text as="h2" variant="heading-sm">
              Splunk SPL
            </Text>
            <div className="panel-actions">
              <Menu trigger={<Button size="sm" variant="tertiary">Examples</Button>}>
                {EXAMPLES.map((ex) => (
                  <Menu.Item key={ex.title} label={ex.title} onPress={() => setSpl(ex.spl)} />
                ))}
              </Menu>
              <Button size="sm" variant="tertiary" onClick={() => setSpl('')} disabled={!spl}>
                Clear
              </Button>
            </div>
          </div>
          <TextArea aria-label="Splunk SPL query" value={spl} onChange={setSpl} autoSize={{ minRows: 10, maxRows: 26 }} spellCheck={false} placeholder="index=web status>=500 | stats count by host" appearance="default" />
          {live && result.indexes.length > 0 && (
            <div className="index-map">
              <Text variant="body-sm-semibold">Splunk index → Cribl dataset</Text>
              {result.indexes.map((ix) => (
                <SelectField
                  key={ix}
                  label={`index=${ix}`}
                  layout="horizontal"
                  size="sm"
                  items={mapItems}
                  canSearch
                  searchPlaceholder="Search datasets"
                  placeholder={env.datasets.some((d) => d.id === ix) ? `${ix} (same name)` : 'Choose the dataset with this data'}
                  disabled={env.loading}
                  value={prefs.indexMap?.[ix] ?? ''}
                  onChange={(k) => {
                    const next = { ...(prefs.indexMap ?? {}) };
                    if (k) next[ix] = String(k);
                    else delete next[ix];
                    updatePrefs({ indexMap: next });
                  }}
                />
              ))}
            </div>
          )}
          <div className="options">
            <SelectField
              label="Default dataset"
              helperText="Used when the SPL has no index= clause."
              items={datasetItems}
              canSearch
              searchPlaceholder="Search datasets"
              placeholder={live ? 'Select a dataset' : 'Not available offline'}
              disabled={!live || env.loading}
              value={prefs.defaultDataset ?? ''}
              onChange={(k) => updatePrefs({ defaultDataset: k ? String(k) : '' })}
              size="sm"
            />
            <div className="option-check">
              <Checkbox checked={!!prefs.filtersAsWhere} onChange={(e) => updatePrefs({ filtersAsWhere: e.target.checked })}>
                Emit first-stage filters as a where stage
              </Checkbox>
              <Text variant="body-xs-normal" color="subtle">
                Off keeps Splunk-style filters in the initial stage, which Cribl pushes down to the dataset (fastest).
              </Text>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <Text as="h2" variant="heading-sm">
              Cribl Search KQL
            </Text>
            <div className="panel-actions">
              <Button size="sm" variant="secondary" leadingIcon={copied ? CheckOutlined : CopyOutlined} onClick={() => void doCopy()} disabled={!hasQuery}>
                {copied ? 'Copied' : 'Copy KQL'}
              </Button>
            </div>
          </div>
          <pre className={`code code-main ${counts.error ? 'code-has-errors' : ''}`}>{hasQuery ? result.kql : '// Enter SPL on the left'}</pre>
          <div className="summary">
            {counts.error > 0 && <Tag color="danger">{`${counts.error} needs attention`}</Tag>}
            {counts.warning > 0 && <Tag color="warning">{`${counts.warning} approximations`}</Tag>}
            {counts.info > 0 && <Tag color="info">{`${counts.info} notes`}</Tag>}
            {hasQuery && !result.notes.length && <Tag color="success">Clean translation</Tag>}
            {refChips.map((c) => (
              <Tag key={c.label} color={c.ok === null ? 'default' : c.ok ? 'success' : 'danger'} size="sm">
                {`${c.label}${c.ok === null ? '' : c.ok ? ' ✓' : ' not found'}`}
              </Tag>
            ))}
          </div>
          <div className="live-actions">
            <Button size="sm" variant="secondary" onClick={() => void doCheck()} disabled={!live || !hasQuery} pending={syntax.state === 'checking'}>
              Check syntax
            </Button>
            <Button size="sm" variant="primary" leadingIcon={Play} onClick={openRun} disabled={!live || !hasQuery || running}>
              Run in Cribl Search
            </Button>
            <Button size="sm" variant="secondary" leadingIcon={Bookmark} onClick={openSave} disabled={!live || !hasQuery}>
              Save as saved search
            </Button>
            {!live && (
              <Text variant="body-xs-normal" color="subtle">
                Open the app inside Cribl to check syntax, run, or save.
              </Text>
            )}
          </div>
          {syntax.state === 'done' && syntax.error && <Alert appearance="danger" title="Syntax check failed">{syntax.error}</Alert>}
          {syntax.state === 'done' && syntax.result && !syntax.result.ok && (
            <Alert appearance="danger" title="Cribl's parser rejected the query">
              {syntax.result.message}
            </Alert>
          )}
          {syntax.state === 'done' && syntax.result?.ok && syntax.result.limited && (
            <Alert appearance="warning" title="Accepted, with limits" onDismiss={() => setSyntax({ kql: '', state: 'idle' })}>
              The parser accepted the query but could not fully plan it in preview mode ({syntax.result.message}). Run it to be sure.
            </Alert>
          )}
          {syntax.state === 'done' && syntax.result?.ok && !syntax.result.limited && (
            <Alert appearance="success" title="Cribl's parser accepted the query" onDismiss={() => setSyntax({ kql: '', state: 'idle' })}>
              Operators and functions resolved against this tenant. The check parses the query only; it does not verify datasets, filters or results.
            </Alert>
          )}
          {saveMsg && (
            <Alert appearance={saveMsg.kind} title={saveMsg.kind === 'success' ? 'Saved' : 'Could not save'} onDismiss={saveMsg.kind === 'success' ? () => setSaveMsg(null) : undefined}>
              {saveMsg.text}
            </Alert>
          )}
        </div>
      </section>

      <section className="panel details">
        <ToggleButtonGroup
          aria-label="Details"
          selectedKeys={[tab]}
          disallowEmptySelection
          onSelectionChange={(keys) => {
            const k = [...keys][0];
            if (k) setTab(k as Tab);
          }}
          items={tabItems}
        />
        <div className="tab-body">
          {tab === 'notes' && <NotesPanel notes={result.notes} />}
          {tab === 'stages' && <StagesPanel stages={result.stages} notes={result.notes} />}
          {tab === 'results' && <ResultsPanel job={job} results={results} error={runError} running={running} />}
          {tab === 'reference' && <ReferencePanel live={env.docs} liveError={env.docsError} />}
          {tab === 'history' && <HistoryPanel entries={history} onLoad={loadHistoryEntry} onClear={clearHistory} available={live} />}
        </div>
      </section>

      <Modal isOpen={runOpen} onIsOpenChange={setRunOpen} title="Run in Cribl Search" confirmButtonText="Run search" onConfirm={() => void doRun()} onClose={() => setRunOpen(false)}>
        <div className="modal-body">
          <Text variant="body-sm-normal">This creates a real search job in this tenant and consumes search credits. The query runs as-is; unsupported stages are left as comments.</Text>
          <div className="modal-row">
            <TextField label="Earliest" value={runEarliest} onChange={setRunEarliest} helperText="Relative (-24h, -1d@d) or epoch" />
            <TextField label="Latest" value={runLatest} onChange={setRunLatest} />
            <NumberField label="Max rows" value={runLimit} onChange={(v) => setRunLimit(Number.isFinite(v) ? Math.max(1, Math.min(1000, v)) : 100)} min={1} max={1000} />
          </div>
          <pre className="code code-sm">{plainKql}</pre>
        </div>
      </Modal>

      <Modal isOpen={saveOpen} onIsOpenChange={setSaveOpen} title="Save as Cribl Search saved search" confirmButtonText="Create saved search" onConfirm={() => doSave()} onClose={() => setSaveOpen(false)}>
        <div className="modal-body">
          <Text variant="body-sm-normal">Creates a new saved search in Cribl Search with the translated query and the time range below. Existing saved searches are never overwritten.</Text>
          <div className="modal-row">
            <TextField
              label="Name"
              value={saveName}
              onChange={(v) => {
                setSaveName(v);
                setSaveId(slug(v));
              }}
            />
            <TextField label="Id" value={saveId} onChange={(v) => setSaveId(slug(v))} helperText="Lowercase letters, digits and underscores" />
          </div>
          <div className="modal-row">
            <TextField label="Earliest" value={runEarliest} onChange={setRunEarliest} />
            <TextField label="Latest" value={runLatest} onChange={setRunLatest} />
          </div>
          {saveMsg && saveMsg.kind === 'danger' && <Alert appearance="danger">{saveMsg.text}</Alert>}
          <pre className="code code-sm">{plainKql}</pre>
        </div>
      </Modal>
    </div>
  );
}

export default App;
