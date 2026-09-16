/**
 * CLI: translate SPL to Cribl Search KQL.
 *
 *   npm run translate -- "index=web | stats count by host"
 *   echo "index=web | stats count" | npm run translate -- --json
 *
 * Flags: --json (structured output), --filters-as-where, --default-dataset <id>,
 *        --knowledge <knowledge.json> (Splunk knowledge bundle from scripts/knowledge-from-dir.ts), --no-shim
 */
import { readFileSync } from 'node:fs';
import { translate } from '../src/translator/index.ts';
import type { Knowledge } from '../src/knowledge/types.ts';

const argv = process.argv.slice(2);
const json = argv.includes('--json');
const filtersAsWhere = argv.includes('--filters-as-where');
const ddIdx = argv.indexOf('--default-dataset');
const defaultDataset = ddIdx !== -1 ? argv[ddIdx + 1] : undefined;
const kIdx = argv.indexOf('--knowledge');
const knowledge = kIdx !== -1 ? (JSON.parse(readFileSync(argv[kIdx + 1], 'utf8')) as Knowledge) : undefined;
const positional = argv.filter((a, i) => !a.startsWith('--') && !(ddIdx !== -1 && i === ddIdx + 1) && !(kIdx !== -1 && i === kIdx + 1));
const spl = positional.length ? positional.join(' ') : readFileSync(0, 'utf8');

const result = translate(spl, { filtersAsWhere, defaultDataset, knowledge, applyShim: !argv.includes('--no-shim') });
if (json) {
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} else {
  process.stdout.write(result.kql + '\n');
  for (const n of result.notes) process.stderr.write(`[${n.level}] (${n.command}) ${n.message}\n`);
}
