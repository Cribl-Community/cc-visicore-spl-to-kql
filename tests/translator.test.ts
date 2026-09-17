import { describe, expect, it } from 'vitest';
import { translate } from '../src/translator';
import { parseExpr, renderExpr, kqlRegexLiteral } from '../src/translator/expr';
import { splitPipeline, tokenize } from '../src/translator/lexer';
import { relativeTimeToKql } from '../src/translator/time';
import { createCtx } from '../src/translator/types';

const kql = (spl: string, opts = {}) => translate(spl, opts).kql;
const body = (spl: string, opts = {}) =>
  kql(spl, opts)
    .split('\n')
    .filter((l) => !l.startsWith('//'))
    .join('\n');
const expr = (e: string) => renderExpr(parseExpr(e), createCtx({}));

describe('lexer', () => {
  it('splits pipelines outside quotes and brackets', () => {
    expect(splitPipeline('index=a "x | y" | stats count | eval z=if(a="|",1,2)')).toEqual(['index=a "x | y"', 'stats count', 'eval z=if(a="|",1,2)']);
    expect(splitPipeline('a | append [search b | stats count] | c')).toEqual(['a', 'append [search b | stats count]', 'c']);
  });
  it('strips ``` comments', () => {
    expect(splitPipeline('index=a ```note``` | stats count')).toEqual(['index=a', 'stats count']);
  });
  it('tokenizes args with subsearches, macros and quoted strings', () => {
    const t = tokenize('host=web* "a b" `m(1)` [search x]', 'args');
    expect(t.map((x) => x.t)).toEqual(['word', 'op', 'word', 'str', 'macro', 'sub']);
  });
});

describe('scope (first stage)', () => {
  it('maps index= to dataset and keeps filters in the initial stage', () => {
    expect(body('index=web status=500 host=web* "error"')).toBe('dataset="web" status=500 host=web* "error"');
  });
  it('handles boolean groups and NOT', () => {
    expect(body('index=web (status=500 OR status=503) NOT host=web1*')).toBe('dataset="web" (status=500 OR status=503) NOT host=web1*');
  });
  it('supports multiple indexes', () => {
    expect(body('index=web OR index=cdn | stats count')).toBe('dataset in ("web", "cdn")\n| summarize count = count()');
    expect(body('index IN (web, cdn)')).toBe('dataset in ("web", "cdn")');
  });
  it('moves earliest/latest to a comment and the time range', () => {
    const r = translate('index=web earliest=-24h latest=now');
    expect(r.timeRange).toEqual({ earliest: '-24h', latest: 'now' });
    expect(r.kql.split('\n')[0]).toBe('// Time range: earliest=-24h latest=now');
  });
  it('flags a missing index and uses the default dataset when given', () => {
    const r = translate('status=500 | stats count');
    expect(r.kql).toContain('dataset="<DATASET>"');
    expect(r.notes.some((n) => n.level === 'error')).toBe(true);
    expect(body('status=500', { defaultDataset: 'main' })).toBe('dataset="main" status=500');
  });
  it('warns about unknown datasets and lookups', () => {
    const r = translate('index=nope | lookup missing_table host', { knownDatasets: ['web'], knownLookups: ['other.csv'] });
    expect(r.notes.filter((n) => n.level === 'warning').map((n) => n.message).join(' ')).toMatch(/nope.*dataset|dataset.*nope/);
    expect(r.notes.some((n) => /missing_table/.test(n.message))).toBe(true);
    expect(r.datasets).toEqual(['nope']);
    expect(r.lookups).toEqual(['missing_table']);
  });
  it('emits filters as where when requested', () => {
    expect(body('index=web status=500 host=web*', { filtersAsWhere: true })).toBe('dataset="web"\n| where status == 500 and host startswith "web"');
  });
  it('translates macros to ${name}', () => {
    const r = translate('index=web `errors` | stats count');
    expect(r.kql).toContain('${errors}');
    expect(r.macros).toEqual(['errors']);
  });
});

describe('search / where', () => {
  it('renders mid-pipeline search as where with case-insensitive matching', () => {
    expect(body('index=w | search status=404 uri=*.php user=Bob')).toBe('dataset="w"\n| where status == 404 and uri endswith ".php" and user =~ "Bob"');
    expect(body('index=w | search "timeout" NOT method=DELETE')).toBe('dataset="w"\n| where * has "timeout" and not(method =~ "DELETE")');
    expect(body('index=w | search host IN (a, b) OR x=*mid*')).toBe('dataset="w"\n| where host in~ ("a", "b") or x contains "mid"');
  });
  it('translates eval where expressions', () => {
    expect(body('index=w | where kb > 10 AND like(uri, "/api/%")')).toBe('dataset="w"\n| where kb > 10 and uri startswith_cs "/api/"');
    expect(body('index=w | where isnotnull(user) AND NOT match(uri, "^/static")')).toBe('dataset="w"\n| where isnotnull(user) and not(uri matches regex /^\\/static/)');
    expect(body('index=w | where status IN (500, 503)')).toBe('dataset="w"\n| where status in (500, 503)');
  });
  it('regex command uses a regex literal', () => {
    expect(body('index=w | regex uri="^/admin"')).toBe('dataset="w"\n| where uri matches regex /^\\/admin/');
    expect(body('index=w | regex uri!="(?i)^/admin"')).toBe('dataset="w"\n| where not(uri matches regex /^\\/admin/i)');
    expect(kqlRegexLiteral('a\\/b/c', 'i')).toBe('/a\\/b\\/c/i');
  });
});

describe('eval expressions', () => {
  it('maps operators and functions', () => {
    expect(expr('if(status >= 500, "err", "ok")')).toBe('iff(status >= 500, "err", "ok")');
    expect(expr('lower(user) . "@x"')).toBe('strcat(tolower(user), "@x")');
    expect(expr('round(bytes / 1024, 2)')).toBe('round(bytes / 1024, 2)');
    expect(expr('case(a<1,"x",a<2,"y")')).toBe('case(a < 1, "x", a < 2, "y", null)');
    expect(expr('coalesce(a, "n/a")')).toBe('coalesce(a, "n/a")');
    expect(expr('cidrmatch("10.0.0.0/8", ip)')).toBe('ipv4_is_in_range(ip, "10.0.0.0/8")');
    expect(expr('md5(x)')).toBe('hash_md5(x)');
    expect(expr('len(x)')).toBe('strlen(x)');
    expect(expr('substr(x, 2, 3)')).toBe('substring(x, 1, 4)');
    expect(expr('substr(x, -3)')).toBe('substring(x, -3)');
    expect(expr('replace(x, "^a(\\d+)", "b\\1")')).toBe('replace_regex(x, @"^a(\\d+)", @"b\\1")');
    expect(expr('mvindex(split(uri, "/"), 1)')).toBe('tostring(split(uri, "/", 1))');
    expect(expr('mvindex(parts, 2)')).toBe('parts[2]');
    expect(expr("'my field' + 1")).toBe('["my field"] + 1');
    expect(expr('a = 1 AND NOT b != 2 OR c')).toBe('(a == 1 and not(b != 2)) or c');
    expect(expr('status IN (200, 201)')).toBe('status in (200, 201)');
    expect(expr('tonumber("5") * 2')).toBe('todouble("5") * 2');
    expect(expr('max(a, b, 3)')).toBe('max_of(a, b, 3)');
    expect(expr('log(x)')).toBe('log10(x)');
    expect(expr('log(x, 2)')).toBe('log2(x)');
    expect(expr('strftime(_time, "%Y-%m-%d")')).toBe('strftime(_time, "%Y-%m-%d")');
    expect(expr('relative_time(_time, "-1d@d")')).toBe('startofday(_time - 1d)');
    expect(expr('relative_time(now(), "@h")')).toBe('bin(now(), 1h)');
    expect(expr('1.5e3 + 0x10')).toBe('1500 + 16');
    expect(expr('-(a - b) * 2')).toBe('-(a - b) * 2');
    expect(expr('a - (b - c)')).toBe('a - (b - c)');
    expect(expr('spath(payload, "order.items{}.sku")')).toBe('extract_json("$.order.items[*].sku", payload)');
  });
  it('quotes reserved field names', () => {
    expect(body('index=w | eval range = a - b | sort -range')).toBe('dataset="w"\n| extend ["range"] = a - b\n| order by ["range"] desc, _time desc');
  });
  it('reports unknown or unsupported functions', () => {
    const r = translate('index=w | eval x = mvcount(tags), y = frobnicate(1)');
    expect(r.notes.filter((n) => n.level === 'error').length).toBe(2);
  });
});

describe('stats family', () => {
  it('names every aggregation and aliases Splunk default names', () => {
    expect(body('index=w | stats count, dc(ip) as ips, avg(rt), p95(rt), sum(bytes) as total by host, status | sort -count | head 20')).toBe(
      [
        'dataset="w"',
        '| where isnotnull(host) and isnotnull(status)',
        '| summarize count = count(), ips = dcount(ip), avg_rt = avg(rt), p95_rt = percentile(rt, 95), total = sum(bytes) by host, status',
        // Splunk's sort is stable: ties keep the stats output order (by-fields ascending).
        '| order by count desc, host asc, status asc',
        '| limit 20',
      ].join('\n'),
    );
    expect(body('index=w | stats sum(bytes) by host | sort -sum(bytes) | rename sum(bytes) as tb')).toBe(
      'dataset="w"\n| where isnotnull(host)\n| summarize sum_bytes = sum(bytes) by host\n| order by sum_bytes desc, host asc\n| project-rename tb = sum_bytes',
    );
  });
  it('handles count(eval()), first/last, range, list/values', () => {
    expect(body('index=w | stats count(eval(status=503)) as bad, first(uri) as f, last(uri) as l, range(bytes) as r, values(u) as vs, list(s) as ls')).toBe(
      'dataset="w"\n| summarize bad = countif(status == 503), f = findlatest(uri), l = findearliest(uri), r = max(bytes) - min(bytes), vs = values(u), ls = list(s, 0)',
    );
  });
  it('eventstats and streamstats', () => {
    expect(body('index=w | eventstats avg(rt) as art by host')).toBe('dataset="w"\n| eventstats art = avg(rt) by host');
    expect(body('index=w | streamstats count as n, sum(bytes) as rb by host')).toBe(
      [
        'dataset="w"',
        '| order by _time desc',
        // Grouped calculations sort by group, then restore the incoming order (Splunk leaves it unchanged).
        '| extend __ss_ord = row_number(1)',
        '| order by host asc, __ss_ord asc',
        '| extend n = row_number(1, host != prev(host)), rb = row_cumsum(bytes, host != prev(host))',
        '| order by __ss_ord asc',
        '| project-away __ss_ord',
      ].join('\n'),
    );
  });
  it('timechart and chart', () => {
    expect(body('index=w | timechart span=5m count by status')).toBe('dataset="w"\n| timestats span=5m@h count = count() by status');
    expect(body('index=w | timechart span=1d@d avg(rt) as art')).toBe('dataset="w"\n| timestats span=1d@d art = avg(rt)');
    expect(body('index=w | chart count over host by status')).toBe('dataset="w"\n| summarize count = count() by host, status\n| pivot count over status by host');
    expect(body('index=w | chart count by host')).toBe('dataset="w"\n| summarize count = count() by host');
  });
  it('top and rare', () => {
    expect(body('index=w | top limit=5 uri showperc=f')).toBe('dataset="w"\n| summarize count = count() by uri\n| order by count desc\n| limit 5');
    expect(body('index=w | top 3 status by host showperc=f')).toBe(
      [
        'dataset="w"',
        '| summarize count = count() by host, status',
        '| order by host asc, count desc',
        '| extend __rank = row_number(1, host != prev(host))',
        '| where __rank <= 3',
        '| project-away __rank',
      ].join('\n'),
    );
    expect(body('index=w | rare method')).toContain('order by count asc');
  });
  it('tstats', () => {
    expect(body('| tstats count where index=web sourcetype=access by host')).toBe('dataset="web" sourcetype=access\n| summarize count = count() by host');
    expect(body('| tstats count where index=web by _time span=1h')).toBe('dataset="web"\n| timestats span=1h@d count = count()');
    expect(translate('| tstats count from datamodel=Web by Web.status').unsupportedCount).toBe(1);
  });
});

describe('field commands', () => {
  it('fields, table, rename, sort, head, tail, dedup', () => {
    expect(body('index=w | fields - _raw, x')).toBe('dataset="w"\n| project-away _raw, x');
    expect(body('index=w | fields + a b')).toBe('dataset="w"\n| project a, b');
    expect(body('index=w | table _time, "my field", host')).toBe('dataset="w"\n| project _time, ["my field"], host');
    expect(body('index=w | rename a AS b, c as d')).toBe('dataset="w"\n| project-rename b = a, d = c');
    expect(body('index=w | sort 0 -bytes, +host')).toBe('dataset="w"\n| order by bytes desc, host asc, _time desc');
    expect(body('index=w | sort 10 num(x) desc')).toBe('dataset="w"\n| order by x desc, _time desc\n| limit 10');
    // head keeps the first results in the current order: newest first for events.
    expect(body('index=w | head')).toBe('dataset="w"\n| order by _time desc\n| limit 10');
    expect(body('index=w | head limit=5')).toBe('dataset="w"\n| order by _time desc\n| limit 5');
    expect(body('index=w | tail 3')).toBe('dataset="w"\n| order by _time asc\n| limit 3');
    // dedup keeps the first results per key in the current order; sortby orders the output.
    expect(body('index=w | dedup 2 host, ip sortby -_time')).toBe(
      [
        'dataset="w"',
        // sortby applies before deduplication: the first results per key in sortby order are kept.
        '| order by _time desc',
        '| where isnotnull(host) and isnotnull(ip)',
        '| extend __dd_ord = row_number(1)',
        '| order by host asc, ip asc, __dd_ord asc',
        '| extend __dd_n = row_number(1, host != prev(host) or ip != prev(ip))',
        '| where __dd_n <= 2',
        '| order by __dd_ord asc',
        '| project-away __dd_ord, __dd_n',
      ].join('\n'),
    );
    expect(body('index=w | sort 0 _time | dedup host sortby -bytes')).toContain('| order by bytes desc, _time asc\n| where isnotnull(host)');
    expect(body('index=w | dedup keepempty=t host')).toContain('| where __dd_n <= 1 or isnull(host)');
    expect(body('index=w | dedup keepempty=t consecutive=t host')).toContain('| extend __dd_prev0 = prev(host)\n| extend __dd_run = row_cumsum(iff(isnull(__dd_prev0) or host != __dd_prev0, 1, 0))');
  });
  it('bin, fillnull, makemv, mvexpand, spath, convert, strcat, addtotals, rangemap, replace', () => {
    expect(body('index=w | bin _time span=15m')).toBe('dataset="w"\n| extend _time = bin(_time, 15m)');
    expect(body('index=w | bucket span=1h _time as hour')).toBe('dataset="w"\n| extend hour = bin(_time, 1h)');
    expect(body('index=w | bin bytes span=1000')).toBe('dataset="w"\n| extend bytes = bin(bytes, 1000)');
    expect(body('index=w | fillnull value="n/a" user, ref')).toBe('dataset="w"\n| extend user = coalesce(user, "n/a"), ref = coalesce(ref, "n/a")');
    expect(body('index=w | makemv delim="," tags | mvexpand tags limit=5')).toBe('dataset="w"\n| extend tags = split(tags, ",")\n| mv-expand tags limit 5');
    expect(body('index=w | spath input=p path=a.b{}.c output=o')).toBe('dataset="w"\n| extend o = extract_json("$.a.b[*].c", p)');
    expect(body('index=w | convert timeformat="%Y" ctime(_time) as y num(b)')).toBe('dataset="w"\n| extend y = strftime(_time, "%Y"), b = todouble(b)');
    expect(body('index=w | strcat host ":" port hp')).toBe('dataset="w"\n| extend hp = strcat(host, ":", port)');
    expect(body('index=w | addtotals fieldname=t a b')).toBe('dataset="w"\n| extend t = coalesce(todouble(a), 0) + coalesce(todouble(b), 0)');
    expect(body('index=w | rangemap field=x lo=0-9 hi=10-99 default=big')).toBe('dataset="w"\n| extend ["range"] = case(x >= 0 and x <= 9, "lo", x >= 10 and x <= 99, "hi", "big")');
    expect(body('index=w | replace "GET" WITH "get", "POST" WITH "post" IN method')).toBe('dataset="w"\n| extend method = case(method == "GET", "get", method == "POST", "post", method)');
  });
  it('rex named groups and sed mode', () => {
    expect(body('index=w | rex field=uri "^/api/(?<ver>v\\d+)/(?<res>\\w+)"')).toBe(
      [
        'dataset="w"',
        '| extend __rex0 = extract(@"^/api/(?<ver>v\\d+)/(?<res>\\w+)", 1, uri), __rex1 = extract(@"^/api/(?<ver>v\\d+)/(?<res>\\w+)", 2, uri)',
        // A non-matching regex leaves the fields as they were, like Splunk rex.
        '| extend ver = iff(isempty(__rex0), ver, __rex0), res = iff(isempty(__rex1), res, __rex1)',
        '| project-away __rex0, __rex1',
      ].join('\n'),
    );
    expect(body('index=w | rex mode=sed "s/pw=\\S+/pw=***/g"')).toBe('dataset="w"\n| extend _raw = replace_regex(_raw, @"pw=\\S+", @"pw=***")');
    expect(translate('index=w | rex "no groups"').unsupportedCount).toBe(1);
  });
  it('lookup, inputlookup, outputlookup, iplocation', () => {
    expect(body('index=w | lookup ports port AS dstport OUTPUT service AS svc, transport')).toBe(
      'dataset="w"\n| lookup output="service,transport" ports on dstport=port\n| project-rename svc = service',
    );
    expect(body('| inputlookup ports.csv where transport=tcp | table service')).toBe('dataset="$vt_lookups" lookupFile="ports"\n| where transport =~ "tcp"\n| project service');
    expect(body('index=w | stats count by host | outputlookup append=t hosts.csv')).toBe('dataset="w"\n| where isnotnull(host)\n| summarize count = count() by host\n| export mode=append to lookup hosts');
    expect(body('index=w | iplocation prefix=geo_ clientip')).toBe('dataset="w"\n| ip-lookup prefix="geo_" geocity on clientip');
  });
});

describe('multi-search', () => {
  it('append and join use inline subqueries with the cribl keyword', () => {
    expect(body('index=w | append [search index=cdn status=500 | stats count by host]')).toBe('dataset="w"\n| union (cribl dataset="cdn" status=500 | where isnotnull(host) | summarize count = count() by host)');
    expect(body('index=w | join type=left host [search index=inv | fields host, owner]')).toBe('dataset="w"\n| join kind=leftouter (cribl dataset="inv" | project host, owner) on host');
    expect(body('| multisearch [search index=a] [search index=b | head 1]')).toBe('dataset="a"\n| union (cribl dataset="b" | order by _time desc | limit 1)');
  });
  it('makeresults, addinfo, delta, accum, xyseries, eventcount', () => {
    expect(body('| makeresults count=5 | eval x = random() % 10')).toBe('dataset="$vt_dummy" event<5\n| extend x = rand() % 10');
    expect(body('index=w | addinfo')).toContain('earliestTime()');
    expect(body('index=w | delta bytes as d p=2 | accum bytes as c')).toBe('dataset="w"\n| order by _time desc\n| extend d = bytes - prev(bytes, 2)\n| extend c = row_cumsum(bytes)');
    expect(body('index=w | xyseries host status count')).toBe('dataset="w"\n| pivot count over status by host');
    expect(body('| eventcount index=w')).toBe('dataset="w"\n| summarize count = count() by dataset');
  });
});

describe('unsupported', () => {
  it('emits TODO comments and error notes without dropping the rest', () => {
    const r = translate('index=w | transaction ip | stats count');
    expect(r.unsupportedCount).toBe(1);
    expect(r.kql).toContain('// TODO (transaction)');
    expect(r.kql).toContain('| summarize count = count()');
    expect(r.notes.find((n) => n.command === 'transaction')?.level).toBe('error');
  });
  it('unknown commands', () => {
    const r = translate('index=w | frob x');
    expect(r.unsupportedCount).toBe(1);
    expect(r.stages[1].unsupported).toBe(true);
  });
  it('starting with a pipe and non-generating command synthesizes a scope', () => {
    const r = translate('| stats count', { defaultDataset: 'main' });
    expect(r.kql).toBe('dataset="main"\n| summarize count = count()');
  });
});

describe('time helpers', () => {
  it('relative time modifiers', () => {
    expect(relativeTimeToKql('t', '-1h')?.kql).toBe('t - 1h');
    expect(relativeTimeToKql('t', '+30m@m')?.kql).toBe('bin(t + 30m, 1m)');
    expect(relativeTimeToKql('t', '@mon')?.kql).toBe('startofmonth(t)');
    expect(relativeTimeToKql('t', '-1w')?.kql).toBe('t - 7d');
    expect(relativeTimeToKql('t', '@q')).toBeNull();
  });
});

describe('lookup-file datasets', () => {
  it('maps "$vt_lookups:<file>" to a lookup scope', () => {
    expect(translate('index=web status=500 | stats count', { indexMap: { web: '$vt_lookups:web_events.csv' }, knownDatasets: ['main'] }).kql).toBe(
      'dataset="$vt_lookups" lookupFile="web_events" status=500\n| summarize count = count()',
    );
    expect(translate('status=500', { defaultDataset: '$vt_lookups:web_events' }).kql).toBe('dataset="$vt_lookups" lookupFile="web_events" status=500');
  });
});

// Regressions for semantics verified against live Splunk and Cribl Search (tests/differential).
describe('search-expression semantics', () => {
  it('evaluates OR before AND, unlike eval/where', () => {
    expect(body('index=web a=1 AND b=1 OR c=1')).toBe('dataset="web" a=1 (b=1 OR c=1)');
    expect(body('index=web a=1 b=1 OR c=1')).toBe('dataset="web" a=1 (b=1 OR c=1)');
    expect(body('index=web c=1 OR b=1 AND a=1')).toBe('dataset="web" (c=1 OR b=1) a=1');
    expect(body('index=web | search a=1 AND b=1 OR c=1')).toBe('dataset="web"\n| where a == 1 and (b == 1 or c == 1)');
    expect(body('index=web | where a=1 AND b=1 OR c=1')).toBe('dataset="web"\n| where (a == 1 and b == 1) or c == 1');
  });
  it('keeps explicit groups, parenthesizing AND inside OR', () => {
    expect(body('index=web (a=1 AND b=1) OR c=1')).toBe('dataset="web" (a=1 b=1) OR c=1');
    expect(body('index=web | search (a=1 AND b=1) OR c=1')).toBe('dataset="web"\n| where (a == 1 and b == 1) or c == 1');
    expect(body('| tstats count where index=web host=a AND source=b OR host=c')).toContain('host=a (source=b OR host=c)');
  });
  it('field!=value requires the field to exist; NOT field=value does not', () => {
    expect(body('index=web user!=alice')).toBe('dataset="web" user!=alice user=*');
    expect(body('index=web NOT user=alice')).toBe('dataset="web" NOT user=alice');
    expect(body('index=web user!=alice OR status=500')).toBe('dataset="web" (user!=alice user=*) OR status=500');
    expect(body('index=web NOT user!=alice')).toBe('dataset="web" NOT (user!=alice user=*)');
    expect(body('index=web | search user!="alice" status!=200 uri!=/api*')).toBe(
      'dataset="web"\n| where (isnotnull(user) and not(user =~ "alice")) and (isnotnull(status) and not(status == 200)) and (isnotnull(uri) and not(uri startswith "/api"))',
    );
    expect(body('index=web | search NOT user=alice')).toBe('dataset="web"\n| where not(user =~ "alice")');
    // Metadata fields exist on every event.
    expect(body('index=web host!=web1 | search sourcetype!=x')).toBe('dataset="web" host!=web1\n| where not(sourcetype =~ "x")');
  });
});

describe('streamstats current=f', () => {
  it('excludes the current event from count and sum', () => {
    expect(body('index=web | streamstats current=f count as n sum(bytes) as total')).toBe(
      [
        'dataset="web"',
        '| order by _time desc',
        '| extend __ss_rank = row_number(1), __ss_sum0 = row_cumsum(bytes)',
        '| extend n = __ss_rank - 1, total = iff(__ss_rank == 1, int(null), __ss_sum0 - coalesce(bytes, 0))',
        '| project-away __ss_rank, __ss_sum0',
      ].join('\n'),
    );
  });
  it('restarts per group and keeps window functions out of iff()', () => {
    const out = body('index=web | streamstats current=f count as n last(status) as prev_status by host');
    expect(out).toContain('__ss_rank = row_number(1, host != prev(host)), __ss_prev0 = prev(status)');
    expect(out).toContain('n = __ss_rank - 1, prev_status = iff(__ss_rank == 1, int(null), __ss_prev0)');
  });
  it('is unchanged when the current event is included', () => {
    expect(body('index=web | streamstats count as n sum(bytes) as total by host')).toContain('| extend n = row_number(1, host != prev(host)), total = row_cumsum(bytes, host != prev(host))');
  });
});

describe('streamstats ordering and count(field)', () => {
  it('keeps the order of an earlier sort instead of assuming newest first', () => {
    expect(body('index=web | sort 0 _time | streamstats sum(bytes) as total')).toBe('dataset="web"\n| order by _time asc\n| extend total = row_cumsum(bytes)');
    expect(body('index=web | sort 0 -bytes | streamstats count as n by host')).toContain('| order by bytes desc, _time desc\n| extend __ss_ord = row_number(1)\n| order by host asc, __ss_ord asc\n| extend n = row_number(1, host != prev(host))\n| order by __ss_ord asc');
    expect(body('index=web | tail 5 | streamstats count as n')).toContain('| order by _time asc\n| limit 5\n| extend n = row_number(1)');
  });
  it('follows stats group order and falls back to newest first', () => {
    expect(body('index=web | stats sum(bytes) as b by host | streamstats sum(b) as run')).toContain('| order by host asc\n| extend run = row_cumsum(b)');
    expect(body('index=web | streamstats count as n')).toContain('| order by _time desc\n| extend n = row_number(1)');
    // A new result set without a known order drops the earlier sort.
    expect(body('index=web | sort 0 bytes | stats count | streamstats count as n')).toContain('| order by _time desc');
  });
  it('count(field) counts only events that have the field', () => {
    expect(body('index=web | streamstats count(user) as n by host')).toContain(
      '| extend __ss_cnt0 = row_cumsum(iff(isnotnull(user), 1, 0), host != prev(host))\n| extend n = __ss_cnt0\n| order by __ss_ord asc\n| project-away __ss_ord, __ss_cnt0',
    );
    expect(body('index=web | streamstats current=f count(user) as n')).toContain('| extend n = __ss_cnt0 - iff(isnotnull(user), 1, 0)');
  });
});

describe('result order', () => {
  it('sort is stable: ties keep the incoming order', () => {
    expect(body('index=w | stats count by src | sort -count | head 5')).toBe('dataset="w"\n| where isnotnull(src)\n| summarize count = count() by src\n| order by count desc, src asc\n| limit 5');
  });
  it('tail takes the last results of the current order, in reverse', () => {
    expect(body('index=w | sort 0 _time | tail 2')).toContain('| order by _time asc\n| order by _time desc\n| limit 2');
    expect(body('index=w | stats count by host | tail 1')).toContain('| order by host desc\n| limit 1');
    expect(translate('index=w | append [search index=x] | tail 2').notes.some((n) => /define no result order/.test(n.message))).toBe(true);
  });
  it('reverse flips the current order', () => {
    expect(body('index=w | sort 0 bytes | reverse')).toBe('dataset="w"\n| order by bytes asc, _time desc\n| order by bytes desc, _time asc');
  });
  it('head and delta do not repeat an order the previous stage already applied', () => {
    expect(body('index=w | sort 0 _time | streamstats count as n by host | head 2')).toMatch(/\| order by __ss_ord asc\n\| project-away __ss_ord\n\| limit 2$/);
    expect(body('index=w | sort 0 bytes | reverse | delta bytes as d')).toBe('dataset="w"\n| order by bytes asc, _time desc\n| order by bytes desc, _time asc\n| extend d = bytes - prev(bytes)');
  });
  it('warns where order by can drop rows beyond 10,000', () => {
    const warned = (spl: string) => translate(spl).notes.some((n) => n.level === 'warning' && /at most 10,000 rows/.test(n.message));
    expect(warned('index=w | sort 0 _time | stats count')).toBe(true);
    expect(warned('index=w | streamstats count as n')).toBe(true);
    expect(warned('index=w | reverse')).toBe(true);
    // Splunk's sort without a count keeps 10,000 results too, and head/tail keep fewer.
    expect(warned('index=w | sort -bytes')).toBe(false);
    expect(warned('index=w | head 5')).toBe(false);
    expect(warned('index=w | tail 5')).toBe(false);
  });
  it('first() and last() warn when an earlier stage changed the order', () => {
    const warned = (spl: string) => translate(spl).notes.some((n) => n.level === 'warning' && /current result order/.test(n.message));
    expect(warned('index=w | sort 0 bytes | stats first(uri)')).toBe(true);
    expect(warned('index=w | stats first(uri)')).toBe(false);
  });
});

describe('arithmetic grouping', () => {
  it('keeps parentheses where equal-precedence operators are not interchangeable', () => {
    expect(expr('2*(5%3)')).toBe('2 * (5 % 3)');
    expect(expr('2*(8/4)')).toBe('2 * (8 / 4)');
    expect(expr('8/(2*2)')).toBe('8 / (2 * 2)');
    expect(expr('10-(4-1)')).toBe('10 - (4 - 1)');
    expect(expr('2+(3-1)')).toBe('2 + (3 - 1)');
    expect(expr('7%(2*3)')).toBe('7 % (2 * 3)');
  });
  it('drops parentheses that cannot change the value', () => {
    expect(expr('(2*5)%3')).toBe('2 * 5 % 3');
    expect(expr('2*(3*4)')).toBe('2 * 3 * 4');
    expect(expr('2+(3+4)')).toBe('2 + 3 + 4');
    expect(expr('(1+2)*3')).toBe('(1 + 2) * 3');
  });
});

