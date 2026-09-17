"""Differential test cases: each SPL query runs in Splunk, its translation runs in Cribl Search, results must match.

Options per case:
  tol / rel     numeric tolerance (absolute, or relative when rel=True)
  known         documented semantic difference; the case is run but not compared
  expect_fail   the translation is expected to be flagged unsupported
  dropzero      drop all-zero rows from Splunk's output (timechart zero-fills, timestats does not)
  modes         restrict to ("where",) or ("scope",); default is both
  ordered       force ordered (True) or multiset (False) row comparison; by default rows are compared in order
                when the SPL ends with an order-giving command (see compare.py)
  expect_note   text a translation note must contain (checked before `known`)
"""

CAP = 'at most 10,000 rows'

P = 'index=main sourcetype=spl2kql'

GENERIC = [
 (f'{P} | stats count by host', {}),
 (f'{P} | stats count, dc(clientip) as ips, avg(response_time) as art, sum(bytes) as b, max(bytes) as mx, min(bytes) as mn by host', {}),
 (f'{P} status>=500 | stats count by status', {}),
 (f'{P} | eval kb = round(bytes/1024, 1) | stats sum(kb) as total_kb by host', {}),
 (f'{P} | eval cat = case(status<300,"2xx",status<400,"3xx",status<500,"4xx",true(),"5xx") | stats count by cat', {}),
 (f'{P} | where like(uri, "/api/%") | stats count by uri', {}),
 (f'{P} | search uri=*.php OR uri=/login | stats count by uri', {}),
 (f'{P} | rex field=uri "^/api/(?<ver>v\\d+)/(?<res>\\w+)" | stats count by ver, res', {}),
 (f'{P} | eval u = lower(user) . "@x.com" | stats count by u', {'known': 'strcat treats null as empty; lookup CSV has no nulls'}),
 (f'{P} | top 3 uri', {}),
 (f'{P} | rare 2 method', {}),
 (f'{P} | stats count by host | sort -count | head 2', {}),
 (f'{P} | eval s = substr(uri, 2, 3), l = len(uri) | stats count by s, l', {}),
 (f'{P} | eval isint = if(cidrmatch("10.0.0.0/8", clientip), "in", "out") | stats count by isint', {}),
 (f'{P} | eval m = mvindex(split(uri,"/"), 1) | stats count by m', {}),
 (f'{P} | stats count(eval(status=503)) as unavail, count as total by host', {}),
 (f'{P} | eval t = strftime(_time, "%M") | stats count by t', {}),
 (f'{P} | timechart span=15m count', {'time': True, 'dropzero': True}),
 (f'{P} | timechart span=15m count by method', {'time': True, 'dropzero': True}),
 (f'{P} | chart count over host by method', {}),
 (f'{P} | eventstats avg(bytes) as ab by host | where bytes > ab | stats count by host', {}),
 (f'{P} | stats values(method) as ms by host', {}),
 (f'{P} | bin bytes span=10000 | stats count by bytes', {'known': 'Splunk labels numeric bins as ranges'}),
 (f'{P} | eval e = if(match(msg, "^error"), 1, 0) | stats sum(e) as errors by host', {}),
 (f'{P} | where status=200 AND (method="GET" OR method="POST") | stats count', {}),
 (f'{P} | stats count by host | eventstats sum(count) as total | eval pct = round(100*count/total, 1)', {}),
 (f'{P} | eval x = tonumber(status) + 1, y = status . "-" . method | stats count by x, y', {}),
 (f'{P} | stats p95(response_time) as p95, median(response_time) as med, stdev(bytes) as sd', {'tol': 0.15, 'rel': True}),
 (f'{P} | eval r = replace(uri, "^/api/v(\\d+)", "V\\1") | stats count by r', {}),
 (f'{P} | stats earliest(status) as e, latest(status) as l by host', {}),
 (f'{P} | stats range(bytes) as rb by host', {}),
 (f'{P} | eval r = relative_time(_time, "-1h@h") | stats min(r) as m, max(r) as mx', {}),
 (f'{P} | search NOT method=DELETE msg="error*" | stats count by method', {}),
 (f'{P} | where isnull(user) | stats count', {'known': 'lookup CSV has empty strings instead of nulls'}),
 (f'{P} | eval b = bytes % 7 | stats sum(b) as sb', {}),
 (f'{P} | stats count by clientip | where count > 3 | sort -count, clientip | head 5', {}),
 (f'{P} | rangemap field=bytes small=0-10000 medium=10001-30000 default=large | stats count by range', {}),
 (f'{P} | eval trimmed = trim(" " . method . " "), up = upper(method) | stats count by trimmed, up', {}),
 (f'{P} | stats count by host, method | xyseries host method count', {}),
 (f'{P} | eval q = if(status>=400, "bad", "good") | chart count by host, q', {}),
 (f'{P} | regex uri="^/api" | stats count', {}),
 (f'{P} | stats sum(bytes) as b by host | sort -b | head 1 | fields host', {}),
 (f'{P} | rename bytes as size | stats sum(size) as s', {}),
 (f'{P} | eval hp = host . ":" . tostring(status) | stats dc(hp) as n', {}),
 (f'{P} | stats sum(bytes) by host | sort -sum(bytes) | rename sum(bytes) as total | head 2', {}),
 (f'{P} | eval tagl = split(tags, ",") | mvexpand tagl | stats count by tagl', {}),
 (f'{P} | makemv delim="," tags | mvexpand tags | stats count by tags', {'known': 'empty-string multivalue handling'}),
 (f'{P} | stats count as hits by host | sort hits | head 1', {}),
 (f'{P} | eval big = if(bytes > 25000, "y", "n") | stats count by host, big | sort host, big', {}),
 (f'{P} | where status != 200 | stats count', {}),
 (f'{P} method=GET (status=404 OR status=403) NOT host=api* | stats count by host', {}),
 (f'{P} "upstream timeout" | stats count', {}),
 (f'{P} msg="error*" | stats count', {}),
 (f'{P} | eval n = if(isnotnull(user) AND user!="", 1, 0) | stats sum(n) as named', {}),
 (f'{P} | eval c = coalesce(user, "none") | stats count by c', {'known': 'Cribl coalesce skips empty strings'}),
 (f'{P} | eval lg = round(log(bytes), 2), sq = round(sqrt(bytes), 2), p = pow(2, 3) | stats max(lg) as mlg, max(sq) as msq, max(p) as mp', {'tol': 0.01}),
 (f'{P} | eval f = floor(response_time * 10), ce = ceiling(response_time * 10) | stats sum(f) as sf, sum(ce) as sc', {}),
 (f'{P} | eval h = md5(uri) | stats dc(h) as n', {}),
 (f'{P} | eval m = if(like(uri, "%order%"), "order", "other") | stats count by m', {}),
 (f'{P} | eval s = if(status IN (200, 201), "ok", "no") | stats count by s', {}),
 (f'{P} | where status IN (500, 503) | stats count by status', {}),
 (f'{P} | stats first(uri) as f, last(uri) as l', {'known': 'Splunk first/last depend on result order; mapped to findlatest/findearliest'}),
 (f'{P} | stats count by user | fillnull value="none" user', {'known': 'lookup CSV has empty strings instead of nulls'}),
 (f'{P} | addtotals fieldname=t bytes, status | stats sum(t) as st', {}),
 (f'{P} | convert num(bytes) as nb | stats sum(nb) as s', {}),
 (f'{P} | eval ep = _time - 3600 | stats min(ep) as m', {}),
 (f'{P} | streamstats count as n by host | stats max(n) as mx by host', {}),
 (f'{P} | eval j = json_extract(_raw, "method") | stats count by j', {}),
 (f'{P} | spath input=_raw path=method output=m2 | stats count by m2', {}),
 (f'{P} | eval x = if(searchmatch("status=200"), 1, 0) | stats sum(x) as ok', {'expect_fail': True}),

 # --- Boolean precedence: the search command evaluates OR before AND; eval/where do the opposite.
 (f'{P} method=DELETE AND status=200 OR host=web1 | stats count', {}),
 (f'{P} method=DELETE status=200 OR host=web1 | stats count', {}),
 (f'{P} host=web1 OR status=200 AND method=DELETE | stats count', {}),
 (f'{P} (method=DELETE AND status=200) OR host=web1 | stats count', {}),
 (f'{P} host=web1 OR (status=200 AND method=DELETE) | stats count', {}),
 (f'{P} NOT host=web1 OR status=200 method=DELETE | stats count', {}),
 (f'{P} NOT (method=DELETE AND status=200 OR host=web1) | stats count', {}),
 (f'{P} | search method=DELETE AND status=200 OR host=web1 | stats count', {}),
 (f'{P} | search (method=DELETE AND status=200) OR host=web1 | stats count', {}),
 (f'{P} | where method="DELETE" AND status=200 OR host="web1" | stats count', {}),
 (f'{P} | eval m = if(method="DELETE" AND status=200 OR host="web1", 1, 0) | stats sum(m) as m', {}),
 (f'| tstats count where {P} host=api1 AND source=nope OR host=web1', {}),
 (f'| tstats count where {P} (host=api1 AND source=nope) OR host=web1', {}),

 # --- field!=value only matches events that have the field; NOT field=value also matches events without it.
 (f'{P} nosuchfield!="x" | stats count', {}),
 (f'{P} nosuchfield!=x* | stats count', {}),
 (f'{P} NOT nosuchfield="x" | stats count', {}),
 (f'{P} NOT nosuchfield!="x" | stats count', {}),
 (f'{P} nosuchfield!="x" OR host=web1 | stats count', {}),
 (f'{P} | search nosuchfield!="x" | stats count', {}),
 (f'{P} | search nosuchfield!="x" OR host=web1 | stats count', {}),
 (f'{P} | search NOT nosuchfield="x" | stats count', {}),
 (f'{P} method!=GET status!=200 | stats count by method', {}),
 (f'{P} | search method!=GET status!=200 uri!=/api* | stats count by method', {}),
 (f'{P} host!=web1 | stats count by host', {}),
 (f'{P} user!=alice | stats count', {'known': 'lookup CSV has empty strings where the Splunk events have no user field'}),

 # --- streamstats current=f excludes the current event (order-independent measures only).
 (f'{P} | eval one=1 | streamstats current=f count as n sum(one) as t by host | stats max(n) as mxn, min(n) as mnn, max(t) as mxt, min(t) as mnt, count(t) as ct by host', {}),
 (f'{P} | eval one=1 | streamstats current=f count as n sum(one) as t | stats max(n) as mxn, min(n) as mnn, max(t) as mxt, min(t) as mnt, count(t) as ct', {}),
 (f'{P} | streamstats current=f last(host) as ph by host | stats count(ph) as c, dc(ph) as d by host', {}),
 (f'{P} | eval one=1 | streamstats count as n sum(one) as t by host | stats max(n) as mxn, min(n) as mnn, max(t) as mxt, min(t) as mnt by host', {}),

 # --- streamstats follows the order of earlier stages (sort, stats), not always newest first.
 (f'{P} | sort 0 _time | streamstats count as n sum(bytes) as t by host | where n<=3 | table host, n, bytes, t', {}),
 (f'{P} | sort 0 _time | streamstats sum(bytes) as t | where t < 200000 | table bytes, t', {}),
 (f'{P} | sort 0 -_time | streamstats current=f sum(bytes) as t | where t < 200000 | table bytes, t', {}),
 (f'{P} | stats sum(bytes) as b by host | streamstats sum(b) as run | table host, b, run', {}),
 ('| makeresults count=2 | streamstats count as i | eval x=i*10, _time=_time+i | sort 0 _time | streamstats sum(x) as t | table x, t', {}),

 # --- streamstats count(field) counts only events that have the field.
 (f'{P} | streamstats count(nosuchfield) as n count(uri) as u by host | stats max(n) as mn, max(u) as mu by host', {}),
 (f'{P} | streamstats current=f count(nosuchfield) as n count(uri) as u by host | stats max(n) as mn, min(u) as mi, max(u) as mu by host', {}),
 ('| makeresults | streamstats count(missing) as n | table n', {}),

 # --- rex leaves the target field unchanged when the regex does not match.
 (f'{P} | eval x="keep" | rex field=uri "^/zzz(?<x>\\d+)" | stats count by x', {}),
 (f'{P} | eval ver="none" | rex field=uri "^/api/(?<ver>v\\d+)" | stats count by ver', {}),
 (f'{P} | rex field=uri "^/zzz(?<nothere>\\d+)" | eval n=if(isnull(nothere), "null", "set") | stats count by n', {}),
 ('| makeresults | eval x="keep" | rex field=x "^(?<x>zzz)" | table x', {}),

 # --- Result order. Timestamps and bytes are unique in the test data, so every order below is exact.
 (f'{P} | head 5 | table _time, host, bytes', {}),
 (f'{P} | sort 0 _time | head 5 | table _time, host, bytes', {'expect_note': CAP}),
 (f'{P} | sort 0 _time | tail 3 | table _time, host, bytes', {}),
 (f'{P} | tail 3 | table _time, bytes', {}),
 (f'{P} | sort 0 bytes | reverse | head 3 | table bytes, host', {}),
 (f'{P} | stats count by host | tail 2', {}),
 (f'{P} | stats count by host | reverse', {}),
 (f'{P} | stats count by clientip | sort -count | head 5', {}),
 (f'{P} | stats count by clientip | sort count | head 12', {}),
 (f'{P} | top 4 clientip', {}),
 # Interleaved groups: grouped streamstats must not change the row order.
 (f'{P} | sort 0 _time | streamstats count as n by host | head 8 | table _time, host, n', {'ordered': True}),
 (f'{P} | streamstats count as n by host | head 8 | table _time, host, n', {'ordered': True}),
 (f'{P} | sort 0 _time | streamstats count as n by host | streamstats count as m | where m<=10 | table host, n, m', {'ordered': True}),
 (f'{P} | sort 0 -bytes | streamstats current=f sum(bytes) as above by method | head 10 | table method, bytes, above', {'ordered': True}),
 (f'{P} | sort 0 _time | delta bytes as d | head 6 | table bytes, d', {'ordered': True}),
 (f'{P} | delta bytes as d | head 6 | table bytes, d', {'ordered': True}),
 (f'{P} | sort 0 _time | accum bytes as c | head 6 | table bytes, c', {'ordered': True}),
 (f'{P} | dedup host | table host, _time, bytes', {}),
 (f'{P} | sort 0 bytes | dedup method | table method, bytes', {}),
 (f'{P} | dedup host sortby -bytes | table host, bytes', {'ordered': True}),
 (f'{P} | dedup 3 method | table method, _time', {}),
 (f'{P} | sort 0 _time | dedup consecutive=t method | head 20 | table _time, method', {'ordered': True}),
 (f'{P} | eval u=if(method="GET", "g", null()) | dedup u | table u, _time', {}),
 (f'{P} | eval u=if(method="GET", "g", null()) | dedup keepempty=t u | stats count', {}),
 # Sparse fields: user is missing on some events.
 (f'{P} | sort 0 _time | head 40 | eval u=if(method="GET", user, null()) | table _time, u', {'known': 'lookup CSV has empty strings where the Splunk events have no user field'}),
 (f'{P} | sort 0 _time | head 40 | eval big=if(bytes > 30000, bytes, null()) | table _time, big', {}),
 # first()/last() follow the current order in Splunk; the translation keeps findlatest()/findearliest() and warns.
 (f'{P} | sort 0 bytes | stats first(bytes) as f', {'expect_note': 'current result order', 'known': 'first()/last() after a sort: Splunk uses the sorted order, findlatest() the most recent event'}),

 # --- More than 10,000 rows: Cribl's order by keeps 10,000; the translation must say so.
 ('| makeresults count=12000 | stats count', {}),
 ('| makeresults count=12000 | streamstats count as n | stats count, max(n) as mx', {'expect_note': CAP, 'known': "Cribl's order by keeps 10,000 rows"}),
 ('| makeresults count=12000 | sort 0 _time | stats count', {'expect_note': CAP, 'known': "Cribl's order by keeps 10,000 rows"}),
 ('| makeresults count=12000 | head 5 | stats count', {}),
]

# --- Generated arithmetic: every pair of + - * / % in three groupings, plus unary minus and comparisons.
# Operands are chosen so no grouping divides by zero and most groupings give different values.
def _arith_exprs():
    ops = ['+', '-', '*', '/', '%']
    out = []
    for o1 in ops:
        for o2 in ops:
            out += [f'17 {o1} (7 {o2} 3)', f'(17 {o1} 7) {o2} 3', f'17 {o1} 7 {o2} 3']
    out += ['-(3 - 5) * 2', '2 - -3', '-2 * -(4 % 3)', '10 / (2 * 5)', '2 * -(3 + 1)', '(1 + 2) * (3 + 4) % 5', '100 / 7 / 2', '100 / (7 / 2)']
    return out


def _arith_cases(per_query=20):
    exprs = _arith_exprs()
    cases = []
    for start in range(0, len(exprs), per_query):
        chunk = exprs[start:start + per_query]
        names = [f'e{start + i}' for i in range(len(chunk))]
        evals = ', '.join(f'{n}={e}' for n, e in zip(names, chunk))
        cases.append((f'| makeresults | eval {evals} | table {", ".join(names)}', {'tol': 1e-9, 'modes': ('where',)}))
    # Precedence inside comparisons and boolean logic.
    cases.append(('| makeresults | eval c1=if(1 + 2 * 3 == 7, "y", "n"), c2=if((1 + 2) * 3 == 9 AND NOT 4 % 3 == 0, "y", "n"), c3=if(10 - (2 - 1) > 8 OR 1 == 2, "y", "n") | table c1, c2, c3', {'modes': ('where',)}))
    return cases


GENERIC += _arith_cases()

W = 'index=main sourcetype=access_combined'

CIM = [
 (f'{W} | stats count by src, action, status_description', {}),
 (f'{W} | stats count by http_method, status_type', {}),
 (f'{W} | stats sum(bytes_out) as b, dc(src) as srcs, avg(url_length) as ul by dest', {'tol': 0.01}),
 (f'{W} | stats count by uri_extension', {}),
 (f'{W} | stats count by app, vendor_product', {}),
 (f'{W} | where action="failure" | stats count by status', {}),
 (f'{W} | stats count by user', {}),
 (f'{W} | stats count by uri_path, file', {}),
 (f'{W} | stats count by referer_domain, root, file', {}),
 (f'{W} | stats count by useragent', {}),
 (f'{W} | eval big = if(bytes > 25000, "big", "small") | stats count by big, http_method', {}),
 (f'{W} | stats count by src | sort -count | head 5', {}),
 ('tag=web | stats count by http_method, action', {}),
 ('eventtype=web_access | stats count by status_description', {}),
 ('| tstats count from datamodel=Web.Web by Web.action', {}),
 ('| tstats count from datamodel=Web.Web by Web.action, Web.status', {}),
 ('| tstats count from datamodel=Web.Web where Web.status>=500 by Web.src', {}),
 ('| tstats sum(Web.bytes) as bytes, dc(Web.src) as srcs from datamodel=Web.Web by Web.dest', {}),
 ('| tstats count from datamodel=Web.Web by Web.http_method, Web.url', {}),
 ('| tstats count from datamodel=Web.Web by Web.app, Web.vendor_product, Web.status', {}),
 ('| tstats count from datamodel=Web.Web where Web.action=failure Web.http_method=GET by Web.url', {}),
 (f'{W} action=failure status_type="Server Error" | stats count by src', {}),
 ('| datamodel Web Web search | stats count by Web.action, Web.http_method', {}),
 ('| from datamodel:"Web.Web" | stats count by action, status', {}),
 ('| tstats count from datamodel=Web.Web by Web.user', {}),
 ('| tstats count from datamodel=Web.Web by Web.uri_path', {}),
 # Search-expression semantics on extracted (shim) fields.
 (f'{W} action=failure AND http_method=GET OR http_method=POST | stats count by action, http_method', {}),
 (f'{W} action!=success | stats count by action', {}),
 (f'{W} nosuchfield!=x | stats count', {}),
 ('| tstats count from datamodel=Web.Web where Web.action=failure AND Web.http_method=GET OR Web.http_method=POST by Web.action, Web.http_method', {}),
]

# Two sourcetypes whose props define the same fields differently (tests/differential/README.md has the stanzas),
# plus spl2kql:plain, which has no knowledge at all. The Cribl lookup only holds sourcetype=spl2kql, so the other
# sourcetypes are synthesized from the same rows, exactly as Splunk holds the same 300 events under all three.
MULTI_PRELUDE = '| extend sourcetype = dynamic(["spl2kql", "spl2kql:test", "spl2kql:plain"])\n| mv-expand sourcetype'
MULTI = [
 ('index=main sourcetype=spl2kql* | stats count, dc(src) as srcs by sourcetype, kind, api_ver', {'modes': ('where',)}),
 ('index=main (sourcetype=spl2kql OR sourcetype="spl2kql:test") | stats count by kind, src', {'modes': ('where',)}),
 ('index=main sourcetype=spl2kql:test | stats count by kind, src, api_ver', {'modes': ('where',)}),
 ('index=main sourcetype=spl2kql* kind=B OR kind=A-GET api_ver=v1 | stats count by sourcetype, kind, api_ver', {'modes': ('where',)}),
 # A sourcetype without knowledge in scope must not receive another sourcetype's fields.
 ('index=main (sourcetype=spl2kql OR sourcetype="spl2kql:plain") | eval k=coalesce(kind, "none") | stats count by sourcetype, k', {'modes': ('where',)}),
 ('index=main sourcetype=spl2kql OR sourcetype="spl2kql:plain" | eval s=if(isnull(src), "none", "set") | stats count by sourcetype, s', {'modes': ('where',)}),
 # sourcetype IN (...) selects knowledge like sourcetype=.
 ('index=main sourcetype IN (spl2kql, "spl2kql:plain") | eval k=coalesce(kind, "none") | stats count by sourcetype, k', {'modes': ('where',)}),
 ('index=main sourcetype IN ("spl2kql:test") | stats count by kind, api_ver', {'modes': ('where',)}),
]

SUITES = {
  'generic': {'cases': GENERIC, 'lookup': 'spl2kql_test_events', 'knowledge': False,
              'casts': '| extend _time = todouble(_time), status = tolong(status), bytes = tolong(bytes), response_time = todouble(response_time)'},
  'cim': {'cases': CIM, 'lookup': 'spl2kql_web_events', 'knowledge': True, 'casts': '| extend _time = todouble(_time)'},
  'multi': {'cases': MULTI, 'lookup': 'spl2kql_test_events', 'knowledge': True,
            'casts': '| extend _time = todouble(_time), status = tolong(status), bytes = tolong(bytes), response_time = todouble(response_time)\n' + MULTI_PRELUDE},
}
