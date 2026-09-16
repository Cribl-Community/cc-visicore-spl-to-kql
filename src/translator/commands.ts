/**
 * SPL command handlers. Each handler receives the raw argument string of one
 * pipeline stage and returns the KQL stages to emit (without the leading `|`).
 *
 * Conventions:
 *  - Aggregations are always named (`count = count()`), so downstream SPL that
 *    references Splunk's default names keeps working through ctx.fieldAliases.
 *  - Anything that cannot be translated faithfully emits an `error` note and a
 *    `// TODO` comment line rather than silently changing the query's meaning.
 */
import { parseArgs, splitTopLevel, tokenize, type Tok } from './lexer';
import { fieldRef, globToRegex, kqlRegexLiteral, kqlString, kqlVerbatim, translateExpr, parseExpr, renderExpr, ExprError } from './expr';
import { type SAst, parseSearch, extractScope, renderScope, renderWhere, isEmptyPredicate, collectSourcetypes, partitionPredicate } from './search';
import { buildShim, matchSourcetypes } from '../knowledge/shim';
import { calculationStages, constraintSearch, objectPrefixes, resolveDataModel } from '../knowledge/datamodel';
import { parseSpan, spanToTimespan, spanToTimestats } from './time';
import type { Ctx } from './types';

export interface HandlerResult {
  kql: string[];
  unsupported?: boolean;
}

export interface Env {
  /** Translate a subsearch into a single-line KQL subquery (with the `cribl` keyword). */
  sub: (spl: string) => string;
  /** True when this stage is the first in the pipeline and must produce the dataset scope. */
  first: boolean;
}

export type Handler = (args: string, ctx: Ctx, env: Env) => HandlerResult;

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

const words = (s: string): string[] =>
  splitTopLevel(s, ' ')
    .flatMap((p) => splitTopLevel(p, ','))
    .map((p) => p.trim())
    .filter(Boolean);

/** Split `args` at a top-level keyword (case-insensitive), e.g. "by". */
function splitKeyword(args: string, kw: string): { head: string; tail: string | null } {
  const parts = splitTopLevel(args, ' ');
  const idx = parts.findIndex((p) => p.trim().toLowerCase() === kw);
  if (idx === -1) return { head: args, tail: null };
  return { head: parts.slice(0, idx).join(' ').trim(), tail: parts.slice(idx + 1).join(' ').trim() };
}

function unquote(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
  return t;
}

function todo(spl: string, command: string): string {
  return `// TODO (${command}): not translated — ${spl.replace(/\s+/g, ' ').trim()}`;
}

function unsupportedCmd(message: string): Handler {
  return (args, ctx) => {
    ctx.note('error', message);
    return { kql: [todo(`${ctx.command} ${args}`, ctx.command)], unsupported: true };
  };
}

function skipCmd(message: string): Handler {
  return (_args, ctx) => {
    ctx.note('info', message);
    return { kql: [] };
  };
}

/** Field list from "a b, c" honoring quotes. */
function fieldList(s: string, ctx: Ctx): string[] {
  return words(s).map((w) => fieldRef(unquote(w), ctx));
}

function sanitizeName(s: string): string {
  return s.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'value';
}

/* ------------------------------------------------------------------ */
/* Scope (first stage)                                                 */
/* ------------------------------------------------------------------ */

/** SPL `lookup` spec → KQL stages, for the knowledge shim. */
const lookupToKql = (spec: string, ctx: Ctx): string[] => COMMANDS.lookup(spec, ctx, { sub: () => '', first: false }).kql;

/** Build the dataset scope stage (plus optional where/shim stages) from an SPL search expression. */
export function buildScope(raw: string, ctx: Ctx): string[] {
  const ast = parseSearch(raw);
  const { datasets, timeRange, rest } = extractScope(ast, ctx);
  if (timeRange.earliest || timeRange.latest) {
    if (ctx.inSubsearch) ctx.note('warning', 'earliest/latest inside a subsearch cannot be scoped separately in Cribl Search; the outer time range applies.');
    else {
      if (timeRange.earliest) ctx.timeRange.earliest = timeRange.earliest;
      if (timeRange.latest) ctx.timeRange.latest = timeRange.latest;
      ctx.note('info', `Time range earliest=${timeRange.earliest ?? '(unset)'} latest=${timeRange.latest ?? 'now'} was moved out of the query; set it on the Cribl Search time picker (same relative syntax).`);
    }
  }
  // Sourcetypes referenced (directly or via tag/eventtype expansion) drive the knowledge shim and dataset fallback.
  const stSet = new Set<string>();
  collectSourcetypes(rest, stSet);
  const k = ctx.opts.knowledge;
  const sourcetypes = k ? [...stSet].flatMap((st) => matchSourcetypes(st, k)) : [...stSet];
  for (const st of sourcetypes) ctx.sourcetypes.add(st);

  let scope: string;
  if (datasets.length === 0) {
    const viaSt = [...stSet].map((st) => ctx.opts.indexMap?.[st]).find(Boolean);
    if (viaSt) {
      scope = `dataset=${kqlString(viaSt)}`;
      ctx.note('info', `No index= in the SPL; using dataset "${viaSt}" mapped from the sourcetype.`);
    } else if (ctx.opts.defaultDataset) {
      scope = `dataset=${kqlString(ctx.opts.defaultDataset)}`;
      ctx.note('info', `No index= in the SPL; using the default dataset "${ctx.opts.defaultDataset}".`);
    } else {
      scope = 'dataset="<DATASET>"';
      ctx.note('error', 'No index= in the SPL. Cribl Search requires a dataset scope: replace <DATASET> with the dataset to search (or set a default dataset).');
    }
  } else {
    const mapped = [...new Set(datasets)].map((d) => {
      ctx.indexes.add(d);
      const m = ctx.opts.indexMap?.[d];
      if (m && m !== d) ctx.note('info', `index="${d}" was mapped to dataset "${m}".`);
      return m || d;
    });
    for (const d of mapped) {
      ctx.datasets.add(d);
      if (ctx.opts.knownDatasets && !d.includes('*') && !ctx.opts.knownDatasets.includes(d)) {
        ctx.note('warning', `index="${d}" does not match any Cribl Search dataset in this environment. Map it to the dataset that holds this data.`);
      }
    }
    scope = mapped.length === 1 ? `dataset=${kqlString(mapped[0])}` : `dataset in (${mapped.map(kqlString).join(', ')})`;
  }
  // Field stages reproduced from Splunk knowledge (extractions, aliases, evals, lookups).
  const shim: string[] = [];
  if (k && ctx.opts.applyShim !== false) {
    if (sourcetypes.length > 1) ctx.note('info', `Several sourcetypes are in scope (${sourcetypes.join(', ')}); their search-time field stages are applied in sequence.`);
    const seen = new Set<string>();
    for (const st of sourcetypes) {
      const fresh = buildShim(st, k, ctx, { lookupToKql }).filter((line) => line.startsWith('//') || !seen.has(line));
      fresh.forEach((line) => seen.add(line));
      // Drop the header comment when every stage was already emitted for another sourcetype.
      if (fresh.some((line) => !line.startsWith('//'))) shim.push(...fresh);
    }
    if (!sourcetypes.length && stSet.size) ctx.note('info', `No Splunk knowledge is loaded for sourcetype ${[...stSet].join(', ')}; field names pass through unchanged.`);
  }
  // Predicates on extracted fields must run after the field stages exist.
  let scopePred = rest;
  let later: SAst = { k: 'all' };
  if (shim.length) {
    const parts = partitionPredicate(rest);
    scopePred = parts.scope;
    later = parts.later;
    if (!isEmptyPredicate(later)) ctx.note('info', 'Filters on extracted fields were moved after the Splunk field stages so the fields exist when they are evaluated.');
  }
  const prefix = ctx.inSubsearch ? 'cribl ' : '';
  const out: string[] = [];
  if (ctx.opts.filtersAsWhere) {
    out.push(`${prefix}${scope}`);
    if (!isEmptyPredicate(scopePred)) out.push(`where ${renderWhere(scopePred, ctx)}`);
  } else {
    const pred = renderScope(scopePred, ctx);
    out.push(prefix + (pred ? `${scope} ${pred}` : scope));
  }
  out.push(...shim);
  if (!isEmptyPredicate(later)) out.push(`where ${renderWhere(later, ctx)}`);
  return out;
}

/** Stages that reproduce a Splunk data model object: constraints (scope + where), sourcetype shims and calculated fields. */
export function dataModelStages(ref: string, extraSearch: string, ctx: Ctx): { stages: string[]; ok: boolean } {
  const k = ctx.opts.knowledge;
  const r = k ? resolveDataModel(ref, k) : null;
  if (!k || !r) {
    ctx.note('error', `Data model "${ref}" is not in the loaded Splunk knowledge; load the CIM app (or the app that defines it) to translate it.`);
    return { stages: [], ok: false };
  }
  for (const p of objectPrefixes(r)) ctx.dmPrefixes.add(p);
  const constraint = constraintSearch(r);
  const search = [constraint, extraSearch].filter((x) => x.trim()).join(' ');
  const stages = buildScope(search, ctx);
  stages.push(...calculationStages(r, k, ctx, lookupToKql));
  ctx.note('info', `Data model ${r.model.name}.${r.chain[r.chain.length - 1].name}: constraints ${r.chain.map((o) => o.constraints.join(' ')).filter(Boolean).map((c) => `"${c}"`).join(' + ') || '(none)'}; object prefixes are stripped from field names.`);
  return { stages, ok: true };
}

/* ------------------------------------------------------------------ */
/* Aggregations                                                        */
/* ------------------------------------------------------------------ */

interface Agg {
  fn: string;
  arg: string;
  alias?: string;
  raw: string;
}

const AGG_OPTIONS = new Set(['allnum', 'delim', 'partitions', 'dedup_splitvals', 'current', 'window', 'global', 'reset_on_change', 'reset_before', 'reset_after', 'time_window', 'max_events']);

/** Parse "count sum(bytes) as total, dc(host)" into aggregation descriptors. */
export function parseAggList(s: string): Agg[] {
  const out: Agg[] = [];
  const parts = words(s);
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.toLowerCase() === 'as' && out.length && parts[i + 1]) {
      out[out.length - 1].alias = unquote(parts[i + 1]);
      i++;
      continue;
    }
    const opt = /^([A-Za-z_]+)=/.exec(p);
    if (opt && AGG_OPTIONS.has(opt[1].toLowerCase())) continue;
    const m = /^([A-Za-z_][A-Za-z0-9_]*)(?:\(([\s\S]*)\))?$/.exec(p);
    if (!m) {
      out.push({ fn: p, arg: '', raw: p });
      continue;
    }
    out.push({ fn: m[1].toLowerCase(), arg: (m[2] ?? '').trim(), raw: p });
  }
  return out;
}

/** Splunk's default output field name for an aggregation. */
function splDefaultName(a: Agg): string {
  if (a.fn === 'count' && !a.arg) return 'count';
  return `${a.fn}(${a.arg})`;
}

function aggArg(a: Agg, ctx: Ctx): string {
  const arg = a.arg.trim();
  const ev = /^eval\(([\s\S]*)\)$/i.exec(arg);
  if (ev) return translateExpr(ev[1], ctx);
  if (arg.includes('*')) ctx.note('error', `Wildcard field "${arg}" in ${a.fn}() is not supported by Cribl Search aggregations; list the fields explicitly.`);
  return fieldRef(unquote(arg), ctx);
}

/** Translate one aggregation to `name = fn(...)`, registering the name alias. */
export function aggToKql(a: Agg, ctx: Ctx): { kql: string; name: string } {
  const fn = a.fn;
  const isEval = /^eval\(/i.test(a.arg.trim());
  const arg = a.arg ? aggArg(a, ctx) : '';
  let expr: string;
  const pm = /^(?:p|perc|exactperc|upperperc)(\d+(?:\.\d+)?)$/.exec(fn);
  if (pm) expr = `percentile(${arg}, ${pm[1]})`;
  else
    switch (fn) {
      case 'count':
      case 'c':
        expr = !a.arg ? 'count()' : isEval ? `countif(${arg})` : `count(${arg})`;
        break;
      case 'dc':
      case 'distinct_count':
      case 'estdc':
        expr = `dcount(${arg})`;
        break;
      case 'sum':
        expr = `sum(${arg})`;
        break;
      case 'avg':
      case 'mean':
        expr = `avg(${arg})`;
        break;
      case 'min':
        expr = `min(${arg})`;
        break;
      case 'max':
        expr = `max(${arg})`;
        break;
      case 'median':
        expr = `median(${arg})`;
        break;
      case 'mode':
        ctx.note('error', 'mode() has no Cribl Search aggregation; consider `summarize count() by field | top 1 by count_`.');
        expr = `/* mode */ take_any(${arg})`;
        break;
      case 'stdev':
        expr = `stdev(${arg})`;
        break;
      case 'stdevp':
        expr = `stdevp(${arg})`;
        break;
      case 'var':
        expr = `variance(${arg})`;
        break;
      case 'varp':
        expr = `variancep(${arg})`;
        break;
      case 'values':
        expr = `values(${arg})`;
        break;
      case 'list':
        expr = `list(${arg}, 0)`;
        break;
      case 'first':
        expr = `findlatest(${arg})`;
        ctx.note('info', `first(${a.arg}) is the most recent value in Splunk (events arrive newest-first); emitted as findlatest(), which is order-independent.`);
        break;
      case 'last':
        expr = `findearliest(${arg})`;
        ctx.note('info', `last(${a.arg}) is the oldest value in Splunk (events arrive newest-first); emitted as findearliest(), which is order-independent.`);
        break;
      case 'earliest':
        expr = `findearliest(${arg})`;
        break;
      case 'latest':
        expr = `findlatest(${arg})`;
        break;
      case 'earliest_time':
        expr = 'min(_time)';
        ctx.note('info', `earliest_time(${a.arg}) was approximated as min(_time) of the group.`);
        break;
      case 'latest_time':
        expr = 'max(_time)';
        ctx.note('info', `latest_time(${a.arg}) was approximated as max(_time) of the group.`);
        break;
      case 'range':
        expr = `max(${arg}) - min(${arg})`;
        break;
      case 'sumsq':
        expr = `sumsq(${arg})`;
        break;
      case 'per_second':
        expr = `persecond(${arg})`;
        break;
      case 'per_minute':
        expr = `persecond(${arg}) * 60`;
        break;
      case 'per_hour':
        expr = `persecond(${arg}) * 3600`;
        break;
      case 'per_day':
        expr = `persecond(${arg}) * 86400`;
        break;
      case 'rate':
        expr = `persecond(${arg})`;
        ctx.note('warning', 'rate() was approximated with persecond(); Splunk rate() divides the value delta by the time delta.');
        break;
      case 'estdc_error':
      case 'exactperc':
        ctx.note('error', `${fn}() has no Cribl Search equivalent.`);
        expr = `/* ${fn} */ null`;
        break;
      default:
        ctx.note('error', `Unknown aggregation function ${fn}(); emitted unchanged.`);
        expr = `${fn}(${arg})`;
    }
  const splName = a.alias ?? splDefaultName(a);
  let name = a.alias ?? (fn === 'count' && !a.arg ? 'count' : sanitizeName(`${fn}_${a.arg}`));
  if (!a.alias && splName !== name) ctx.fieldAliases.set(splName, name);
  name = fieldRef(name, ctx);
  return { kql: `${name} = ${expr}`, name };
}

function byFields(by: string | null, ctx: Ctx): string[] {
  if (!by) return [];
  return words(by)
    .filter((w) => !/^[A-Za-z_]+=/.test(w) || !AGG_OPTIONS.has(w.split('=')[0].toLowerCase()))
    .map((w) => {
      if (w.includes('*')) ctx.note('error', `Wildcard group-by field "${w}" is not supported in Cribl Search; list fields explicitly.`);
      return fieldRef(unquote(w), ctx);
    });
}

function statsLike(op: 'summarize' | 'eventstats'): Handler {
  return (args, ctx) => {
    const { head, tail } = splitKeyword(args, 'by');
    const aggs = parseAggList(head).map((a) => aggToKql(a, ctx));
    const by = byFields(tail, ctx);
    if (aggs.length === 0 && by.length === 0) {
      ctx.note('error', `${ctx.command} has no aggregation functions.`);
      return { kql: [todo(`${ctx.command} ${args}`, ctx.command)], unsupported: true };
    }
    const kql = `${op} ${aggs.map((a) => a.kql).join(', ')}${by.length ? ` by ${by.join(', ')}` : ''}`.replace(/\s+by/, ' by');
    const out: string[] = [];
    if (op === 'summarize' && by.length) {
      // Splunk drops events whose group-by field is missing; Cribl keeps them in a null group.
      out.push(`where ${by.map((b) => `isnotnull(${b})`).join(' and ')}`);
      ctx.note('info', 'Splunk stats drops events where a by-field is missing; a where isnotnull() stage was added to match. Remove it if the fields are always present.');
    }
    out.push(kql.trim());
    return { kql: out };
  };
}

/* ------------------------------------------------------------------ */
/* Handlers                                                            */
/* ------------------------------------------------------------------ */

const search: Handler = (args, ctx, env) => {
  if (env.first) return { kql: buildScope(args, ctx) };
  const ast = parseSearch(args);
  const { datasets, rest } = extractScope(ast, ctx);
  if (datasets.length) ctx.note('warning', 'index= in a mid-pipeline search was ignored; datasets are scoped only in the first stage.');
  if (isEmptyPredicate(rest)) return { kql: [] };
  return { kql: [`where ${renderWhere(rest, ctx)}`] };
};

const where: Handler = (args, ctx) => ({ kql: [`where ${translateExpr(args, ctx)}`] });

const evalCmd: Handler = (args, ctx) => {
  const assigns = splitTopLevel(args, ',')
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const a of assigns) {
    const m = /^\s*('[^']*'|"[^"]*"|[^=\s]+)\s*=(?!=)([\s\S]*)$/.exec(a);
    if (!m) {
      ctx.note('error', `Could not parse eval assignment "${a}".`);
      continue;
    }
    const name = fieldRef(unquote(m[1]), ctx);
    out.push(`${name} = ${translateExpr(m[2], ctx)}`);
  }
  if (!out.length) return { kql: [todo(`eval ${args}`, 'eval')], unsupported: true };
  return { kql: [`extend ${out.join(', ')}`] };
};

const fields: Handler = (args, ctx) => {
  let rest = args.trim();
  let remove = false;
  if (rest.startsWith('-')) {
    remove = true;
    rest = rest.slice(1);
  } else if (rest.startsWith('+')) rest = rest.slice(1);
  const list = fieldList(rest, ctx);
  if (!list.length) return { kql: [] };
  if (remove) return { kql: [`project-away ${list.join(', ')}`] };
  ctx.note('info', 'project keeps only the listed fields (Splunk fields also keeps _time and _raw); add _time if you need it.');
  return { kql: [`project ${list.join(', ')}`] };
};

const table: Handler = (args, ctx) => {
  const list = fieldList(args, ctx);
  return list.length ? { kql: [`project ${list.join(', ')}`] } : { kql: [] };
};

const rename: Handler = (args, ctx) => {
  const ws = words(args);
  const pairs: string[] = [];
  for (let i = 0; i < ws.length; i++) {
    const src = unquote(ws[i]);
    const as = ws[i + 1];
    const dst = ws[i + 2] !== undefined ? unquote(ws[i + 2]) : undefined;
    if (as && as.toLowerCase() === 'as' && dst !== undefined) {
      if (src.includes('*') || dst.includes('*')) {
        ctx.note('error', `Wildcard rename "${src} AS ${dst}" is not supported in Cribl Search; rename fields individually.`);
      } else {
        pairs.push(`${fieldRef(dst, ctx)} = ${fieldRef(src, ctx)}`);
        ctx.fieldAliases.delete(dst);
      }
      i += 2;
    }
  }
  if (!pairs.length) return { kql: [todo(`rename ${args}`, 'rename')], unsupported: true };
  return { kql: [`project-rename ${pairs.join(', ')}`] };
};

const sort: Handler = (args, ctx) => {
  let limit = 0;
  const specs: string[] = [];
  let globalDesc = false;
  const ws = words(args);
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i];
    const lim = /^limit=(\d+)$/i.exec(w);
    if (lim) {
      limit = parseInt(lim[1], 10);
      continue;
    }
    if (/^\d+$/.test(w) && specs.length === 0 && i === 0) {
      limit = parseInt(w, 10);
      continue;
    }
    if (/^(desc|d)$/i.test(w) && i === ws.length - 1) {
      globalDesc = true;
      continue;
    }
    let v = w;
    let dir = 'asc';
    if (v.startsWith('-')) {
      dir = 'desc';
      v = v.slice(1);
    } else if (v.startsWith('+')) v = v.slice(1);
    // sort -ip(field) / num(field) / str(field) / auto(field)
    const wrapped = /^(ip|num|str|auto)\((.*)\)$/i.exec(v);
    if (wrapped) v = wrapped[2];
    if (!v) continue;
    specs.push(`${fieldRef(unquote(v), ctx)} ${dir}`);
  }
  if (globalDesc) {
    for (let i = 0; i < specs.length; i++) specs[i] = specs[i].endsWith(' asc') ? specs[i].replace(/ asc$/, ' desc') : specs[i].replace(/ desc$/, ' asc');
  }
  const kql: string[] = [];
  if (specs.length) kql.push(`order by ${specs.join(', ')}`);
  if (limit > 0) kql.push(`limit ${limit}`);
  return { kql };
};

const head: Handler = (args, ctx) => {
  const p = parseArgs(args, { optionKeys: new Set(['limit', 'null', 'keeplast']) });
  let n = p.opts.limit ? parseInt(p.opts.limit, 10) : 10;
  const pos = p.positional.filter((t) => t.t !== 'op');
  if (pos.length === 1 && pos[0].t === 'word' && /^\d+$/.test(pos[0].v)) n = parseInt(pos[0].v, 10);
  else if (pos.length) {
    ctx.note('error', `head with a condition ("${args.trim()}") is not supported; Cribl Search limit takes a count. Emitted limit ${n} plus the condition as a where.`);
    return { kql: [`where ${translateExpr(args, ctx)}`, `limit ${n}`] };
  }
  return { kql: [`limit ${n}`] };
};

const tail: Handler = (args, ctx) => {
  const m = /^\s*(\d+)?/.exec(args);
  const n = m && m[1] ? parseInt(m[1], 10) : 10;
  ctx.note('info', 'tail returns the last N events; emitted as an ascending time sort followed by limit.');
  return { kql: ['order by _time asc', `limit ${n}`] };
};

const reverse: Handler = (_args, ctx) => {
  ctx.note('warning', 'reverse has no direct equivalent; add `| order by <field> asc` with the opposite direction of the previous sort.');
  return { kql: [] };
};

const topRare = (rare: boolean): Handler => (args, ctx) => {
  const p = parseArgs(args, { optionKeys: new Set(['limit', 'countfield', 'percentfield', 'showcount', 'showperc', 'useother', 'otherstr']) });
  const cf = fieldRef(p.opts.countfield ?? 'count', ctx);
  const pf = fieldRef(p.opts.percentfield ?? 'percent', ctx);
  const showPerc = !/^(f|false|0|no)$/i.test(p.opts.showperc ?? 't');
  let n = p.opts.limit ? parseInt(p.opts.limit, 10) : 10;
  const toks = p.positional.filter((t) => t.t !== 'op');
  const fieldsSpl: string[] = [];
  const bySpl: string[] = [];
  let inBy = false;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (i === 0 && t.t === 'word' && /^\d+$/.test(t.v)) {
      n = parseInt(t.v, 10);
      continue;
    }
    if (t.t === 'word' && t.v.toLowerCase() === 'by') {
      inBy = true;
      continue;
    }
    (inBy ? bySpl : fieldsSpl).push(unquote(t.v));
  }
  if (!fieldsSpl.length) return { kql: [todo(`${ctx.command} ${args}`, ctx.command)], unsupported: true };
  const f = fieldsSpl.map((x) => fieldRef(x, ctx));
  const by = bySpl.map((x) => fieldRef(x, ctx));
  if (p.opts.useother && /^(t|true|1|yes)$/i.test(p.opts.useother)) ctx.note('warning', 'useother=t is not supported; the OTHER bucket was not added.');
  const dir = rare ? 'asc' : 'desc';
  const kql: string[] = [`summarize ${cf} = count() by ${[...by, ...f].join(', ')}`];
  if (showPerc) {
    kql.push(`eventstats __total = sum(${cf})${by.length ? ` by ${by.join(', ')}` : ''}`);
    kql.push(`extend ${pf} = round(100.0 * ${cf} / __total, 2)`);
    kql.push('project-away __total');
  }
  if (by.length) {
    kql.push(`order by ${by.map((b) => `${b} asc`).join(', ')}, ${cf} ${dir}`);
    const restart = by.map((b) => `${b} != prev(${b})`).join(' or ');
    kql.push(`extend __rank = row_number(1, ${restart})`);
    kql.push(`where __rank <= ${n}`);
    kql.push('project-away __rank');
    ctx.note('info', `${ctx.command} ... by: emitted a per-group rank with row_number() so each group keeps its ${rare ? 'least' : 'most'} common ${n} value(s).`);
  } else {
    kql.push(`order by ${cf} ${dir}`);
    kql.push(`limit ${n}`);
  }
  return { kql };
};

const stats = statsLike('summarize');
const eventstats = statsLike('eventstats');

const streamstats: Handler = (args, ctx) => {
  const p = parseArgs(args, { optionKeys: new Set(['current', 'window', 'global', 'reset_on_change', 'reset_before', 'reset_after', 'allnum']) });
  const { head: h, tail: byRaw } = splitKeyword(args, 'by');
  const by = byFields(byRaw, ctx);
  const restart = by.length ? `, ${by.map((b) => `${b} != prev(${b})`).join(' or ')}` : '';
  const currentFalse = /^(f|false|0)$/i.test(p.opts.current ?? 't');
  if (p.opts.window) ctx.note('error', `streamstats window=${p.opts.window} (sliding windows) is not supported; the emitted expressions are cumulative.`);
  const aggs = parseAggList(h);
  const out: string[] = [];
  for (const a of aggs) {
    const name = fieldRef(a.alias ?? splDefaultName(a), ctx);
    if (!a.alias) ctx.fieldAliases.set(splDefaultName(a), sanitizeName(a.alias ?? (a.fn === 'count' && !a.arg ? 'count' : `${a.fn}_${a.arg}`)));
    const nm = a.alias ? name : fieldRef(sanitizeName(a.fn === 'count' && !a.arg ? 'count' : `${a.fn}_${a.arg}`), ctx);
    const arg = a.arg ? fieldRef(unquote(a.arg), ctx) : '';
    switch (a.fn) {
      case 'count':
      case 'c':
        out.push(`${nm} = row_number(1${restart})`);
        break;
      case 'sum':
        out.push(`${nm} = row_cumsum(${arg}${restart})`);
        break;
      case 'last':
        if (currentFalse) out.push(`${nm} = prev(${arg})`);
        else out.push(`${nm} = ${arg}`);
        break;
      case 'first':
        ctx.note('error', `streamstats first(${a.arg}) is not supported (no running-first window function).`);
        break;
      default:
        ctx.note('error', `streamstats ${a.fn}() is not supported; only count, sum and last (current=f) map to Cribl window functions.`);
    }
  }
  if (!out.length) return { kql: [todo(`streamstats ${args}`, 'streamstats')], unsupported: true };
  // Splunk streams events newest-first; group restarts require the by-fields to be contiguous.
  const order = [...by.map((b) => `${b} asc`), '_time desc'];
  ctx.note('info', `Splunk streamstats runs over events newest-first${by.length ? ' and accumulates per group' : ''}; an order by stage was added to reproduce that. Flip _time to asc for chronological running totals.`);
  return { kql: [`order by ${order.join(', ')}`, `extend ${out.join(', ')}`] };
};

const TIMECHART_OPTS = new Set(['span', 'bins', 'limit', 'useother', 'usenull', 'partial', 'cont', 'fixedrange', 'sep', 'format', 'minspan', 'otherstr', 'nullstr', 'agg']);

const timechart: Handler = (args, ctx) => {
  const p = parseArgs(args, { optionKeys: TIMECHART_OPTS });
  const { head: h, tail: byRaw } = splitKeyword(args, 'by');
  const aggSrc = words(h).filter((w) => !(/^([A-Za-z_]+)=/.test(w) && TIMECHART_OPTS.has(w.split('=')[0].toLowerCase()))).join(' ');
  const aggs = parseAggList(aggSrc).map((a) => aggToKql(a, ctx));
  if (!aggs.length) aggs.push(aggToKql({ fn: 'count', arg: '', raw: 'count' }, ctx));
  const by = byFields(byRaw ? words(byRaw).filter((w) => !/^(limit|useother|usenull|otherstr|nullstr)=/i.test(w)).join(' ') : null, ctx);
  let spanKql = '';
  if (p.opts.span) {
    const sp = parseSpan(p.opts.span.replace(/@.*$/, ''));
    if (sp) {
      spanKql = `span=${spanToTimestats(sp, p.opts.span.includes('@') ? p.opts.span.split('@')[1] : undefined)} `;
      ctx.note('info', 'The @ suffix on span aligns buckets to the clock like Splunk; without it Cribl aligns buckets to the start of the search range.');
    } else ctx.note('warning', `Could not parse span=${p.opts.span}; timestats will auto-select a span.`);
  } else if (p.opts.bins) spanKql = `numBins=${parseInt(p.opts.bins, 10)} `;
  if (p.opts.limit || p.opts.useother) ctx.note('warning', 'timechart limit=/useother= (top-N series with OTHER) is not supported; all series are returned.');
  const kql = [`timestats ${spanKql}${aggs.map((a) => a.kql).join(', ')}${by.length ? ` by ${by.join(', ')}` : ''}`];
  if (by.length) ctx.note('info', 'timestats with a by-field returns one column per series, like Splunk timechart. Empty time buckets are omitted rather than zero-filled.');
  else ctx.note('info', 'timestats omits empty time buckets; Splunk timechart zero-fills them.');
  return { kql };
};

const chart: Handler = (args, ctx) => {
  const p = parseArgs(args, { optionKeys: new Set(['span', 'bins', 'limit', 'useother', 'usenull', 'otherstr', 'nullstr', 'sep', 'format', 'cont', 'agg']) });
  const { head: beforeBy, tail: byRaw } = splitKeyword(args, 'by');
  const { head: aggPart, tail: overRaw } = splitKeyword(beforeBy, 'over');
  const aggSrc = words(aggPart).filter((w) => !/^(span|bins|limit|useother|usenull|otherstr|nullstr|sep|format|cont)=/i.test(w)).join(' ');
  const aggs = parseAggList(aggSrc).map((a) => aggToKql(a, ctx));
  if (!aggs.length) return { kql: [todo(`chart ${args}`, 'chart')], unsupported: true };
  const byList = byRaw ? words(byRaw).filter((w) => !/^[A-Za-z_]+=/.test(w)) : [];
  let rowField = overRaw ? words(overRaw)[0] : undefined;
  let colField: string | undefined;
  if (rowField) colField = byList[0];
  else if (byList.length >= 2) [rowField, colField] = byList;
  else rowField = byList[0];
  if (p.opts.limit || p.opts.useother) ctx.note('warning', 'chart limit=/useother= is not supported; all column values are returned.');
  if (rowField && rowField.toLowerCase() === '_time') {
    const sp = p.opts.span ? parseSpan(p.opts.span) : null;
    const span = sp ? `span=${spanToTimestats(sp)} ` : p.opts.bins ? `numBins=${p.opts.bins} ` : '';
    const col = colField ? fieldRef(colField, ctx) : undefined;
    return { kql: [`timestats ${span}${aggs.map((a) => a.kql).join(', ')}${col ? ` by ${col}` : ''}`] };
  }
  const groups = [rowField, colField].filter((x): x is string => !!x).map((x) => fieldRef(x, ctx));
  const kql = [`summarize ${aggs.map((a) => a.kql).join(', ')}${groups.length ? ` by ${groups.join(', ')}` : ''}`];
  if (rowField && colField) {
    if (aggs.length === 1) kql.push(`pivot ${aggs[0].name} over ${fieldRef(colField, ctx)} by ${fieldRef(rowField, ctx)}`);
    else ctx.note('warning', 'chart with several aggregations and a split-by field: pivot supports one data field per stage; add `| pivot <field> over <col> by <row>` manually.');
  }
  return { kql };
};

const binCmd: Handler = (args, ctx) => {
  const p = parseArgs(args, { optionKeys: new Set(['span', 'bins', 'minspan', 'start', 'end', 'aligntime']) });
  const toks = p.positional.filter((t) => t.t !== 'op');
  const field = toks[0] ? unquote(toks[0].v) : '_time';
  let out = field;
  if (toks[1] && toks[1].t === 'word' && toks[1].v.toLowerCase() === 'as' && toks[2]) out = unquote(toks[2].v);
  const f = fieldRef(field, ctx);
  const o = fieldRef(out, ctx);
  if (p.opts.span) {
    const raw = p.opts.span;
    if (/^log/i.test(raw)) {
      ctx.note('error', `Logarithmic span (${raw}) is not supported by bin().`);
      return { kql: [todo(`bin ${args}`, 'bin')], unsupported: true };
    }
    const isTimeField = /^_time$|time/i.test(field);
    const sp = parseSpan(raw.replace(/@.*$/, ''));
    if (!sp || (!isTimeField && /^\d+(\.\d+)?$/.test(raw))) {
      const n = Number(raw);
      if (Number.isFinite(n)) {
        if (!isTimeField) ctx.note('info', 'Splunk labels numeric bins as ranges ("0-10000"); Cribl bin() returns the lower bound.');
        return { kql: [`extend ${o} = bin(${f}, ${n})`] };
      }
      ctx.note('error', `Could not parse span=${raw}.`);
      return { kql: [todo(`bin ${args}`, 'bin')], unsupported: true };
    }
    const ts = spanToTimespan(sp);
    if (ts.note) ctx.note('warning', ts.note);
    if (raw.includes('@')) ctx.note('warning', `Snap-to (${raw}) is not supported by bin(); bins are aligned to the epoch.`);
    return { kql: [`extend ${o} = bin(${f}, ${ts.literal})`] };
  }
  if (p.opts.bins) {
    if (field === '_time') {
      ctx.note('info', `bins=${p.opts.bins} mapped to bin_auto(), which picks a span from the search time range.`);
      return { kql: [`extend ${o} = bin_auto(${f})`] };
    }
    ctx.note('error', 'bins=N on a non-time field has no equivalent; use span=.');
    return { kql: [todo(`bin ${args}`, 'bin')], unsupported: true };
  }
  return { kql: [`extend ${o} = bin_auto(${f})`] };
};

const dedup: Handler = (args, ctx) => {
  const { head: h, tail: sortby } = splitKeyword(args, 'sortby');
  const p = parseArgs(h, { optionKeys: new Set(['keepevents', 'keepempty', 'consecutive']) });
  const toks = p.positional.filter((t) => t.t !== 'op');
  let n = 1;
  const fieldsSpl: string[] = [];
  toks.forEach((t, i) => {
    if (i === 0 && t.t === 'word' && /^\d+$/.test(t.v)) n = parseInt(t.v, 10);
    else fieldsSpl.push(unquote(t.v));
  });
  if (!fieldsSpl.length) return { kql: [todo(`dedup ${args}`, 'dedup')], unsupported: true };
  const kql: string[] = [];
  if (sortby) {
    const specs = words(sortby).map((w) => {
      const desc = w.startsWith('-');
      const name = w.replace(/^[+-]/, '').replace(/^(ip|num|str|auto)\((.*)\)$/, '$2');
      return `${fieldRef(unquote(name), ctx)} ${desc ? 'desc' : 'asc'}`;
    });
    kql.push(`order by ${specs.join(', ')}`);
  }
  if (/^(t|true|1)$/i.test(p.opts.keepevents ?? '')) ctx.note('warning', 'dedup keepevents=t is not supported; duplicate events are removed.');
  kql.push(`dedup ${n > 1 ? `num_duplicates=${n} ` : ''}by ${fieldsSpl.map((f) => fieldRef(f, ctx)).join(', ')}`);
  ctx.note('warning', 'Cribl dedup only suppresses duplicates within a time window (default 30s). Add `time_window=<seconds>` covering your search range for Splunk-style global dedup.');
  return { kql };
};

/** Index of each named capture group (1-based, counting all capturing groups). */
function namedGroups(re: string): { name: string; index: number }[] {
  const out: { name: string; index: number }[] = [];
  let idx = 0;
  for (let i = 0; i < re.length; i++) {
    const c = re[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '[') {
      // skip character class
      i++;
      while (i < re.length && re[i] !== ']') {
        if (re[i] === '\\') i++;
        i++;
      }
      continue;
    }
    if (c === '(') {
      if (re[i + 1] === '?') {
        const m = /^\(\?P?<([A-Za-z_][A-Za-z0-9_]*)>/.exec(re.slice(i));
        if (m) {
          idx++;
          out.push({ name: m[1], index: idx });
        }
        // (?:...), (?=...), (?!...), (?i) etc. are non-capturing
      } else idx++;
    }
  }
  return out;
}

const rex: Handler = (args, ctx) => {
  const p = parseArgs(args, { optionKeys: new Set(['field', 'max_match', 'offset_field', 'mode']) });
  const src = fieldRef(p.opts.field ?? '_raw', ctx);
  const reTok = p.positional.find((t) => t.t === 'str');
  if (!reTok) return { kql: [todo(`rex ${args}`, 'rex')], unsupported: true };
  const re = reTok.v;
  if (p.opts.mode && p.opts.mode.toLowerCase() === 'sed') {
    const m = /^([sy])(.)([\s\S]*?)\2([\s\S]*?)\2([gi\d]*)$/.exec(re);
    if (!m) {
      ctx.note('error', `Could not parse sed expression "${re}".`);
      return { kql: [todo(`rex ${args}`, 'rex')], unsupported: true };
    }
    if (m[1] === 'y') return { kql: [`extend ${src} = translate(${kqlString(m[3])}, ${kqlString(m[4])}, ${src})`] };
    const flags = m[5];
    if (!flags.includes('g')) ctx.note('warning', 'sed without the g flag replaces only the first match in Splunk; replace_regex replaces all matches.');
    const pattern = (flags.includes('i') ? '(?i)' : '') + m[3];
    const repl = m[4].replace(/&/g, '\\0');
    return { kql: [`extend ${src} = replace_regex(${src}, ${kqlVerbatim(pattern)}, ${kqlVerbatim(repl)})`] };
  }
  const groups = namedGroups(re);
  if (!groups.length) {
    ctx.note('error', 'rex has no named capture groups (?<name>...), so there is nothing to extract.');
    return { kql: [todo(`rex ${args}`, 'rex')], unsupported: true };
  }
  if (/\(\?<[=!]|\(\?[=!]/.test(re)) ctx.note('warning', 'The regex uses lookaround, which RE2 (used by extract()) does not support.');
  const cleaned = re.replace(/\(\?P</g, '(?<');
  const maxMatch = p.opts.max_match ? parseInt(p.opts.max_match, 10) : 1;
  if (maxMatch !== 1) {
    ctx.note('warning', `max_match=${p.opts.max_match}: extract_all() returns all matches as an array of capture arrays; index into it as needed.`);
    const out = groups.length === 1 ? fieldRef(groups[0].name, ctx) : fieldRef(sanitizeName(groups.map((g) => g.name).join('_')), ctx);
    return { kql: [`extend ${out} = extract_all(${kqlVerbatim(cleaned)}, ${src})`] };
  }
  const parts = groups.map((g) => `${fieldRef(g.name, ctx)} = extract(${kqlVerbatim(cleaned)}, ${g.index}, ${src})`);
  // extract() yields "" when the regex does not match; Splunk rex leaves the field unset.
  const nulls = groups.map((g) => `${fieldRef(g.name, ctx)} = iff(isempty(${fieldRef(g.name, ctx)}), null, ${fieldRef(g.name, ctx)})`);
  ctx.note('info', 'extract() returns an empty string when the regex does not match; a second extend converts those to null so later stats/where behave like Splunk.');
  return { kql: [`extend ${parts.join(', ')}`, `extend ${nulls.join(', ')}`] };
};

const regexCmd: Handler = (args, ctx) => {
  const toks = tokenize(args, 'args');
  let field = '_raw';
  let negate = false;
  let re: string | null = null;
  if (toks.length >= 3 && toks[0].t === 'word' && toks[1].t === 'op' && (toks[1].v === '=' || toks[1].v === '!=')) {
    field = toks[0].v;
    negate = toks[1].v === '!=';
    re = toks[2].v;
  } else if (toks[0]) re = toks[0].v;
  if (re === null) return { kql: [todo(`regex ${args}`, 'regex')], unsupported: true };
  const pred = `${fieldRef(field, ctx)} matches regex ${kqlRegexLiteral(re)}`;
  return { kql: [`where ${negate ? `not(${pred})` : pred}`] };
};

function checkLookup(name: string, ctx: Ctx) {
  const base = name.replace(/\.csv$/i, '');
  ctx.lookups.add(base);
  if (ctx.opts.knownLookups) {
    const ok = ctx.opts.knownLookups.some((k) => k === name || k === base || k === `${base}.csv` || k.replace(/\.csv$/i, '') === base);
    if (!ok) ctx.note('warning', `Lookup "${name}" was not found in Cribl Search. Upload it (Search → Lookups) or pick the matching lookup file.`);
  }
  return base;
}

const lookup: Handler = (args, ctx) => {
  const p = parseArgs(args, { optionKeys: new Set(['local', 'update']) });
  const toks = p.positional.filter((t) => t.t !== 'op');
  if (!toks.length) return { kql: [todo(`lookup ${args}`, 'lookup')], unsupported: true };
  const table = checkLookup(unquote(toks[0].v), ctx);
  const conds: string[] = [];
  const outputs: string[] = [];
  const renames: string[] = [];
  let mode: 'in' | 'out' = 'in';
  let outputNew = false;
  for (let i = 1; i < toks.length; i++) {
    const t = toks[i];
    const lw = t.v.toLowerCase();
    if (lw === 'output' || lw === 'outputnew') {
      mode = 'out';
      outputNew = lw === 'outputnew';
      continue;
    }
    let lf = unquote(t.v);
    let ef = lf;
    if (toks[i + 1] && toks[i + 1].v.toLowerCase() === 'as' && toks[i + 2]) {
      ef = unquote(toks[i + 2].v);
      i += 2;
    }
    if (mode === 'in') conds.push(ef === lf ? fieldRef(lf, ctx) : `${fieldRef(ef, ctx)}=${lf}`);
    else {
      outputs.push(lf);
      if (ef !== lf) renames.push(`${fieldRef(ef, ctx)} = ${fieldRef(lf, ctx)}`);
    }
  }
  if (!conds.length) {
    ctx.note('error', 'lookup needs at least one match field.');
    return { kql: [todo(`lookup ${args}`, 'lookup')], unsupported: true };
  }
  if (outputNew) ctx.note('warning', 'OUTPUTNEW (do not overwrite existing fields) is not supported; lookup fields overwrite existing values.');
  const kql = [`lookup ${outputs.length ? `output=${kqlString(outputs.join(','))} ` : ''}${table} on ${conds.join(', ')}`];
  if (renames.length) {
    kql.push(`project-rename ${renames.join(', ')}`);
    ctx.note('info', 'OUTPUT ... AS renames were emitted as a project-rename after the lookup.');
  }
  return { kql };
};

const inputlookup: Handler = (args, ctx, env) => {
  const { head: h, tail: whereRaw } = splitKeyword(args, 'where');
  const p = parseArgs(h, { optionKeys: new Set(['append', 'start', 'max', 'strict']) });
  const t = p.positional.find((x) => x.t !== 'op');
  if (!t) return { kql: [todo(`inputlookup ${args}`, 'inputlookup')], unsupported: true };
  const table = checkLookup(unquote(t.v), ctx);
  if (!env.first || /^(t|true|1)$/i.test(p.opts.append ?? '')) {
    ctx.note('error', 'inputlookup append=t (mid-pipeline) has no direct equivalent; use `| union (cribl dataset="$vt_lookups" lookupFile="...")`.');
    return { kql: [`union (cribl dataset="$vt_lookups" lookupFile=${kqlString(table)})`] };
  }
  const kql = [`${ctx.inSubsearch ? 'cribl ' : ''}dataset="$vt_lookups" lookupFile=${kqlString(table)}`];
  if (whereRaw) kql.push(`where ${renderWhere(parseSearch(whereRaw), ctx)}`);
  if (p.opts.max) kql.push(`limit ${parseInt(p.opts.max, 10)}`);
  return { kql };
};

const outputlookup: Handler = (args, ctx) => {
  const p = parseArgs(args, { optionKeys: new Set(['append', 'create_empty', 'override_if_empty', 'max', 'key_field', 'createinapp', 'create_context', 'output_format']) });
  const t = p.positional.find((x) => x.t !== 'op');
  if (!t) return { kql: [todo(`outputlookup ${args}`, 'outputlookup')], unsupported: true };
  const table = unquote(t.v).replace(/\.csv$/i, '');
  ctx.lookups.add(table);
  const append = /^(t|true|1)$/i.test(p.opts.append ?? '');
  ctx.note('warning', `export to lookup ${append ? 'appends to' : 'replaces'} the lookup "${table}.csv" in Cribl Search when the query runs.`);
  return { kql: [`export ${append ? 'mode=append ' : ''}to lookup ${/^[A-Za-z0-9_-]+$/.test(table) ? table : kqlString(table)}`] };
};

const iplocation: Handler = (args, ctx) => {
  const p = parseArgs(args, { optionKeys: new Set(['prefix', 'allfields', 'lang']) });
  const t = p.positional.find((x) => x.t !== 'op');
  if (!t) return { kql: [todo(`iplocation ${args}`, 'iplocation')], unsupported: true };
  const opts = [p.opts.prefix ? `prefix=${kqlString(p.opts.prefix)}` : '', p.opts.lang ? `lang=${kqlString(p.opts.lang)}` : ''].filter(Boolean).join(' ');
  ctx.note('warning', 'iplocation requires a GeoIP .mmdb lookup in Cribl Search; "geocity" is a placeholder — replace it with your uploaded database name (without .mmdb).');
  return { kql: [`ip-lookup ${opts ? opts + ' ' : ''}geocity on ${fieldRef(unquote(t.v), ctx)}`] };
};

const fillnull: Handler = (args, ctx) => {
  const p = parseArgs(args, { optionKeys: new Set(['value', 'field_list']) });
  const value = p.opts.value !== undefined ? (p.optToks.value?.t === 'str' || !/^-?\d+(\.\d+)?$/.test(p.opts.value) ? kqlString(p.opts.value) : p.opts.value) : '0';
  const flds = p.positional.filter((x) => x.t !== 'op').map((x) => fieldRef(unquote(x.v), ctx));
  if (!flds.length) {
    ctx.note('error', 'fillnull without a field list cannot be translated (Cribl Search needs explicit fields); list the fields to fill.');
    return { kql: [todo(`fillnull ${args}`, 'fillnull')], unsupported: true };
  }
  ctx.note('info', 'coalesce() also replaces empty strings, whereas Splunk fillnull only fills missing fields.');
  return { kql: [`extend ${flds.map((f) => `${f} = coalesce(${f}, ${value})`).join(', ')}`] };
};

const makemv: Handler = (args, ctx) => {
  const p = parseArgs(args, { optionKeys: new Set(['delim', 'tokenizer', 'allowempty', 'setsv']) });
  const t = p.positional.find((x) => x.t !== 'op');
  if (!t) return { kql: [todo(`makemv ${args}`, 'makemv')], unsupported: true };
  const f = fieldRef(unquote(t.v), ctx);
  if (p.opts.tokenizer) {
    ctx.note('warning', 'makemv tokenizer= was emitted with extract_all(); the result is an array of capture-group arrays.');
    return { kql: [`extend ${f} = extract_all(${kqlVerbatim(p.opts.tokenizer)}, ${f})`] };
  }
  return { kql: [`extend ${f} = split(${f}, ${kqlString(p.opts.delim ?? ' ')})`] };
};

const mvexpand: Handler = (args, ctx) => {
  const p = parseArgs(args, { optionKeys: new Set(['limit']) });
  const t = p.positional.find((x) => x.t !== 'op');
  if (!t) return { kql: [todo(`mvexpand ${args}`, 'mvexpand')], unsupported: true };
  return { kql: [`mv-expand ${fieldRef(unquote(t.v), ctx)}${p.opts.limit ? ` limit ${parseInt(p.opts.limit, 10)}` : ''}`] };
};

const spath: Handler = (args, ctx) => {
  const p = parseArgs(args, { optionKeys: new Set(['input', 'output', 'path']) });
  const pos = p.positional.find((x) => x.t !== 'op');
  const path = p.opts.path ?? (pos ? unquote(pos.v) : undefined);
  const input = fieldRef(p.opts.input ?? '_raw', ctx);
  if (!path) {
    ctx.note('info', 'spath without a path extracts all JSON fields; Cribl Search parses JSON automatically, so nothing was emitted.');
    return { kql: [] };
  }
  const out = fieldRef(p.opts.output ?? path, ctx);
  let jp = path.replace(/\{(\d+)\}/g, '[$1]').replace(/\{\}/g, '[*]');
  if (!jp.startsWith('$')) jp = '$.' + jp;
  return { kql: [`extend ${out} = extract_json(${kqlString(jp)}, ${input})`] };
};

const convert: Handler = (args, ctx) => {
  const p = parseArgs(args, { optionKeys: new Set(['timeformat']) });
  const fmt = p.opts.timeformat ?? '%m/%d/%Y %H:%M:%S';
  const out: string[] = [];
  // Each item looks like fn(field) [AS out]; match on the raw words instead of tokens.
  const items = [...words(args).join(' ').matchAll(/([A-Za-z_]+)\(([^)]*)\)(?:\s+as\s+(\S+))?/gi)];
  for (const m of items) {
    const fn = m[1].toLowerCase();
    const field = unquote(m[2]);
    if (!field) continue;
    const outName = m[3] ? unquote(m[3]) : field;
    const f = fieldRef(field, ctx);
    const o = fieldRef(outName, ctx);
    switch (fn) {
      case 'ctime':
        out.push(`${o} = strftime(${f}, ${kqlString(fmt)})`);
        break;
      case 'mktime':
        out.push(`${o} = strptime(${f}, ${kqlString(fmt)})`);
        break;
      case 'num':
      case 'auto':
        out.push(`${o} = todouble(${f})`);
        break;
      case 'rmunit':
        out.push(`${o} = todouble(extract(@"^\\s*(-?[\\d.]+)", 1, ${f}))`);
        break;
      case 'rmcomma':
        out.push(`${o} = todouble(replace_regex(${f}, @",", ""))`);
        break;
      case 'dur2sec':
        out.push(`${o} = toint(split(${f}, ":", 0)) * 3600 + toint(split(${f}, ":", 1)) * 60 + todouble(split(${f}, ":", 2))`);
        ctx.note('info', 'dur2sec assumes an HH:MM:SS duration.');
        break;
      case 'memk':
        out.push(`${o} = todouble(extract(@"^([\\d.]+)", 1, ${f})) * case(${f} endswith "g", 1048576, ${f} endswith "m", 1024, 1)`);
        break;
      case 'mstime':
        ctx.note('error', 'convert mstime() is not supported.');
        break;
      case 'none':
        break;
      default:
        ctx.note('error', `convert ${fn}() is not supported.`);
    }
  }
  if (!out.length) return { kql: [todo(`convert ${args}`, 'convert')], unsupported: true };
  return { kql: [`extend ${out.join(', ')}`] };
};

const strcat: Handler = (args, ctx) => {
  const p = parseArgs(args, { optionKeys: new Set(['allrequired']) });
  const toks = p.positional.filter((x) => x.t !== 'op');
  if (toks.length < 2) return { kql: [todo(`strcat ${args}`, 'strcat')], unsupported: true };
  const dest = fieldRef(unquote(toks[toks.length - 1].v), ctx);
  const parts = toks.slice(0, -1).map((t) => (t.t === 'str' ? kqlString(t.v) : fieldRef(t.v, ctx)));
  return { kql: [`extend ${dest} = strcat(${parts.join(', ')})`] };
};

const addtotals: Handler = (args, ctx) => {
  const p = parseArgs(args, { optionKeys: new Set(['row', 'col', 'fieldname', 'labelfield', 'label']) });
  if (/^(t|true|1)$/i.test(p.opts.col ?? '')) ctx.note('warning', 'addtotals col=t (a summary row) is not supported; only row totals were emitted.');
  const flds = p.positional.filter((x) => x.t !== 'op').map((x) => fieldRef(unquote(x.v), ctx));
  if (!flds.length) {
    ctx.note('error', 'addtotals without a field list cannot be translated (Cribl Search needs explicit numeric fields).');
    return { kql: [todo(`addtotals ${args}`, 'addtotals')], unsupported: true };
  }
  return { kql: [`extend ${fieldRef(p.opts.fieldname ?? 'Total', ctx)} = ${flds.map((f) => `coalesce(todouble(${f}), 0)`).join(' + ')}`] };
};

const append: Handler = (args, ctx, env) => {
  const p = parseArgs(args, { optionKeys: new Set(['extendtimerange', 'maxtime', 'maxout', 'timeout']) });
  const sub = p.positional.find((x) => x.t === 'sub');
  if (!sub) return { kql: [todo(`append ${args}`, 'append')], unsupported: true };
  ctx.note('info', 'append was emitted as union with an inline subquery. Cribl also supports `let name = <query>; ... | union name`.');
  return { kql: [`union (${env.sub(sub.v)})`] };
};

const join: Handler = (args, ctx, env) => {
  const p = parseArgs(args, { optionKeys: new Set(['type', 'max', 'usetime', 'earlier', 'overwrite', 'left', 'right', 'where']) });
  const sub = p.positional.find((x) => x.t === 'sub');
  const flds = p.positional.filter((x) => x.t === 'word' || x.t === 'str').map((x) => fieldRef(unquote(x.v), ctx));
  if (!sub) return { kql: [todo(`join ${args}`, 'join')], unsupported: true };
  if (!flds.length) {
    ctx.note('error', 'join without explicit field names is not supported (Cribl join requires `on <fields>`).');
    return { kql: [todo(`join ${args}`, 'join')], unsupported: true };
  }
  const type = (p.opts.type ?? 'inner').toLowerCase();
  const kind = type === 'inner' ? 'inner' : 'leftouter';
  if (p.opts.max && p.opts.max !== '1') ctx.note('info', `join max=${p.opts.max}: Cribl join matches all rows; use kind=innerunique for one match per key.`);
  ctx.note('info', 'Splunk join overwrites left-side fields by default; add `overwrite=true` to the Cribl join options if you rely on that.');
  return { kql: [`join kind=${kind} (${env.sub(sub.v)}) on ${flds.join(', ')}`] };
};

const multisearch: Handler = (args, ctx, env) => {
  const subs = parseArgs(args).positional.filter((x) => x.t === 'sub');
  if (subs.length < 1) return { kql: [todo(`${ctx.command} ${args}`, ctx.command)], unsupported: true };
  const first = env.sub(subs[0].v).replace(/^cribl /, '');
  const kql = [first, ...subs.slice(1).map((s) => `union (${env.sub(s.v)})`)];
  return { kql };
};

const xyseries: Handler = (args, ctx) => {
  const f = words(args).filter((w) => !/^[A-Za-z_]+=/.test(w));
  if (f.length < 3) return { kql: [todo(`xyseries ${args}`, 'xyseries')], unsupported: true };
  return { kql: [`pivot ${fieldRef(f[2], ctx)} over ${fieldRef(f[1], ctx)} by ${fieldRef(f[0], ctx)}`] };
};

const rangemap: Handler = (args, ctx) => {
  const p = parseArgs(args);
  const field = p.opts.field ? fieldRef(p.opts.field, ctx) : null;
  if (!field) return { kql: [todo(`rangemap ${args}`, 'rangemap')], unsupported: true };
  const branches: string[] = [];
  for (const [k, v] of Object.entries(p.opts)) {
    if (k === 'field' || k === 'default') continue;
    const m = /^(-?[\d.]+)-(-?[\d.]+)$/.exec(v);
    if (!m) continue;
    branches.push(`${field} >= ${m[1]} and ${field} <= ${m[2]}, ${kqlString(k)}`);
  }
  branches.push(kqlString(p.opts.default ?? 'None'));
  return { kql: [`extend ${fieldRef('range', ctx)} = case(${branches.join(', ')})`] };
};

const replaceCmd: Handler = (args, ctx) => {
  const { head: pairsRaw, tail: inRaw } = splitKeyword(args, 'in');
  if (!inRaw) {
    ctx.note('error', 'replace without `IN <fields>` applies to all fields, which has no Cribl equivalent; add the field list.');
    return { kql: [todo(`replace ${args}`, 'replace')], unsupported: true };
  }
  const toks = tokenize(pairsRaw, 'args');
  const pairs: { from: string; to: string }[] = [];
  for (let i = 0; i < toks.length; i++) {
    if (toks[i + 1] && toks[i + 1].t === 'word' && toks[i + 1].v.toLowerCase() === 'with' && toks[i + 2]) {
      pairs.push({ from: toks[i].v, to: toks[i + 2].v });
      i += 2;
    }
  }
  const flds = fieldList(inRaw, ctx);
  const out: string[] = [];
  for (const f of flds) {
    const plain = pairs.filter((pr) => !pr.from.includes('*'));
    const wild = pairs.filter((pr) => pr.from.includes('*'));
    let expr = f;
    if (plain.length) expr = `case(${plain.map((pr) => `${f} == ${kqlString(pr.from)}, ${kqlString(pr.to)}`).join(', ')}, ${f})`;
    for (const pr of wild) {
      const re = globToRegex(pr.from).replace(/\.\*/g, '(.*)');
      let n = 0;
      const rep = pr.to.replace(/\*/g, () => `\\${++n}`);
      expr = `replace_regex(${expr}, ${kqlVerbatim(re)}, ${kqlVerbatim(rep)})`;
    }
    out.push(`${f} = ${expr}`);
  }
  return { kql: [`extend ${out.join(', ')}`] };
};

const tstats: Handler = (args, ctx, env) => {
  const p = parseArgs(args, { optionKeys: new Set(['prestats', 'local', 'append', 'summariesonly', 'allow_old_summaries', 'chunk_size', 'fillnull_value', 'include_reduced_buckets']) });
  const cleaned = words(args).filter((w) => !/^(prestats|local|append|summariesonly|allow_old_summaries|chunk_size|fillnull_value|include_reduced_buckets)=/i.test(w)).join(' ');
  const { head: beforeBy, tail: byRaw } = splitKeyword(cleaned, 'by');
  const { head: beforeWhere, tail: whereRaw } = splitKeyword(beforeBy, 'where');
  const { head: aggRaw, tail: fromRaw } = splitKeyword(beforeWhere, 'from');
  let scope: string[] = [];
  const dm = fromRaw ? /datamodel\s*=\s*("?[^\s"]+"?(?:\."?[^\s"]+"?)?)/i.exec(fromRaw) : null;
  if (dm) {
    const r = dataModelStages(dm[1], whereRaw ?? '', ctx);
    if (!r.ok) return { kql: [todo(`tstats ${args}`, 'tstats')], unsupported: true };
    scope = r.stages;
  } else if (fromRaw) {
    ctx.note('error', `tstats FROM ${fromRaw} is not supported.`);
    return { kql: [todo(`tstats ${args}`, 'tstats')], unsupported: true };
  } else if (env.first) scope = buildScope(whereRaw ?? '', ctx);
  else if (whereRaw) {
    const rest = extractScope(parseSearch(whereRaw), ctx).rest;
    if (!isEmptyPredicate(rest)) scope = [`where ${renderWhere(rest, ctx)}`];
  }
  const aggs = parseAggList(aggRaw).map((a) => aggToKql(a, ctx));
  if (!aggs.length) aggs.push(aggToKql({ fn: 'count', arg: '', raw: 'count' }, ctx));
  const byWords = byRaw ? words(byRaw) : [];
  const spanOpt = byWords.find((w) => /^span=/i.test(w));
  const groups = byWords.filter((w) => !/^[A-Za-z_]+=/.test(w));
  if (dm && ctx.opts.knowledge) {
    const r = resolveDataModel(dm[1], ctx.opts.knowledge);
    if (r) {
      const modelFields = new Set(r.chain.flatMap((o) => o.fields.map((f) => f.name)));
      for (const g of groups) {
        const bare = g.replace(/^[A-Za-z_][A-Za-z0-9_]*\./, '');
        if (bare !== '_time' && !modelFields.has(bare)) ctx.note('warning', `"${g}" is not a field of data model ${r.model.name}.${r.chain[r.chain.length - 1].name}; Splunk tstats would return no results for it. The field is grouped on anyway.`);
      }
    }
  }
  const isTime = groups.some((g) => g.toLowerCase() === '_time');
  if (/^(t|true|1)$/i.test(p.opts.prestats ?? '')) ctx.note('warning', 'prestats=t has no meaning in Cribl Search; a normal aggregation was emitted.');
  ctx.note('info', 'tstats reads Splunk index-time summaries; the emitted summarize runs over the dataset (Lakehouse-backed datasets are fastest).');
  if (isTime) {
    const sp = spanOpt ? parseSpan(spanOpt.split('=')[1]) : null;
    const others = groups.filter((g) => g.toLowerCase() !== '_time').map((g) => fieldRef(g, ctx));
    return { kql: [...scope, `timestats ${sp ? `span=${spanToTimestats(sp)} ` : ''}${aggs.map((a) => a.kql).join(', ')}${others.length ? ` by ${others.join(', ')}` : ''}`] };
  }
  const by = groups.map((g) => fieldRef(g, ctx));
  return { kql: [...scope, `summarize ${aggs.map((a) => a.kql).join(', ')}${by.length ? ` by ${by.join(', ')}` : ''}`] };
};

const makeresults: Handler = (args, ctx) => {
  const p = parseArgs(args, { optionKeys: new Set(['count', 'annotate', 'splunk_server', 'splunk_server_group']) });
  const n = p.opts.count ? parseInt(p.opts.count, 10) : 1;
  return { kql: [`${ctx.inSubsearch ? 'cribl ' : ''}dataset="$vt_dummy" event<${n}`] };
};

const addinfo: Handler = () => ({ kql: ['extend info_min_time = earliestTime(), info_max_time = latestTime(), info_search_time = now(), info_sid = jobID()'] });

const delta: Handler = (args, ctx) => {
  const p = parseArgs(args, { optionKeys: new Set(['p']) });
  const toks = p.positional.filter((x) => x.t !== 'op');
  if (!toks.length) return { kql: [todo(`delta ${args}`, 'delta')], unsupported: true };
  const f = unquote(toks[0].v);
  let out = `delta(${f})`;
  if (toks[1] && toks[1].v.toLowerCase() === 'as' && toks[2]) out = unquote(toks[2].v);
  else ctx.fieldAliases.set(out, sanitizeName(`delta_${f}`));
  const n = p.opts.p ? parseInt(p.opts.p, 10) : 1;
  ctx.note('info', 'delta uses prev(); make sure events are sorted (`| order by _time asc`) before this stage.');
  return { kql: [`extend ${fieldRef(out, ctx)} = ${fieldRef(f, ctx)} - prev(${fieldRef(f, ctx)}${n !== 1 ? `, ${n}` : ''})`] };
};

const accum: Handler = (args, ctx) => {
  const toks = words(args);
  if (!toks.length) return { kql: [todo(`accum ${args}`, 'accum')], unsupported: true };
  const f = unquote(toks[0]);
  const out = toks[1]?.toLowerCase() === 'as' && toks[2] ? unquote(toks[2]) : f;
  return { kql: [`extend ${fieldRef(out, ctx)} = row_cumsum(${fieldRef(f, ctx)})`] };
};

const collect: Handler = (args, ctx) => {
  const p = parseArgs(args);
  if (!p.opts.index) return { kql: [todo(`collect ${args}`, 'collect')], unsupported: true };
  ctx.note('warning', `collect writes to a summary index; emitted as export to the Lake dataset "${p.opts.index}". Use \`export to search <id>\` for a Search dataset. Exports write data when the query runs.`);
  return { kql: [`export to lake ${/^[A-Za-z0-9_-]+$/.test(p.opts.index) ? p.opts.index : kqlString(p.opts.index)}`] };
};

const eventcount: Handler = (args, ctx, env) => {
  const p = parseArgs(args, { optionKeys: new Set(['index', 'summarize', 'report_size', 'list_vix']) });
  const kql: string[] = [];
  if (env.first) kql.push(...buildScope(p.opts.index ? `index=${p.opts.index}` : '', ctx));
  kql.push('summarize count = count() by dataset');
  return { kql };
};

const uniq: Handler = (_args, ctx) => {
  ctx.note('warning', 'uniq removes consecutive duplicate events; emitted as `distinct *`, which removes all duplicate rows.');
  return { kql: ['distinct *'] };
};

const fieldformat: Handler = (args, ctx, env) => {
  ctx.note('info', 'fieldformat only changes display in Splunk; it was emitted as an extend that replaces the field value.');
  return evalCmd(args, ctx, env);
};

const datamodelCmd: Handler = (args, ctx) => {
  const ws = words(args).filter((w) => !/^[A-Za-z_]+=/.test(w));
  const model = ws[0];
  if (!model) return { kql: [todo(`datamodel ${args}`, 'datamodel')], unsupported: true };
  const object = ws[1] && !/^(search|flat|acceleration_search)$/i.test(ws[1]) ? ws[1] : undefined;
  const r = dataModelStages(object ? `${model}.${object}` : model, '', ctx);
  if (!r.ok) return { kql: [todo(`datamodel ${args}`, 'datamodel')], unsupported: true };
  ctx.note('info', 'Fields are emitted without the Object. prefix Splunk adds for `| datamodel ... search`; later stages that use the prefix are rewritten.');
  return { kql: r.stages };
};

const fromCmd: Handler = (args, ctx, env) => {
  const m = /^\s*(datamodel|lookup|savedsearch|inputlookup)\s*[:\s]\s*("?[^"\s]+"?)/i.exec(args);
  if (m && /lookup/i.test(m[1])) return inputlookup(m[2], ctx, env);
  if (m && /datamodel/i.test(m[1])) {
    const r = dataModelStages(m[2].replace(/"/g, ''), '', ctx);
    if (!r.ok) return { kql: [todo(`from ${args}`, 'from')], unsupported: true };
    return { kql: r.stages };
  }
  return unsupportedCmd(`from ${args.trim()} has no Cribl Search equivalent (saved searches are not addressable).`)(args, ctx, env);
};

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */

export const COMMANDS: Record<string, Handler> = {
  search,
  where,
  eval: evalCmd,
  fields,
  table,
  rename,
  sort,
  reverse,
  head,
  tail,
  top: topRare(false),
  rare: topRare(true),
  stats,
  sistats: stats,
  eventstats,
  streamstats,
  timechart,
  sitimechart: timechart,
  chart,
  sichart: chart,
  bin: binCmd,
  bucket: binCmd,
  dedup,
  rex,
  regex: regexCmd,
  lookup,
  inputlookup,
  outputlookup,
  iplocation,
  fillnull,
  makemv,
  mvexpand,
  spath,
  convert,
  strcat,
  addtotals,
  append,
  join,
  multisearch,
  union: multisearch,
  xyseries,
  rangemap,
  replace: replaceCmd,
  tstats,
  makeresults,
  addinfo,
  delta,
  accum,
  collect,
  eventcount,
  uniq,
  fieldformat,
  from: fromCmd,
  datamodel: datamodelCmd,
  // silently skipped
  highlight: skipCmd('highlight only affects Splunk UI rendering; skipped.'),
  localop: skipCmd('localop is a Splunk execution hint; skipped.'),
  noop: skipCmd('noop skipped.'),
  require: skipCmd('require has no effect in Cribl Search; skipped.'),
  // unsupported
  transaction: unsupportedCmd('transaction has no Cribl Search equivalent. Approximate with `summarize duration = max(_time) - min(_time), eventcount = count(), events = list(_raw) by <fields>`.'),
  appendcols: unsupportedCmd('appendcols (column-wise append) has no Cribl Search equivalent; consider a join on a shared key.'),
  appendpipe: unsupportedCmd('appendpipe has no Cribl Search equivalent; run the sub-pipeline as a separate union branch with a let statement.'),
  mvcombine: unsupportedCmd('mvcombine has no Cribl Search equivalent; use `summarize field = list(field) by <other fields>`.'),
  untable: unsupportedCmd('untable (unpivot) has no Cribl Search equivalent.'),
  transpose: unsupportedCmd('transpose has no Cribl Search equivalent.'),
  map: unsupportedCmd('map (run a search per result) has no Cribl Search equivalent.'),
  foreach: unsupportedCmd('foreach has no Cribl Search equivalent; expand the template into explicit extend expressions.'),
  return: unsupportedCmd('return (subsearch results as search terms) has no Cribl Search equivalent; use a let statement and `in` instead.'),
  format: unsupportedCmd('format has no Cribl Search equivalent.'),
  sendemail: unsupportedCmd('sendemail is not available; configure a Notification on the saved search instead.'),
  sendalert: unsupportedCmd('sendalert is not available; configure a Notification on the saved search instead.'),
  rest: unsupportedCmd('rest (Splunk REST API) has no Cribl equivalent; consider the externaldata operator for HTTP APIs.'),
  metadata: unsupportedCmd('metadata has no Cribl Search equivalent; try `summarize min(_time), max(_time), count() by host` on the dataset.'),
  metasearch: unsupportedCmd('metasearch has no Cribl Search equivalent; run a normal search on the dataset.'),
  dbinspect: unsupportedCmd('dbinspect has no Cribl Search equivalent.'),
  mstats: unsupportedCmd('mstats has no direct equivalent; query the metrics dataset with `dataset="<metrics>" | where metric == "..." | summarize ...`.'),
  mcatalog: unsupportedCmd('mcatalog has no direct equivalent; try `dataset="<metrics>" | distinct metric`.'),
  savedsearch: unsupportedCmd('savedsearch cannot be referenced from a query; paste the saved query inline.'),
  loadjob: unsupportedCmd('loadjob has no Cribl Search equivalent; use $vt_results with a job id.'),
  gentimes: unsupportedCmd('gentimes has no Cribl Search equivalent; use `print range(...)`.'),
  inputcsv: unsupportedCmd('inputcsv has no Cribl Search equivalent; upload the CSV as a lookup and use $vt_lookups.'),
  outputcsv: unsupportedCmd('outputcsv has no Cribl Search equivalent; use `export to lookup`.'),
  cluster: unsupportedCmd('cluster (event clustering) has no Cribl Search equivalent.'),
  kmeans: unsupportedCmd('kmeans has no Cribl Search equivalent.'),
  anomalies: unsupportedCmd('anomalies has no Cribl Search equivalent.'),
  anomalydetection: unsupportedCmd('anomalydetection has no Cribl Search equivalent.'),
  predict: unsupportedCmd('predict has no Cribl Search equivalent.'),
  trendline: unsupportedCmd('trendline has no Cribl Search equivalent; approximate a moving average with prev() window functions.'),
  timewrap: unsupportedCmd('timewrap has no Cribl Search equivalent.'),
  geostats: unsupportedCmd('geostats has no Cribl Search equivalent; use ip-lookup plus summarize by lat, lon.'),
  geom: unsupportedCmd('geom has no Cribl Search equivalent.'),
  contingency: unsupportedCmd('contingency has no Cribl Search equivalent; use `summarize count() by a, b | pivot`.'),
  associate: unsupportedCmd('associate has no Cribl Search equivalent.'),
  correlate: unsupportedCmd('correlate has no Cribl Search equivalent.'),
  fieldsummary: unsupportedCmd('fieldsummary has no Cribl Search equivalent; the Fields sidebar provides the same summary.'),
  typer: unsupportedCmd('typer (eventtypes) has no Cribl Search equivalent.'),
  tags: unsupportedCmd('tags has no Cribl Search equivalent.'),
  xmlkv: unsupportedCmd('xmlkv has no Cribl Search equivalent; use the extract operator with an XML parser.'),
  multikv: unsupportedCmd('multikv has no Cribl Search equivalent.'),
  erex: unsupportedCmd('erex (example-based extraction) has no Cribl Search equivalent; write the regex with rex.'),
  kv: unsupportedCmd('kv/extract auto key-value extraction: Cribl Search parses key=value pairs automatically, or use the extract operator with type=kvp.'),
  extract: unsupportedCmd('extract auto key-value extraction: Cribl Search parses key=value pairs automatically, or use the extract operator with type=kvp.'),
  xpath: unsupportedCmd('xpath has no Cribl Search equivalent.'),
  abstract: unsupportedCmd('abstract has no Cribl Search equivalent.'),
  diff: unsupportedCmd('diff has no Cribl Search equivalent.'),
  set: unsupportedCmd('set (union/diff/intersect of subsearches) has no Cribl Search equivalent; use union / join kind=leftanti.'),
  selfjoin: unsupportedCmd('selfjoin has no Cribl Search equivalent; use a let statement and join.'),
  filldown: unsupportedCmd('filldown has no Cribl Search equivalent.'),
  nomv: unsupportedCmd('nomv has no Cribl Search equivalent; use strcat_delim over an expanded array.'),
  mvcount: unsupportedCmd('mvcount is an eval function, not a command.'),
  outputtext: unsupportedCmd('outputtext has no Cribl Search equivalent.'),
  script: unsupportedCmd('script/run has no Cribl Search equivalent.'),
  run: unsupportedCmd('script/run has no Cribl Search equivalent.'),
  dbxquery: unsupportedCmd('dbxquery has no Cribl Search equivalent; use a database Dataset Provider.'),
  audit: unsupportedCmd('audit has no Cribl Search equivalent.'),
  history: unsupportedCmd('history has no Cribl Search equivalent; see $vt_jobs.'),
  makecontinuous: unsupportedCmd('makecontinuous has no Cribl Search equivalent; timestats already fills empty buckets.'),
  autoregress: unsupportedCmd('autoregress has no Cribl Search equivalent; use prev() window functions.'),
  bucketdir: unsupportedCmd('bucketdir has no Cribl Search equivalent.'),
  concurrency: unsupportedCmd('concurrency has no Cribl Search equivalent.'),
  pivot: unsupportedCmd('Splunk pivot (data models) has no Cribl Search equivalent.'),
  gauge: unsupportedCmd('gauge is a visualization command; use the chart settings in Cribl Search.'),
  iconify: unsupportedCmd('iconify has no Cribl Search equivalent.'),
  sirare: unsupportedCmd('sirare has no Cribl Search equivalent; use rare.'),
  sitop: unsupportedCmd('sitop has no Cribl Search equivalent; use top.'),
  rtorder: unsupportedCmd('rtorder has no Cribl Search equivalent.'),
  streamstats_: unsupportedCmd('unused'),
  summaryindex: unsupportedCmd('summaryindex has no Cribl Search equivalent; use export.'),
  tscollect: unsupportedCmd('tscollect has no Cribl Search equivalent.'),
  typeahead: unsupportedCmd('typeahead has no Cribl Search equivalent.'),
  walklex: unsupportedCmd('walklex has no Cribl Search equivalent.'),
  x11: unsupportedCmd('x11 has no Cribl Search equivalent.'),
  outlier: unsupportedCmd('outlier has no Cribl Search equivalent; filter with percentile() thresholds.'),
  arules: unsupportedCmd('arules has no Cribl Search equivalent.'),
  cofilter: unsupportedCmd('cofilter has no Cribl Search equivalent.'),
  analyzefields: unsupportedCmd('analyzefields has no Cribl Search equivalent.'),
  findtypes: unsupportedCmd('findtypes has no Cribl Search equivalent.'),
  localize: unsupportedCmd('localize has no Cribl Search equivalent.'),
  overlap: unsupportedCmd('overlap has no Cribl Search equivalent.'),
  relevancy: unsupportedCmd('relevancy has no Cribl Search equivalent.'),
  reltime: unsupportedCmd('reltime has no Cribl Search equivalent; use format_timespan(now() - _time, ...).'),
  scrub: unsupportedCmd('scrub has no Cribl Search equivalent.'),
  searchtxn: unsupportedCmd('searchtxn has no Cribl Search equivalent.'),
  setfields: unsupportedCmd('setfields has no Cribl Search equivalent; use eval.'),
  spendleaked_: unsupportedCmd('unused'),
  strcat_: unsupportedCmd('unused'),
  tojson: unsupportedCmd('tojson has no Cribl Search equivalent as a command; use bag_pack() in extend.'),
  fromjson_: unsupportedCmd('unused'),
  mpreview: unsupportedCmd('mpreview has no Cribl Search equivalent.'),
  msearch: unsupportedCmd('msearch has no Cribl Search equivalent.'),
  redistribute: unsupportedCmd('redistribute is a Splunk execution hint; remove it.'),
  rex_: unsupportedCmd('unused'),
  lookup_: unsupportedCmd('unused'),
};

// Remove placeholder entries used only to keep the table tidy.
for (const k of Object.keys(COMMANDS)) if (k.endsWith('_')) delete COMMANDS[k];

/** Commands that produce events and therefore can start a pipeline. */
export const GENERATING = new Set(['search', 'inputlookup', 'tstats', 'makeresults', 'multisearch', 'union', 'from', 'eventcount', 'rest', 'metadata', 'metasearch', 'datamodel', 'mstats', 'mcatalog', 'savedsearch', 'loadjob', 'gentimes', 'inputcsv', 'dbinspect', 'audit', 'history', 'dbxquery', 'typeahead', 'walklex', 'mpreview', 'msearch', 'pivot', 'set']);

// Re-export for callers that want to pre-parse.
export { parseExpr, renderExpr, ExprError, kqlString, kqlVerbatim, tokenize };
export type { Tok };
