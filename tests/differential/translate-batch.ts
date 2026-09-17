/**
 * Translate a batch of SPL queries for the differential harness.
 * stdin:  { "cases": ["<spl>", ...], "options": TranslateOptions, "knowledge": "<path to knowledge.json>" | null }
 * stdout: [{ "kql": "...", "notes": [...] }, ...]
 */
import { readFileSync } from 'node:fs';
import { translate } from '../../src/translator/index.ts';
import type { Knowledge } from '../../src/knowledge/types.ts';

const input = JSON.parse(readFileSync(0, 'utf8')) as { cases: string[]; options: Record<string, unknown>; knowledge: string | null };
const knowledge = input.knowledge ? (JSON.parse(readFileSync(input.knowledge, 'utf8')) as Knowledge) : undefined;
const out = input.cases.map((spl) => {
  try {
    const r = translate(spl, { ...input.options, knowledge });
    return { kql: r.kql, notes: r.notes };
  } catch (e) {
    return { error: (e as Error).message };
  }
});
process.stdout.write(JSON.stringify(out));
