/**
 * Backend endpoint: pull knowledge objects from a Splunk instance over its
 * REST API and store them as the shared knowledge bundle.
 *
 *   POST /api/v1/a/<appId>/endpoints/splunkSync   { "test": true }   → connectivity check only
 *   POST /api/v1/a/<appId>/endpoints/splunkSync   {}                 → full sync
 *
 * Connection: KV `splunk/connection` = { baseUrl: "https://splunk.example.com:8089", enabled: true }.
 * Auth: the Splunk host must be declared in config/proxies.yml with the
 * Authorization header injected from the encrypted KV key `splunk_token`, so
 * the token is never readable by app code. Scheduled runs (config/schedules.yml)
 * hit this same handler with a body containing `scheduledFor`.
 */
import { knowledgeFromRest, restEntries, type RestPayloads } from '../src/knowledge/rest.js';
import { errorResponse, json, KEYS, kvGet, kvPut } from './lib/kv.js';
import { storeSharedKnowledge } from './lib/merge.js';

interface Connection {
  baseUrl: string;
  enabled?: boolean;
  /** Splunk app namespace filter, e.g. "-" for all. */
  app?: string;
}

async function splunkGet(base: string, path: string, params: Record<string, string> = {}): Promise<unknown> {
  const u = new URL(path, base.endsWith('/') ? base : base + '/');
  u.searchParams.set('output_mode', 'json');
  u.searchParams.set('count', '0');
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const res = await fetch(u.toString(), { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`Splunk ${path}: HTTP ${res.status} ${(await res.text()).slice(0, 160)}`);
  return res.json();
}

export async function onRequest(request: Request, context: { appId: string }): Promise<Response> {
  try {
    const body = (await request.json().catch(() => ({}))) as { test?: boolean; scheduledFor?: string };
    const conn = await kvGet<Connection>(KEYS.splunkConnection);
    if (!conn?.baseUrl) {
      if (body.scheduledFor) return json({ ok: true, skipped: 'no Splunk connection configured' });
      return json({ ok: false, error: 'No Splunk connection configured. Save the Splunk URL and token in the Splunk knowledge tab first.' }, 400);
    }
    if (conn.enabled === false && body.scheduledFor) return json({ ok: true, skipped: 'connection disabled' });
    const base = conn.baseUrl.replace(/\/+$/, '');
    const ns = conn.app ? `servicesNS/-/${encodeURIComponent(conn.app)}` : 'services';

    const info = (await splunkGet(base, `${ns}/server/info`)) as { entry?: { content?: { version?: string; serverName?: string } }[] };
    const server = info.entry?.[0]?.content ?? {};
    if (body.test) return json({ ok: true, server: { version: server.version, serverName: server.serverName } });

    console.log(`[splunkSync] ${context.appId} syncing from ${base} (${server.version ?? '?'})${body.scheduledFor ? ' [scheduled]' : ''}`);
    const get = async (p: string) => restEntries(await splunkGet(base, `${ns}/${p}`));
    const payloads: RestPayloads = {
      propsExtractions: await get('data/props/extractions'),
      fieldaliases: await get('data/props/fieldaliases'),
      calcfields: await get('data/props/calcfields'),
      propsLookups: await get('data/props/lookups'),
      transformsExtractions: await get('data/transforms/extractions'),
      transformsLookups: await get('data/transforms/lookups'),
      eventtypes: await get('saved/eventtypes'),
      macros: await get('admin/macros'),
      datamodels: [],
    };
    // Data model definitions are only complete on the per-model endpoint.
    const models = await get('datamodel/model');
    for (const m of models) {
      try {
        const full = restEntries(await splunkGet(base, `${ns}/datamodel/model/${encodeURIComponent(m.name)}`));
        if (full[0]) payloads.datamodels!.push(full[0]);
      } catch (e) {
        console.warn(`[splunkSync] data model ${m.name}: ${(e as Error).message}`);
      }
    }
    const label = `splunk:${server.serverName ?? new URL(base).host}`;
    const k = knowledgeFromRest(payloads, label);
    const status = await storeSharedKnowledge(k, label, true);
    await kvPut(KEYS.splunkConnection, { ...conn, lastSync: status.updatedAt, lastServer: server.version });
    return json({ ok: true, server: { version: server.version, serverName: server.serverName }, counts: { models: payloads.datamodels!.length, eventtypes: payloads.eventtypes!.length }, status });
  } catch (e) {
    return errorResponse(e);
  }
}
