/**
 * Resolve Splunk data models (e.g. CIM `Web.Web`) into their constraint
 * searches and calculated fields so `tstats ... from datamodel=` and
 * `| datamodel X Y search` can be translated.
 */
import { fieldRef, kqlVerbatim, translateExpr } from '../translator/expr';
import type { Ctx } from '../translator/types';
import { convertSplunkRegex } from './regex';
import { lookupStages, resolveLookupSpec } from './shim';
import type { DataModel, DmObject, Knowledge } from './types';

export interface ResolvedModel {
  model: DataModel;
  /** Root object first, requested object last. */
  chain: DmObject[];
}

/** `Web`, `Web.Web`, `"Web"."Web"`, `Network_Traffic.All_Traffic` → model + object chain. */
export function resolveDataModel(ref: string, k: Knowledge): ResolvedModel | null {
  const cleaned = ref.replace(/"/g, '').trim();
  const [modelName, objectName] = cleaned.split('.');
  const model = k.models[modelName];
  if (!model) return null;
  const target = objectName ?? modelName;
  let obj = model.objects.find((o) => o.name === target) ?? model.objects.find((o) => !o.parent);
  if (!obj) return null;
  const chain: DmObject[] = [];
  const seen = new Set<string>();
  while (obj && !seen.has(obj.name)) {
    seen.add(obj.name);
    chain.unshift(obj);
    obj = obj.parent ? model.objects.find((o) => o.name === obj!.parent) : undefined;
  }
  return { model, chain };
}

/** All constraint searches of the chain, root first, joined as one SPL search expression. */
export function constraintSearch(r: ResolvedModel): string {
  const parts = r.chain.flatMap((o) => o.constraints).filter((c) => c.trim());
  return parts.map((p) => `(${p})`).join(' ');
}

/** Calculated fields of the chain (root first) as KQL stages. */
export function calculationStages(r: ResolvedModel, k: Knowledge, ctx: Ctx, lookupToKql: (spec: string, ctx: Ctx) => string[]): string[] {
  const stages: string[] = [];
  const evals: string[] = [];
  for (const o of r.chain) {
    for (const c of o.calculations) {
      if (c.type === 'Eval' && c.expression && c.outputFields[0]) {
        evals.push(`${fieldRef(c.outputFields[0], ctx)} = ${translateExpr(c.expression, ctx)}`);
      } else if (c.type === 'Rex' && c.expression) {
        const conv = convertSplunkRegex(c.expression, k.transforms);
        for (const n of conv.notes) ctx.note('warning', `Data model ${o.name} rex: ${n}`);
        const src = fieldRef(c.inputField ?? '_raw', ctx);
        for (const g of conv.groups) evals.push(`${fieldRef(g.name, ctx)} = extract(${kqlVerbatim(conv.regex)}, ${g.index}, ${src})`);
      } else if (c.type === 'Lookup' && c.lookupName) {
        const inputs = (c.lookupInputs ?? []).map((i) => (i.inputField === i.lookupField ? i.lookupField : `${i.lookupField} AS ${i.inputField}`)).join(' ');
        const outputs = c.outputFields.length ? ` OUTPUTNEW ${c.outputFields.join(' ')}` : '';
        const resolved = resolveLookupSpec(`${c.lookupName} ${inputs}${outputs}`, k, ctx);
        if (resolved) {
          if (evals.length) {
            stages.push(`extend ${evals.join(', ')}`);
            evals.length = 0;
          }
          stages.push(...lookupStages(resolved, ctx, lookupToKql));
        }
      } else if (c.type === 'GeoIP') {
        ctx.note('warning', `Data model ${o.name} uses a GeoIP calculation on ${c.inputField ?? 'an IP field'}; add \`ip-lookup <mmdb> on ${c.inputField ?? 'field'}\` with your GeoIP lookup.`);
      }
    }
  }
  if (evals.length) stages.push(`extend ${evals.join(', ')}`);
  return stages;
}

/** Object names in the chain, used to strip `Object.field` prefixes from field references. */
export function objectPrefixes(r: ResolvedModel): string[] {
  return [...new Set([r.model.name, ...r.chain.map((o) => o.name)])];
}
