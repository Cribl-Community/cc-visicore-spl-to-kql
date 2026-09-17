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
    await io.del('k/c0');
    await expect(readPackedKnowledge(io, 'k')).rejects.toThrow(/incomplete/);
  });
});
