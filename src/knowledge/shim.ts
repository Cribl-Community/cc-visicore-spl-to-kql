/**
 * Build the "CIM shim": KQL stages that reproduce Splunk's search-time field
 * pipeline for a sourcetype in Cribl Search, in Splunk's evaluation order:
 * extractions (EXTRACT/REPORT) → field aliases → calculated fields (EVAL) → lookups.
 */
import { fieldRef, kqlString, kqlVerbatim, translateExpr } from '../translator/expr';
import type { Ctx } from '../translator/types';
import { convertSplunkRegex } from './regex';
import type { Knowledge, SourcetypeKnowledge, Transform } from './types';

export interface ShimOptions {
  /** Function that translates an SPL lookup spec ("table f AS g OUTPUT x") into KQL stages. */
  lookupToKql: (spec: string, ctx: Ctx) => string[];
  /**
   * Restrict every stage to events of this sourcetype. Needed when several sourcetypes are in
   * scope, so one sourcetype's aliases and calculated fields do not overwrite another's.
   */
  guarded?: boolean;
  /** Sourcetypes whose rules are identical to this one's; the guard matches any of them. Defaults to the sourcetype itself. */
  guardSourcetypes?: string[];
}

/** Maps an extraction's source field to the `source=` argument of the extract operator. */
type SourceArg = (source: string) => string;

/** Rename duplicate named groups (RE2/Cribl reject them): second `domain` becomes `domain_2`. */
function dedupeGroupNames(regex: string, ctx: Ctx, label: string): string {
  const seen = new Map<string, number>();
  let renamed: string[] = [];
  const out = regex.replace(/\(\?<([A-Za-z_][A-Za-z0-9_]*)>/g, (m, name: string) => {
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    if (n === 1) return m;
    renamed.push(`${name}→${name}_${n}`);
    return `(?<${name}_${n}>`;
  });
  if (renamed.length) ctx.note('info', `${label}: duplicate capture group names were renamed (${renamed.join(', ')}); Splunk keeps the last match.`);
  return out;
}

/** Give names to the capturing groups referenced by a FORMAT string (field::$N). */
function nameGroupsFromFormat(regex: string, mapping: { field: string; group: number }[]): string {
  const byIndex = new Map(mapping.map((m) => [m.group, m.field]));
  let idx = 0;
  let out = '';
  for (let i = 0; i < regex.length; i++) {
    const c = regex[i];
    if (c === '\\') {
      out += c + (regex[i + 1] ?? '');
      i++;
      continue;
    }
    if (c === '[') {
      let j = i + 1;
      while (j < regex.length && regex[j] !== ']') {
        if (regex[j] === '\\') j++;
        j++;
      }
      out += regex.slice(i, j + 1);
      i = j;
      continue;
    }
    if (c === '(' && regex[i + 1] !== '?') {
      idx++;
      const name = byIndex.get(idx);
      out += name ? `(?<${name.replace(/[^A-Za-z0-9_]/g, '_')}>` : '(';
      continue;
    }
    if (c === '(' && /^\(\?P?</.test(regex.slice(i))) idx++;
    out += c;
  }
  return out;
}

/** Parse a FORMAT string like "field::$1 other::$2" into group → field mappings. */
function parseFormat(format: string): { mapping: { field: string; group: number }[]; dynamicKey: boolean } {
  const mapping: { field: string; group: number }[] = [];
  let dynamicKey = false;
  for (const tok of format.trim().split(/\s+/)) {
    const m = /^(.+?)::\$(\d+)$/.exec(tok);
    if (!m) continue;
    if (/^\$\d+$/.test(m[1])) {
      dynamicKey = true;
      continue;
    }
    mapping.push({ field: m[1].replace(/^"(.*)"$/, '$1'), group: parseInt(m[2], 10) });
  }
  return { mapping, dynamicKey };
}

/** One regex extraction → a Cribl `extract` operator stage (all named groups become fields; unmatched groups are null). */
function regexStage(regex: string, source: string, format: string | undefined, k: Knowledge, ctx: Ctx, label: string, multi: boolean, srcArg: SourceArg): string | null {
  const conv = convertSplunkRegex(regex, k.transforms);
  for (const n of conv.notes) ctx.note('warning', `${label}: ${n}`);
  let re = conv.regex;
  if (format) {
    const f = parseFormat(format);
    if (f.dynamicKey) ctx.note('error', `${label}: FORMAT uses a captured key name ($1::$2), which cannot be expressed in KQL; skipped.`);
    if (!f.mapping.length) return null;
    re = nameGroupsFromFormat(re, f.mapping);
  } else if (!conv.groups.length) {
    ctx.note('warning', `${label}: regex has no named capture groups and no FORMAT; nothing to extract.`);
    return null;
  }
  re = dedupeGroupNames(re, ctx, label);
  if (multi) ctx.note('warning', `${label}: MV_ADD/REPEAT_MATCH extractions are multivalue in Splunk; the extract operator keeps the first match.`);
  return `extract ${srcArg(source)}type=regex regex=${kqlVerbatim(re)}`;
}

function transformStages(t: Transform, k: Knowledge, ctx: Ctx, srcArg: SourceArg): string[] {
  const label = `transform ${t.name}`;
  const source = (t.sourceKey ?? '_raw').replace(/^field:/, '');
  if (t.regex) {
    const st = regexStage(t.regex, source, t.format, k, ctx, label, !!(t.mvAdd || t.repeatMatch), srcArg);
    return st ? [st] : [];
  }
  if (t.delims) {
    if (t.delims.length > 1) {
      ctx.note('info', `${label}: key=value delimiter extraction (DELIMS with two delimiters) is covered by Cribl's automatic key-value parsing; nothing emitted.`);
      return [];
    }
    if (!t.fields?.length) {
      ctx.note('warning', `${label}: DELIMS without FIELDS cannot be translated.`);
      return [];
    }
    return [`extract ${srcArg(source)}type=delim delimiter=${kqlString(t.delims[0])} ${kqlString(t.fields.join(','))}`];
  }
  return [];
}

/** Resolve a LOOKUP-x spec to an SPL `lookup` argument string (using the definition's file name) plus Cribl lookup options. */
export function resolveLookupSpec(spec: string, k: Knowledge, ctx: Ctx): { spec: string; criblOpts: string } | null {
  const parts = spec.trim().split(/\s+/);
  const def = parts[0];
  const t = k.transforms[def];
  if (!t) {
    ctx.note('warning', `Lookup definition "${def}" is not in the loaded transforms; using the name as the lookup file.`);
    return { spec, criblOpts: '' };
  }
  if (t.collection && !t.filename) {
    ctx.note('error', `Lookup "${def}" is backed by KV store collection "${t.collection}", which Cribl Search cannot read; skipped.`);
    return null;
  }
  const file = (t.filename ?? def).replace(/\.csv$/i, '');
  let criblOpts = '';
  if (t.matchType && /CIDR\(/i.test(t.matchType)) criblOpts = 'matchMode=cidr';
  if (t.matchType && /WILDCARD\(/i.test(t.matchType)) ctx.note('warning', `Lookup "${def}" uses WILDCARD matching; Cribl supports exact, cidr and regex match modes. Convert the lookup column to a regex and use matchMode=regex.`);
  return { spec: `${file} ${parts.slice(1).join(' ')}`, criblOpts };
}

/** Translate a resolved lookup into KQL stages, injecting Cribl-only options into the lookup operator. */
export function lookupStages(resolved: { spec: string; criblOpts: string }, ctx: Ctx, lookupToKql: (spec: string, ctx: Ctx) => string[]): string[] {
  return lookupToKql(resolved.spec, ctx).map((line) => (resolved.criblOpts && line.startsWith('lookup ') ? `lookup ${resolved.criblOpts} ${line.slice(7)}` : line));
}

/** Build shim stages for one sourcetype. Returns [] when nothing is known about it. */
export function buildShim(sourcetype: string, k: Knowledge, ctx: Ctx, opts: ShimOptions): string[] {
  const sk: SourcetypeKnowledge | undefined = k.props[sourcetype];
  if (!sk) return [];
  const stages: string[] = [];
  const prevCommand = ctx.command;
  ctx.command = `shim:${sourcetype}`;

  const members = opts.guardSourcetypes?.length ? opts.guardSourcetypes : [sourcetype];
  const isSt = members.length === 1 ? `sourcetype == ${kqlString(members[0])}` : `sourcetype in (${members.map(kqlString).join(', ')})`;
  const only = (field: string, expr: string) => (opts.guarded ? `${field} = iff(${isSt}, ${expr}, ${field})` : `${field} = ${expr}`);

  // 1. Extractions (EXTRACT-* then REPORT-*, one extract stage per regex)
  const exStages: string[] = [];
  // Guarded: the extract operator leaves existing fields alone when nothing matches, so other
  // sourcetypes are excluded by extracting from a copy of the source that is empty for them.
  const copies = new Map<string, string>();
  const srcArg: SourceArg = (source) => {
    if (!opts.guarded) return source === '_raw' ? '' : `source=${fieldRef(source, ctx)} `;
    let tmp = copies.get(source);
    if (!tmp) {
      tmp = `__shim_src${copies.size}`;
      copies.set(source, tmp);
      exStages.push(`extend ${tmp} = iff(${isSt}, ${fieldRef(source, ctx)}, "")`);
    }
    return `source=${tmp} `;
  };
  for (const e of sk.extracts) {
    const st = regexStage(e.regex, e.inField ?? '_raw', undefined, k, ctx, `EXTRACT-${e.name}`, false, srcArg);
    if (st) exStages.push(st);
  }
  for (const r of sk.reports) {
    for (const tn of r.transforms) {
      const t = k.transforms[tn];
      if (!t) {
        ctx.note('warning', `REPORT-${r.name}: transform "${tn}" is not in the loaded transforms.`);
        continue;
      }
      exStages.push(...transformStages(t, k, ctx, srcArg));
    }
  }
  stages.push(...exStages);
  if (copies.size) stages.push(`project-away ${[...copies.values()].join(', ')}`);
  if (sk.kvMode && /^(json|xml|auto)$/i.test(sk.kvMode)) ctx.note('info', `KV_MODE=${sk.kvMode}: Cribl Search parses JSON and key=value pairs automatically; nothing emitted.`);

  // 2. Field aliases
  const aliases = sk.aliases.flatMap((a) => a.pairs);
  if (aliases.length) {
    stages.push(`extend ${aliases.map((p) => only(fieldRef(p.to, ctx), p.asNew ? `coalesce(${fieldRef(p.to, ctx)}, ${fieldRef(p.from, ctx)})` : fieldRef(p.from, ctx))).join(', ')}`);
  }

  // 3. Calculated fields (EVAL-*). Splunk evaluates them independently of each other.
  if (sk.evals.length) {
    stages.push(`extend ${sk.evals.map((e) => only(fieldRef(e.field, ctx), translateExpr(e.expr, ctx))).join(', ')}`);
  }

  // 4. Lookups
  for (const l of sk.lookups) {
    const resolved = resolveLookupSpec(l.spec, k, ctx);
    if (resolved) stages.push(...lookupStages(resolved, ctx, opts.lookupToKql));
  }
  if (opts.guarded && sk.lookups.length) ctx.note('warning', `Automatic lookups of sourcetype "${sourcetype}" cannot be limited to that sourcetype; they also enrich matching events of the other sourcetypes in scope.`);

  if (stages.length) {
    ctx.note('info', `Applied Splunk knowledge for sourcetype "${members.join('", "')}": ${exStages.filter((x) => x.startsWith('extract ')).length} extraction(s), ${aliases.length} alias(es), ${sk.evals.length} calculated field(s), ${sk.lookups.length} lookup(s).`);
    stages.unshift(`// Splunk search-time fields for ${members.map((m) => `sourcetype=${m}`).join(', ')}`);
  }
  ctx.command = prevCommand;
  return stages;
}

/** Sourcetypes in the knowledge that match a (possibly wildcarded) sourcetype term. */
export function matchSourcetypes(pattern: string, k: Knowledge): string[] {
  if (!pattern.includes('*')) return k.props[pattern] ? [pattern] : [];
  const re = new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 'i');
  return Object.keys(k.props).filter((s) => re.test(s));
}
