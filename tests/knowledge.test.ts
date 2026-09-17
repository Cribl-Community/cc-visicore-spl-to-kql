import { describe, expect, it } from 'vitest';
import { translate } from '../src/translator';
import { applyTags, dataModelFromJson, knowledgeFromEventtypes, knowledgeFromFiles, knowledgeFromMacros, knowledgeFromProps, knowledgeFromTransforms, parseConf } from '../src/knowledge/conf';
import { convertSplunkRegex, expandMacros, pcreToRe2 } from '../src/knowledge/regex';
import { emptyKnowledge, mergeKnowledge, type Knowledge } from '../src/knowledge/types';

const PROPS = `
[access_combined]
REPORT-access = access-extractions
FIELDALIAS-cim = clientip AS src uri AS url, method ASNEW http_method
EVAL-action = if(status >= 400, "failure", "success")
EVAL-app = "apache"
EXTRACT-ext = \\.(?<uri_extension>[a-zA-Z0-9]+)(?:\\?|$) in uri
LOOKUP-status = http_status_lookup status OUTPUT status_description status_type
KV_MODE = none

[source::/var/log/foo]
EXTRACT-x = (?<x>\\d+)
`;

const TRANSFORMS = `
[nspaces]
REGEX = \\S+

[sbstring]
REGEX = \\[(?<>[^\\]]*+)\\]

[bc_domain]
REGEX = (?<domain>\\w++://[^/\\s"]++)

[access-extractions]
REGEX = ^[[nspaces:clientip]]\\s++[[nspaces:ident]]\\s++[[sbstring:req_time]]\\s++"(?<method>\\S+)\\s+(?<uri>[[bc_domain:uri_]]?\\S+)"\\s++[[nspaces:status]]

[http_status_lookup]
filename = http_status.csv

[cidr_lookup]
filename = nets.csv
match_type = CIDR(cidr)

[delim-fields]
DELIMS = ","
FIELDS = a, b, "c"

[fmt-fields]
REGEX = (\\d+)-(\\w+)
FORMAT = num::$1 word::$2
`;

const EVENTTYPES = `
[web_access]
search = sourcetype=access_combined OR sourcetype=access_common

[audit]
search = index=_audit sourcetype=audittrail
`;

const TAGS = `
[eventtype=web_access]
web = enabled
proxy = disabled

[eventtype=audit]
change = enabled
`;

const MACROS = `
[cim_Web_indexes]
definition = ()

[with_args(1)]
definition = index=$idx$
`;

const WEB_MODEL = JSON.stringify({
  modelName: 'Web',
  objects: [
    {
      objectName: 'Web',
      parentName: 'BaseEvent',
      constraints: [{ search: '(`cim_Web_indexes`) tag=web' }],
      fields: [{ fieldName: 'action' }, { fieldName: 'status' }, { fieldName: 'src' }, { fieldName: 'url' }],
      calculations: [
        { calculationType: 'Eval', outputFields: [{ fieldName: 'action' }], expression: 'if(isnull(action) OR action="","unknown",action)' },
        { calculationType: 'Rex', outputFields: [{ fieldName: 'url_domain' }], inputField: 'url', expression: '^(?<url_domain>\\w+://[^/]+)' },
      ],
    },
    { objectName: 'Proxy', parentName: 'Web', constraints: [{ search: 'tag=proxy' }], fields: [{ fieldName: 'category' }], calculations: [] },
  ],
});

function knowledge(): Knowledge {
  let k = mergeKnowledge(emptyKnowledge(), knowledgeFromProps(PROPS));
  k = mergeKnowledge(k, knowledgeFromTransforms(TRANSFORMS));
  k = mergeKnowledge(k, knowledgeFromEventtypes(EVENTTYPES));
  k = mergeKnowledge(k, knowledgeFromMacros(MACROS));
  applyTags(k, TAGS);
  const dm = dataModelFromJson(WEB_MODEL);
  k.models[dm.name] = dm;
  return k;
}

const body = (spl: string, opts = {}) =>
  translate(spl, { knowledge: knowledge(), defaultDataset: 'main', ...opts })
    .kql.split('\n')
    .filter((l) => !l.startsWith('//'))
    .join('\n');

describe('conf parsing', () => {
  it('local/ overrides default/ rule by rule, whatever order the package lists the files in', () => {
    const files = [
      { path: '/TA-x/local/props.conf', text: '[st]\nEVAL-x = x + 10\nFIELDALIAS-a = c AS d\n' },
      { path: '/TA-x/default/props.conf', text: '[st]\nEVAL-x = x + 1\nEVAL-y = 2\nFIELDALIAS-a = a AS b\n' },
    ];
    for (const order of [files, [...files].reverse()]) {
      const st = knowledgeFromFiles(order, 'TA-x').props.st;
      expect(st.evals.map((e) => `${e.field}=${e.expr}`)).toEqual(['x=x + 10', 'y=2']);
      expect(st.aliases.map((al) => al.pairs.map((pr) => `${pr.from}>${pr.to}`).join())).toEqual(['c>d']);
    }
    const kql = translate('index=main sourcetype=st | stats count by x', { knowledge: knowledgeFromFiles(files, 'TA-x') }).kql;
    expect(kql.match(/extend .*x = /g)).toHaveLength(1);
  });
  it('merging the same knowledge again leaves the bundle unchanged', () => {
    const k = knowledge();
    const again = mergeKnowledge(k, knowledge());
    expect(again).toEqual(k);
    expect(mergeKnowledge(again, knowledge())).toEqual(k);
  });
  it('parses stanzas, continuations and comments', () => {
    const c = parseConf('# c\n[a]\nk = v \\\n  more\nx=1\n[b]\ny = 2');
    expect(c.a.k).toBe('v \n  more');
    expect(c.a.x).toBe('1');
    expect(c.b.y).toBe('2');
  });
  it('reads props classes and skips source:: stanzas', () => {
    const k = knowledgeFromProps(PROPS);
    const st = k.props.access_combined;
    expect(st.reports[0].transforms).toEqual(['access-extractions']);
    expect(st.aliases[0].pairs).toEqual([
      { from: 'clientip', to: 'src', asNew: false },
      { from: 'uri', to: 'url', asNew: false },
      { from: 'method', to: 'http_method', asNew: true },
    ]);
    expect(st.evals.map((e) => e.field)).toEqual(['action', 'app']);
    expect(st.extracts[0]).toEqual({ name: 'ext', regex: '\\.(?<uri_extension>[a-zA-Z0-9]+)(?:\\?|$)', inField: 'uri' });
    expect(st.lookups[0].spec).toBe('http_status_lookup status OUTPUT status_description status_type');
    expect(st.kvMode).toBe('none');
    expect(Object.keys(k.props)).toEqual(['access_combined']);
  });
  it('reads transforms, lookups, delims and formats', () => {
    const k = knowledgeFromTransforms(TRANSFORMS);
    expect(k.transforms['http_status_lookup'].filename).toBe('http_status.csv');
    expect(k.transforms['cidr_lookup'].matchType).toBe('CIDR(cidr)');
    expect(k.transforms['delim-fields']).toMatchObject({ delims: [','], fields: ['a', 'b', 'c'] });
    expect(k.transforms['fmt-fields'].format).toBe('num::$1 word::$2');
    expect(k.lookupFiles).toEqual(['http_status.csv', 'nets.csv']);
  });
  it('attaches enabled tags to eventtypes and parses zero-arg macros', () => {
    const k = knowledge();
    expect(k.eventtypes.find((e) => e.name === 'web_access')?.tags).toEqual(['web']);
    expect(k.macros).toEqual({ cim_Web_indexes: '()' });
  });
  it('loads a TA directory layout', () => {
    const k = knowledgeFromFiles([
      { path: '/default/props.conf', text: PROPS },
      { path: '/default/transforms.conf', text: TRANSFORMS },
      { path: '/default/eventtypes.conf', text: EVENTTYPES },
      { path: '/default/tags.conf', text: TAGS },
      { path: '/default/data/models/Web.json', text: WEB_MODEL },
      { path: '/lookups/http_status.csv', text: '' },
    ], 'TA-test');
    expect(k.sources).toEqual(['TA-test']);
    expect(Object.keys(k.models)).toEqual(['Web']);
    expect(k.models.Web.objects[1].parent).toBe('Web');
    expect(k.lookupFiles).toContain('http_status.csv');
  });
});

describe('regex conversion', () => {
  const k = knowledge();
  it('expands macros: unnamed placeholder, prefix, and plain wrapping', () => {
    const r = expandMacros('[[nspaces:clientip]] [[sbstring:req_time]] [[bc_domain:uri_]] [[nspaces]]', k.transforms);
    expect(r.regex).toBe('(?<clientip>\\S+) \\[(?<req_time>[^\\]]*+)\\] (?<uri_domain>\\w++://[^/\\s"]++) (?:\\S+)');
  });
  it('rewrites PCRE-only syntax and reports unsupported features', () => {
    expect(pcreToRe2('\\s++\\w*+(?>a|b)x?+').regex).toBe('\\s+\\w*(?:a|b)x?');
    expect(pcreToRe2('(?P<a>x)\\h').regex).toBe('(?<a>x)[ \\t]');
    expect(pcreToRe2('(?<=a)b').notes.join(' ')).toMatch(/lookahead\/lookbehind/);
    expect(pcreToRe2('(a)\\1').notes.join(' ')).toMatch(/backreference/);
  });
  it('indexes named groups after conversion', () => {
    const c = convertSplunkRegex('^(\\d+) (?<a>x)(?:y)(?<b>z)', k.transforms);
    expect(c.groups).toEqual([
      { name: 'a', index: 2 },
      { name: 'b', index: 3 },
    ]);
  });
});

describe('shim', () => {
  it('emits extract, alias, eval and lookup stages for a known sourcetype, in Splunk order', () => {
    expect(body('index=main sourcetype=access_combined | stats count by src, action')).toBe(
      [
        'dataset="main" sourcetype=access_combined',
        '| extract source=uri type=regex regex=@"\\.(?<uri_extension>[a-zA-Z0-9]+)(?:\\?|$)"',
        '| extract type=regex regex=@"^(?<clientip>\\S+)\\s+(?<ident>\\S+)\\s+\\[(?<req_time>[^\\]]*)\\]\\s+""(?<method>\\S+)\\s+(?<uri>(?<uri_domain>\\w+://[^/\\s""]+)?\\S+)""\\s+(?<status>\\S+)"',
        '| extend src = clientip, url = uri, http_method = coalesce(http_method, method)',
        '| extend action = iff(status >= 400, "failure", "success"), app = "apache"',
        '| lookup output="status_description,status_type" http_status on status',
        '| where isnotnull(src) and isnotnull(action)',
        '| summarize count = count() by src, action',
      ].join('\n'),
    );
  });
  it('moves filters on extracted fields after the field stages', () => {
    const out = body('index=main sourcetype=access_combined action=failure status>=500 | stats count');
    expect(out.split('\n')[0]).toBe('dataset="main" sourcetype=access_combined');
    expect(out).toContain('| where action =~ "failure" and status >= 500\n| summarize count = count()');
  });
  it('handles FORMAT and DELIMS transforms and CIDR lookups', () => {
    const k = knowledge();
    k.props.custom = { sourcetype: 'custom', extracts: [], reports: [{ name: 'r', transforms: ['fmt-fields', 'delim-fields'] }], aliases: [], evals: [], lookups: [{ name: 'l', spec: 'cidr_lookup src AS cidr OUTPUT net_name' }] };
    const out = translate('index=main sourcetype=custom', { knowledge: k }).kql;
    expect(out).toContain('| extract type=regex regex=@"(?<num>\\d+)-(?<word>\\w+)"');
    expect(out).toContain('| extract type=delim delimiter="," "a,b,c"');
    expect(out).toContain('| lookup matchMode=cidr output="net_name" nets on cidr=src');
  });
  it('limits each sourcetype\'s stages to its own events when several are in scope', () => {
    const k = knowledge();
    const st = (evals: { field: string; expr: string }[], extra = {}) => ({ extracts: [], reports: [], aliases: [], evals, lookups: [], ...extra });
    k.props.a = { sourcetype: 'a', ...st([{ field: 'kind', expr: '"A"' }], { extracts: [{ name: 'v', regex: '^/api/(?<ver>v\\d+)', inField: 'uri' }], aliases: [{ name: 'x', pairs: [{ from: 'clientip', to: 'src' }] }] }) };
    k.props.b = { sourcetype: 'b', ...st([{ field: 'kind', expr: '"B"' }]) };
    k.props.b2 = { sourcetype: 'b2', ...st([{ field: 'kind', expr: '"B"' }]) };
    const out = translate('index=main (sourcetype=a OR sourcetype=b) | stats count by kind', { knowledge: k }).kql.split('\n');
    expect(out).toContain('| extend __shim_src0 = iff(sourcetype == "a", uri, "")');
    expect(out).toContain('| extract source=__shim_src0 type=regex regex=@"^/api/(?<ver>v\\d+)"');
    expect(out).toContain('| project-away __shim_src0');
    expect(out).toContain('| extend src = iff(sourcetype == "a", clientip, src)');
    expect(out).toContain('| extend ["kind"] = iff(sourcetype == "a", "A", ["kind"])');
    expect(out).toContain('| extend ["kind"] = iff(sourcetype == "b", "B", ["kind"])');
    // Sourcetypes with identical rules share one guard; a wildcard can still match other sourcetypes.
    const same = translate('index=main sourcetype=b*', { knowledge: k }).kql;
    expect(same.match(/extend \["kind"\]/g)).toHaveLength(1);
    expect(same).toContain('| extend ["kind"] = iff(sourcetype in ("b", "b2"), "B", ["kind"])');
  });
  it('guards the rules unless the query pins exactly one sourcetype', () => {
    const k = knowledge();
    k.props.a = { sourcetype: 'a', extracts: [], reports: [], aliases: [], evals: [{ name: 'kind', field: 'kind', expr: '"A"' }], lookups: [] };
    const kql = (spl: string) => translate(spl, { knowledge: k }).kql;
    const guarded = '| extend ["kind"] = iff(sourcetype == "a", "A", ["kind"])';
    // Only a has rules, but b's events are in scope too.
    expect(kql('index=main (sourcetype=a OR sourcetype=b) | stats count by kind')).toContain(guarded);
    expect(kql('index=main sourcetype=a OR host=web1 | stats count by kind')).toContain(guarded);
    // IN lists are sourcetype terms too.
    expect(kql('index=main sourcetype IN (a, b) | stats count by kind')).toContain(guarded);
    expect(kql('index=main sourcetype IN (a) | stats count by kind')).toContain('| extend ["kind"] = "A"');
    expect(kql('index=main sourcetype=a | stats count by kind')).toContain('| extend ["kind"] = "A"');
  });
  it('lists sourcetypes without knowledge next to the ones it covers', () => {
    const r = translate('index=main (sourcetype=access_combined OR sourcetype=nothing_known) | stats count', { knowledge: knowledge() });
    expect(r.sourcetypes.sort()).toEqual(['access_combined', 'nothing_known']);
  });
  it('can be disabled and reports unknown sourcetypes', () => {
    expect(body('index=main sourcetype=access_combined | stats count', { applyShim: false })).toBe('dataset="main" sourcetype=access_combined\n| summarize count = count()');
    const r = translate('index=main sourcetype=nothing_known | stats count', { knowledge: knowledge() });
    expect(r.notes.some((n) => /No Splunk knowledge is loaded for sourcetype nothing_known/.test(n.message))).toBe(true);
  });
});

describe('tags, eventtypes and data models', () => {
  it('treats data model calculated fields as model fields in tstats by-clauses', () => {
    const notes = (spl: string) => translate(spl, { knowledge: knowledge() }).notes.filter((n) => /is not a field of data model/.test(n.message)).map((n) => n.message);
    // url_domain exists only as a Rex calculation output.
    expect(notes('| tstats count from datamodel=Web.Web by Web.url_domain')).toEqual([]);
    expect(notes('| tstats count from datamodel=Web.Web by Web.nosuchfield')).toHaveLength(1);
  });
  it('expands tag= and eventtype= into eventtype searches and pulls index= into the scope', () => {
    expect(body('tag=web | stats count by src').split('\n')[0]).toBe('dataset="main" sourcetype=access_combined OR sourcetype=access_common');
    expect(body('eventtype=audit | stats count').split('\n')[0]).toBe('dataset="_audit" sourcetype=audittrail');
    const r = translate('tag=nope | stats count', { knowledge: knowledge(), defaultDataset: 'main' });
    expect(r.notes.some((n) => n.level === 'warning' && /tag=nope/.test(n.message))).toBe(true);
  });
  it('translates tstats over a data model with constraints, calculations and prefix stripping', () => {
    const out = body('| tstats count from datamodel=Web.Web where Web.status>=500 by Web.action, Web.src');
    const lines = out.split('\n');
    expect(lines[0]).toBe('dataset="main" sourcetype=access_combined OR sourcetype=access_common');
    expect(out).toContain('| extend action = iff(isnull(action) or action == "", "unknown", action), url_domain = extract(@"^(?<url_domain>\\w+://[^/]+)", 1, url)');
    expect(out).toContain('| where status >= 500');
    expect(lines[lines.length - 1]).toBe('| summarize count = count() by action, src');
    expect(out.indexOf('| where status >= 500')).toBeGreaterThan(out.indexOf('extract type=regex'));
  });
  it('resolves child objects through their parents and warns on non-model fields', () => {
    const r = translate('| tstats count from datamodel=Web.Proxy by Web.category, Web.nosuch', { knowledge: knowledge(), defaultDataset: 'main' });
    expect(r.notes.some((n) => n.level === 'warning' && /tag=proxy/.test(n.message))).toBe(true);
    expect(r.notes.some((n) => /Web.nosuch.*not a field/.test(n.message))).toBe(true);
  });
  it('datamodel and from datamodel commands', () => {
    expect(body('| datamodel Web Web search | stats count by Web.action')).toContain('| summarize count = count() by action');
    expect(body('| from datamodel:"Web.Web" | stats count by action')).toContain('| summarize count = count() by action');
    expect(translate('| tstats count from datamodel=Nope', { knowledge: knowledge() }).unsupportedCount).toBe(1);
  });
});
