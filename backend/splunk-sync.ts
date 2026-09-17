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
import { updateSharedKnowledge } from './lib/merge.js';

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

/**
 * Knowledge endpoints the sync reads, all publicly documented (Splunk Cloud Platform supports only documented
 * endpoints; `/admin/` ones are unsupported, so macros come from configs/conf-macros).
 */
const KNOWLEDGE_ENDPOINTS = {
  propsExtractions: 'data/props/extractions',
  fieldaliases: 'data/props/fieldaliases',
  calcfields: 'data/props/calcfields',
  propsLookups: 'data/props/lookups',
  transformsExtractions: 'data/transforms/extractions',
  transformsLookups: 'data/transforms/lookups',
  eventtypes: 'saved/eventtypes',
  macros: 'configs/conf-macros',
  datamodels: 'datamodel/model',
} as const;

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
    if (body.test) {
      // Read one entry from every endpoint the sync uses, so a token that can reach Splunk but not all of the
      // knowledge (a restricted role, an endpoint blocked on Splunk Cloud) fails here rather than at sync time.
      const checks = await Promise.all(
        Object.values(KNOWLEDGE_ENDPOINTS).map(async (endpoint) => {
          try {
            await splunkGet(base, `${ns}/${endpoint}`, { count: '1' });
            return { endpoint, ok: true };
          } catch (e) {
            return { endpoint, ok: false, error: (e as Error).message };
          }
        }),
      );
      const bad = checks.filter((c) => !c.ok);
      const who = `${server.serverName ?? 'Splunk'} ${server.version ?? ''}`.trim();
      if (bad.length) return json({ ok: false, error: `Connected to ${who}, but the token cannot read ${bad.length} of ${checks.length} knowledge endpoints the sync needs: ${bad.map((c) => c.error).join('; ')}`, server, checks }, 422);
      return json({ ok: true, server: { version: server.version, serverName: server.serverName }, checks });
    }

    console.log(`[splunkSync] ${context.appId} syncing from ${base} (${server.version ?? '?'})${body.scheduledFor ? ' [scheduled]' : ''}`);
    const get = async (p: string) => restEntries(await splunkGet(base, `${ns}/${p}`));
    const E = KNOWLEDGE_ENDPOINTS;
    const payloads: RestPayloads = {
      propsExtractions: await get(E.propsExtractions),
      fieldaliases: await get(E.fieldaliases),
      calcfields: await get(E.calcfields),
      propsLookups: await get(E.propsLookups),
      transformsExtractions: await get(E.transformsExtractions),
      transformsLookups: await get(E.transformsLookups),
      eventtypes: await get(E.eventtypes),
      macros: await get(E.macros),
      datamodels: [],
    };
    // Data model definitions are only complete on the per-model endpoint.
    const models = await get(E.datamodels);
    const failed: string[] = [];
    for (const m of models) {
      try {
        const full = restEntries(await splunkGet(base, `${ns}/datamodel/model/${encodeURIComponent(m.name)}`));
        if (full[0]) payloads.datamodels!.push(full[0]);
      } catch (e) {
        console.warn(`[splunkSync] data model ${m.name}: ${(e as Error).message}`);
        failed.push(m.name);
      }
    }
    const label = `splunk:${server.serverName ?? new URL(base).host}`;
    const k = knowledgeFromRest(payloads, label);
    if (models.length && failed.length === models.length) throw new Error(`Splunk sync aborted: none of the ${models.length} data models could be fetched (${failed.slice(0, 5).join(', ')}). The shared bundle was left unchanged.`);
    // A sync replaces the shared bundle, so a model that could not be fetched this time is carried
    // over from the bundle as stored at write time instead of silently disappearing for every user.
    let kept: string[] = [];
    let lost: string[] = [];
    const status = await updateSharedKnowledge(label, (previous) => {
      const next = { ...k, models: { ...k.models } };
      kept = [];
      lost = [];
      for (const name of failed) {
        const old = previous?.models[name];
        if (old) {
          next.models[name] = old;
          kept.push(name);
        } else lost.push(name);
      }
      return next;
    });
    await kvPut(KEYS.splunkConnection, { ...conn, lastSync: status.updatedAt, lastServer: server.version });
    return json({ ok: true, server: { version: server.version, serverName: server.serverName }, counts: { models: payloads.datamodels!.length, eventtypes: payloads.eventtypes!.length }, partial: failed.length > 0, kept, failed: lost, status });
  } catch (e) {
    return errorResponse(e);
  }
}
