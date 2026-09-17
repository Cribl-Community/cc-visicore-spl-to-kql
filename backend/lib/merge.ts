import { KEYS, kvIO, kvPut, type KnowledgeStatus } from './kv.js';
import { KnowledgeConflictError, readKnowledgeVersion, readPackedKnowledge, writePackedKnowledge } from '../../src/knowledge/kvpack.js';
import { emptyKnowledge, knowledgeSummary, mergeKnowledge, type Knowledge } from '../../src/knowledge/types.js';

const ATTEMPTS = 8;
/** Pause before confirming a write survived, long enough for a concurrent save's index switch to land. */
const SETTLE_MS = 250;

/**
 * Read-modify-write of the shared bundle. `build` receives the bundle as currently stored and returns the new
 * one; if another import or sync saves in between, the write is abandoned and `build` runs again on the newer
 * bundle, so concurrent imports are merged instead of one silently replacing the other.
 */
export async function updateSharedKnowledge(source: string, build: (current: Knowledge | null) => Knowledge): Promise<KnowledgeStatus> {
  for (let attempt = 1; ; attempt++) {
    const version = await readKnowledgeVersion(kvIO, KEYS.sharedKnowledge);
    const current = await readPackedKnowledge(kvIO, KEYS.sharedKnowledge);
    const next = build(current);
    try {
      const packed = await writePackedKnowledge(kvIO, KEYS.sharedKnowledge, next, { expectVersion: version, settleMs: SETTLE_MS });
      const status: KnowledgeStatus = { updatedAt: packed.updatedAt, source, summary: knowledgeSummary(next), bytes: packed.bytes };
      await kvPut(KEYS.knowledgeStatus, status);
      return status;
    } catch (e) {
      if (!(e instanceof KnowledgeConflictError)) throw e;
      if (attempt >= ATTEMPTS) throw new Error(`The shared knowledge bundle kept changing while this save was written (${ATTEMPTS} attempts); another import or sync is running. Nothing from this save was stored; try again.`);
      await new Promise((r) => setTimeout(r, 50 + Math.random() * 200 * attempt));
    }
  }
}

/** Merge new knowledge into the shared bundle (or replace it) and record status. */
export function storeSharedKnowledge(incoming: Knowledge, source: string, replace: boolean): Promise<KnowledgeStatus> {
  return updateSharedKnowledge(source, (current) => mergeKnowledge(replace ? emptyKnowledge() : (current ?? emptyKnowledge()), incoming));
}
