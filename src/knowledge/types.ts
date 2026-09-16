/**
 * Splunk knowledge objects the translator can use to reproduce search-time
 * field extraction (props/transforms), CIM normalisation (aliases, calculated
 * fields, lookups), eventtypes/tags and data models in Cribl Search.
 */

export interface Transform {
  name: string;
  /** Regex-based extraction. */
  regex?: string;
  /** FORMAT string, e.g. "$1::$2" or "field::$1 other::$2". */
  format?: string;
  /** Delimiter-based extraction. */
  delims?: string[];
  fields?: string[];
  /** Field the regex runs against (default _raw). */
  sourceKey?: string;
  mvAdd?: boolean;
  repeatMatch?: boolean;
  /** Lookup definition: CSV file name. */
  filename?: string;
  /** Lookup definition: KV store collection (unsupported). */
  collection?: string;
  /** e.g. "CIDR(src_ip)" or "WILDCARD(host)". */
  matchType?: string;
  caseSensitive?: boolean;
}

export interface Extract {
  name: string;
  regex: string;
  /** `EXTRACT-x = regex in field` */
  inField?: string;
}

export interface AliasPair {
  from: string;
  to: string;
  /** ASNEW: only set the alias when it does not already exist. */
  asNew: boolean;
}

export interface SourcetypeKnowledge {
  sourcetype: string;
  extracts: Extract[];
  /** REPORT-x = transform1, transform2 */
  reports: { name: string; transforms: string[] }[];
  aliases: { name: string; pairs: AliasPair[] }[];
  evals: { name: string; field: string; expr: string }[];
  /** LOOKUP-x = <definition> <lookupField> [AS <eventField>] ... [OUTPUT|OUTPUTNEW ...] */
  lookups: { name: string; spec: string }[];
  kvMode?: string;
}

export interface Eventtype {
  name: string;
  search: string;
  tags: string[];
}

export interface DmField {
  name: string;
  type?: string;
  /** Present when the field is only a display alias. */
  displayName?: string;
}

export interface DmCalculation {
  type: 'Eval' | 'Rex' | 'Lookup' | 'GeoIP' | string;
  outputFields: string[];
  /** Eval: expression. Rex: regex. Lookup: lookup name. */
  expression?: string;
  inputField?: string;
  lookupName?: string;
  lookupInputs?: { inputField: string; lookupField: string }[];
}

export interface DmObject {
  name: string;
  parent?: string;
  /** Raw SPL constraint searches (applied on top of the parent's). */
  constraints: string[];
  fields: DmField[];
  calculations: DmCalculation[];
}

export interface DataModel {
  name: string;
  displayName?: string;
  objects: DmObject[];
}

export interface Knowledge {
  transforms: Record<string, Transform>;
  /** Keyed by sourcetype stanza name (may contain wildcards, e.g. "access_*"). */
  props: Record<string, SourcetypeKnowledge>;
  eventtypes: Eventtype[];
  models: Record<string, DataModel>;
  /** Lookup file names known from transforms (for validation). */
  lookupFiles: string[];
  /** Search macros without arguments: name → definition (e.g. cim_Web_indexes → "()"). */
  macros: Record<string, string>;
  /** Where the knowledge came from (for the UI). */
  sources: string[];
}

export function emptyKnowledge(): Knowledge {
  return { transforms: {}, props: {}, eventtypes: [], models: {}, lookupFiles: [], macros: {}, sources: [] };
}

/** Merge b into a (b wins on conflicts). */
export function mergeKnowledge(a: Knowledge, b: Knowledge): Knowledge {
  const props = { ...a.props };
  for (const [k, v] of Object.entries(b.props)) {
    const prev = props[k];
    props[k] = prev
      ? {
          sourcetype: k,
          extracts: [...prev.extracts, ...v.extracts],
          reports: [...prev.reports, ...v.reports],
          aliases: [...prev.aliases, ...v.aliases],
          evals: [...prev.evals, ...v.evals],
          lookups: [...prev.lookups, ...v.lookups],
          kvMode: v.kvMode ?? prev.kvMode,
        }
      : v;
  }
  const et = new Map(a.eventtypes.map((e) => [e.name, e]));
  for (const e of b.eventtypes) {
    const prev = et.get(e.name);
    et.set(e.name, prev ? { ...prev, ...e, tags: [...new Set([...prev.tags, ...e.tags])] } : e);
  }
  return {
    transforms: { ...a.transforms, ...b.transforms },
    props,
    eventtypes: [...et.values()],
    models: { ...a.models, ...b.models },
    lookupFiles: [...new Set([...a.lookupFiles, ...b.lookupFiles])],
    macros: { ...a.macros, ...b.macros },
    sources: [...new Set([...a.sources, ...b.sources])],
  };
}

/** Summary counts for the UI. */
export function knowledgeSummary(k: Knowledge) {
  const st = Object.values(k.props);
  return {
    sourcetypes: st.length,
    extractions: st.reduce((n, s) => n + s.extracts.length + s.reports.length, 0),
    aliases: st.reduce((n, s) => n + s.aliases.reduce((m, a) => m + a.pairs.length, 0), 0),
    evals: st.reduce((n, s) => n + s.evals.length, 0),
    lookups: st.reduce((n, s) => n + s.lookups.length, 0),
    eventtypes: k.eventtypes.length,
    models: Object.keys(k.models).length,
    transforms: Object.keys(k.transforms).length,
    macros: Object.keys(k.macros ?? {}).length,
  };
}
