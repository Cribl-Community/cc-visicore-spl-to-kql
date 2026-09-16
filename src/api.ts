/**
 * Cribl REST API layer for the SPL → KQL app.
 *
 * All calls go through the platform fetch proxy, which injects the signed-in
 * user's auth. Search endpoints always use the `default_search` group.
 */

const SEARCH_GROUP = 'default_search';
const api = () => window.CRIBL_API_URL;

/** True when running inside Cribl (or the Cribl dev preview) with the API available. */
export function inCribl(): boolean {
  return typeof window !== 'undefined' && typeof window.CRIBL_API_URL === 'string' && window.CRIBL_API_URL.length > 0;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request(method: string, path: string, opts: { body?: unknown; ok404?: boolean } = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const resp = await fetch(api() + path, { method, headers, body });
  if (!resp.ok && !(opts.ok404 && resp.status === 404)) {
    const text = await resp.text();
    let message = text.slice(0, 500);
    try {
      const j = JSON.parse(text) as { message?: string; error?: string };
      message = j.message ?? j.error ?? message;
    } catch {
      /* not json */
    }
    throw new ApiError(resp.status, message || `${method} ${path} failed with HTTP ${resp.status}`);
  }
  return resp;
}

const getJson = async <T>(path: string): Promise<T> => (await request('GET', path)).json() as Promise<T>;

interface Items<T> {
  items?: T[];
}

/* ------------------------------------------------------------------ */
/* Environment discovery                                               */
/* ------------------------------------------------------------------ */

export interface Dataset {
  id: string;
  type?: string;
  provider?: string;
  description?: string;
}

export async function listDatasets(): Promise<Dataset[]> {
  const data = await getJson<Items<Dataset>>(`/m/${SEARCH_GROUP}/search/datasets`);
  return (data.items ?? []).map((d) => ({ id: d.id, type: d.type, provider: d.provider, description: d.description }));
}

export interface Lookup {
  id: string;
  size?: number;
  rows?: number;
}

export async function listLookups(): Promise<Lookup[]> {
  const data = await getJson<Items<Lookup>>(`/m/${SEARCH_GROUP}/system/lookups`);
  return data.items ?? [];
}

export interface Macro {
  id: string;
  replacement: string;
}

export async function listMacros(): Promise<Macro[]> {
  const data = await getJson<Items<Macro>>(`/m/${SEARCH_GROUP}/search/macros`);
  return data.items ?? [];
}

export interface KustoDoc {
  kind: 'operator' | 'function' | 'datatype';
  name: string;
  shortDescription: string;
  longDescription: string;
  metadata?: { slug?: string; title?: string };
}

export interface KustoDocs {
  catalog: { label: string; items: { kind: string; name: string }[] }[];
  docs: KustoDoc[];
}

/** The KQL documentation bundle that powers autocomplete in the Cribl Search editor. */
export async function getDocs(): Promise<KustoDocs> {
  return getJson<KustoDocs>(`/m/${SEARCH_GROUP}/search/docs`);
}

/* ------------------------------------------------------------------ */
/* Syntax check (preview endpoint)                                      */
/* ------------------------------------------------------------------ */

export interface SyntaxCheck {
  ok: boolean;
  /** Parser message when not ok. */
  message?: string;
  /**
   * True when the parser could not evaluate the query in preview mode
   * (subqueries, window functions); the syntax was otherwise accepted.
   */
  limited?: boolean;
  /** Sample output events on success. */
  events?: Record<string, unknown>[];
}

/** Sample events fed to the preview endpoint so the parser has something to bind to. */
export const SAMPLE_EVENTS: Record<string, unknown>[] = [
  { _time: 1700000000, _raw: '203.0.113.7 - alice [GET /api/v1/orders] 200 512 0.12', host: 'web1', source: 'access.log', sourcetype: 'access_combined', clientip: '203.0.113.7', method: 'GET', uri: '/api/v1/orders', status: 200, bytes: 512, response_time: 0.12, user: 'alice' },
  { _time: 1700000060, _raw: '198.51.100.9 - bob [POST /login] 503 128 2.31 error: upstream timeout', host: 'web2', source: 'access.log', sourcetype: 'access_combined', clientip: '198.51.100.9', method: 'POST', uri: '/login', status: 503, bytes: 128, response_time: 2.31, user: 'bob' },
  { _time: 1700000120, _raw: '10.1.2.3 - - [GET /static/app.js] 404 0 0.01', host: 'web1', source: 'access.log', sourcetype: 'access_combined', clientip: '10.1.2.3', method: 'GET', uri: '/static/app.js', status: 404, bytes: 0, response_time: 0.01 },
];

const LIMITED_PATTERNS = [/nested- or sub-queries not supported/i];

/**
 * Ask Cribl's parser to accept the query. Uses the search preview endpoint,
 * which parses and plans the query against sample events without running a
 * search job (no credits, no data access). Note: the preview does not apply
 * filters or dataset scope; it is a syntax and function check only.
 */
export async function checkSyntax(query: string, events: Record<string, unknown>[] = SAMPLE_EVENTS): Promise<SyntaxCheck> {
  const resp = await fetch(api() + `/m/${SEARCH_GROUP}/search/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ events, query }),
  });
  if (resp.ok) {
    const data = (await resp.json()) as { events?: Record<string, unknown>[] };
    return { ok: true, events: data.events ?? [] };
  }
  const text = await resp.text();
  let message = text.slice(0, 600);
  try {
    const j = JSON.parse(text) as { message?: string };
    if (j.message) message = j.message;
  } catch {
    /* not json */
  }
  if (LIMITED_PATTERNS.some((p) => p.test(message))) return { ok: true, limited: true, message };
  return { ok: false, message };
}

/* ------------------------------------------------------------------ */
/* Search jobs                                                          */
/* ------------------------------------------------------------------ */

export interface SearchJob {
  id: string;
  status: string;
  query?: string;
  earliest?: string;
  latest?: string;
  timeCreated?: number;
  timeStarted?: number;
  timeCompleted?: number;
}

export async function createJob(query: string, earliest: string, latest: string): Promise<SearchJob> {
  const resp = await request('POST', `/m/${SEARCH_GROUP}/search/jobs`, { body: { query, earliest, latest } });
  const data = (await resp.json()) as Items<SearchJob>;
  const job = data.items?.[0];
  if (!job) throw new ApiError(500, 'Search job was not created.');
  return job;
}

export async function getJob(id: string): Promise<SearchJob> {
  const data = await getJson<Items<SearchJob>>(`/m/${SEARCH_GROUP}/search/jobs/${encodeURIComponent(id)}`);
  const job = data.items?.[0];
  if (!job) throw new ApiError(404, `Search job ${id} not found.`);
  return job;
}

export async function cancelJob(id: string): Promise<void> {
  await request('POST', `/m/${SEARCH_GROUP}/search/jobs/${encodeURIComponent(id)}/cancel`);
}

export interface JobResults {
  meta: { totalEventCount?: number; persistedEventCount?: number; isFinished?: boolean; warnings?: string[] };
  rows: Record<string, unknown>[];
}

/** Results are NDJSON: the first line is job metadata, the rest are events. */
export async function getResults(id: string, limit = 100): Promise<JobResults> {
  const resp = await request('GET', `/m/${SEARCH_GROUP}/search/jobs/${encodeURIComponent(id)}/results?limit=${limit}`);
  const text = await resp.text();
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
  if (!lines.length) return { meta: {}, rows: [] };
  const [meta, ...rows] = lines;
  return { meta: meta as JobResults['meta'], rows };
}

/** Job log lines (used to surface the failure reason for a failed job). */
export async function getJobErrors(id: string): Promise<string[]> {
  try {
    const resp = await request('GET', `/m/${SEARCH_GROUP}/search/jobs/${encodeURIComponent(id)}/logs`);
    const text = await resp.text();
    return text
      .split('\n')
      .filter((l) => /error|fail/i.test(l))
      .slice(0, 5);
  } catch {
    return [];
  }
}

/** Run a query end to end: create the job, poll until it finishes, fetch results. */
export async function runQuery(
  query: string,
  earliest: string,
  latest: string,
  opts: { limit?: number; signal?: AbortSignal; onStatus?: (job: SearchJob) => void } = {},
): Promise<{ job: SearchJob; results: JobResults }> {
  const job = await createJob(query, earliest, latest);
  let current = job;
  const started = Date.now();
  while (!['completed', 'failed', 'canceled', 'cancelled'].includes(current.status)) {
    if (opts.signal?.aborted) {
      await cancelJob(job.id).catch(() => undefined);
      throw new ApiError(499, 'Search canceled.');
    }
    if (Date.now() - started > 5 * 60_000) {
      await cancelJob(job.id).catch(() => undefined);
      throw new ApiError(504, 'Search did not finish within 5 minutes and was canceled.');
    }
    await new Promise((r) => setTimeout(r, 750));
    current = await getJob(job.id);
    opts.onStatus?.(current);
  }
  if (current.status !== 'completed') {
    const errs = await getJobErrors(job.id);
    throw new ApiError(500, `Search ${current.status}${errs.length ? ': ' + errs.join(' | ') : ''}`);
  }
  const results = await getResults(job.id, opts.limit ?? 100);
  return { job: current, results };
}

/* ------------------------------------------------------------------ */
/* Saved searches                                                       */
/* ------------------------------------------------------------------ */

export interface SavedSearchInput {
  id: string;
  name: string;
  query: string;
  earliest?: string;
  latest?: string;
}

export async function saveSearch(input: SavedSearchInput): Promise<void> {
  await request('POST', `/m/${SEARCH_GROUP}/search/saved`, { body: input });
}

export async function savedSearchExists(id: string): Promise<boolean> {
  const resp = await request('GET', `/m/${SEARCH_GROUP}/search/saved/${encodeURIComponent(id)}`, { ok404: true });
  if (resp.status === 404) return false;
  const data = (await resp.json()) as Items<unknown>;
  return (data.items ?? []).length > 0;
}

/* ------------------------------------------------------------------ */
/* App KV store: per-user conversion history                            */
/* ------------------------------------------------------------------ */

export interface HistoryEntry {
  id: string;
  ts: number;
  spl: string;
  kql: string;
  warnings: number;
  errors: number;
}

const HISTORY_LIMIT = 50;

async function kvLoad<T>(key: string): Promise<T | null> {
  const resp = await request('GET', `/kvstore/${key}`, { ok404: true });
  if (resp.status === 404) return null;
  const text = await resp.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

async function kvSave(key: string, value: unknown): Promise<void> {
  await request('PUT', `/kvstore/${key}`, { body: value });
}

const historyKey = (userId: string) => `users/${encodeURIComponent(userId)}/history`;

export async function loadHistory(userId: string): Promise<HistoryEntry[]> {
  const data = await kvLoad<HistoryEntry[]>(historyKey(userId));
  return Array.isArray(data) ? data : [];
}

export async function saveHistory(userId: string, entries: HistoryEntry[]): Promise<void> {
  await kvSave(historyKey(userId), entries.slice(0, HISTORY_LIMIT));
}

export interface UserPrefs {
  defaultDataset?: string;
  /** Splunk index → Cribl dataset overrides. */
  indexMap?: Record<string, string>;
  filtersAsWhere?: boolean;
  earliest?: string;
  latest?: string;
}

const prefsKey = (userId: string) => `users/${encodeURIComponent(userId)}/prefs`;

export async function loadPrefs(userId: string): Promise<UserPrefs> {
  return (await kvLoad<UserPrefs>(prefsKey(userId))) ?? {};
}

export async function savePrefs(userId: string, prefs: UserPrefs): Promise<void> {
  await kvSave(prefsKey(userId), prefs);
}

/** Current user id, or "anonymous" when running outside Cribl. */
export async function currentUserId(): Promise<string> {
  if (typeof window.getCriblUser !== 'function') return 'anonymous';
  try {
    const u = await window.getCriblUser();
    return u.id || u.username || 'anonymous';
  } catch {
    return 'anonymous';
  }
}
