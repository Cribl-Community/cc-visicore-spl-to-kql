# Differential tests (live Splunk vs live Cribl Search)

Unit tests pin what the translator emits. These tests check that what it emits **means the same thing**:
every case runs the SPL in a real Splunk, runs the translation as a real Cribl Search job, and compares
the result rows. They exist because translation bugs of this kind pass every unit test:

- the `search` command evaluates `OR` before `AND` (the reverse of `eval`/`where`);
- `field!=value` only matches events that have the field, `NOT field=value` does not care;
- `streamstats current=f` excludes the current event;
- several sourcetypes in scope must not overwrite each other's calculated fields;
- Cribl window functions (`row_number`, `row_cumsum`, `prev`) skip restarts when nested inside `iff()`;
- a sourcetype without knowledge in scope must not receive another sourcetype's fields;
- `streamstats` runs in the order of an earlier `sort`, and `count(field)` counts only events with the field;
- a `rex` that does not match leaves the target field's earlier value alone;
- `head`, `tail`, `reverse`, `dedup`, `delta` and grouped `streamstats` follow and preserve the current row order,
  and `sort` is stable;
- Cribl's `order by` keeps at most 10,000 rows (`| makeresults count=12000` cases check the warning).

Run them whenever translator or knowledge-shim semantics change, and add a case for every new command,
option or bug fix. A case is one line in `cases.py`.

## Running

```sh
export SPL2KQL_CRIBL_CLI=/path/to/vct-cribl-cli      # its default profile must reach the Cribl tenant
export SPL2KQL_SPLUNK_CLI=/path/to/vct-splunk-cli    # SPLUNK_URL / SPLUNK_TOKEN come from its .env or the environment
export SPLUNK_HOME=/path/to/splunk                   # conf files are read to build the knowledge bundle

# Use the Cribl CLI's Python environment (it provides the authenticated API client).
$SPL2KQL_CRIBL_CLI/.venv/bin/python tests/differential/run.py                  # all suites, both filter modes
$SPL2KQL_CRIBL_CLI/.venv/bin/python tests/differential/run.py --suite generic -k streamstats --show-kql
```

Results are compared strictly by `compare.py`: the row count must match, every field seen in any row is
compared, and rows are compared in order whenever the SPL defines the output order (an order-giving command after
the last command that builds a new result set, or `ordered: True` on the case). `test_compare.py` proves the
comparator rejects wrong results (reversed order, a wrong value in a field missing from the first row, extra zero
rows); `run.py` refuses to run if those self-tests fail. Run them alone with `python3 tests/differential/test_compare.py`.

Each case runs twice: `where` mode (filters emitted as a `where` stage) and `scope` mode (filters kept in
the dataset scope stage), because the two renderers are separate code paths. The exit code is non-zero when
any case fails. `KNOWN-DIFF` cases document semantic differences that are artifacts of the test data.

## Suites

| Suite | What it covers | Splunk data | Cribl data |
|---|---|---|---|
| `generic` | commands, eval functions, search-expression semantics | `index=main sourcetype=spl2kql` | lookup `spl2kql_test_events.csv` |
| `cim` | knowledge shim, tags/eventtypes, `tstats`/`datamodel` on the CIM Web model | `index=main sourcetype=access_combined` + `Splunk_SA_CIM` + `TA-spl2kql-web` | lookup `spl2kql_web_events.csv`, `http_status.csv` |
| `multi` | sourcetypes that define the same fields differently, and one with no knowledge | `sourcetype=spl2kql`, `spl2kql:test` and `spl2kql:plain` (same 300 events) | `spl2kql_test_events.csv`, other sourcetypes synthesized with `mv-expand` |

## Environment setup (once)

1. Splunk: ingest `fixtures/events.json` into `index=main` as sourcetype `spl2kql`, again as `spl2kql:test`, and
   again as `spl2kql:plain` (a sourcetype with no knowledge)
   (`POST /services/receivers/simple?index=main&sourcetype=...`, one event per request, host from the event),
   and `fixtures/web_events.json` rendered as `access_combined` lines.
2. Splunk apps: `Splunk_SA_CIM`, and a `TA-spl2kql-web` whose `props.conf` holds the `access_combined`
   CIM mapping plus:

   ```ini
   [spl2kql]
   EXTRACT-api_ver = "uri": "/api/(?<api_ver>v\d+)
   FIELDALIAS-src = clientip AS src
   EVAL-kind = "A-" . method

   [spl2kql:test]
   EXTRACT-api_ver = "uri": "/(?<api_ver>[a-z]+)
   EVAL-src = "test-" . method
   EVAL-kind = "B"
   ```
3. Cribl Search: upload the same events as lookups `spl2kql_test_events.csv` (columns from the JSON plus
   `_time`, `_raw`, `sourcetype=spl2kql`) and `spl2kql_web_events.csv`, plus the TA's `http_status.csv`.

The harness passes `--earliest 0` to Splunk so the fixtures never age out of the search window.
