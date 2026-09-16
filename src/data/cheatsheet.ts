/** SPL → Cribl Search KQL quick reference shown in the Reference panel. */
export interface CheatRow {
  spl: string;
  kql: string;
  note?: string;
}

export const CHEATSHEET: { title: string; rows: CheatRow[] }[] = [
  {
    title: 'Scope and filtering',
    rows: [
      { spl: 'index=web sourcetype=access', kql: 'dataset="web" sourcetype=access', note: 'First-stage filters are pushed down to the dataset provider.' },
      { spl: 'index=a OR index=b', kql: 'dataset in ("a", "b")' },
      { spl: 'earliest=-24h latest=now', kql: '(time picker)', note: 'Same relative syntax; set it on the search, not in the query.' },
      { spl: 'search field=val*', kql: 'where field startswith "val"', note: 'Mid-pipeline search becomes a where predicate.' },
      { spl: 'where like(f, "a%")', kql: 'where f startswith_cs "a"' },
      { spl: 'regex f="^abc"', kql: 'where f matches regex /^abc/' },
      { spl: 'NOT / AND / OR', kql: 'not() / and / or' },
    ],
  },
  {
    title: 'Fields and eval',
    rows: [
      { spl: 'eval x = a . b', kql: 'extend x = strcat(a, b)' },
      { spl: 'eval x = if(c, 1, 0)', kql: 'extend x = iff(c, 1, 0)' },
      { spl: 'eval x = case(c1, v1, c2, v2)', kql: 'extend x = case(c1, v1, c2, v2, null)' },
      { spl: 'eval x = substr(s, 2, 3)', kql: 'extend x = substring(s, 1, 4)', note: 'SPL is 1-based with a length; KQL is 0-based with an end index.' },
      { spl: 'eval x = len(s)', kql: 'extend x = strlen(s)' },
      { spl: 'eval x = cidrmatch(cidr, ip)', kql: 'extend x = ipv4_is_in_range(ip, cidr)' },
      { spl: 'eval x = strftime(_time, fmt)', kql: 'extend x = strftime(_time, fmt)', note: 'Same % directives.' },
      { spl: 'eval x = relative_time(_time, "@d")', kql: 'extend x = startofday(_time)' },
      { spl: 'fields a, b / fields - c', kql: 'project a, b / project-away c' },
      { spl: 'rename a AS b', kql: 'project-rename b = a' },
      { spl: 'rex field=f "(?<x>...)"', kql: 'extend x = extract(@"(?<x>...)", 1, f)' },
      { spl: 'rex mode=sed "s/a/b/g"', kql: 'extend _raw = replace_regex(_raw, @"a", @"b")' },
      { spl: 'spath path=a.b', kql: 'extend a.b = extract_json("$.a.b", _raw)' },
      { spl: 'fillnull value=0 f', kql: 'extend f = coalesce(f, 0)' },
      { spl: 'makemv delim="," f | mvexpand f', kql: 'extend f = split(f, ",") | mv-expand f' },
    ],
  },
  {
    title: 'Aggregation',
    rows: [
      { spl: 'stats count by host', kql: 'summarize count = count() by host' },
      { spl: 'stats dc(x) / avg(x) / p95(x)', kql: 'dcount(x) / avg(x) / percentile(x, 95)' },
      { spl: 'stats values(x) / list(x)', kql: 'values(x) / list(x, 0)' },
      { spl: 'stats first(x) / last(x)', kql: 'findlatest(x) / findearliest(x)' },
      { spl: 'stats count(eval(c))', kql: 'countif(c)' },
      { spl: 'eventstats avg(x) by h', kql: 'eventstats avg_x = avg(x) by h' },
      { spl: 'streamstats count', kql: 'extend count = row_number()' },
      { spl: 'timechart span=5m count by h', kql: 'timestats span=5m@h count = count() by h' },
      { spl: 'chart count over a by b', kql: 'summarize count = count() by a, b | pivot count over b by a' },
      { spl: 'top 10 f', kql: 'summarize count = count() by f | order by count desc | limit 10' },
      { spl: 'bin _time span=1h', kql: 'extend _time = bin(_time, 1h)' },
      { spl: 'dedup f', kql: 'dedup by f', note: 'Cribl dedup works within a time window (default 30s).' },
    ],
  },
  {
    title: 'Ordering, limits, joins',
    rows: [
      { spl: 'sort -count', kql: 'order by count desc' },
      { spl: 'head 10 / tail 10', kql: 'limit 10 / order by _time asc | limit 10' },
      { spl: 'append [search ...]', kql: 'union (cribl dataset=... | ...)' },
      { spl: 'join type=left f [search ...]', kql: 'join kind=leftouter (cribl ...) on f' },
      { spl: 'lookup t f OUTPUT g', kql: 'lookup output="g" t on f' },
      { spl: '| inputlookup t', kql: 'dataset="$vt_lookups" lookupFile="t"' },
      { spl: 'outputlookup t', kql: 'export to lookup t' },
      { spl: 'iplocation ip', kql: 'ip-lookup <mmdb> on ip' },
      { spl: '| makeresults count=5', kql: 'dataset="$vt_dummy" event<5' },
      { spl: '`macro`', kql: '${macro}' },
    ],
  },
];
