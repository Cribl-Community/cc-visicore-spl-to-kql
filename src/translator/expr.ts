/**
 * SPL eval/where expression parser and Cribl Search KQL renderer.
 *
 * Parses Splunk eval expressions into a small AST, then renders KQL. All
 * function mappings live in FUNCS below; anything not mapped is emitted as-is
 * with an error note so the query fails loudly in Cribl instead of silently
 * changing meaning.
 */
import { tokenize, type Tok } from './lexer';
import { relativeTimeToKql } from './time';
import type { Ctx } from './types';
import { KQL_OPERATORS } from '../data/kql-catalog';

export type Ast =
  | { k: 'num'; v: string }
  | { k: 'str'; v: string }
  | { k: 'field'; name: string }
  | { k: 'call'; name: string; args: Ast[] }
  | { k: 'bin'; op: string; l: Ast; r: Ast }
  | { k: 'not'; e: Ast }
  | { k: 'neg'; e: Ast }
  | { k: 'macro'; v: string }
  | { k: 'raw'; v: string };

export class ExprError extends Error {}

class Parser {
  i = 0;
  private toks: Tok[];
  constructor(toks: Tok[]) {
    this.toks = toks;
  }

  peek(): Tok | undefined {
    return this.toks[this.i];
  }
  next(): Tok {
    const t = this.toks[this.i++];
    if (!t) throw new ExprError('unexpected end of expression');
    return t;
  }
  isOp(v: string): boolean {
    const t = this.peek();
    return !!t && t.t === 'op' && t.v === v;
  }
  isWord(v: string): boolean {
    const t = this.peek();
    return !!t && t.t === 'word' && t.v.toLowerCase() === v;
  }
  expectOp(v: string) {
    if (!this.isOp(v)) {
      const t = this.peek();
      throw new ExprError(`expected "${v}" but found ${t ? JSON.stringify(t.v) : 'end of expression'}`);
    }
    this.i++;
  }

  parseExpr(): Ast {
    return this.parseOr();
  }
  parseOr(): Ast {
    let l = this.parseAnd();
    while (this.isWord('or')) {
      this.i++;
      const r = this.parseAnd();
      l = { k: 'bin', op: 'or', l, r };
    }
    return l;
  }
  parseAnd(): Ast {
    let l = this.parseNot();
    while (this.isWord('and')) {
      this.i++;
      const r = this.parseNot();
      l = { k: 'bin', op: 'and', l, r };
    }
    return l;
  }
  parseNot(): Ast {
    if (this.isWord('not')) {
      this.i++;
      return { k: 'not', e: this.parseNot() };
    }
    return this.parseCmp();
  }
  parseCmp(): Ast {
    const l = this.parseConcat();
    const t = this.peek();
    if (t && t.t === 'op' && ['=', '==', '!=', '<', '>', '<=', '>='].includes(t.v)) {
      this.i++;
      const r = this.parseConcat();
      return { k: 'bin', op: t.v === '=' ? '==' : t.v, l, r };
    }
    if (this.isWord('like')) {
      this.i++;
      const r = this.parseConcat();
      return { k: 'bin', op: 'like', l, r };
    }
    if (this.isWord('in')) {
      this.i++;
      this.expectOp('(');
      const args: Ast[] = [];
      if (!this.isOp(')')) {
        for (;;) {
          args.push(this.parseExpr());
          if (this.isOp(',')) {
            this.i++;
            continue;
          }
          break;
        }
      }
      this.expectOp(')');
      return { k: 'call', name: 'in', args: [l, ...args] };
    }
    return l;
  }
  parseConcat(): Ast {
    let l = this.parseAdd();
    while (this.isOp('.')) {
      this.i++;
      const r = this.parseAdd();
      l = { k: 'bin', op: '.', l, r };
    }
    return l;
  }
  parseAdd(): Ast {
    let l = this.parseMul();
    while (this.isOp('+') || this.isOp('-')) {
      const op = this.next().v;
      const r = this.parseMul();
      l = { k: 'bin', op, l, r };
    }
    return l;
  }
  parseMul(): Ast {
    let l = this.parseUnary();
    while (this.isOp('*') || this.isOp('/') || this.isOp('%')) {
      const op = this.next().v;
      const r = this.parseUnary();
      l = { k: 'bin', op, l, r };
    }
    return l;
  }
  parseUnary(): Ast {
    if (this.isOp('-')) {
      this.i++;
      return { k: 'neg', e: this.parseUnary() };
    }
    if (this.isOp('+')) {
      this.i++;
      return this.parseUnary();
    }
    if (this.isOp('!')) {
      this.i++;
      return { k: 'not', e: this.parseUnary() };
    }
    return this.parsePrimary();
  }
  parsePrimary(): Ast {
    const t = this.next();
    switch (t.t) {
      case 'num':
        return { k: 'num', v: t.v };
      case 'str':
        return t.q === '"' ? { k: 'str', v: t.v } : { k: 'field', name: t.v };
      case 'macro':
        return { k: 'macro', v: t.v };
      case 'word': {
        if (this.isOp('(')) {
          this.i++;
          const args: Ast[] = [];
          if (!this.isOp(')')) {
            for (;;) {
              args.push(this.parseExpr());
              if (this.isOp(',')) {
                this.i++;
                continue;
              }
              break;
            }
          }
          this.expectOp(')');
          return { k: 'call', name: t.v.toLowerCase(), args };
        }
        const lw = t.v.toLowerCase();
        if (lw === 'true' || lw === 'false' || lw === 'null') return { k: 'raw', v: lw };
        return { k: 'field', name: t.v };
      }
      case 'op':
        if (t.v === '(') {
          const e = this.parseExpr();
          this.expectOp(')');
          return e;
        }
        throw new ExprError(`unexpected "${t.v}"`);
      default:
        throw new ExprError(`unexpected token ${JSON.stringify(t.v)}`);
    }
  }
}

export function parseExpr(src: string): Ast {
  const p = new Parser(tokenize(src, 'expr'));
  const ast = p.parseExpr();
  const rest = p.peek();
  if (rest) throw new ExprError(`unexpected "${rest.v}" after expression`);
  return ast;
}

/* ------------------------------------------------------------------ */
/* Rendering helpers                                                   */
/* ------------------------------------------------------------------ */

/** KQL keywords that cannot be used as bare field names. */
const RESERVED = new Set<string>([
  ...[...KQL_OPERATORS].filter((o) => /^[a-z-]+$/.test(o) && o !== 'count'),
  'by', 'on', 'of', 'in', 'and', 'or', 'not', 'has', 'contains', 'startswith', 'endswith', 'matches', 'regex',
  'true', 'false', 'null', 'dynamic', 'datetime', 'timespan', 'let', 'set', 'kind', 'with', 'to', 'from', 'over',
  'asc', 'desc', 'nulls', 'first', 'last', 'cribl', 'dataset', 'string', 'int', 'long', 'real', 'double', 'bool',
  'decimal', 'guid', 'range', 'print', 'top', 'limit', 'take', 'sort', 'order', 'where', 'extend', 'project',
  'summarize', 'join', 'union', 'search', 'find', 'lookup', 'export', 'render', 'distinct', 'dedup', 'between',
  'pivot', 'send', 'suppress', 'timestats', 'eventstats', 'centralize', 'foldkeys', 'externaldata', 'extract',
]);

/** Render a KQL string literal with double quotes. */
export function kqlString(v: string): string {
  return '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t') + '"';
}

/** Render a verbatim (regex-safe) KQL string: @"..." with embedded quotes doubled. Used for RE2 function arguments. */
export function kqlVerbatim(v: string): string {
  return '@"' + v.replace(/"/g, '""') + '"';
}

/**
 * Render a regex literal for the `matches regex` operator: /pattern/flags.
 * Cribl's engine misparses string patterns that contain "/", so the literal
 * form is used everywhere. A leading (?i) becomes the i flag.
 */
export function kqlRegexLiteral(pattern: string, flags = ''): string {
  let p = pattern;
  let f = flags;
  const inline = /^\(\?([imsx]+)\)/.exec(p);
  if (inline) {
    p = p.slice(inline[0].length);
    for (const c of inline[1]) if (!f.includes(c) && c !== 'x') f += c;
  }
  p = p.replace(/(\\.)|\//g, (_m, esc: string) => esc ?? "\\/");
  return `/${p}/${f}`;
}

/** Render a field reference, resolving aggregation aliases and quoting where needed. */
export function fieldRef(name: string, ctx: Ctx): string {
  const resolved = ctx.fieldAliases.get(name) ?? name;
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(resolved) && !RESERVED.has(resolved.toLowerCase())) return resolved;
  // Dotted names are nested-path access in Cribl (JSON is auto-parsed), keep them bare.
  if (/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)+$/.test(resolved)) return resolved;
  return '["' + resolved.replace(/"/g, '\\"') + '"]';
}

/** Normalize a numeric literal: KQL has no scientific/hex literals. */
export function kqlNumber(v: string): string {
  if (/^0x[0-9a-f]+$/i.test(v)) return String(parseInt(v, 16));
  if (/[eE]/.test(v)) {
    const n = Number(v);
    if (Number.isFinite(n)) return Number.isInteger(n) ? String(n) : String(n);
  }
  if (v.startsWith('.')) return '0' + v;
  return v;
}

const PREC: Record<string, number> = {
  or: 1,
  and: 2,
  '==': 3, '!=': 3, '<': 3, '>': 3, '<=': 3, '>=': 3, like: 3,
  '+': 5, '-': 5,
  '*': 6, '/': 6, '%': 6,
};

function isBin(a: Ast): a is Extract<Ast, { k: 'bin' }> {
  return a.k === 'bin';
}

function isStrLiteral(a: Ast): boolean {
  return a.k === 'str';
}

function isNumericLiteral(a: Ast): boolean {
  return a.k === 'num';
}

/** Convert a Splunk LIKE pattern (% and _) into a KQL predicate. */
function likeToKql(lhs: string, pattern: string): string {
  const hasPct = pattern.includes('%');
  const hasUnd = pattern.includes('_');
  if (!hasPct && !hasUnd) return `${lhs} == ${kqlString(pattern)}`;
  const body = pattern.replace(/^%+|%+$/g, '');
  const leading = pattern.startsWith('%');
  const trailing = pattern.endsWith('%');
  if (!hasUnd && !body.includes('%')) {
    if (leading && trailing) return `${lhs} contains_cs ${kqlString(body)}`;
    if (trailing) return `${lhs} startswith_cs ${kqlString(body)}`;
    if (leading) return `${lhs} endswith_cs ${kqlString(body)}`;
  }
  const re = '^' + pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$';
  return `${lhs} matches regex ${kqlRegexLiteral(re)}`;
}

/** Convert a Splunk wildcard glob (`*`) to an anchored regex. */
export function globToRegex(glob: string): string {
  return '^' + glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$';
}

type Fn = (args: Ast[], r: (a: Ast) => string, ctx: Ctx, raw: Ast[]) => string;

const same =
  (name: string, min = 0, max = Infinity): Fn =>
  (args, r, ctx) => {
    if (args.length < min || args.length > max) ctx.note('warning', `${name}() called with ${args.length} argument(s); check the Cribl signature.`);
    return `${name}(${args.map(r).join(', ')})`;
  };

const unsupported =
  (why: string): Fn =>
  (_args, _r, ctx) => {
    ctx.note('error', why);
    return `/* unsupported */ null`;
  };

function strArg(a: Ast | undefined): string | null {
  return a && a.k === 'str' ? a.v : null;
}

function trimRegex(chars: string | null): string {
  if (chars === null) return kqlVerbatim('\\s+');
  return kqlVerbatim('[' + chars.replace(/[\]\\^-]/g, '\\$&') + ']+');
}

function jsonPath(p: string): string {
  let path = p.trim();
  path = path.replace(/\{(\d+)\}/g, '[$1]').replace(/\{\}/g, '[*]');
  if (!path.startsWith('$')) path = '$.' + path;
  return path;
}

const FUNCS: Record<string, Fn> = {
  // conditionals
  if: (a, r) => `iff(${r(a[0])}, ${r(a[1])}, ${r(a[2])})`,
  case: (a, r, ctx) => {
    const parts = a.map(r);
    if (parts.length % 2 === 0) {
      parts.push('null');
      ctx.note('info', 'case() has no default branch in SPL; KQL case() requires one, so `null` was appended.');
    }
    return `case(${parts.join(', ')})`;
  },
  coalesce: (a, r, ctx) => {
    ctx.note('info', 'coalesce() in Cribl also skips empty strings; Splunk coalesce() only skips null.');
    return `coalesce(${a.map(r).join(', ')})`;
  },
  nullif: (a, r) => `iff(${r(a[0])} == ${r(a[1])}, null, ${r(a[0])})`,
  validate: unsupported('validate() has no Cribl Search equivalent; rewrite with case().'),
  isnull: same('isnull', 1, 1),
  isnotnull: same('isnotnull', 1, 1),
  isnum: (a, r) => `isnotnull(todouble(${r(a[0])}))`,
  isstr: (a, r) => `gettype(${r(a[0])}) == "string"`,
  isint: (a, r) => `gettype(${r(a[0])}) == "int"`,
  isbool: (a, r) => `gettype(${r(a[0])}) == "bool"`,
  typeof: (a, r) => `gettype(${r(a[0])})`,
  true: () => 'true',
  false: () => 'false',
  null: () => 'null',
  in: (a, r) => `${r(a[0])} in (${a.slice(1).map(r).join(', ')})`,
  like: (a, r, ctx) => {
    const pat = strArg(a[1]);
    if (pat === null) {
      ctx.note('warning', 'like() with a non-literal pattern was emitted as a case-sensitive equality; adjust manually.');
      return `${r(a[0])} == ${r(a[1])}`;
    }
    return likeToKql(r(a[0]), pat);
  },
  match: (a, r, ctx) => {
    const re = strArg(a[1]);
    if (re === null) {
      ctx.note('warning', 'match() with a non-literal regex; verify the emitted matches regex expression.');
      return `${r(a[0])} matches regex ${r(a[1])}`;
    }
    return `${r(a[0])} matches regex ${kqlRegexLiteral(re)}`;
  },
  cidrmatch: (a, r) => `ipv4_is_in_range(${r(a[1])}, ${r(a[0])})`,
  searchmatch: unsupported('searchmatch() is not available; express the condition with where/has predicates.'),

  // strings
  len: (a, r) => `strlen(${r(a[0])})`,
  lower: (a, r) => `tolower(${r(a[0])})`,
  upper: (a, r) => `toupper(${r(a[0])})`,
  ltrim: (a, r) => `trim_start(${trimRegex(strArg(a[1]))}, ${r(a[0])})`,
  rtrim: (a, r) => `trim_end(${trimRegex(strArg(a[1]))}, ${r(a[0])})`,
  trim: (a, r) => `trim(${trimRegex(strArg(a[1]))}, ${r(a[0])})`,
  substr: (a, r, ctx) => {
    // SPL: substr(s, start1based, length). Cribl: substring(s, start0based, endIndexExclusive).
    const start = a[1];
    const src = r(a[0]);
    const isNeg = (start && start.k === 'neg' && start.e.k === 'num') || (start && start.k === 'num' && Number(start.v) < 0);
    if (isNeg) {
      const n = start.k === 'neg' ? `-${(start.e as { v: string }).v}` : (start as { v: string }).v;
      // Negative start counts from the end; a length becomes a second substring.
      return a.length > 2 ? `substring(substring(${src}, ${n}), 0, ${r(a[2])})` : `substring(${src}, ${n})`;
    }
    let startKql: string;
    if (start && start.k === 'num') startKql = String(Math.max(0, Number(start.v) - 1));
    else {
      startKql = `(${r(start)}) - 1`;
      ctx.note('info', 'substr() is 1-based in SPL and 0-based in KQL; the start index was shifted by one.');
    }
    if (a.length > 2) {
      const len = a[2];
      const end = len.k === 'num' && start.k === 'num' ? String(Math.max(0, Number(start.v) - 1) + Number(len.v)) : `${startKql} + ${r(len)}`;
      return `substring(${src}, ${startKql}, ${end})`;
    }
    return `substring(${src}, ${startKql})`;
  },
  replace: (a, r, ctx) => {
    const re = strArg(a[1]);
    const rep = strArg(a[2]);
    if (re === null || rep === null) {
      ctx.note('warning', 'replace() with non-literal regex/replacement; verify escaping.');
      return `replace_regex(${r(a[0])}, ${r(a[1])}, ${r(a[2])})`;
    }
    if (/\(\?[<=!]/.test(re) || /\(\?<[=!]/.test(re)) ctx.note('warning', 'Regex uses lookaround, which RE2 (used by replace_regex) does not support.');
    return `replace_regex(${r(a[0])}, ${kqlVerbatim(re)}, ${kqlVerbatim(rep.replace(/\$(\d)/g, '\\$1'))})`;
  },
  split: (a, r) => `split(${r(a[0])}, ${r(a[1])})`,
  mvindex: (a, r, ctx) => {
    if (a.length > 2) ctx.note('warning', 'mvindex() with a range was reduced to the first index; slices are not supported.');
    const mv = a[0];
    if (mv.k === 'call' && mv.name === 'split' && mv.args.length === 2) {
      // split() takes an index argument directly; wrap in tostring() to unwrap the one-element array.
      return `tostring(split(${r(mv.args[0])}, ${r(mv.args[1])}, ${r(a[1])}))`;
    }
    if (mv.k !== 'field') {
      ctx.note('warning', 'mvindex() on an expression: Cribl only indexes fields (x[i]); assign the array to a field first.');
    }
    return `${r(mv)}[${r(a[1])}]`;
  },
  mvcount: unsupported('mvcount() has no Cribl Search equivalent (no array_length function in this deployment).'),
  mvjoin: unsupported('mvjoin() has no Cribl Search equivalent; consider mv-expand + summarize strcat_delim.'),
  mvappend: unsupported('mvappend() has no Cribl Search equivalent.'),
  mvdedup: unsupported('mvdedup() has no Cribl Search equivalent.'),
  mvfilter: unsupported('mvfilter() has no Cribl Search equivalent; use mv-expand | where.'),
  mvfind: unsupported('mvfind() has no Cribl Search equivalent.'),
  mvmap: unsupported('mvmap() has no Cribl Search equivalent; use mv-expand | extend.'),
  mvsort: unsupported('mvsort() has no Cribl Search equivalent.'),
  mvzip: (a, r) => `zip(${r(a[0])}, ${r(a[1])})`,
  mvrange: (a, r) => `range(${a.map(r).join(', ')})`,
  strcat: same('strcat', 1),
  tostring: (a, r, ctx) => {
    const fmt = strArg(a[1]);
    if (fmt) ctx.note('warning', `tostring(x, "${fmt}") formatting is not available; plain tostring() was emitted.`);
    return `tostring(${r(a[0])})`;
  },
  tonumber: (a, r, ctx) => {
    if (a.length > 1) ctx.note('warning', 'tonumber() with a base is not supported; base 10 assumed.');
    return `todouble(${r(a[0])})`;
  },
  printf: unsupported('printf() has no Cribl Search equivalent; use strcat()/format functions.'),
  urldecode: (a, r) => `url_decode(${r(a[0])})`,
  md5: (a, r) => `hash_md5(${r(a[0])})`,
  sha1: (a, r) => `hash_sha1(${r(a[0])})`,
  sha256: (a, r) => `hash_sha256(${r(a[0])})`,
  sha512: unsupported('sha512() is not available in Cribl Search (md5/sha1/sha256 are).'),
  crc32: unsupported('crc32() is not available in Cribl Search.'),
  json_extract: (a, r, ctx) => {
    const p = strArg(a[1]);
    if (p === null) {
      ctx.note('warning', 'json_extract() with a non-literal path; verify the emitted extract_json path.');
      return `extract_json(${r(a[1])}, ${r(a[0])})`;
    }
    return `extract_json(${kqlString(jsonPath(p))}, ${r(a[0])})`;
  },
  spath: (a, r, ctx) => FUNCS.json_extract(a, r, ctx, a),
  json_valid: unsupported('json_valid() is not available; use isnotnull(parse_json(x)).'),
  json_object: (a, r) => `bag_pack(${a.map(r).join(', ')})`,
  json_keys: (a, r) => `bag_keys(parse_json(${r(a[0])}))`,
  json_array: unsupported('json_array() is not available in Cribl Search.'),
  tojson: (a, r) => `tostring(${r(a[0])})`,
  ipmask: unsupported('ipmask() is not available in Cribl Search.'),

  // math
  round: same('round', 1, 2),
  floor: same('floor', 1, 1),
  ceiling: (a, r) => `ceiling(${r(a[0])})`,
  ceil: (a, r) => `ceiling(${r(a[0])})`,
  abs: same('abs', 1, 1),
  exp: same('exp', 1, 1),
  ln: (a, r) => `log(${r(a[0])})`,
  log: (a, r) => {
    if (a.length < 2) return `log10(${r(a[0])})`;
    const b = a[1];
    if (b.k === 'num' && b.v === '10') return `log10(${r(a[0])})`;
    if (b.k === 'num' && b.v === '2') return `log2(${r(a[0])})`;
    return `log(${r(a[0])}) / log(${r(b)})`;
  },
  pow: same('pow', 2, 2),
  sqrt: same('sqrt', 1, 1),
  pi: () => 'pi()',
  exact: (a, r) => r(a[0]),
  sigfig: (a, r, ctx) => {
    ctx.note('info', 'sigfig() has no equivalent; the value was emitted unchanged.');
    return r(a[0]);
  },
  random: () => 'rand()',
  max: (a, r) => (a.length === 1 ? r(a[0]) : `max_of(${a.map(r).join(', ')})`),
  min: (a, r) => (a.length === 1 ? r(a[0]) : `min_of(${a.map(r).join(', ')})`),
  acos: same('acos', 1, 1),
  asin: same('asin', 1, 1),
  atan: same('atan', 1, 1),
  atan2: same('atan2', 2, 2),
  cos: same('cos', 1, 1),
  sin: same('sin', 1, 1),
  tan: same('tan', 1, 1),
  acosh: unsupported('acosh() is not available in Cribl Search.'),
  asinh: unsupported('asinh() is not available in Cribl Search.'),
  atanh: unsupported('atanh() is not available in Cribl Search.'),
  cosh: unsupported('cosh() is not available in Cribl Search.'),
  sinh: unsupported('sinh() is not available in Cribl Search.'),
  tanh: unsupported('tanh() is not available in Cribl Search.'),
  hypot: (a, r) => `sqrt(pow(${r(a[0])}, 2) + pow(${r(a[1])}, 2))`,
  bit_and: (a, r) => `binary_and(${r(a[0])}, ${r(a[1])})`,
  bit_or: (a, r) => `binary_or(${r(a[0])}, ${r(a[1])})`,
  bit_xor: (a, r) => `binary_xor(${r(a[0])}, ${r(a[1])})`,
  bit_not: (a, r) => `binary_not(${r(a[0])})`,
  bit_shift_left: (a, r) => `binary_shift_left(${r(a[0])}, ${r(a[1])})`,
  bit_shift_right: (a, r) => `binary_shift_right(${r(a[0])}, ${r(a[1])})`,

  // time
  now: () => 'now()',
  time: () => 'now()',
  relative_time: (a, r, ctx) => {
    const mod = strArg(a[1]);
    if (mod === null) {
      ctx.note('error', 'relative_time() needs a literal modifier to translate.');
      return r(a[0]);
    }
    const res = relativeTimeToKql(r(a[0]), mod);
    if (!res) {
      ctx.note('error', `relative_time() modifier "${mod}" could not be translated.`);
      return r(a[0]);
    }
    if (res.note) ctx.note('warning', res.note);
    return res.kql;
  },
  strftime: (a, r, ctx) => {
    ctx.note('info', 'strftime()/strptime() use the same % directives; Cribl evaluates them in the search timezone (UTC by default), Splunk in the user timezone.');
    return `strftime(${a.map(r).join(', ')})`;
  },
  strptime: (a, r, ctx) => {
    ctx.note('info', 'strftime()/strptime() use the same % directives; Cribl evaluates them in the search timezone (UTC by default), Splunk in the user timezone.');
    return `strptime(${a.map(r).join(', ')})`;
  },
  mktime: unsupported('mktime() is not an SPL function; did you mean strptime()?'),
};

/** Aliases that share an implementation. */
FUNCS.ceiling = FUNCS.ceil;

export interface RenderOptions {
  /** Called for a field reference (allows callers to track referenced fields). */
  onField?: (name: string) => void;
}

/** Render an eval AST as a KQL scalar expression. */
export function renderExpr(ast: Ast, ctx: Ctx, opts: RenderOptions = {}): string {
  const r = (a: Ast): string => renderExpr(a, ctx, opts);
  switch (ast.k) {
    case 'num':
      return kqlNumber(ast.v);
    case 'str':
      return kqlString(ast.v);
    case 'raw':
      return ast.v;
    case 'field':
      opts.onField?.(ast.name);
      return fieldRef(ast.name, ctx);
    case 'macro': {
      const name = ast.v.replace(/\(.*$/, '');
      ctx.macros.add(name);
      if (ast.v.includes('(')) ctx.note('warning', `Macro \`${ast.v}\` has arguments; Cribl Search macros take none, so \${${name}} was emitted.`);
      return `\${${name}}`;
    }
    case 'neg': {
      const inner = r(ast.e);
      return isBin(ast.e) ? `-(${inner})` : `-${inner}`;
    }
    case 'not':
      return `not(${r(ast.e)})`;
    case 'call': {
      const fn = FUNCS[ast.name];
      if (!fn) {
        ctx.note('error', `Unknown eval function ${ast.name}(); emitted unchanged.`);
        return `${ast.name}(${ast.args.map(r).join(', ')})`;
      }
      return fn(ast.args, r, ctx, ast.args);
    }
    case 'bin': {
      if (ast.op === '.') {
        const parts: Ast[] = [];
        const flatten = (a: Ast) => {
          if (isBin(a) && a.op === '.') {
            flatten(a.l);
            flatten(a.r);
          } else parts.push(a);
        };
        flatten(ast);
        if (parts.some((p) => p.k === 'field')) ctx.note('info', 'strcat() treats a missing field as an empty string; Splunk `.` yields null when any operand is null.');
        return `strcat(${parts.map(r).join(', ')})`;
      }
      if (ast.op === 'like') {
        const pat = strArg(ast.r);
        if (pat !== null) return likeToKql(r(ast.l), pat);
        ctx.note('warning', 'LIKE with a non-literal pattern was emitted as equality.');
        return `${r(ast.l)} == ${r(ast.r)}`;
      }
      const myPrec = PREC[ast.op] ?? 4;
      const wrap = (child: Ast, rightSide: boolean): string => {
        const s = r(child);
        if (isBin(child) && child.op !== '.' && child.op !== 'like') {
          const cp = PREC[child.op] ?? 4;
          if (cp < myPrec || (cp === myPrec && rightSide && ['-', '/', '%'].includes(ast.op))) return `(${s})`;
          if (cp === myPrec && myPrec === 3) return `(${s})`; // chained comparisons
        }
        return s;
      };
      let op = ast.op;
      let l = wrap(ast.l, false);
      let rr = wrap(ast.r, true);
      // Splunk `=`/`!=` on strings is case-sensitive in eval — keep ==/!=.
      if (op === '+' && (isStrLiteral(ast.l) || isStrLiteral(ast.r)) && !(isNumericLiteral(ast.l) || isNumericLiteral(ast.r))) {
        ctx.note('info', '`+` with a string operand: SPL yields null unless both are numeric; KQL concatenates. Verify intent.');
      }
      if (op === 'and' || op === 'or') {
        l = isBin(ast.l) && ast.l.op !== ast.op && (ast.l.op === 'and' || ast.l.op === 'or') ? `(${r(ast.l)})` : l;
        rr = isBin(ast.r) && ast.r.op !== ast.op && (ast.r.op === 'and' || ast.r.op === 'or') ? `(${r(ast.r)})` : rr;
      }
      if (op === '==' || op === '!=') {
        // `field == "true"` style boolean literals: fine as-is.
      }
      return `${l} ${op} ${rr}`;
    }
  }
}

/** Parse and render in one step; on parse failure emit an error note and passthrough text. */
export function translateExpr(src: string, ctx: Ctx, opts: RenderOptions = {}): string {
  try {
    return renderExpr(parseExpr(src), ctx, opts);
  } catch (e) {
    ctx.note('error', `Could not parse expression "${src.trim()}": ${(e as Error).message}. Emitted unchanged.`);
    return src.trim();
  }
}

/** Collect the field names referenced by an expression (best effort). */
export function referencedFields(src: string): Set<string> {
  const out = new Set<string>();
  try {
    const walk = (a: Ast) => {
      switch (a.k) {
        case 'field':
          out.add(a.name);
          break;
        case 'call':
          a.args.forEach(walk);
          break;
        case 'bin':
          walk(a.l);
          walk(a.r);
          break;
        case 'not':
        case 'neg':
          walk(a.e);
          break;
        default:
      }
    };
    walk(parseExpr(src));
  } catch {
    /* ignore */
  }
  return out;
}
