import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ungzip } from 'pako';
import { readTar } from '../src/knowledge/archive';
import { knowledgeFromFiles } from '../src/knowledge/conf';
import { mergeKnowledge } from '../src/knowledge/types';
import { translate } from '../src/translator';

const load = (name: string) => readTar(ungzip(new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)))));

describe('app package reader', () => {
  it('extracts knowledge files from a TA .tgz and translates CIM fields with it', () => {
    const ta = load('TA-spl2kql-web.tgz');
    expect(ta.map((f) => f.path).sort()).toEqual([
      '/TA-spl2kql-web/default/eventtypes.conf',
      '/TA-spl2kql-web/default/props.conf',
      '/TA-spl2kql-web/default/tags.conf',
      '/TA-spl2kql-web/default/transforms.conf',
      '/TA-spl2kql-web/lookups/http_status.csv',
    ]);
    const cim = load('Splunk_SA_CIM-models.tgz');
    expect(cim.map((f) => f.path)).toContain('/Splunk_SA_CIM/default/data/models/Web.json');
    const k = mergeKnowledge(knowledgeFromFiles(ta, 'TA-spl2kql-web'), knowledgeFromFiles(cim, 'Splunk_SA_CIM'));
    expect(Object.keys(k.models).sort()).toEqual(['Authentication', 'Web']);
    expect(k.eventtypes.find((e) => e.name === 'web_access')?.tags).toEqual(['web']);
    expect(k.macros.cim_Web_indexes).toBe('()');
    const r = translate('| tstats count from datamodel=Web.Web by Web.action', { knowledge: k, defaultDataset: 'main' });
    expect(r.kql).toContain('sourcetype=access_combined OR sourcetype=access_common');
    expect(r.kql).toContain('| extend src = clientip, url = uri');
    expect(r.kql).toContain('| lookup output="status_description,status_type" http_status on status');
    expect(r.kql).toContain('| summarize count = count() by action');
    expect(r.unsupportedCount).toBe(0);
  });
});
