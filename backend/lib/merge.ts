import { KEYS, kvIO, kvPut, type KnowledgeStatus } from './kv.js';
import { readPackedKnowledge, writePackedKnowledge } from '../../src/knowledge/kvpack.js';
import { emptyKnowledge, knowledgeSummary, mergeKnowledge, type Knowledge } from '../../src/knowledge/types.js';

/** Merge new knowledge into the shared bundle (or replace it) and record status. */
export async function storeSharedKnowledge(incoming: Knowledge, source: string, replace: boolean): Promise<KnowledgeStatus> {
  const current = replace ? null : await readPackedKnowledge(kvIO, KEYS.sharedKnowledge);
  const merged = mergeKnowledge(current ?? emptyKnowledge(), incoming);
  const packed = await writePackedKnowledge(kvIO, KEYS.sharedKnowledge, merged);
  const status: KnowledgeStatus = { updatedAt: packed.updatedAt, source, summary: knowledgeSummary(merged), bytes: packed.bytes };
  await kvPut(KEYS.knowledgeStatus, status);
  return status;
}
