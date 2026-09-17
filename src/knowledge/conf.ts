/**
 * Parsers for Splunk .conf files and data model JSON, producing Knowledge.
 */
import { emptyKnowledge, mergeKnowledge, type AliasPair, type DataModel, type DmObject, type Knowledge, type SourcetypeKnowledge, type Transform } from './types';

export type ConfStanzas = Record<string, Record<string, string>>;

/** Parse Splunk .conf text: [stanza] blocks of key = value with `\` line continuations. */
export function parseConf(text: string): ConfStanzas {
  const out: ConfStanzas = {};
  let current: Record<string, string> | null = null;
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    // continuation lines
    while (line.endsWith('\\') && i + 1 < lines.length) {
      line = line.slice(0, -1) + '\n' + lines[++i];
    }
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) continue;
    const st = /^\[(.*)\]\s*$/.exec(trimmed);
    if (st) {
      current = out[st[1]] ?? {};
      out[st[1]] = current;
      continue;
    }
    const eq = line.indexOf('=');
    if (eq === -1 || !current) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (key) current[key] = value;
  }
  return out;
}

const ALIAS_RE = /(\S+)\s+(AS|ASNEW)\s+(\S+)/gi;

function parseAliasPairs(spec: string): AliasPair[] {
  const pairs: AliasPair[] = [];
  for (const m of spec.replace(/,/g, ' ').matchAll(ALIAS_RE)) {
    pairs.push({ from: unq(m[1]), to: unq(m[3]), asNew: m[2].toUpperCase() === 'ASNEW' });
  }
  return pairs;
}

const unq = (s: string) => s.replace(/^"(.*)"$/, '$1');

function stanzaSourcetype(stanza: string): string | null {
  // Only sourcetype stanzas are supported; [source::...] and [host::...] are skipped.
  if (/^(source|host|rule|delayedrule)::/i.test(stanza)) return null;
  if (stanza.startsWith('(?::){0}')) return null;
  return stanza;
}

function stKnowledge(props: Record<string, SourcetypeKnowledge>, st: string): SourcetypeKnowledge {
  return (props[st] ??= { sourcetype: st, extracts: [], reports: [], aliases: [], evals: [], lookups: [] });
}

/** props.conf → per-sourcetype knowledge (search-time classes only). */
export function knowledgeFromProps(text: string): Knowledge {
  const k = emptyKnowledge();
  const stanzas = parseConf(text);
  for (const [stanza, kv] of Object.entries(stanzas)) {
    const st = stanzaSourcetype(stanza);
    if (!st) continue;
    for (const [key, value] of Object.entries(kv)) {
      const m = /^(EXTRACT|REPORT|FIELDALIAS|EVAL|LOOKUP)-(.+)$/i.exec(key);
      if (key.toUpperCase() === 'KV_MODE') {
        stKnowledge(k.props, st).kvMode = value;
        continue;
      }
      if (!m) continue;
      const sk = stKnowledge(k.props, st);
      const cls = m[1].toUpperCase();
      const name = m[2];
      if (cls === 'EXTRACT') {
        const inField = /\s+in\s+(\S+)\s*$/i.exec(value);
        sk.extracts.push({ name, regex: inField ? value.slice(0, inField.index) : value, inField: inField?.[1] });
      } else if (cls === 'REPORT') {
        sk.reports.push({ name, transforms: value.split(/\s*,\s*/).filter(Boolean) });
      } else if (cls === 'FIELDALIAS') {
        sk.aliases.push({ name, pairs: parseAliasPairs(value) });
      } else if (cls === 'EVAL') {
        sk.evals.push({ name, field: name, expr: value });
      } else if (cls === 'LOOKUP') {
        sk.lookups.push({ name, spec: value });
      }
    }
  }
  return k;
}

/** transforms.conf → transforms (regex extractions and lookup definitions). */
export function knowledgeFromTransforms(text: string): Knowledge {
  const k = emptyKnowledge();
  for (const [name, kv] of Object.entries(parseConf(text))) {
    const t: Transform = { name };
    const get = (key: string) => Object.entries(kv).find(([kk]) => kk.toUpperCase() === key)?.[1];
    if (get('REGEX')) t.regex = get('REGEX');
    if (get('FORMAT')) t.format = get('FORMAT');
    if (get('DELIMS')) t.delims = [...get('DELIMS')!.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1].replace(/\\(.)/g, '$1'));
    if (get('FIELDS')) t.fields = get('FIELDS')!.split(/\s*,\s*/).map(unq);
    if (get('SOURCE_KEY')) t.sourceKey = get('SOURCE_KEY');
    if (/^true$/i.test(get('MV_ADD') ?? '')) t.mvAdd = true;
    if (/^true$/i.test(get('REPEAT_MATCH') ?? '')) t.repeatMatch = true;
    if (get('FILENAME')) {
      t.filename = get('FILENAME');
      k.lookupFiles.push(t.filename!);
    }
    if (get('COLLECTION')) t.collection = get('COLLECTION');
    if (get('MATCH_TYPE')) t.matchType = get('MATCH_TYPE');
    if (get('CASE_SENSITIVE_MATCH') !== undefined) t.caseSensitive = !/^false$/i.test(get('CASE_SENSITIVE_MATCH')!);
    k.transforms[name] = t;
  }
  return k;
}

/** macros.conf → zero-argument macro definitions. */
export function knowledgeFromMacros(text: string): Knowledge {
  const k = emptyKnowledge();
  for (const [name, kv] of Object.entries(parseConf(text))) {
    if (/\(\d+\)$/.test(name)) continue; // macros with arguments are not expanded
    const def = kv.definition ?? kv.DEFINITION;
    if (def !== undefined) k.macros[name] = def;
  }
  return k;
}

/** eventtypes.conf → eventtypes (tags are added by applyTags). */
export function knowledgeFromEventtypes(text: string): Knowledge {
  const k = emptyKnowledge();
  for (const [name, kv] of Object.entries(parseConf(text))) {
    const search = kv.search ?? kv.SEARCH;
    if (search) k.eventtypes.push({ name, search, tags: [] });
  }
  return k;
}

/** tags.conf → tags attached to eventtypes (only `[eventtype=name]` stanzas are used). */
export function applyTags(k: Knowledge, text: string): Knowledge {
  const stanzas = parseConf(text);
  const byName = new Map(k.eventtypes.map((e) => [e.name, e]));
  for (const [stanza, kv] of Object.entries(stanzas)) {
    const m = /^eventtype=(.+)$/.exec(stanza);
    if (!m) continue;
    const name = m[1].replace(/%3A/gi, ':');
    const tags = Object.entries(kv)
      .filter(([, v]) => /^enabled$/i.test(v))
      .map(([t]) => t);
    const et = byName.get(name);
    if (et) et.tags = [...new Set([...et.tags, ...tags])];
    else {
      const created = { name, search: '', tags };
      k.eventtypes.push(created);
      byName.set(name, created);
    }
  }
  return k;
}

interface RawDm {
  modelName?: string;
  displayName?: string;
  objectNameList?: string[];
  objects?: RawDmObject[];
}
interface RawDmObject {
  objectName: string;
  parentName?: string;
  constraints?: { search: string }[];
  fields?: { fieldName: string; type?: string; displayName?: string }[];
  calculations?: {
    calculationType?: string;
    outputFields?: { fieldName: string }[];
    expression?: string;
    inputField?: string;
    lookupName?: string;
    lookupInputs?: { inputField: string; lookupField: string }[];
  }[];
}

/** Data model JSON (Splunk_SA_CIM/default/data/models/X.json or the REST `description`) → DataModel. */
export function dataModelFromJson(json: string | RawDm, fallbackName?: string): DataModel {
  const raw: RawDm = typeof json === 'string' ? (JSON.parse(json) as RawDm) : json;
  const objects: DmObject[] = (raw.objects ?? []).map((o) => ({
    name: o.objectName,
    parent: o.parentName && o.parentName !== 'BaseEvent' && o.parentName !== 'BaseSearch' && o.parentName !== 'BaseTransaction' ? o.parentName : undefined,
    constraints: (o.constraints ?? []).map((c) => c.search).filter(Boolean),
    fields: (o.fields ?? []).map((f) => ({ name: f.fieldName, type: f.type, displayName: f.displayName })),
    calculations: (o.calculations ?? []).map((c) => ({
      type: c.calculationType ?? 'Eval',
      outputFields: (c.outputFields ?? []).map((f) => f.fieldName),
      expression: c.expression,
      inputField: c.inputField,
      lookupName: c.lookupName,
      lookupInputs: c.lookupInputs,
    })),
  }));
  return { name: raw.modelName ?? fallbackName ?? 'model', displayName: raw.displayName, objects };
}

/** Build knowledge from a set of files (name → text), e.g. an unpacked TA or app. */
export function knowledgeFromFiles(files: { path: string; text: string }[], sourceLabel = 'files'): Knowledge {
  let k = emptyKnowledge();
  const tagTexts: string[] = [];
  const csvNames: string[] = [];
  // Splunk lets local/ settings override default/ ones; archives list files in any order, so default/ is read first.
  const rank = (path: string) => (path.toLowerCase().includes('/local/') ? 1 : 0);
  const ordered = files.map((f, i) => ({ f, i })).sort((x, y) => rank(x.f.path) - rank(y.f.path) || x.i - y.i).map((x) => x.f);
  for (const f of ordered) {
    const base = f.path.split('/').pop() ?? f.path;
    const lower = f.path.toLowerCase();
    if (lower.includes('/local/') || lower.includes('/default/') || !lower.includes('/')) {
      if (base === 'props.conf') k = mergeKnowledge(k, knowledgeFromProps(f.text));
      else if (base === 'transforms.conf') k = mergeKnowledge(k, knowledgeFromTransforms(f.text));
      else if (base === 'eventtypes.conf') k = mergeKnowledge(k, knowledgeFromEventtypes(f.text));
      else if (base === 'macros.conf') k = mergeKnowledge(k, knowledgeFromMacros(f.text));
      else if (base === 'tags.conf') tagTexts.push(f.text);
    }
    if (lower.includes('/data/models/') && lower.endsWith('.json')) {
      try {
        const dm = dataModelFromJson(f.text, base.replace(/\.json$/i, ''));
        k.models[dm.name] = dm;
      } catch {
        /* not a data model */
      }
    }
    if (lower.includes('/lookups/') && lower.endsWith('.csv')) csvNames.push(base);
  }
  for (const t of tagTexts) applyTags(k, t);
  k.lookupFiles = [...new Set([...k.lookupFiles, ...csvNames])];
  k.sources = [sourceLabel];
  return k;
}
