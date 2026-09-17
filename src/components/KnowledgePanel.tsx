import { useMemo, useRef, useState } from 'react';
import { Alert, Button, Checkbox, EmptyState, PasswordField, Tag, Text, TextField } from '@capra/core';
import { readArchive } from '../knowledge/archive';
import { dataModelFromJson, knowledgeFromFiles } from '../knowledge/conf';
import { emptyKnowledge, knowledgeSummary, mergeKnowledge, type Knowledge } from '../knowledge/types';
import type { KnowledgeStatus, SplunkConnection } from '../api';

interface Props {
  /** Knowledge loaded by this user in the browser. */
  knowledge: Knowledge | null;
  onChange: (k: Knowledge | null) => void;
  /** Shared bundle written by the backend endpoints (all users). */
  shared: Knowledge | null;
  sharedStatus: KnowledgeStatus | null;
  onSharedChanged: () => Promise<void>;
  applyShim: boolean;
  onApplyShimChange: (v: boolean) => void;
  /** Sourcetypes referenced by the current SPL, to show which ones are covered. */
  sourcetypes: string[];
  persistError: string | null;
  live: boolean;
  backend: {
    importUrl: (url: string, replace: boolean) => Promise<{ files: number; loaded: string[]; status: KnowledgeStatus }>;
    splunkSync: (test: boolean) => Promise<{ server?: { version?: string; serverName?: string }; counts?: { models: number; eventtypes: number }; status?: KnowledgeStatus }>;
    saveConnection: (conn: SplunkConnection, token?: string) => Promise<void>;
    clearShared: () => Promise<void>;
  };
  connection: SplunkConnection | null;
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

type Msg = { kind: 'success' | 'danger' | 'info'; text: string } | null;

export function KnowledgePanel(p: Props) {
  const { knowledge, onChange, shared, sharedStatus, applyShim, onApplyShimChange, sourcetypes, persistError, live, backend, connection } = p;
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState('https://github.com/splunk/addonfactory-splunk_sa_cim/archive/refs/heads/master.tar.gz');
  const [urlMsg, setUrlMsg] = useState<Msg>(null);
  const [baseUrl, setBaseUrl] = useState(connection?.baseUrl ?? '');
  const [token, setToken] = useState('');
  const [connMsg, setConnMsg] = useState<Msg>(null);

  const combined = useMemo(() => (shared && knowledge ? mergeKnowledge(shared, knowledge) : (shared ?? knowledge)), [shared, knowledge]);
  const summary = useMemo(() => (combined ? knowledgeSummary(combined) : null), [combined]);

  const onFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy('files');
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
    setBusy(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const doImportUrl = async () => {
    setBusy('url');
    setUrlMsg(null);
    try {
      const r = await backend.importUrl(url.trim(), false);
      await p.onSharedChanged();
      setUrlMsg({ kind: 'success', text: `Imported ${r.loaded.join(', ')} (${r.files} files). Shared bundle now has ${r.status.summary.sourcetypes} sourcetypes and ${r.status.summary.models} data models.` });
    } catch (e) {
      setUrlMsg({ kind: 'danger', text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const doSaveConnection = async () => {
    setBusy('conn');
    setConnMsg(null);
    try {
      const newToken = token.trim();
      await backend.saveConnection({ ...(connection ?? {}), baseUrl: baseUrl.trim().replace(/\/+$/, ''), enabled: true }, newToken || undefined);
      setToken('');
      const t = await backend.splunkSync(true);
      const tokenNote = newToken ? 'Token stored encrypted in the app KV store.' : 'Using the stored token.';
      setConnMsg({ kind: 'success', text: `Connected to ${t.server?.serverName ?? 'Splunk'} ${t.server?.version ?? ''}. ${tokenNote}` });
    } catch (e) {
      setConnMsg({ kind: 'danger', text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const doSync = async () => {
    setBusy('sync');
    setConnMsg(null);
    try {
      const r = await backend.splunkSync(false);
      await p.onSharedChanged();
      setConnMsg({ kind: 'success', text: `Synced from ${r.server?.serverName ?? 'Splunk'} ${r.server?.version ?? ''}: ${r.status?.summary.sourcetypes ?? 0} sourcetypes, ${r.counts?.models ?? 0} data models, ${r.counts?.eventtypes ?? 0} eventtypes.` });
    } catch (e) {
      setConnMsg({ kind: 'danger', text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const doClearShared = async () => {
    setBusy('clear');
    try {
      await backend.clearShared();
      await p.onSharedChanged();
    } finally {
      setBusy(null);
    }
  };

  const covered = sourcetypes.filter((s) => combined?.props[s]);
  const uncovered = sourcetypes.filter((s) => !combined?.props[s]);

  return (
    <div className="knowledge">
      <Text variant="body-sm-normal">
        Load Splunk knowledge objects so the translation reproduces search-time fields in Cribl: field extractions (props/transforms), CIM aliases and calculated fields, lookups, eventtypes, tags and data models.
      </Text>
      <Checkbox checked={applyShim} onChange={(e) => onApplyShimChange(e.target.checked)}>
        Apply Splunk search-time field stages to translations
      </Checkbox>

      <div className="knowledge-sources">
        <div className="knowledge-source">
          <Text variant="body-sm-semibold">Upload files (this user)</Text>
          <Text variant="body-xs-normal" color="subtle">
            App/TA packages (.tgz, .spl), .conf files, data model .json, or a knowledge.json bundle from <code>npm run knowledge</code>.
          </Text>
          <div className="panel-actions">
            <input ref={inputRef} type="file" multiple accept=".tgz,.spl,.tar,.gz,.conf,.json" aria-label="Splunk knowledge files" className="visually-hidden-input" onChange={(e) => void onFiles(e.target.files)} />
            <Button size="sm" variant="primary" pending={busy === 'files'} onClick={() => inputRef.current?.click()}>
              Load files
            </Button>
            {knowledge && (
              <Button size="sm" variant="tertiary" appearance="danger" onClick={() => onChange(null)}>
                Remove uploads
              </Button>
            )}
          </div>
          {error && <Alert appearance="danger" title="Some files could not be loaded">{error}</Alert>}
          {persistError && <Alert appearance="warning" title="Uploads are kept for this session only">{persistError}</Alert>}
        </div>

        <div className="knowledge-source">
          <Text variant="body-sm-semibold">Import from URL (shared, via backend)</Text>
          <Text variant="body-xs-normal" color="subtle">
            The backend downloads and unpacks the package, then merges it into the shared bundle every user sees. GitHub hosts are allowed; admins can authorize others under App Settings.
          </Text>
          <TextField aria-label="Package URL" value={url} onChange={setUrl} size="sm" placeholder="https://…/package.tgz" />
          <div className="panel-actions">
            <Button size="sm" variant="primary" pending={busy === 'url'} disabled={!live || !url.trim()} onClick={() => void doImportUrl()}>
              Import
            </Button>
          </div>
          {urlMsg && <Alert appearance={urlMsg.kind}>{urlMsg.text}</Alert>}
        </div>

        <div className="knowledge-source">
          <Text variant="body-sm-semibold">Connect to Splunk (shared, via backend)</Text>
          <Text variant="body-xs-normal" color="subtle">
            Pulls props, transforms, eventtypes, tags, macros and data models over the Splunk REST API, and re-syncs nightly. The host must be allowed in the app's proxy configuration.
          </Text>
          <TextField label="Splunk management URL" value={baseUrl} onChange={setBaseUrl} size="sm" placeholder="https://splunk.example.com:8089" />
          <PasswordField label="Authentication token" value={token} onChange={setToken} size="sm" helperText={connection?.baseUrl ? 'Leave blank to keep the stored token.' : 'Stored encrypted; never readable by the app.'} />
          <div className="panel-actions">
            <Button size="sm" variant="secondary" pending={busy === 'conn'} disabled={!live || !baseUrl.trim()} onClick={() => void doSaveConnection()}>
              Save and test
            </Button>
            <Button size="sm" variant="primary" pending={busy === 'sync'} disabled={!live || !connection?.baseUrl} onClick={() => void doSync()}>
              Sync now
            </Button>
            {connection?.lastSync && (
              <Text variant="body-xs-normal" color="subtle">{`Last sync ${new Date(connection.lastSync).toLocaleString()}${connection.lastServer ? ` · Splunk ${connection.lastServer}` : ''}`}</Text>
            )}
          </div>
          {connMsg && <Alert appearance={connMsg.kind}>{connMsg.text}</Alert>}
        </div>
      </div>

      {!combined || !summary ? (
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
          <div className="summary">
            <Text variant="body-xs-normal" color="subtle">{`Sources: ${combined.sources.join(', ')}`}</Text>
            {sharedStatus && <Text variant="body-xs-normal" color="subtle">{` · shared bundle updated ${new Date(sharedStatus.updatedAt).toLocaleString()} from ${sharedStatus.source}`}</Text>}
            {shared && (
              <Button size="sm" variant="tertiary" appearance="danger" pending={busy === 'clear'} onClick={() => void doClearShared()}>
                Clear shared bundle
              </Button>
            )}
          </div>
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
                {Object.values(combined.props)
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
                {Object.values(combined.models)
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
                {combined.eventtypes
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
