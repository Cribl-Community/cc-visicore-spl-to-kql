/**
 * Build a Splunk knowledge bundle (JSON) from app directories on disk, e.g.
 *
 *   npm run knowledge -- $SPLUNK_HOME/etc/system $SPLUNK_HOME/etc/apps/Splunk_SA_CIM $SPLUNK_HOME/etc/apps/TA-foo --out knowledge.json
 *
 * Reads props.conf, transforms.conf, eventtypes.conf, tags.conf, macros.conf (default/ then
 * local/ so local overrides win) and data/models/*.json. The output can be loaded in the app
 * or passed to `npm run translate -- --knowledge knowledge.json`.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { knowledgeFromFiles } from '../src/knowledge/conf.ts';
import { knowledgeSummary, mergeKnowledge, emptyKnowledge } from '../src/knowledge/types.ts';

const argv = process.argv.slice(2);
const outIdx = argv.indexOf('--out');
const outPath = outIdx !== -1 ? argv[outIdx + 1] : undefined;
const dirs = argv.filter((a, i) => !a.startsWith('--') && !(outIdx !== -1 && i === outIdx + 1));
if (!dirs.length) {
  process.stderr.write('usage: knowledge-from-dir <appDir...> [--out knowledge.json]\n');
  process.exit(2);
}

const WANTED = new Set(['props.conf', 'transforms.conf', 'eventtypes.conf', 'tags.conf', 'macros.conf']);

function walk(dir: string, out: string[]) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === '.git') continue;
      walk(p, out);
    } else if (WANTED.has(name) || (p.includes('/data/models/') && name.endsWith('.json')) || (p.includes('/lookups/') && name.endsWith('.csv'))) {
      out.push(p);
    }
  }
}

let k = emptyKnowledge();
for (const dir of dirs) {
  const files: string[] = [];
  walk(dir, files);
  // default/ before local/ so local overrides win in the merge.
  files.sort((a, b) => Number(a.includes('/local/')) - Number(b.includes('/local/')));
  const label = dir.replace(/\/+$/, '').split('/').pop() ?? dir;
  const loaded = knowledgeFromFiles(
    files.map((p) => ({ path: '/' + relative(dir, p).replace(/\\/g, '/'), text: p.endsWith('.csv') ? '' : readFileSync(p, 'utf8') })),
    label,
  );
  k = mergeKnowledge(k, loaded);
  process.stderr.write(`${label}: ${files.length} file(s)\n`);
}
const json = JSON.stringify(k);
if (outPath) writeFileSync(outPath, json);
else process.stdout.write(json + '\n');
process.stderr.write(`summary: ${JSON.stringify(knowledgeSummary(k))}\n`);
