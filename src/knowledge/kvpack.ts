/**
 * Packing a knowledge bundle into the app KV store.
 *
 * KV values are capped at roughly 100 KB, and a CIM-sized bundle (data models
 * included) is several times that. Bundles are therefore gzipped, base64
 * encoded, and split across `<key>/c<n>` chunk keys, with `<key>` itself
 * holding a small index. The same helpers serve the browser (via the fetch
 * proxy) and backend endpoints (via the runtime's relative fetch).
 */
import { gzip, ungzip } from 'pako';
import type { Knowledge } from './types.js';

/** Stay well under the KV limit after base64 expansion. */
export const CHUNK_CHARS = 80_000;

export interface PackIndex {
  packed: 1;
  chunks: number;
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

const chunkKey = (key: string, i: number) => `${key}/c${i}`;

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
  const head = parseJson(await io.get(key)) as (PackIndex & Partial<Knowledge>) | null;
  if (!head) return null;
  if (head.packed !== 1) return head.props ? (head as unknown as Knowledge) : null;
  const chunks = await Promise.all(Array.from({ length: head.chunks }, (_, i) => io.get(chunkKey(key, i))));
  if (chunks.some((c) => !c)) throw new Error(`Knowledge bundle at ${key} is incomplete (missing chunks); re-import it.`);
  return unpackKnowledge(chunks as string[]);
}

/** Write a bundle under `key`, replacing any previous chunks. */
export async function writePackedKnowledge(io: KvIO, key: string, k: Knowledge): Promise<PackIndex> {
  const previous = parseJson(await io.get(key)) as PackIndex | null;
  const { index, chunks } = packKnowledge(k);
  await Promise.all(chunks.map((c, i) => io.put(chunkKey(key, i), c)));
  await io.put(key, JSON.stringify(index));
  const stale = previous?.packed === 1 ? previous.chunks : 0;
  for (let i = chunks.length; i < stale; i++) await io.del(chunkKey(key, i));
  return index;
}

export async function deletePackedKnowledge(io: KvIO, key: string): Promise<void> {
  const previous = parseJson(await io.get(key)) as PackIndex | null;
  const n = previous?.packed === 1 ? previous.chunks : 0;
  for (let i = 0; i < n; i++) await io.del(chunkKey(key, i));
  await io.del(key);
}
