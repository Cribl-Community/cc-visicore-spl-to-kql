/** Sample SPL queries offered from the Examples menu. */
export interface Example {
  title: string;
  spl: string;
}

export const EXAMPLES: Example[] = [
  {
    title: 'Errors by host',
    spl: 'index=web sourcetype=access_combined status>=500 earliest=-24h\n| stats count, dc(clientip) as unique_ips by host\n| sort -count\n| head 10',
  },
  {
    title: 'Timechart by status',
    spl: 'index=web\n| timechart span=5m count by status',
  },
  {
    title: 'Eval, where and top',
    spl: 'index=web\n| eval kb = round(bytes / 1024, 1), tier = if(response_time > 1, "slow", "fast")\n| where kb > 10 AND like(uri, "/api/%")\n| top limit=5 uri by tier',
  },
  {
    title: 'Regex extraction',
    spl: 'index=web\n| rex field=uri "^/api/(?<version>v\\d+)/(?<resource>\\w+)"\n| stats count by version, resource',
  },
  {
    title: 'Lookup enrichment',
    spl: 'index=firewall action=blocked\n| lookup service_names_port_numbers port_number AS dest_port OUTPUT service_name\n| stats count by service_name\n| sort -count',
  },
  {
    title: 'Append and join',
    spl: 'index=web status=500\n| stats count by host\n| join type=left host [search index=inventory | fields host, owner]\n| append [search index=cdn status=500 | stats count by host]',
  },
  {
    title: 'Streamstats and dedup',
    spl: 'index=auth action=failure\n| streamstats count as attempts by user\n| where attempts > 5\n| dedup user sortby -_time\n| table _time, user, src_ip, attempts',
  },
  {
    title: 'tstats summary',
    spl: '| tstats count where index=web sourcetype=access_combined by _time span=1h, host',
  },
  {
    title: 'Unsupported commands',
    spl: 'index=web\n| transaction clientip maxspan=5m\n| eval x = mvcount(uri)\n| transpose',
  },
];
