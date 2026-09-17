/**
 * App KV store helpers for backend endpoints. Inside the platform runtime,
 * relative fetches are scoped to this app's store.
 */

import type { KvIO } from '../../src/knowledge/kvpack.js';

/** Parse a KV value that may be JSON, a JSON string wrapped in JSON, or a plain string. */
function parseValue<T>(text: string): T | null {
  if (!text || text === '[object Object]') return null;
  try {
    let v: unknown = JSON.parse(text);
    if (typeof v === 'string') {
      try {
        v = JSON.parse(v);
      } catch {
        /* plain string */
      }
    }
    return v as T;
  } catch {
    return null;
  }
}

export async function kvGet<T>(key: string): Promise<T | null> {
  const res = await fetch(`/api/v1/kvstore/${key}`, { headers: { accept: 'application/json' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`KV read ${key} failed: HTTP ${res.status}`);
  return parseValue<T>(await res.text());
}

/**
 * Store a value as JSON text. The value is written as a text/plain body so the
 * backend runtime returns the JSON text on read (it stringifies object bodies to
 * "[object Object]" when the stored value is a JSON object).
 */
export async function kvPut(key: string, value: unknown): Promise<void> {
  const res = await fetch(`/api/v1/kvstore/${key}`, {
    method: 'PUT',
    headers: { 'content-type': 'text/plain' },
    body: JSON.stringify(value),
  });
  if (!res.ok) throw new Error(`KV write ${key} failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
}

export async function kvDelete(key: string): Promise<void> {
  const res = await fetch(`/api/v1/kvstore/${key}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) throw new Error(`KV delete ${key} failed: HTTP ${res.status}`);
}

/** Raw text adapter for the chunked knowledge helpers in src/knowledge/kvpack.ts. */
export const kvIO: KvIO = {
  async get(key) {
    const res = await fetch(`/api/v1/kvstore/${key}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`KV read ${key} failed: HTTP ${res.status}`);
    const t = await res.text();
    return t === '[object Object]' ? null : t;
  },
  async put(key, text) {
    const res = await fetch(`/api/v1/kvstore/${key}`, { method: 'PUT', headers: { 'content-type': 'text/plain' }, body: text });
    if (!res.ok) throw new Error(`KV write ${key} failed: HTTP ${res.status} ${(await res.text()).slice(0, 120)}`);
  },
  del: kvDelete,
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

export function errorResponse(e: unknown, status = 500): Response {
  const message = e instanceof Error ? e.message : String(e);
  console.error('endpoint error:', message);
  return json({ ok: false, error: message }, status);
}

/** KV keys shared by the frontend and backend. */
export const KEYS = {
  /** Shared Splunk knowledge bundle (all users). */
  sharedKnowledge: 'knowledge/shared',
  /** Status of the last import/sync. */
  knowledgeStatus: 'knowledge/status',
  /** Splunk connection settings (non-secret). The token lives in `splunk_token` (encrypted). */
  splunkConnection: 'splunk/connection',
};

export interface KnowledgeStatus {
  updatedAt: number;
  source: string;
  summary: Record<string, number>;
  /** Uncompressed bundle size in bytes. */
  bytes?: number;
  error?: string;
}
