/**
 * SPL → Cribl Search KQL translator entry point.
 *
 *   const result = translate('index=web status=500 | stats count by host');
 *   result.kql   // 'dataset="web" status=500\n| summarize count = count() by host'
 *   result.notes // explanations, approximations and unsupported bits
 */
import { splitPipeline, stripComments } from './lexer';
import { COMMANDS, GENERATING, buildScope, type Env, type HandlerResult } from './commands';
import { createCtx, type Ctx, type StageResult, type TranslateOptions, type TranslationResult } from './types';

export type { Note, NoteLevel, StageResult, TimeRange, TranslateOptions, TranslationResult } from './types';

interface Stage {
  spl: string;
  command: string;
  args: string;
}

/** Split SPL into stages and identify each command. */
function stagesOf(spl: string): Stage[] {
  const cleaned = stripComments(spl).trim();
  const startsWithPipe = cleaned.startsWith('|');
  const parts = splitPipeline(cleaned);
  return parts.map((p, i) => {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\b([\s\S]*)$/.exec(p);
    const isFirstSearch = i === 0 && !startsWithPipe;
    if (isFirstSearch) {
      // `search index=x` and bare terms are both the implicit search stage.
      if (m && m[1].toLowerCase() === 'search') return { spl: p, command: 'search', args: m[2].trim() };
      return { spl: p, command: 'search', args: p };
    }
    if (m && (COMMANDS[m[1].toLowerCase()] || GENERATING.has(m[1].toLowerCase()))) return { spl: p, command: m[1].toLowerCase(), args: m[2].trim() };
    if (m) return { spl: p, command: m[1].toLowerCase(), args: m[2].trim() };
    return { spl: p, command: 'search', args: p };
  });
}

function runStage(stage: Stage, ctx: Ctx, env: Env): HandlerResult {
  const handler = COMMANDS[stage.command];
  if (!handler) {
    ctx.note('error', `Unknown SPL command "${stage.command}"; the stage was not translated.`);
    return { kql: [`// TODO (${stage.command}): not translated — ${stage.spl.replace(/\s+/g, ' ').trim()}`], unsupported: true };
  }
  try {
    return handler(stage.args, ctx, env);
  } catch (e) {
    ctx.note('error', `Failed to translate "${stage.command}": ${(e as Error).message}`);
    return { kql: [`// TODO (${stage.command}): not translated — ${stage.spl.replace(/\s+/g, ' ').trim()}`], unsupported: true };
  }
}

/** Translate a subsearch into a single-line KQL subquery. Notes are merged into the parent context. */
function translateSub(spl: string, parent: Ctx): string {
  const ctx = createCtx(parent.opts, true);
  ctx.fieldAliases = new Map(parent.fieldAliases);
  const stages = stagesOf(spl);
  const lines: string[] = [];
  stages.forEach((st, i) => {
    ctx.stage = i + 1;
    ctx.command = st.command;
    const env: Env = { sub: (s) => translateSub(s, ctx), first: i === 0 };
    if (i === 0 && !GENERATING.has(st.command)) {
      lines.push(...buildScope('', ctx));
    }
    const r = runStage(st, ctx, { ...env, first: env.first && GENERATING.has(st.command) });
    lines.push(...r.kql.filter((l) => !l.startsWith('//')));
  });
  for (const n of ctx.notes) parent.notes.push({ ...n, stage: parent.stage, command: parent.command, message: `[subsearch] ${n.message}` });
  ctx.datasets.forEach((d) => parent.datasets.add(d));
  ctx.indexes.forEach((d) => parent.indexes.add(d));
  ctx.lookups.forEach((d) => parent.lookups.add(d));
  ctx.macros.forEach((d) => parent.macros.add(d));
  return lines.join(' | ');
}

export function translate(spl: string, opts: TranslateOptions = {}): TranslationResult {
  const ctx = createCtx(opts);
  const stages = stagesOf(spl);
  const results: StageResult[] = [];
  const lines: string[] = [];

  if (stages.length === 0) {
    return { kql: '', stages: [], notes: [], timeRange: {}, datasets: [], indexes: [], lookups: [], macros: [], unsupportedCount: 0 };
  }

  stages.forEach((st, i) => {
    ctx.stage = i + 1;
    ctx.command = st.command;
    const first = i === 0;
    if (first && !GENERATING.has(st.command)) {
      // Pipeline starts with a non-generating command (e.g. `| stats ...`): synthesize a scope.
      ctx.note('warning', 'The SPL does not start with a search; a dataset scope was added so the query is runnable.');
      lines.push(...buildScope('', ctx));
    }
    const env: Env = { sub: (s) => translateSub(s, ctx), first: first && GENERATING.has(st.command) };
    const r = runStage(st, ctx, env);
    results.push({ index: i + 1, spl: st.spl, command: st.command, kql: r.kql, unsupported: !!r.unsupported });
    lines.push(...r.kql);
  });

  const header: string[] = [];
  if (ctx.timeRange.earliest || ctx.timeRange.latest) {
    header.push(`// Time range: earliest=${ctx.timeRange.earliest ?? '-15m'} latest=${ctx.timeRange.latest ?? 'now'}`);
  }
  const body = lines.map((l, i) => (i === 0 || l.startsWith('//') ? l : `| ${l}`)).join('\n');
  const kql = [...header, body].join('\n');

  return {
    kql,
    stages: results,
    notes: ctx.notes,
    timeRange: ctx.timeRange,
    datasets: [...ctx.datasets],
    indexes: [...ctx.indexes],
    lookups: [...ctx.lookups],
    macros: [...ctx.macros],
    unsupportedCount: results.filter((r) => r.unsupported).length,
  };
}

/** Strip comment lines so the query can be sent to the preview/validation endpoint. */
export function stripKqlComments(kql: string): string {
  return kql
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n')
    .trim();
}
