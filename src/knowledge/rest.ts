/**
 * Build Knowledge from Splunk REST API payloads (the same objects a TA's .conf
 * files declare, as returned by splunkd). Used by the backend `splunkSync`
 * endpoint; the payload shapes were verified against Splunk 10.4.
 *
 * Endpoints (all with output_mode=json, count=0):
 *   /services/data/props/extractions      EXTRACT-* (type "Inline") and REPORT-* (type "Uses transform")
 *   /services/data/props/fieldaliases     FIELDALIAS-*
 *   /services/data/props/calcfields       EVAL-*
 *   /services/data/props/lookups          LOOKUP-*
 *   /services/data/transforms/extractions REGEX/FORMAT/DELIMS/FIELDS/SOURCE_KEY/MV_ADD/REPEAT_MATCH
 *   /services/data/transforms/lookups     filename/match_type/case_sensitive_match/collection
 *   /services/saved/eventtypes            search + tags
 *   /services/configs/conf-macros         definition (+ args)
 *   /services/datamodel/model             `description` holds the model JSON
 */
import { applyTags, dataModelFromJson, knowledgeFromEventtypes, knowledgeFromMacros, knowledgeFromProps, knowledgeFromTransforms } from './conf';
import { emptyKnowledge, mergeKnowledge, type Knowledge } from './types';

export interface RestEntry {
  name: string;
  content: Record<string, unknown>;
}

export interface RestPayloads {
  propsExtractions?: RestEntry[];
  fieldaliases?: RestEntry[];
  calcfields?: RestEntry[];
  propsLookups?: RestEntry[];
  transformsExtractions?: RestEntry[];
  transformsLookups?: RestEntry[];
  eventtypes?: RestEntry[];
  macros?: RestEntry[];
  datamodels?: RestEntry[];
}

const str = (v: unknown): string => (v === undefined || v === null ? '' : String(v));

/** Synthesize props.conf text from the props/* endpoints (each entry names "stanza : ATTRIBUTE"). */
function propsConf(entries: RestEntry[]): string {
  const byStanza = new Map<string, string[]>();
  for (const e of entries) {
    const c = e.content;
    const stanza = str(c.stanza) || e.name.split(' : ')[0];
    const attr = str(c.attribute) || e.name.split(' : ')[1];
    const value = str(c.value);
    if (!stanza || !attr || !value) continue;
    if (!byStanza.has(stanza)) byStanza.set(stanza, []);
    byStanza.get(stanza)!.push(`${attr} = ${value.replace(/\n/g, '\\\n')}`);
  }
  return [...byStanza.entries()].map(([s, lines]) => `[${s}]\n${lines.join('\n')}`).join('\n\n');
}

function transformsConf(extractions: RestEntry[], lookups: RestEntry[]): string {
  const stanzas: string[] = [];
  for (const e of extractions) {
    const c = e.content;
    const lines: string[] = [];
    if (str(c.REGEX)) lines.push(`REGEX = ${str(c.REGEX)}`);
    if (str(c.FORMAT)) lines.push(`FORMAT = ${str(c.FORMAT)}`);
    if (str(c.DELIMS)) lines.push(`DELIMS = ${str(c.DELIMS)}`);
    if (str(c.FIELDS)) lines.push(`FIELDS = ${str(c.FIELDS)}`);
    if (str(c.SOURCE_KEY) && str(c.SOURCE_KEY) !== '_raw') lines.push(`SOURCE_KEY = ${str(c.SOURCE_KEY)}`);
    if (c.MV_ADD === true || str(c.MV_ADD).toLowerCase() === 'true') lines.push('MV_ADD = true');
    if (c.REPEAT_MATCH === true || str(c.REPEAT_MATCH).toLowerCase() === 'true') lines.push('REPEAT_MATCH = true');
    if (lines.length) stanzas.push(`[${e.name}]\n${lines.join('\n')}`);
  }
  for (const e of lookups) {
    const c = e.content;
    const lines: string[] = [];
    if (str(c.filename)) lines.push(`filename = ${str(c.filename)}`);
    if (str(c.collection)) lines.push(`collection = ${str(c.collection)}`);
    if (str(c.match_type)) lines.push(`match_type = ${str(c.match_type)}`);
    if (c.case_sensitive_match !== undefined) lines.push(`case_sensitive_match = ${str(c.case_sensitive_match)}`);
    if (lines.length) stanzas.push(`[${e.name}]\n${lines.join('\n')}`);
  }
  return stanzas.join('\n\n');
}

function eventtypesConf(entries: RestEntry[]): { eventtypes: string; tags: string } {
  const et: string[] = [];
  const tags: string[] = [];
  for (const e of entries) {
    const search = str(e.content.search);
    if (!search) continue;
    et.push(`[${e.name}]\nsearch = ${search.replace(/\n/g, ' ')}`);
    const t = e.content.tags;
    const list = Array.isArray(t) ? t.map(String) : typeof t === 'string' ? t.split(/[\s,]+/) : [];
    if (list.length) tags.push(`[eventtype=${e.name}]\n${list.filter(Boolean).map((x) => `${x} = enabled`).join('\n')}`);
  }
  return { eventtypes: et.join('\n\n'), tags: tags.join('\n\n') };
}

function macrosConf(entries: RestEntry[]): string {
  return entries
    .filter((e) => str(e.content.definition) !== '')
    .map((e) => `[${e.name}]\ndefinition = ${str(e.content.definition).replace(/\n/g, ' ')}`)
    .join('\n\n');
}

/** Convert REST payloads into Knowledge. */
export function knowledgeFromRest(p: RestPayloads, sourceLabel = 'splunk-rest'): Knowledge {
  let k = emptyKnowledge();
  const props = propsConf([...(p.propsExtractions ?? []), ...(p.fieldaliases ?? []), ...(p.calcfields ?? []), ...(p.propsLookups ?? [])]);
  if (props) k = mergeKnowledge(k, knowledgeFromProps(props));
  const transforms = transformsConf(p.transformsExtractions ?? [], p.transformsLookups ?? []);
  if (transforms) k = mergeKnowledge(k, knowledgeFromTransforms(transforms));
  const ev = eventtypesConf(p.eventtypes ?? []);
  if (ev.eventtypes) k = mergeKnowledge(k, knowledgeFromEventtypes(ev.eventtypes));
  if (ev.tags) applyTags(k, ev.tags);
  const macros = macrosConf(p.macros ?? []);
  if (macros) k = mergeKnowledge(k, knowledgeFromMacros(macros));
  for (const e of p.datamodels ?? []) {
    const desc = str(e.content.description);
    if (!desc.startsWith('{')) continue;
    try {
      const dm = dataModelFromJson(desc, e.name);
      k.models[dm.name] = dm;
    } catch {
      /* not a model */
    }
  }
  k.sources = [sourceLabel];
  return k;
}

/** Unwrap a splunkd JSON response (`{ entry: [...] }`) into RestEntry[]. */
export function restEntries(body: unknown): RestEntry[] {
  const entry = (body as { entry?: unknown[] })?.entry;
  if (!Array.isArray(entry)) return [];
  return entry
    .filter((e): e is { name: string; content?: Record<string, unknown> } => !!e && typeof e === 'object' && 'name' in (e as object))
    .map((e) => ({ name: e.name, content: e.content ?? {} }));
}
