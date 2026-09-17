import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CHUNK_CHARS, deletePackedKnowledge, packKnowledge, readPackedKnowledge, unpackKnowledge, writePackedKnowledge, type KvIO } from '../src/knowledge/kvpack';
import { ungzip } from 'pako';
import { readTar } from '../src/knowledge/archive';
import { knowledgeFromFiles } from '../src/knowledge/conf';

function memIO(): KvIO & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async get(k) {
      return store.get(k) ?? null;
    },
    async put(k, v) {
      if (v.length > 100_000) throw new Error('413');
      store.set(k, v);
    },
    async del(k) {
      store.delete(k);
    },
  };
}

const cim = knowledgeFromFiles(readTar(ungzip(new Uint8Array(readFileSync('tests/fixtures/Splunk_SA_CIM-models.tgz')))), 'cim');

describe('kvpack', () => {
  it('round-trips a bundle through gzip/base64 chunks', () => {
    const { index, chunks } = packKnowledge(cim);
    expect(index.chunks).toBe(chunks.length);
    expect(chunks.every((c) => c.length <= CHUNK_CHARS)).toBe(true);
    expect(unpackKnowledge(chunks)).toEqual(cim);
  });

  it('writes, reads, shrinks and deletes through a KV adapter', async () => {
    const io = memIO();
    // Incompressible padding so the packed bundle spans several chunks.
    let x = 123456789;
    const rnd = () => ((x ^= x << 13), (x ^= x >>> 17), (x ^= x << 5), (x >>> 0) % 36);
    const pad = Array.from({ length: 40 }, () => Array.from({ length: 5000 }, () => rnd().toString(36)).join(''));
    const big = { ...cim, sources: pad };
    const idx = await writePackedKnowledge(io, 'k', big);
    expect(idx.chunks).toBeGreaterThan(1);
    expect(io.store.size).toBe(idx.chunks + 1);
    expect(await readPackedKnowledge(io, 'k')).toEqual(big);
    const idx2 = await writePackedKnowledge(io, 'k', cim);
    expect(io.store.size).toBe(idx2.chunks + 1);
    await deletePackedKnowledge(io, 'k');
    expect(io.store.size).toBe(0);
    expect(await readPackedKnowledge(io, 'k')).toBeNull();
  });

  it('reads legacy unpacked values and rejects incomplete chunk sets', async () => {
    const io = memIO();
    await io.put('legacy', JSON.stringify(cim));
    expect(await readPackedKnowledge(io, 'legacy')).toEqual(cim);
    await writePackedKnowledge(io, 'k', cim);
    const gen = (JSON.parse(io.store.get('k')!) as { gen: string }).gen;
    await io.del(`k/g${gen}/c0`);
    await expect(readPackedKnowledge(io, 'k')).rejects.toThrow(/incomplete/);
  });

  it('keeps the previous bundle readable when a write fails part-way', async () => {
    const io = memIO();
    await writePackedKnowledge(io, 'k', cim);
    const before = new Map(io.store);
    const put = io.put.bind(io);
    let calls = 0;
    io.put = async (key, v) => {
      if (++calls === 1) throw new Error('KV write failed: HTTP 500');
      return put(key, v);
    };
    const changed = { ...cim, sources: ['changed'] };
    await expect(writePackedKnowledge(io, 'k', changed)).rejects.toThrow(/HTTP 500/);
    expect(await readPackedKnowledge(io, 'k')).toEqual(cim);
    // The failed generation's chunks are cleaned up.
    expect(new Map(io.store)).toEqual(before);
    io.put = put;
    await writePackedKnowledge(io, 'k', changed);
    expect(await readPackedKnowledge(io, 'k')).toEqual(changed);
  });

  it('reads and replaces bundles stored in the pre-generation layout', async () => {
    const io = memIO();
    const { index, chunks } = packKnowledge(cim);
    await io.put('k', JSON.stringify(index));
    for (const [i, c] of chunks.entries()) await io.put(`k/c${i}`, c);
    expect(await readPackedKnowledge(io, 'k')).toEqual(cim);
    const idx = await writePackedKnowledge(io, 'k', cim);
    expect(io.store.has('k/c0')).toBe(false);
    expect(io.store.size).toBe(idx.chunks + 1);
  });

  it('reads the new bundle when a save completes while a read is fetching chunks', async () => {
    const io = memIO();
    await writePackedKnowledge(io, 'k', cim);
    const changed = { ...cim, sources: ['changed'] };
    let raced = false;
    const reader: KvIO = {
      ...io,
      async get(key) {
        // The reader has already fetched the index; a writer now replaces the bundle and deletes its chunks.
        if (!raced && key.includes('/c')) {
          raced = true;
          await writePackedKnowledge(io, 'k', changed);
        }
        return io.get(key);
      },
    };
    expect(await readPackedKnowledge(reader, 'k')).toEqual(changed);
    expect(raced).toBe(true);
  });
});
