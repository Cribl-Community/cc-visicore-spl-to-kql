import { describe, it } from 'vitest';
import { translate } from '../src/translator';

const SAMPLES = [
  'index=web status=500 | stats count by host',
  'index=web sourcetype=access_combined (status=500 OR status=503) NOT host=web1* "error" earliest=-24h latest=now',
  'index=web | eval kb = bytes / 1024, label = if(status >= 500, "server error", "ok") | where kb > 10 AND like(uri, "/api/%")',
  'index=web | stats count, dc(clientip) as unique_ips, avg(response_time), p95(response_time), sum(bytes) as total_bytes by host, status | sort -count | head 20',
  'index=web | timechart span=5m count by status',
  'index=web | timechart span=1h avg(response_time) as avg_rt, max(response_time) as max_rt',
  'index=web | chart count over host by status',
  'index=web | top limit=5 uri',
  'index=web | top 3 status by host',
  'index=web | rare clientip',
  'index=web | rex field=uri "^/api/(?<version>v\\d+)/(?<resource>\\w+)" | stats count by version, resource',
  'index=web | rex field=_raw mode=sed "s/password=\\S+/password=***/g"',
  'index=web | regex uri="^/admin"',
  'index=web | eval user = lower(user) . "@example.com" | rename user AS email, clientip AS src_ip | table _time, email, src_ip, uri',
  'index=web | fields - _raw, bytes',
  'index=web | dedup clientip sortby -_time',
  'index=web | lookup service_names_port_numbers port AS dstport OUTPUT service_name AS svc, transport',
  '| inputlookup service_names_port_numbers where transport=tcp | table service_name port_number',
  'index=web | stats count by host | outputlookup hosts_summary.csv',
  'index=web | bin _time span=15m | stats sum(bytes) as bytes by _time, host',
  'index=web | eval ts = strftime(_time, "%Y-%m-%d %H:%M"), age = now() - _time, day = relative_time(_time, "@d")',
  'index=web | eval rt = round(response_time * 1000, 2), cat = case(status < 300, "2xx", status < 400, "3xx", status < 500, "4xx")',
  'index=web | search status=404 uri=*.php',
  'index=web | where isnotnull(user) AND NOT match(uri, "^/static")',
  'index=web | fillnull value="unknown" user, referer',
  'index=web | makemv delim="," tags | mvexpand tags',
  'index=web | spath input=payload path=order.items{}.sku output=sku',
  'index=web | eventstats avg(response_time) as avg_rt by host | where response_time > avg_rt * 2',
  'index=web | streamstats count as seq, sum(bytes) as running_bytes by host',
  'index=web | tstats count where index=web by host, status',
  'index=web | tstats count where index=web sourcetype=access by _time span=1h',
  'index=web | append [search index=cdn status=500 | stats count by host]',
  'index=web | join type=left host [search index=inventory | fields host, owner]',
  'index=web | transaction clientip maxspan=5m',
  'index=web | iplocation clientip | stats count by Country',
  'index=web | convert ctime(_time) as when timeformat="%Y-%m-%d"',
  'index=web | strcat host ":" port endpoint',
  'index=web | addtotals fieldname=total bytes, packets',
  'index=web | rangemap field=response_time fast=0-100 slow=101-1000 default=very_slow',
  'index=web | replace "GET" WITH "get", "POST" WITH "post" IN method',
  'index=web | sort 0 -bytes, +host',
  'index=web | head 50 | tail 10',
  'index=web `web_errors` | stats count',
  '| makeresults count=5 | eval x = random() % 10',
  'index=web | stats count as hits by host | eventstats sum(hits) as total | eval pct = round(100 * hits / total, 1)',
  'index=web | stats values(uri) as uris, list(status) as statuses, first(_raw) as sample by clientip',
  'index=web | eval is_internal = cidrmatch("10.0.0.0/8", clientip), hash = md5(user), len = len(uri), sub = substr(uri, 1, 4), parts = split(uri, "/"), first_part = mvindex(parts, 1)',
  'index=web status>=500 | stats count(eval(status=503)) as unavailable, count as total',
  'index=web | xyseries host status count',
  'index=web | eval tag = if(host="web1" OR host="web2", "frontend", "backend")',
  'index=web OR index=cdn | stats count by index',
  'index IN (web, cdn) host=web* | stats count',
  '| stats count',
  'index=web | eval range = bytes - 100 | sort -range',
  'index=web | stats sum(bytes) by host | sort -sum(bytes) | rename sum(bytes) as total_bytes',
  'index=web | eval x = mvcount(tags), y = tostring(bytes, "commas")',
  'index=web | foo bar baz',
  'index=web | delta bytes as delta_bytes | accum bytes as cumulative',
  'index=web | eventcount summarize=false index=web',
  'index=web | fieldformat bytes = tostring(bytes, "commas")',
  'index=web | addinfo | eval window = info_max_time - info_min_time',
  'index=web | uniq',
  'index=web | table host status | transpose',
];

describe('smoke', () => {
  it('prints translations', () => {
    for (const spl of SAMPLES) {
      const r = translate(spl, { knownDatasets: ['web', 'cdn', 'inventory'], knownLookups: ['service_names_port_numbers.csv'] });
      const notes = r.notes.map((n) => `    [${n.level}] (${n.command}) ${n.message}`).join('\n');
      // eslint-disable-next-line no-console
      console.log(`SPL: ${spl}\nKQL:\n${r.kql.split('\n').map((l) => '  ' + l).join('\n')}${notes ? '\n' + notes : ''}\n`);
    }
  });
});
