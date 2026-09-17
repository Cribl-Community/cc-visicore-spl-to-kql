/**
 * SPL search-expression parser (the implicit first stage, `search`, `tstats where`).
 *
 * Renders two ways:
 *  - `renderScope`  → the Cribl Search initial stage (`dataset="x" host=web* "error"`),
 *    which Cribl pushes down to the dataset provider. Same operators as Splunk.
 *  - `renderWhere`  → a `where` predicate for mid-pipeline `search` stages.
 */
import { tokenize, type Tok } from './lexer';
import { fieldRef, globToRegex, kqlRegexLiteral, kqlString, stripDmPrefix } from './expr';
import type { Ctx, TimeRange } from './types';

export type SAst =
  | { k: 'cmp'; field: string; op: string; value: string; quoted: boolean }
  | { k: 'in'; field: string; values: { v: string; quoted: boolean }[] }
  | { k: 'text'; v: string; quoted: boolean }
  | { k: 'and'; l: SAst; r: SAst }
  | { k: 'or'; l: SAst; r: SAst }
  | { k: 'not'; e: SAst }
  | { k: 'sub'; v: string }
  | { k: 'macro'; v: string }
  | { k: 'all' };

const CMP_OPS = new Set(['=', '!=', '<', '>', '<=', '>=', '==']);

class SParser {
  i = 0;
  private toks: Tok[];
  constructor(toks: Tok[]) {
    this.toks = toks;
  }
  peek(o = 0): Tok | undefined {
    return this.toks[this.i + o];
  }
  isWord(v: string, o = 0): boolean {
    const t = this.peek(o);
    return !!t && t.t === 'word' && t.v.toUpperCase() === v;
  }
  isOp(v: string, o = 0): boolean {
    const t = this.peek(o);
    return !!t && t.t === 'op' && t.v === v;
  }
  parse(): SAst {
    if (this.toks.length === 0) return { k: 'all' };
    const e = this.parseAnd();
    return e;
  }
  // The search command evaluates OR before AND (the reverse of eval/where):
  // `a=1 AND b=1 OR c=1` means `a=1 AND (b=1 OR c=1)`.
  parseAnd(): SAst {
    let l = this.parseOr();
    for (;;) {
      if (this.isWord('AND')) this.i++;
      const t = this.peek();
      if (!t || this.isOp(')')) break;
      const r = this.parseOr();
      l = { k: 'and', l, r };
    }
    return l;
  }
  parseOr(): SAst {
    let l = this.parseNot();
    while (this.isWord('OR')) {
      this.i++;
      const r = this.parseNot();
      l = { k: 'or', l, r };
    }
    return l;
  }
  parseNot(): SAst {
    if (this.isWord('NOT')) {
      this.i++;
      return { k: 'not', e: this.parseNot() };
    }
    return this.parseTerm();
  }
  parseTerm(): SAst {
    const t = this.peek();
    if (!t) return { k: 'all' };
    if (t.t === 'op' && t.v === '(') {
      this.i++;
      const e = this.parseAnd();
      if (this.isOp(')')) this.i++;
      return e;
    }
    if (t.t === 'sub') {
      this.i++;
      return { k: 'sub', v: t.v };
    }
    if (t.t === 'macro') {
      this.i++;
      return { k: 'macro', v: t.v };
    }
    if (t.t === 'word' || t.t === 'str') {
      const n1 = this.peek(1);
      // field IN (a, b)
      if (t.t === 'word' && n1 && n1.t === 'word' && n1.v.toUpperCase() === 'IN' && this.isOp('(', 2)) {
        this.i += 3;
        const values: { v: string; quoted: boolean }[] = [];
        while (this.peek() && !this.isOp(')')) {
          const v = this.peek()!;
          this.i++;
          if (v.t === 'op' && v.v === ',') continue;
          if (v.t === 'word' || v.t === 'str' || v.t === 'num') values.push({ v: v.v, quoted: v.t === 'str' });
        }
        if (this.isOp(')')) this.i++;
        return { k: 'in', field: t.v, values };
      }
      // field op value  (handles `field = value` with spaces and `field=` glued forms)
      if (t.t === 'word' && n1 && n1.t === 'op' && CMP_OPS.has(n1.v)) {
        const val = this.peek(2);
        this.i += 2;
        if (val && (val.t === 'word' || val.t === 'str' || val.t === 'num')) {
          this.i++;
          return { k: 'cmp', field: t.v, op: n1.v === '==' ? '=' : n1.v, value: val.v, quoted: val.t === 'str' };
        }
        return { k: 'cmp', field: t.v, op: n1.v, value: '', quoted: true };
      }
      // `field::value` exact form
      if (t.t === 'word' && t.v.includes('::') && !t.v.startsWith('::')) {
        const [f, ...rest] = t.v.split('::');
        this.i++;
        return { k: 'cmp', field: f, op: '=', value: rest.join('::'), quoted: false };
      }
      this.i++;
      return { k: 'text', v: t.v, quoted: t.t === 'str' };
    }
    if (t.t === 'num') {
      this.i++;
      return { k: 'text', v: t.v, quoted: false };
    }
    // stray operator: skip it
    this.i++;
    return { k: 'all' };
  }
}

export function parseSearch(raw: string): SAst {
  return new SParser(tokenize(raw, 'args')).parse();
}

/* ------------------------------------------------------------------ */
/* Scope extraction: index=, earliest=, latest=                        */
/* ------------------------------------------------------------------ */

export interface ScopeInfo {
  datasets: string[];
  timeRange: TimeRange;
  /** Remaining predicate after removing scope terms. */
  rest: SAst;
}

const TIME_FIELDS = new Set(['earliest', 'latest', '_index_earliest', '_index_latest', 'starttime', 'endtime', 'earliest_time', 'latest_time']);

function isIndexOnlyOr(a: SAst): string[] | null {
  if (a.k === 'cmp' && a.field.toLowerCase() === 'index' && a.op === '=') return [a.value];
  if (a.k === 'in' && a.field.toLowerCase() === 'index') return a.values.map((v) => v.v);
  if (a.k === 'or') {
    const l = isIndexOnlyOr(a.l);
    const r = isIndexOnlyOr(a.r);
    if (l && r) return [...l, ...r];
  }
  return null;
}

const globRe = (g: string) => new RegExp('^' + g.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 'i');

/** Remove index= terms nested anywhere in an AST (used for tag/eventtype expansions). */
function stripIndexes(a: SAst, out: string[]): SAst {
  const idx = isIndexOnlyOr(a);
  if (idx) {
    out.push(...idx);
    return { k: 'all' };
  }
  if (a.k === 'and') {
    const l = stripIndexes(a.l, out);
    const r = stripIndexes(a.r, out);
    if (l.k === 'all') return r;
    if (r.k === 'all') return l;
    return { k: 'and', l, r };
  }
  if (a.k === 'or') return { k: 'or', l: stripIndexes(a.l, out), r: stripIndexes(a.r, out) };
  return a;
}

/** Collect sourcetype=value terms anywhere in the predicate. */
export function collectSourcetypes(a: SAst, out: Set<string>): void {
  if (a.k === 'cmp' && a.field.toLowerCase() === 'sourcetype' && a.op === '=') out.add(a.value);
  else if (a.k === 'in' && a.field.toLowerCase() === 'sourcetype') a.values.forEach((v) => out.add(v.v));
  else if (a.k === 'and' || a.k === 'or') {
    collectSourcetypes(a.l, out);
    collectSourcetypes(a.r, out);
  } else if (a.k === 'not') collectSourcetypes(a.e, out);
}

/**
 * The one sourcetype every matching event must have, when the predicate's top-level AND chain
 * pins it with `sourcetype=value` (no wildcard). Null when events of other sourcetypes can match.
 */
export function requiredSourcetype(a: SAst): string | null {
  const pinned = new Set<string>();
  const visit = (t: SAst) => {
    if (t.k === 'and') {
      visit(t.l);
      visit(t.r);
    } else if (t.k === 'cmp' && t.field.toLowerCase() === 'sourcetype' && t.op === '=' && !t.value.includes('*')) pinned.add(t.value);
    else if (t.k === 'in' && t.field.toLowerCase() === 'sourcetype' && t.values.length === 1 && !t.values[0].v.includes('*')) pinned.add(t.values[0].v);
  };
  visit(a);
  return pinned.size === 1 ? [...pinned][0] : null;
}

/** Pull index= and time modifiers out of the top-level AND chain; expand tags, eventtypes and known macros. */
export function extractScope(ast: SAst, ctx: Ctx, depth = 0): ScopeInfo {
  const datasets: string[] = [];
  const timeRange: TimeRange = {};
  const keep: SAst[] = [];
  const k = ctx.opts.knowledge;
  const expandSearches = (searches: string[], label: string) => {
    const branches = searches.map((s) => extractScope(parseSearch(s), ctx, depth + 1));
    for (const b of branches) datasets.push(...b.datasets);
    const rests = branches.map((b) => b.rest).filter((r) => r.k !== 'all');
    if (!rests.length) return;
    let or: SAst = rests[0];
    for (const r of rests.slice(1)) or = { k: 'or', l: or, r };
    const stripped: string[] = [];
    const cleaned = stripIndexes(or, stripped);
    datasets.push(...stripped);
    if (cleaned.k !== 'all') keep.push(cleaned);
    ctx.note('info', `${label} was expanded to its eventtype search(es).`);
  };
  const visit = (a: SAst) => {
    if (a.k === 'and') {
      visit(a.l);
      visit(a.r);
      return;
    }
    const idx = isIndexOnlyOr(a);
    if (idx) {
      datasets.push(...idx);
      return;
    }
    if (k && depth < 6 && a.k === 'cmp' && a.op === '=' && a.field.toLowerCase() === 'tag') {
      const ets = k.eventtypes.filter((e) => e.search && e.tags.some((t) => t.toLowerCase() === a.value.toLowerCase()));
      if (!ets.length) {
        ctx.note('warning', `tag=${a.value}: no eventtype in the loaded Splunk knowledge carries this tag; the term was dropped.`);
        return;
      }
      expandSearches(ets.map((e) => e.search), `tag=${a.value} (${ets.map((e) => e.name).join(', ')})`);
      return;
    }
    if (k && depth < 6 && a.k === 'cmp' && a.op === '=' && a.field.toLowerCase() === 'eventtype') {
      const re = globRe(a.value);
      const ets = k.eventtypes.filter((e) => e.search && re.test(e.name));
      if (!ets.length) {
        ctx.note('warning', `eventtype=${a.value}: not found in the loaded Splunk knowledge; the term was dropped.`);
        return;
      }
      expandSearches(ets.map((e) => e.search), `eventtype=${a.value}`);
      return;
    }
    if (a.k === 'macro') {
      const name = a.v.replace(/\(.*$/, '');
      const def = k?.macros?.[name];
      if (def !== undefined && depth < 6 && !a.v.includes('(')) {
        const inner = extractScope(parseSearch(def), ctx, depth + 1);
        datasets.push(...inner.datasets);
        if (inner.rest.k !== 'all') keep.push(inner.rest);
        return;
      }
    }
    if (a.k === 'cmp' && a.field.toLowerCase() === 'nodename') {
      ctx.note('info', 'nodename= (data model object filter) has no Cribl equivalent and was dropped.');
      return;
    }
    if (a.k === 'cmp' && TIME_FIELDS.has(a.field.toLowerCase())) {
      const f = a.field.toLowerCase();
      if (f === 'earliest' || f === 'starttime' || f === 'earliest_time') timeRange.earliest = a.value;
      else if (f === 'latest' || f === 'endtime' || f === 'latest_time') timeRange.latest = a.value;
      else ctx.note('warning', `${a.field}= (index-time bounds) has no Cribl equivalent and was dropped.`);
      return;
    }
    if (a.k === 'cmp' && a.field.toLowerCase() === 'index' && a.op !== '=') {
      ctx.note('warning', `index${a.op}${a.value} cannot be expressed as a dataset scope; the term was dropped. Add the datasets you want explicitly.`);
      return;
    }
    if (a.k === 'cmp' && a.field.toLowerCase() === 'splunk_server') {
      ctx.note('info', 'splunk_server= has no meaning in Cribl Search and was dropped.');
      return;
    }
    keep.push(a);
  };
  visit(ast);
  const rest: SAst = keep.length === 0 ? { k: 'all' } : keep.reduce((l, r) => ({ k: 'and', l, r }));
  return { datasets, timeRange, rest };
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

function scopeValue(v: string, quoted: boolean): string {
  if (!quoted && /^-?\d+(\.\d+)?$/.test(v)) return v;
  if (!quoted && /^[A-Za-z0-9_*.:/-]+$/.test(v)) return v;
  return kqlString(v);
}

function scopeField(f: string, ctx: Ctx): string {
  const n = stripDmPrefix(f, ctx);
  return /^[A-Za-z_][A-Za-z0-9_.]*$/.test(n) ? n : '["' + n.replace(/"/g, '\\"') + '"]';
}

/** `field!=value` needs an explicit existence test, except on metadata fields every event carries. */
function needsExistence(a: SAst): boolean {
  return a.k === 'cmp' && a.op === '!=' && !META_FIELDS.has(a.field.toLowerCase());
}

/** True when the scope rendering of `a` is several AND-ed terms. */
function isScopeConjunction(a: SAst): boolean {
  return a.k === 'and' || needsExistence(a);
}

/** Render a predicate for Cribl's initial (implicit `cribl`) stage. */
export function renderScope(ast: SAst, ctx: Ctx): string {
  switch (ast.k) {
    case 'all':
      return '';
    case 'cmp': {
      const term = `${scopeField(ast.field, ctx)}${ast.op}${scopeValue(ast.value, ast.quoted)}`;
      // SPL `field!=value` only matches events that have the field; Cribl's != also matches events without it.
      return needsExistence(ast) ? `${term} ${scopeField(ast.field, ctx)}=*` : term;
    }
    case 'in':
      return `${scopeField(ast.field, ctx)} IN (${ast.values.map((v) => scopeValue(v.v, v.quoted)).join(', ')})`;
    case 'text':
      return ast.quoted || !/^[A-Za-z0-9_*.:-]+$/.test(ast.v) ? kqlString(ast.v) : ast.v;
    case 'and': {
      const l = renderScope(ast.l, ctx);
      const r = renderScope(ast.r, ctx);
      const wrap = (s: string, a: SAst) => (a.k === 'or' && s ? `(${s})` : s);
      return [wrap(l, ast.l), wrap(r, ast.r)].filter(Boolean).join(' ');
    }
    case 'or': {
      const l = renderScope(ast.l, ctx);
      const r = renderScope(ast.r, ctx);
      if (!l) return r;
      if (!r) return l;
      // Cribl's initial stage, like SPL, binds OR tighter than the implicit AND.
      const wrap = (s: string, a: SAst) => (isScopeConjunction(a) ? `(${s})` : s);
      return `${wrap(l, ast.l)} OR ${wrap(r, ast.r)}`;
    }
    case 'not': {
      const e = renderScope(ast.e, ctx);
      if (!e) return '';
      return ast.e.k === 'or' || isScopeConjunction(ast.e) ? `NOT (${e})` : `NOT ${e}`;
    }
    case 'sub':
      ctx.note('error', `Subsearch [${ast.v}] inside a search expression has no Cribl equivalent; it was dropped. Consider a let statement or a join.`);
      return '';
    case 'macro': {
      const name = ast.v.replace(/\(.*$/, '');
      ctx.macros.add(name);
      if (ast.v.includes('(')) ctx.note('warning', `Macro \`${ast.v}\` has arguments; Cribl Search macros take none, so \${${name}} was emitted.`);
      return `\${${name}}`;
    }
  }
}

function whereValue(v: string, quoted: boolean): { kql: string; numeric: boolean } {
  if (!quoted && /^-?\d+(\.\d+)?$/.test(v)) return { kql: v, numeric: true };
  return { kql: kqlString(v), numeric: false };
}

/** Render a predicate for a `where` stage (mid-pipeline search). */
export function renderWhere(ast: SAst, ctx: Ctx): string {
  switch (ast.k) {
    case 'all':
      return 'true';
    case 'cmp': {
      const f = fieldRef(ast.field, ctx);
      const hasWild = ast.value.includes('*');
      if (ast.op === '=' || ast.op === '!=') {
        let pred: string;
        if (ast.value === '*') pred = `isnotnull(${f})`;
        else if (hasWild) {
          const body = ast.value.replace(/^\*+|\*+$/g, '');
          const lead = ast.value.startsWith('*');
          const trail = ast.value.endsWith('*');
          if (!body.includes('*')) {
            if (lead && trail) pred = `${f} contains ${kqlString(body)}`;
            else if (trail) pred = `${f} startswith ${kqlString(body)}`;
            else pred = `${f} endswith ${kqlString(body)}`;
          } else pred = `${f} matches regex ${kqlRegexLiteral(globToRegex(ast.value), 'i')}`;
        } else {
          const v = whereValue(ast.value, ast.quoted);
          pred = v.numeric ? `${f} == ${v.kql}` : `${f} =~ ${v.kql}`;
        }
        if (ast.op !== '!=') return pred;
        // SPL `field!=value` only matches events that have the field (unlike `NOT field=value`).
        return needsExistence(ast) ? `(isnotnull(${f}) and not(${pred}))` : `not(${pred})`;
      }
      const v = whereValue(ast.value, ast.quoted);
      return `${f} ${ast.op} ${v.kql}`;
    }
    case 'in': {
      const f = fieldRef(ast.field, ctx);
      const wild = ast.values.filter((v) => v.v.includes('*'));
      const plain = ast.values.filter((v) => !v.v.includes('*'));
      const parts: string[] = [];
      if (plain.length) {
        const allNum = plain.every((v) => whereValue(v.v, v.quoted).numeric);
        parts.push(`${f} ${allNum ? 'in' : 'in~'} (${plain.map((v) => whereValue(v.v, v.quoted).kql).join(', ')})`);
      }
      for (const w of wild) parts.push(renderWhere({ k: 'cmp', field: ast.field, op: '=', value: w.v, quoted: w.quoted }, ctx));
      return parts.length > 1 ? `(${parts.join(' or ')})` : parts[0] ?? 'true';
    }
    case 'text': {
      if (ast.v === '*') return 'true';
      if (ast.v.includes('*')) {
        const body = ast.v.replace(/^\*+|\*+$/g, '');
        if (!body.includes('*')) {
          if (ast.v.startsWith('*') && ast.v.endsWith('*')) return `_raw contains ${kqlString(body)}`;
          if (ast.v.endsWith('*')) return `* hasprefix ${kqlString(body)}`;
          return `* hassuffix ${kqlString(body)}`;
        }
        return `_raw matches regex ${kqlRegexLiteral(globToRegex(ast.v).replace(/^\^|\$$/g, ''), 'i')}`;
      }
      return `* has ${kqlString(ast.v)}`;
    }
    case 'and': {
      const wrap = (a: SAst) => (a.k === 'or' ? `(${renderWhere(a, ctx)})` : renderWhere(a, ctx));
      return `${wrap(ast.l)} and ${wrap(ast.r)}`;
    }
    case 'or': {
      const wrap = (a: SAst) => (a.k === 'and' ? `(${renderWhere(a, ctx)})` : renderWhere(a, ctx));
      return `${wrap(ast.l)} or ${wrap(ast.r)}`;
    }
    case 'not':
      return `not(${renderWhere(ast.e, ctx)})`;
    case 'sub':
      ctx.note('error', `Subsearch [${ast.v}] inside a search expression has no Cribl equivalent; it was dropped.`);
      return 'true';
    case 'macro': {
      const name = ast.v.replace(/\(.*$/, '');
      ctx.macros.add(name);
      return `\${${name}}`;
    }
  }
}

const META_FIELDS = new Set(['sourcetype', 'source', 'host', 'index', '_time', 'splunk_server', 'punct', 'linecount', 'timestamp']);

function usesOnlyMeta(a: SAst): boolean {
  switch (a.k) {
    case 'all':
    case 'text':
    case 'macro':
    case 'sub':
      return true;
    case 'cmp':
      return META_FIELDS.has(a.field.toLowerCase());
    case 'in':
      return META_FIELDS.has(a.field.toLowerCase());
    case 'not':
      return usesOnlyMeta(a.e);
    case 'and':
    case 'or':
      return usesOnlyMeta(a.l) && usesOnlyMeta(a.r);
  }
}

/**
 * Split a predicate into terms that only use index-time metadata (kept in the
 * dataset scope) and terms on extracted fields (applied after the field stages).
 */
export function partitionPredicate(a: SAst): { scope: SAst; later: SAst } {
  const scope: SAst[] = [];
  const later: SAst[] = [];
  const visit = (t: SAst) => {
    if (t.k === 'and') {
      visit(t.l);
      visit(t.r);
    } else if (t.k !== 'all') (usesOnlyMeta(t) ? scope : later).push(t);
  };
  visit(a);
  const join = (xs: SAst[]): SAst => (xs.length ? xs.reduce((l, r) => ({ k: 'and', l, r })) : { k: 'all' });
  return { scope: join(scope), later: join(later) };
}

/** True if the predicate contains anything besides `all`. */
export function isEmptyPredicate(a: SAst): boolean {
  return a.k === 'all';
}
