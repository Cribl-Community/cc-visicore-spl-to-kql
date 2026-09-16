/**
 * Lexing helpers for SPL.
 *
 * Two tokenizer modes:
 *  - `args`: command arguments. Words are maximal runs of non-space characters,
 *    so `host=web*`, `-count`, `sum(bytes)` and `props{}.name` survive intact.
 *  - `expr`: eval/where expressions. `.` is the concat operator, `+ - * / %` are
 *    arithmetic, and identifiers follow Splunk field-name rules.
 */

export type Tok =
  | { t: 'word'; v: string }
  | { t: 'num'; v: string }
  | { t: 'str'; v: string; q: '"' | "'" }
  | { t: 'op'; v: string }
  | { t: 'sub'; v: string }
  | { t: 'macro'; v: string };

/** Strip Splunk ```comments``` (triple-backtick) from a query. */
export function stripComments(spl: string): string {
  return spl.replace(/```[\s\S]*?```/g, ' ');
}

/**
 * Split `input` on `sep` (a single character) at nesting depth zero, respecting
 * double quotes, single quotes, backticks, parentheses and square brackets.
 */
export function splitTopLevel(input: string, sep: string): string[] {
  const parts: string[] = [];
  let cur = '';
  let quote: string | null = null;
  let depth = 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quote) {
      cur += ch;
      if (ch === '\\' && i + 1 < input.length) {
        cur += input[++i];
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    if (ch === sep && depth === 0) {
      parts.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  parts.push(cur);
  return parts;
}

/** Split an SPL query into pipeline stages (trimmed, empty stages dropped). */
export function splitPipeline(spl: string): string[] {
  return splitTopLevel(stripComments(spl), '|')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const TWO_CHAR_OPS = ['!=', '<=', '>=', '==', '<>'];
const ARGS_STOP = new Set([' ', '\t', '\n', '\r', '=', ',', '(', ')', '[', ']', '"', "'", '`', '<', '>', '!']);

export function tokenize(input: string, mode: 'args' | 'expr'): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  const n = input.length;
  while (i < n) {
    const ch = input[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const q = ch;
      let j = i + 1;
      let v = '';
      while (j < n && input[j] !== q) {
        if (input[j] === '\\' && j + 1 < n) {
          const nx = input[j + 1];
          // Splunk escapes: \" \\ inside strings. Keep other backslashes literal (regex).
          if (nx === q || nx === '\\') {
            v += nx;
            j += 2;
            continue;
          }
          v += '\\';
          j++;
          continue;
        }
        v += input[j++];
      }
      toks.push({ t: 'str', v, q: q as '"' | "'" });
      i = j + 1;
      continue;
    }
    if (ch === '`') {
      const j = input.indexOf('`', i + 1);
      const end = j === -1 ? n : j;
      toks.push({ t: 'macro', v: input.slice(i + 1, end).trim() });
      i = end + 1;
      continue;
    }
    if (ch === '[' && mode === 'args') {
      // balanced subsearch
      let depth = 0;
      let j = i;
      let quote: string | null = null;
      for (; j < n; j++) {
        const c = input[j];
        if (quote) {
          if (c === '\\') j++;
          else if (c === quote) quote = null;
          continue;
        }
        if (c === '"' || c === "'") quote = c;
        else if (c === '[') depth++;
        else if (c === ']') {
          depth--;
          if (depth === 0) break;
        }
      }
      toks.push({ t: 'sub', v: input.slice(i + 1, j).trim() });
      i = j + 1;
      continue;
    }
    const two = input.slice(i, i + 2);
    if (TWO_CHAR_OPS.includes(two)) {
      toks.push({ t: 'op', v: two === '<>' ? '!=' : two });
      i += 2;
      continue;
    }
    if (mode === 'expr') {
      if ('=<>(),+-*/%.![]'.includes(ch)) {
        // number like .5? rare; treat '.' as op.
        toks.push({ t: 'op', v: ch });
        i++;
        continue;
      }
      const numMatch = /^(?:0[xX][0-9a-fA-F]+|(?:\d+\.\d+|\d+)(?:[eE][+-]?\d+)?)/.exec(input.slice(i));
      if (numMatch) {
        toks.push({ t: 'num', v: numMatch[0] });
        i += numMatch[0].length;
        continue;
      }
      const idMatch = /^[A-Za-z_@$][\w{}:$@]*/.exec(input.slice(i));
      if (idMatch) {
        toks.push({ t: 'word', v: idMatch[0] });
        i += idMatch[0].length;
        continue;
      }
      // Unknown char: emit as op so the parser can complain.
      toks.push({ t: 'op', v: ch });
      i++;
      continue;
    }
    // args mode
    if ('=,()<>'.includes(ch)) {
      toks.push({ t: 'op', v: ch });
      i++;
      continue;
    }
    if (ch === ']') {
      i++;
      continue;
    }
    let j = i;
    while (j < n && !ARGS_STOP.has(input[j])) j++;
    if (j === i) {
      toks.push({ t: 'op', v: ch });
      i++;
      continue;
    }
    toks.push({ t: 'word', v: input.slice(i, j) });
    i = j;
  }
  return toks;
}

/** Reassemble tokens back to text (used for passthrough/notes). */
export function tokText(t: Tok): string {
  switch (t.t) {
    case 'str':
      return t.q + t.v.replace(/\\/g, '\\\\').replace(new RegExp(t.q, 'g'), '\\' + t.q) + t.q;
    case 'sub':
      return '[' + t.v + ']';
    case 'macro':
      return '`' + t.v + '`';
    default:
      return t.v;
  }
}

/**
 * Split a command's raw argument string into positional words and key=value
 * options. Values keep their quoting info. Words separated by commas are split.
 */
export interface ParsedArgs {
  /** key=value options, keys lower-cased. */
  opts: Record<string, string>;
  /** raw (quoted) form of the value, for options whose quoting matters. */
  optToks: Record<string, Tok>;
  /** positional tokens (non-option) in order. */
  positional: Tok[];
}

export function parseArgs(raw: string, opts: { optionKeys?: Set<string> } = {}): ParsedArgs {
  const toks = tokenize(raw, 'args');
  const out: ParsedArgs = { opts: {}, optToks: {}, positional: [] };
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const next = toks[i + 1];
    const after = toks[i + 2];
    if (
      t.t === 'word' &&
      next &&
      next.t === 'op' &&
      next.v === '=' &&
      after &&
      (after.t === 'word' || after.t === 'str' || after.t === 'num' || after.t === 'sub') &&
      (!opts.optionKeys || opts.optionKeys.has(t.v.toLowerCase()))
    ) {
      out.opts[t.v.toLowerCase()] = after.t === 'sub' ? '[' + after.v + ']' : after.v;
      out.optToks[t.v.toLowerCase()] = after;
      i += 2;
      continue;
    }
    if (t.t === 'op' && t.v === ',') continue;
    out.positional.push(t);
  }
  return out;
}

/** Words of a positional list, honoring commas and quotes: `a, b "c d"` → ["a","b","c d"]. */
export function positionalWords(p: ParsedArgs): string[] {
  return p.positional.filter((t) => t.t === 'word' || t.t === 'str' || t.t === 'num').map((t) => t.v);
}
