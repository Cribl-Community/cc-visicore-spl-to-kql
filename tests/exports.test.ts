import { describe, expect, it } from 'vitest';
import { describeExport, findExports } from '../src/exports';
import { stripKqlComments, translate } from '../src/translator';

const exportsOf = (spl: string) => findExports(stripKqlComments(translate(spl).kql));

describe('export targets', () => {
  it('names the lookup and mode written by outputlookup', () => {
    // Splunk outputlookup replaces the lookup; Cribl export defaults to create, which fails on an existing lookup.
    expect(exportsOf('index=w | stats count by host | outputlookup hosts.csv')).toEqual([{ kind: 'lookup', name: 'hosts', mode: 'overwrite' }]);
    expect(exportsOf('index=w | stats count by host | outputlookup append=t hosts.csv')).toEqual([{ kind: 'lookup', name: 'hosts', mode: 'append' }]);
  });
  it('names Lake and Search dataset targets', () => {
    expect(exportsOf('index=w | stats count by host | collect index=summary')).toEqual([{ kind: 'lake', name: 'summary' }]);
    expect(findExports('dataset="w" | export to search my_ds')).toEqual([{ kind: 'search', name: 'my_ds' }]);
    expect(findExports('dataset="w" | export mode=create to lookup "my lookup"')).toEqual([{ kind: 'lookup', name: 'my lookup', mode: 'create' }]);
  });
  it('finds nothing in queries that only read', () => {
    expect(exportsOf('index=w | lookup hosts host | stats count')).toEqual([]);
    expect(findExports('dataset="w" | where msg has "export to lookup"')).toEqual([]);
  });
  it('describes irreversible writes explicitly', () => {
    expect(describeExport({ kind: 'lookup', name: 'hosts', mode: 'overwrite' })).toMatch(/Replaces the entire contents of the lookup "hosts".*not kept/);
  });
});
