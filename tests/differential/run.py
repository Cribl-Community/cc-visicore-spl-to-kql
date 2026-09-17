#!/usr/bin/env python3
"""Differential test: run SPL in a real Splunk and its translation in a real Cribl Search, then compare results.

See README.md in this directory for the environment it needs. Typical runs:

    python tests/differential/run.py                       # every suite, both filter modes
    python tests/differential/run.py --suite generic -k streamstats
    python tests/differential/run.py --mode scope --show-kql
"""
import argparse, json, os, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
from cases import SUITES  # noqa: E402
from compare import compare_rows  # noqa: E402


def need(var):
    v = os.environ.get(var)
    if not v:
        sys.exit(f'{var} is not set. See tests/differential/README.md.')
    return os.path.expanduser(v)


CRIBL_CLI = need('SPL2KQL_CRIBL_CLI')
SPLUNK_CLI = need('SPL2KQL_SPLUNK_CLI')
SEARCH_GROUP = os.environ.get('SPL2KQL_SEARCH_GROUP', 'default_search')

# The Cribl CLI package provides an authenticated httpx client for the default profile.
sys.path.insert(0, CRIBL_CLI)
_cwd = os.getcwd()
os.chdir(CRIBL_CLI)
import cribl_cli.api.client as _client  # noqa: E402
import cribl_cli.config.loader as _loader  # noqa: E402
client = _client.create_client(_loader.load_config())
os.chdir(_cwd)

splunk_env = dict(os.environ)
env_file = os.path.join(SPLUNK_CLI, '.env')
if os.path.exists(env_file):
    for line in open(env_file):
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, v = line.split('=', 1)
            splunk_env.setdefault(k, v.strip().strip('"'))


def build_knowledge():
    """Knowledge bundle from the Splunk instance's own conf files, so both sides use the same definitions."""
    home = need('SPLUNK_HOME')
    out = os.path.join(HERE, '.cache', 'knowledge.json')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    dirs = [f'{home}/etc/system', f'{home}/etc/apps/Splunk_SA_CIM', f'{home}/etc/apps/TA-spl2kql-web']
    r = subprocess.run(['npx', 'tsx', 'scripts/knowledge-from-dir.ts', *dirs, '--out', out], cwd=APP, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f'knowledge build failed: {r.stderr[:500]}')
    return out


def translate_all(spls, lookup, mode, knowledge):
    options = {'filtersAsWhere': mode == 'where', 'defaultDataset': f'$vt_lookups:{lookup}', 'indexMap': {'main': f'$vt_lookups:{lookup}'}}
    payload = json.dumps({'cases': spls, 'options': options, 'knowledge': knowledge})
    r = subprocess.run(['npx', 'tsx', 'tests/differential/translate-batch.ts'], cwd=APP, input=payload, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f'translate failed: {r.stderr[:800]}')
    return json.loads(r.stdout)


def splunk(spl):
    cmd = [f'{SPLUNK_CLI}/.venv/bin/splunk', 'search', 'run', '--query', spl, '--earliest', '0', '--max-rows', '2000', '--output', 'json']
    r = subprocess.run(cmd, env=splunk_env, capture_output=True, text=True)
    try:
        d = json.loads(r.stdout)
    except Exception:
        return None, (r.stdout + r.stderr)[:300]
    if 'error' in d:
        return None, json.dumps(d['error'])[:300]
    return d['data']['results'], None


def cribl(kql, casts):
    lines = [x for x in kql.split('\n') if not x.strip().startswith('//')]
    if not lines:
        return None, 'empty translation'
    # The lookup CSV holds strings; cast right after the scope stage, as a real dataset would deliver typed values.
    if lines[0].startswith('dataset=') and 'lookupFile=' in lines[0]:
        lines.insert(1, casts)
    q = '\n'.join(lines)
    r = client.post(f'/api/v1/m/{SEARCH_GROUP}/search/jobs', json={'query': q, 'earliest': '-30d', 'latest': 'now'})
    if r.status_code != 200:
        return None, r.text[:300]
    jid = r.json()['items'][0]['id']
    status = None
    for _ in range(360):
        status = client.get(f'/api/v1/m/{SEARCH_GROUP}/search/jobs/{jid}').json()['items'][0]['status']
        if status in ('completed', 'failed', 'canceled'):
            break
        time.sleep(0.5)
    if status != 'completed':
        return None, f'job {status}: ' + client.get(f'/api/v1/m/{SEARCH_GROUP}/search/jobs/{jid}/logs').text[:300]
    res = client.get(f'/api/v1/m/{SEARCH_GROUP}/search/jobs/{jid}/results?limit=2000')
    return [json.loads(x) for x in res.text.strip().split('\n') if x.strip()][1:], None


def compare(spl, opt, tr, casts):
    if 'error' in tr:
        return 'TRANSLATE-ERR', tr['error']
    kql = tr['kql']
    srows, serr = splunk(spl)
    crows, cerr = cribl(kql, casts)
    shown = f'\nKQL: {kql[:1500]}'
    if serr or cerr:
        return ('EXPECTED-FAIL' if opt.get('expect_fail') else 'RUN-ERR'), f'splunk={serr} cribl={cerr}{shown}'
    note = opt.get('expect_note')
    if note and not any(note in n['message'] for n in tr.get('notes', [])):
        return 'NOTE-MISSING', f'the translation should carry a note containing "{note}"{shown}'
    if opt.get('known'):
        return 'KNOWN-DIFF', opt['known']
    status, msg = compare_rows(spl, srows, crows, opt)
    return status, msg if status == 'PASS' else msg + shown


def self_test():
    """The comparator must reject known-wrong results before its PASS verdicts mean anything."""
    import unittest
    import test_compare
    import io
    out = io.StringIO()
    result = unittest.TextTestRunner(verbosity=0, stream=out).run(unittest.defaultTestLoader.loadTestsFromModule(test_compare))
    if not result.wasSuccessful():
        sys.stderr.write(out.getvalue())
        sys.exit('comparator self-tests failed; fix tests/differential/compare.py first.')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--suite', choices=[*SUITES, 'all'], default='all')
    ap.add_argument('--mode', choices=['where', 'scope', 'both'], default='both', help='where: filters as a where stage; scope: filters in the dataset scope stage')
    ap.add_argument('-k', dest='match', default='', help='only run cases whose SPL contains this text')
    ap.add_argument('--jobs', type=int, default=6)
    ap.add_argument('--show-kql', action='store_true', help='print the translation of passing cases too')
    args = ap.parse_args()
    self_test()

    suites = list(SUITES) if args.suite == 'all' else [args.suite]
    modes = ['where', 'scope'] if args.mode == 'both' else [args.mode]
    knowledge = build_knowledge() if any(SUITES[s]['knowledge'] for s in suites) else None
    ok = bad = 0
    for name in suites:
        suite = SUITES[name]
        for mode in modes:
            cases = [(spl, opt) for spl, opt in suite['cases'] if args.match in spl and mode in opt.get('modes', ('where', 'scope'))]
            if not cases:
                continue
            trs = translate_all([c[0] for c in cases], suite['lookup'], mode, knowledge if suite['knowledge'] else None)
            with ThreadPoolExecutor(args.jobs) as pool:
                results = list(pool.map(lambda a: compare(a[0][0], a[0][1], a[1], suite['casts']), zip(cases, trs)))
            print(f'\n=== {name} / {mode} ===')
            for (spl, _), tr, (status, msg) in zip(cases, trs, results):
                print(f'{status:14} {spl}')
                if msg:
                    print('   ' + msg.replace('\n', '\n   '))
                elif args.show_kql:
                    print('   ' + tr['kql'].replace('\n', '\n   '))
                if status in ('PASS', 'KNOWN-DIFF', 'EXPECTED-FAIL'):
                    ok += 1
                else:
                    bad += 1
    print(f'\n{ok} passed, {bad} failed')
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
