/**
 * Packing a knowledge bundle into the app KV store.
 *
 * KV values are capped at roughly 100 KB, and a CIM-sized bundle (data models
 * included) is several times that. Bundles are therefore gzipped, base64
 * encoded, and split across `<key>/g<generation>/c<n>` chunk keys, with `<key>`
 * itself holding a small index. Every write uses a fresh generation and the
 * index is switched only after all of its chunks are stored, so a failed or
 * concurrent write never damages the bundle readers see. The same helpers serve the browser (via the fetch
 * proxy) and backend endpoints (via the runtime's relative fetch).
 */
import { gzip, ungzip } from 'pako';
import type { Knowledge } from './types.js';

/** Stay well under the KV limit after base64 expansion. */
export const CHUNK_CHARS = 80_000;

export interface PackIndex {
  packed: 1;
  chunks: number;
  /** Chunk generation; absent on bundles written before generations existed (`<key>/c<n>`). */
  gen?: string;
  /** Uncompressed JSON size, for display. */
  bytes: number;
  updatedAt: number;
}

export interface KvIO {
  get(key: string): Promise<string | null>;
  put(key: string, text: string): Promise<void>;
  del(key: string): Promise<void>;
}

function toBase64(u8: Uint8Array): string {
  const B = (globalThis as { Buffer?: { from(b: Uint8Array): { toString(enc: string): string } } }).Buffer;
  if (B) return B.from(u8).toString('base64');
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const B = (globalThis as { Buffer?: { from(s: string, enc: string): Uint8Array } }).Buffer;
  if (B) return new Uint8Array(B.from(b64, 'base64'));
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function packKnowledge(k: Knowledge): { index: PackIndex; chunks: string[] } {
  const json = JSON.stringify(k);
  const b64 = toBase64(gzip(json));
  const chunks: string[] = [];
  for (let i = 0; i < b64.length; i += CHUNK_CHARS) chunks.push(b64.slice(i, i + CHUNK_CHARS));
  return { index: { packed: 1, chunks: chunks.length, bytes: json.length, updatedAt: Date.now() }, chunks };
}

export function unpackKnowledge(chunks: string[]): Knowledge {
  return JSON.parse(ungzip(fromBase64(chunks.join('')), { to: 'string' })) as Knowledge;
}

const chunkKey = (key: string, gen: string | undefined, i: number) => (gen ? `${key}/g${gen}/c${i}` : `${key}/c${i}`);

function parseJson(text: string | null): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Read a bundle stored under `key` (packed, or a legacy unpacked JSON value). */
export async function readPackedKnowledge(io: KvIO, key: string): Promise<Knowledge | null> {
  // A save that completes while this read is in flight deletes the generation being read. Missing
  // chunks under an index that has since moved on are therefore retried against the new index;
  // they are an error only when the index still points at them.
  for (let attempt = 0; ; attempt++) {
    const head = parseJson(await io.get(key)) as (PackIndex & Partial<Knowledge>) | null;
    if (!head) return null;
    if (head.packed !== 1) return head.props ? (head as unknown as Knowledge) : null;
    const chunks = await Promise.all(Array.from({ length: head.chunks }, (_, i) => io.get(chunkKey(key, head.gen, i))));
    if (chunks.every((c) => c)) return unpackKnowledge(chunks as string[]);
    const now = parseJson(await io.get(key)) as PackIndex | null;
    const moved = !!now && (now.gen !== head.gen || now.updatedAt !== head.updatedAt);
    if (!moved || attempt >= 4) throw new Error(`Knowledge bundle at ${key} is incomplete (missing chunks); re-import it.`);
  }
}

/** Best-effort removal of one generation's chunks; leftovers are unreachable and harmless. */
async function dropChunks(io: KvIO, key: string, index: Pick<PackIndex, 'chunks' | 'gen'>): Promise<void> {
  await Promise.all(Array.from({ length: index.chunks }, (_, i) => io.del(chunkKey(key, index.gen, i)).catch(() => undefined)));
}

/** Write a bundle under `key`. The previous bundle stays readable until the new one is complete. */
/** Thrown when the bundle changed between reading it and switching the index to a new write. */
export class KnowledgeConflictError extends Error {}

/** Identifies the stored bundle version, so a read-modify-write can check nothing replaced it meanwhile. */
export async function readKnowledgeVersion(io: KvIO, key: string): Promise<string | null> {
  const text = await io.get(key);
  if (!text) return null;
  const head = parseJson(text) as PackIndex | null;
  return head?.packed === 1 ? `${head.gen ?? 'c'}:${head.updatedAt}` : `raw:${text.length}:${text.slice(0, 64)}`;
}

/**
 * Write a bundle under `key`. The previous bundle stays readable until the new one is complete.
 *
 * With `expectVersion` (read before the data being merged), the write is a checked read-modify-write: the index
 * is only switched if the stored version is still that one, and after switching it, the index is read again
 * after `settleMs` to make sure no concurrent save replaced it. Either failure removes this write's chunks and
 * throws KnowledgeConflictError so the caller can merge again on top of the newer bundle. The KV store has no
 * compare-and-set, so a save that switches the index after that final read can still replace this one.
 */
export async function writePackedKnowledge(io: KvIO, key: string, k: Knowledge, opts: { expectVersion?: string | null; settleMs?: number } = {}): Promise<PackIndex> {
  const previous = parseJson(await io.get(key)) as PackIndex | null;
  const packed = packKnowledge(k);
  const gen = `${packed.index.updatedAt.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const index: PackIndex = { ...packed.index, gen };
  try {
    await Promise.all(packed.chunks.map((c, i) => io.put(chunkKey(key, gen, i), c)));
    if (opts.expectVersion !== undefined && (await readKnowledgeVersion(io, key)) !== opts.expectVersion) {
      throw new KnowledgeConflictError(`The knowledge bundle at ${key} was changed by another save while this one was being written.`);
    }
    await io.put(key, JSON.stringify(index));
    if (opts.expectVersion !== undefined) {
      await new Promise((r) => setTimeout(r, opts.settleMs ?? 0));
      if ((await readKnowledgeVersion(io, key)) !== `${gen}:${index.updatedAt}`) {
        throw new KnowledgeConflictError(`The knowledge bundle at ${key} was replaced by another save right after this one.`);
      }
    }
  } catch (e) {
    await dropChunks(io, key, index);
    throw e;
  }
  if (previous?.packed === 1) await dropChunks(io, key, previous);
  return index;
}

export async function deletePackedKnowledge(io: KvIO, key: string): Promise<void> {
  const previous = parseJson(await io.get(key)) as PackIndex | null;
  // Index first: readers then see "no bundle" rather than a bundle with missing chunks.
  await io.del(key);
  if (previous?.packed === 1) await dropChunks(io, key, previous);
}
