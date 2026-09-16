/**
 * Convert Splunk (PCRE) extraction regexes into something Cribl's RE2-based
 * extract() accepts:
 *  - expand `[[transform]]` and `[[transform:field]]` macro references
 *  - possessive quantifiers (`++`, `*+`, `?+`, `}+`) → greedy
 *  - atomic groups `(?>...)` → `(?:...)`
 *  - `(?P<name>` → `(?<name>`
 * Lookarounds and backreferences are left in place and reported.
 */
import type { Transform } from './types';

export interface RegexConversion {
  regex: string;
  /** Named capture groups in order of appearance with their 1-based group index. */
  groups: { name: string; index: number }[];
  notes: string[];
}

/** Expand [[name]] / [[name:field]] using the transform table (depth-limited). */
export function expandMacros(regex: string, transforms: Record<string, Transform>, depth = 0): { regex: string; notes: string[] } {
  const notes: string[] = [];
  if (depth > 8) return { regex, notes: ['Macro expansion nested too deep; stopped.'] };
  const out = regex.replace(/\[\[([A-Za-z0-9_-]+)(?::([A-Za-z0-9_.-]+))?\]\]/g, (_m, name: string, field?: string) => {
    const t = transforms[name];
    if (!t?.regex) {
      notes.push(`Regex macro [[${name}]] is not defined in the loaded transforms; left as-is.`);
      return `[[${name}${field ? ':' + field : ''}]]`;
    }
    const inner = expandMacros(t.regex, transforms, depth + 1);
    notes.push(...inner.notes);
    let body = inner.regex;
    if (field) {
      if (body.includes('(?<>')) {
        // `(?<>...)` is an unnamed group placeholder that takes the field name.
        body = body.replace('(?<>', `(?<${field}>`);
      } else if (/\(\?P?<[A-Za-z_]/.test(body)) {
        // Named groups inside the transform get the field as a prefix ([[bc_domain:referer_]] → referer_domain).
        body = body.replace(/\(\?P?<([A-Za-z_][A-Za-z0-9_]*)>/g, (_m, g: string) => `(?<${field}${g}>`);
      } else {
        body = `(?<${field}>${body})`;
      }
    } else if (/^\(\?<[^>]*>/.test(body) === false) {
      body = `(?:${body})`;
    }
    return body;
  });
  return { regex: out, notes };
}

/** Rewrite PCRE-only syntax to RE2-compatible syntax. */
export function pcreToRe2(regex: string): { regex: string; notes: string[] } {
  const notes: string[] = [];
  let r = regex;
  r = r.replace(/\(\?P</g, '(?<');
  r = r.replace(/\(\?>/g, () => {
    notes.push('Atomic group (?>...) rewritten as a non-capturing group.');
    return '(?:';
  });
  // Possessive quantifiers: `x++`, `x*+`, `x?+`, `x{n,m}+` → greedy. Do not touch escaped or class chars.
  let possessive = false;
  r = r.replace(/(\\.|[^\\])([+*?]|\{\d+(?:,\d*)?\})\+/g, (_m, prev: string, q: string) => {
    possessive = true;
    return prev + q;
  });
  if (possessive) notes.push('Possessive quantifiers (e.g. \\s++) were made greedy; RE2 has no possessive matching.');
  if (/\(\?<?[=!]/.test(r)) notes.push('The regex uses lookahead/lookbehind, which RE2 does not support; Cribl will reject it.');
  if (/\\[1-9]/.test(r)) notes.push('The regex uses a backreference, which RE2 does not support.');
  r = r.replace(/\\h/g, '[ \\t]');
  return { regex: r, notes };
}

/** Index every capturing group (named or not) in order; returns named groups with their index. */
export function captureGroups(re: string): { name: string; index: number }[] {
  const out: { name: string; index: number }[] = [];
  let idx = 0;
  for (let i = 0; i < re.length; i++) {
    const c = re[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '[') {
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
      } else idx++;
    }
  }
  return out;
}

/** Full pipeline: macro expansion + PCRE→RE2 + group indexing. */
export function convertSplunkRegex(regex: string, transforms: Record<string, Transform>): RegexConversion {
  const expanded = expandMacros(regex, transforms);
  const converted = pcreToRe2(expanded.regex);
  return { regex: converted.regex, groups: captureGroups(converted.regex), notes: [...expanded.notes, ...converted.notes] };
}
