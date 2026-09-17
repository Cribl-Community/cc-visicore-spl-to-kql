import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequest } from '../backend/splunk-sync';
import { readPackedKnowledge, type KvIO } from '../src/knowledge/kvpack';

/** In-memory KV store plus a fake Splunk REST API behind a stubbed fetch. */
function fakePlatform(models: string[], failing: Set<string>, requested: string[] = [], denied = new Set<string>()) {
  const kv = new Map<string, string>([['splunk/connection', JSON.stringify({ baseUrl: 'https://splunk.test:8089' })]]);
  const model = (name: string) => ({ entry: [{ name, content: { description: JSON.stringify({ modelName: name, objects: [{ objectName: name, parentName: 'BaseEvent', fields: [], constraints: [] }] }) } }] });
  vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('/api/v1/kvstore/')) {
      const key = url.slice('/api/v1/kvstore/'.length);
      if (init?.method === 'PUT') kv.set(key, String(init.body));
      else if (init?.method === 'DELETE') kv.delete(key);
      else if (!kv.has(key)) return new Response('', { status: 404 });
      return new Response(kv.get(key) ?? '');
    }
    const path = new URL(url).pathname;
    requested.push(path);
    if ([...denied].some((d) => path.endsWith(d))) return new Response('Forbidden', { status: 403 });
    if (path.endsWith('/server/info')) return Response.json({ entry: [{ name: 'info', content: { version: '10.0', serverName: 'test' } }] });
    if (path.endsWith('/datamodel/model')) return Response.json({ entry: models.map((name) => ({ name, content: {} })) });
    const m = /\/datamodel\/model\/(.+)$/.exec(path);
    if (m) return failing.has(m[1]) ? new Response('busy', { status: 503 }) : Response.json(model(m[1]));
    return Response.json({ entry: [] });
  });
  const io: KvIO = { get: async (k) => kv.get(k) ?? null, put: async (k, v) => void kv.set(k, v), del: async (k) => void kv.delete(k) };
  return { kv, io };
}

const sync = async () => (await onRequest(new Request('https://app.test/sync', { method: 'POST', body: '{}' }), { appId: 'test' })).json() as Promise<Record<string, unknown>>;

afterEach(() => vi.unstubAllGlobals());

describe('splunkSync', () => {
  it('keeps a previously synced data model when its fetch fails, and reports the sync as partial', async () => {
    const failing = new Set<string>();
    const { io } = fakePlatform(['Web', 'Authentication'], failing);
    expect(await sync()).toMatchObject({ ok: true, partial: false, kept: [], failed: [] });
    expect(Object.keys((await readPackedKnowledge(io, 'knowledge/shared'))!.models).sort()).toEqual(['Authentication', 'Web']);

    failing.add('Web');
    expect(await sync()).toMatchObject({ ok: true, partial: true, kept: ['Web'], failed: [] });
    expect(Object.keys((await readPackedKnowledge(io, 'knowledge/shared'))!.models).sort()).toEqual(['Authentication', 'Web']);
  });

  it('reports models that failed and have no previous copy', async () => {
    fakePlatform(['Web', 'Authentication'], new Set(['Web']));
    expect(await sync()).toMatchObject({ ok: true, partial: true, kept: [], failed: ['Web'] });
  });

  it('leaves the shared bundle unchanged when no data model can be fetched', async () => {
    const failing = new Set<string>();
    const { kv } = fakePlatform(['Web'], failing);
    await sync();
    const before = new Map(kv);
    failing.add('Web');
    expect(await sync()).toMatchObject({ ok: false, error: expect.stringContaining('left unchanged') });
    expect(new Map(kv)).toEqual(before);
  });

  it('reads macros from the documented configs/conf-macros endpoint', async () => {
    const requested: string[] = [];
    fakePlatform(['Web'], new Set(), requested);
    await sync();
    expect(requested.some((p) => p.endsWith('/services/configs/conf-macros'))).toBe(true);
    expect(requested.some((p) => p.includes('/admin/'))).toBe(false);
  });

  it('Save and test fails when the token cannot read an endpoint the sync needs', async () => {
    const test = async () => (await onRequest(new Request('https://app.test/sync', { method: 'POST', body: '{"test":true}' }), { appId: 'test' })).json() as Promise<Record<string, unknown>>;
    fakePlatform(['Web'], new Set());
    const ok = await test();
    expect(ok).toMatchObject({ ok: true });
    expect((ok.checks as unknown[]).length).toBe(9);
    fakePlatform(['Web'], new Set(), [], new Set(['configs/conf-macros', 'data/props/calcfields']));
    const bad = await test();
    expect(bad).toMatchObject({ ok: false });
    expect(String(bad.error)).toMatch(/cannot read 2 of 9 knowledge endpoints.*HTTP 403/);
    expect(String(bad.error)).toContain('configs/conf-macros');
  });
});
