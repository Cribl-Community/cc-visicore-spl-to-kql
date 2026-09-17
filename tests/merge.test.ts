import { afterEach, describe, expect, it, vi } from 'vitest';
import { storeSharedKnowledge } from '../backend/lib/merge';
import { readPackedKnowledge, type KvIO } from '../src/knowledge/kvpack';
import { knowledgeFromProps } from '../src/knowledge/conf';
import { mergeKnowledge, emptyKnowledge } from '../src/knowledge/types';

/** App KV store behind a stubbed fetch; every call yields so concurrent saves interleave. */
function fakeKv() {
  const kv = new Map<string, string>();
  vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
    await new Promise((r) => setTimeout(r, Math.random() * 3));
    const key = String(input).slice('/api/v1/kvstore/'.length);
    if (init?.method === 'PUT') kv.set(key, String(init.body));
    else if (init?.method === 'DELETE') kv.delete(key);
    else if (!kv.has(key)) return new Response('', { status: 404 });
    return new Response(kv.get(key) ?? '');
  });
  const io: KvIO = { get: async (k) => kv.get(k) ?? null, put: async (k, v) => void kv.set(k, v), del: async (k) => void kv.delete(k) };
  return { kv, io };
}

const pkg = (st: string) => ({ ...knowledgeFromProps(`[${st}]\nEVAL-from = "${st}"\n`), sources: [st] });

afterEach(() => vi.unstubAllGlobals());

describe('shared knowledge saves', () => {
  // Each save pauses before confirming its write survived, so this takes a few seconds.
  it('keeps every import when several run at the same time', { timeout: 60_000 }, async () => {
    for (let round = 0; round < 3; round++) {
      const { io } = fakeKv();
      const names = ['ta_a', 'ta_b', 'ta_c', 'ta_d'];
      await Promise.all(names.map((n) => storeSharedKnowledge(pkg(n), n, false)));
      const stored = await readPackedKnowledge(io, 'knowledge/shared');
      expect(Object.keys(stored!.props).sort()).toEqual(names);
    }
  });

  it('importing the same package twice stores the same bundle', async () => {
    const { io } = fakeKv();
    const ta = mergeKnowledge(emptyKnowledge(), knowledgeFromProps('[st]\nEVAL-x = x + 1\nEXTRACT-a = (?<a>\\d+)\nFIELDALIAS-b = c AS d\nLOOKUP-l = lk k OUTPUT v\n'));
    await storeSharedKnowledge(ta, 'ta', false);
    const once = await readPackedKnowledge(io, 'knowledge/shared');
    await storeSharedKnowledge(ta, 'ta', false);
    expect(await readPackedKnowledge(io, 'knowledge/shared')).toEqual(once);
  });
});
