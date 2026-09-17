# SPL to KQL

Translate Splunk Search Processing Language (SPL) into Cribl Search KQL, with a stage-by-stage explanation of what changed, what was approximated, and what still needs a human.

![SPL to KQL app: Splunk SPL on the left, the translated Cribl Search KQL on the right with approximation and dataset-validation tags, index-to-dataset mapping, and the Notes tab explaining each stage](images/spl-to-kql-app.png)

## Summary

SPL to KQL is a Cribl app for teams moving searches, alerts and dashboards from Splunk to Cribl Search. It helps users translate SPL pipelines into runnable KQL, understand every approximation the translation made, and verify the result against their own Cribl tenant without leaving the app.

## What This App Does

* Primary purpose: deterministic, rule-based translation of SPL into the KQL dialect that Cribl Search actually accepts (verified against a live tenant, not generic Kusto).
* Key capabilities:
  * Translates 60+ SPL commands (search, eval, where, stats, eventstats, streamstats, timechart, chart, top, rare, rex, regex, lookup, inputlookup, outputlookup, join, append, dedup, bin, fillnull, spath, makemv, mvexpand, tstats, rangemap, replace, convert, and more) and 90+ eval functions.
  * Explains every stage: informational notes for semantic differences, warnings for approximations, and errors for commands that have no Cribl equivalent (left in the output as `// TODO` comments so nothing is silently dropped).
  * Validates `index=` names against your datasets, `lookup` tables against your uploaded lookups, and `` `macros` `` against Cribl Search macros.
  * Checks the generated query with Cribl's own parser (the Search preview endpoint), without running a search.
  * Runs the query as a real search job from the app and shows results, or saves it as a Cribl Search saved search.
  * Maps Splunk index names to the Cribl datasets that hold the same data, per user.
  * Reproduces Splunk search-time fields and CIM normalization in Cribl: load your TAs and the CIM app (packages, .conf files or a knowledge bundle) and the translator emits the extractions, field aliases, calculated fields and lookups for each sourcetype, expands `tag=`/`eventtype=` and macros, and translates `tstats ... from datamodel=`, `| datamodel` and `| from datamodel:`.
  * Built-in reference: an SPL to KQL cheat sheet and the operator/function catalog loaded from your tenant.
  * Per-user conversion history, kept in the app KV store.
* Intended users:
  * Analysts and engineers migrating Splunk content to Cribl Search.
  * Admins evaluating what a migration will and will not cover.
* Works with:
  * Cribl.Cloud (Cribl Search). Runs against the `default_search` group.

## When To Use This App

* Migrating saved searches, alerts and dashboard panels from Splunk to Cribl Search.
* Learning KQL by seeing a familiar SPL query side by side with its Cribl equivalent.
* Auditing which SPL features in a content library have no Cribl equivalent before committing to a migration.

## Before You Install

* Required Cribl product or deployment type: Cribl.Cloud with Cribl Search.
* Required permissions or roles: the app declares read access to Search datasets, lookups, macros and docs, plus the ability to create search jobs and saved searches. Admins grant these when sharing the app.
* Required external systems or APIs: none for translation. The optional backend functions reach GitHub (allowed by default) and your Splunk management API (allowed by an admin under Settings > External API Access). Backend functions need Cribl 4.20 or later.
* Required configuration values: none. An optional default dataset can be set per user; the Splunk connection is optional.
* Known limits or prerequisites: translation is rule based, not AI based. Without Splunk knowledge it does not know your field extractions, so field names pass through unchanged; load your add-ons (upload, URL import or Splunk sync) to reproduce them.

## Installation

### Install From Marketplace or URL
1. Go to Apps in your Cribl environment.
2. Choose the Marketplace or import from URL option.
3. If the app is available in the Cribl Marketplace, install it directly from there.
4. If the app is distributed as a Marketplace-hosted URL, use the URL to import it.
5. Review the app details and complete installation.

### If The App Is Not Yet In The Cribl Marketplace
1. Run `npm run package` in this repository to produce the `.tgz` app package (or download it from the Releases section).
2. In Cribl, go to Apps and choose import from file.
3. Upload the `.tgz` file.
4. Review the app details and complete installation.

## Configuration

| Setting | Required | Description | Example | Scope |
|---|---|---|---|---|
| Splunk knowledge (upload) | No | Add-on packages, .conf files, data model JSON or a knowledge.json bundle; enables search-time field reproduction and data model translation. | `Splunk_SA_CIM.tgz`, `TA-apache.tgz` | per-user |
| Splunk knowledge (import from URL) | No | A backend function downloads and unpacks a package or GitHub archive and merges it into the shared bundle every user sees. | `https://github.com/splunk/addonfactory-splunk_sa_cim/archive/refs/heads/master.tar.gz` | shared |
| Splunk connection | No | Splunk management URL and an authentication token. A backend function pulls props, transforms, eventtypes, tags, macros and data models over the Splunk REST API, on demand and nightly. The host must be allowed under Settings > External API Access. | `https://splunk.example.com:8089` | shared |
| Apply Splunk search-time field stages | No | On (default) emits the extraction, alias, calculated field and lookup stages for the sourcetypes in the query when knowledge is loaded. The line under the checkbox says what it adds for the current query. | on | per-user |
| Splunk index → Cribl dataset | No | Per-index override used when the Splunk index name differs from the Cribl dataset id. Shown for every `index=` the SPL references. | `main` → `default_logs` | per-user |
| Default dataset | No | Dataset used when the SPL has no `index=` clause. When unset the output contains `dataset="<DATASET>"` and an error note. | `default_logs` | per-user |
| Emit first-stage filters as a where stage | No | Off (default) keeps Splunk-style filters in Cribl's initial stage, which is pushed down to the dataset provider. On moves them to a `where` stage. | off | per-user |
| Earliest / Latest | No | Time range used when running or saving the translated query. Pre-filled from `earliest=`/`latest=` in the SPL. | `-24h` / `now` | per-user |

Per-user settings are saved in the app KV store and restored on the next visit. The shared knowledge bundle and the Splunk connection are stored once for the whole app; the token is stored encrypted and is only ever read by the platform proxy.

## How To Use

### Typical Workflow
1. Open the app from the Apps page.
2. Paste an SPL query on the left (or pick one from Examples). The KQL updates as you type.
3. Read the summary tags under the KQL: needs attention, approximations, notes, and whether referenced datasets, lookups and macros exist in this tenant.
4. Open the Notes tab for the reasoning behind each change, or the Stages tab to see each SPL stage next to the KQL it produced.
5. Use Check syntax to have Cribl's parser accept the query, Run in Cribl Search to execute it, or Save as saved search to keep it.
6. Copy KQL to use it anywhere else.

### First-Run Checklist
* Confirm the status tag in the header shows your datasets, lookups and macros were loaded.
* Set a default dataset if your SPL library relies on a default index.
* Try the “Unsupported commands” example to see how untranslatable stages are reported.

## Splunk Knowledge And CIM

Splunk fields such as `src`, `action` or `Web.status` exist only because add-ons define search-time extractions, aliases, calculated fields, lookups, eventtypes and tags. The **Splunk knowledge** tab loads those definitions so the translation reproduces them in Cribl Search.

![Splunk knowledge tab: upload, import from URL and Splunk connection sources on top; the combined bundle's sources and the sourcetypes used by the current query; category tabs for sourcetypes, extractions, aliases, calculated fields, lookups, eventtypes, data models and macros; a filterable list with access_combined selected and its extractions, field aliases, calculated fields and automatic lookup shown on the right](images/splunk-knowledge.png)

Three ways to load it:

* **Upload files** (this user only): add-on packages (`.tgz`/`.spl`) or their `props.conf`, `transforms.conf`, `eventtypes.conf`, `tags.conf`, `macros.conf` files; the Common Information Model app (`Splunk_SA_CIM`) for data model definitions (`default/data/models/*.json`) or individual model JSON files; or a `knowledge.json` bundle built from a Splunk install with `npm run knowledge -- $SPLUNK_HOME/etc/system $SPLUNK_HOME/etc/apps/Splunk_SA_CIM $SPLUNK_HOME/etc/apps/<TA> --out knowledge.json`.
* **Import from URL** (shared): the `importUrl` backend function downloads a package or GitHub repository archive on the Cribl platform, unpacks it and merges it into the shared bundle. The default URL is the CIM add-on's GitHub archive. Uploads and URL imports merge; the summary shows the combined sources.
* **Connect to Splunk** (shared): enter the Splunk management URL (port 8089) and a token, click **Save and test** (it checks the connection and that the token can read every endpoint the sync uses), then **Sync now**. The `splunkSync` backend function reads the documented knowledge endpoints `data/props/*`, `data/transforms/*`, `saved/eventtypes`, `configs/conf-macros` and `datamodel/model` over the Splunk REST API and replaces the shared bundle with what the instance actually has. A schedule re-runs the sync nightly at 03:00 UTC. The Splunk host must be allowed for the app (see [External API Access](#external-api-access)); the token is injected by the platform proxy and never returned to app code.

Shared knowledge is merged with the user's own uploads at translation time; the user's uploads win when both define the same rule. Merging works rule by rule, like Splunk's configuration layering: an `EVAL-x`, `EXTRACT-x`, `FIELDALIAS-x`, `REPORT-x` or `LOOKUP-x` replaces an earlier rule with the same name, a package's `local/` settings override its `default/` ones, and importing the same package again leaves the bundle unchanged.

Browsing what is loaded: the tabs under the sources line (Sourcetypes, Extractions, Aliases, Calculated fields, Lookups, Eventtypes, Data models, Macros) each list the matching objects with a filter box that searches names and definitions. Selecting an item shows its full definition: a sourcetype's extraction regexes (with `REPORT` transforms resolved), aliases, calculated fields and lookups; a data model's datasets with their constraints, fields and calculated fields; an eventtype's search and tags; a macro's definition. Sourcetypes used by the query in the editor are listed first and marked **in query**.

**Apply Splunk search-time field stages to translations** turns the per-sourcetype stages on or off. The line under it says what it does for the current query. If the loaded knowledge has nothing for the query's sourcetypes (for example `access_combined`, which Splunk defines in its own `etc/system` defaults rather than in `Splunk_SA_CIM`), the translation is the same either way; sync from Splunk or load the add-on that defines the sourcetype.

Replacing or deleting the shared bundle (Sync now, Clear shared bundle) asks for confirmation first, because it changes the knowledge every user of the app sees. If some data models cannot be fetched during a sync, their previous definitions are kept and the sync is reported as partial.

What the translator does with it, in Splunk's search-time order:

| Splunk knowledge object | Emitted KQL |
|---|---|
| `EXTRACT-x = (?<f>...)` and `REPORT-x` transforms (`REGEX`, `FORMAT`, `[[macro]]` references) | `extract type=regex regex=@"..."` (PCRE possessive/atomic syntax rewritten; lookarounds and backreferences are flagged) |
| `DELIMS`/`FIELDS` transforms | `extract type=delim delimiter="," "a,b,c"` |
| `FIELDALIAS-x = a AS b` / `ASNEW` | `extend b = a` / `extend b = coalesce(b, a)` |
| `EVAL-f = expr` | `extend f = <translated expr>` |
| `LOOKUP-x = def field OUTPUT ...` (with `match_type = CIDR(...)`) | `lookup [matchMode=cidr] output="..." file on field` |
| `tag=web`, `eventtype=x`, `` `macro` `` | expanded to the eventtype searches (index= terms become the dataset scope) |
| `tstats ... from datamodel=Web.Web`, `\| datamodel Web Web search`, `\| from datamodel:"Web.Web"` | dataset scope from the object's constraints, sourcetype field stages, the model's calculated fields, then the aggregation with `Web.` prefixes stripped |

Filters on extracted fields are moved after the field stages so the fields exist when they are evaluated. Lookups referenced by the knowledge must exist in Cribl Search as lookup files (the app validates their names).

When a query covers several sourcetypes whose knowledge differs, each sourcetype's aliases, calculated fields and extractions are applied only to its own events (`iff(sourcetype == "...", ...)`), so one sourcetype's `EVAL-kind` cannot overwrite another's. Automatic lookups cannot be limited this way and are flagged.

Verified end to end: identical Apache access logs were loaded into Splunk (`sourcetype=access_combined`, with `Splunk_SA_CIM` and a CIM web TA installed) and into Cribl Search, and CIM-normalized queries (`stats by src, action, status_description`, `tag=web`, `eventtype=`, `tstats from datamodel=Web.Web ...`, `| datamodel`, `| from datamodel:`) returned identical results in both. See [Development](#development) for the differential test suite.

## Permissions

Required permissions for core functionality (declared in `config/policies.yml`):

### Cribl API Endpoints Used

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/v1/m/default_search/search/datasets` | Map `index=` to datasets and warn about unknown names |
| GET | `/api/v1/m/default_search/system/lookups` | Validate `lookup` / `inputlookup` table names |
| GET | `/api/v1/m/default_search/search/macros` | Validate macro references |
| GET | `/api/v1/m/default_search/search/docs` | Operator and function catalog for the Reference tab |
| POST | `/api/v1/m/default_search/search/preview` | Check syntax with Cribl's parser (no search job, no credits) |
| POST | `/api/v1/m/default_search/search/jobs` | Run the translated query (explicit user action, confirmed in a dialog) |
| GET | `/api/v1/m/default_search/search/jobs/:id` | Poll job status |
| GET | `/api/v1/m/default_search/search/jobs/:id/results` | Fetch results |
| GET | `/api/v1/m/default_search/search/jobs/:id/logs` | Surface the failure reason for a failed job |
| POST | `/api/v1/m/default_search/search/jobs/:id/cancel` | Cancel a running job |
| GET | `/api/v1/m/default_search/search/saved/:id` | Check that a saved search id is free before creating it |
| POST | `/api/v1/m/default_search/search/saved` | Create a saved search (explicit user action, never overwrites) |

If a user lacks access to an optional endpoint (datasets, lookups, macros, docs), translation still works and the header shows which metadata could not be loaded. Running and saving require the job and saved-search permissions.

### Backend Functions

Declared in `config/backend.yml` and `config/schedules.yml`; they run on the Cribl platform (Cribl 4.20 or later) and use the app's KV store and proxy configuration.

| Function | Trigger | What it does |
|---|---|---|
| `importUrl` | **Import** button | Downloads an app/TA package or GitHub archive (up to 60 MB), parses its knowledge files and merges them into the shared bundle. |
| `splunkSync` | **Save and test**, **Sync now**, nightly schedule `splunk-sync-nightly` (`0 3 * * *` UTC) | Tests the Splunk connection or pulls all knowledge objects over the Splunk REST API and replaces the shared bundle. A data model that cannot be fetched keeps its previous definition and the sync is reported as partial; if no data model can be fetched, the bundle is left unchanged. Skips silently when no connection is configured. |

The frontend calls them at `POST /api/v1/a/cc-visicore-spl-to-kql/endpoints/<name>`. Both are visible, with their schedule, under the app's Settings > Backend Functions.

## External API Access

`config/proxies.yml` allows these hosts for the backend functions (the frontend makes no external calls):

| Host | Used by | Purpose |
|---|---|---|
| `github.com`, `codeload.github.com`, `objects.githubusercontent.com`, `raw.githubusercontent.com` | `importUrl` | Download add-on packages and repository archives. GitHub archive links are fetched from `codeload.github.com`, where they redirect. |
| your Splunk management host | `splunkSync` | Splunk REST API. Not declared by default. |

To enable the Splunk connection, an admin adds the Splunk host under the app's **Settings > External API Access** (or in `config/proxies.yml` before packaging) with the token injected from the encrypted KV key:

```json
{
  "id": "splunk.example.com:8089",
  "headers": { "inject": { "Authorization": "`Bearer ${kv.splunk_token}`" } },
  "timeout": 120000,
  "rejectUnauthorized": true
}
```

Set `rejectUnauthorized` to `false` only for a self-signed Splunk certificate. The token itself is written by the Splunk knowledge tab to the KV key `splunk_token` with `?encrypted=true`; it cannot be read back by the app, only injected by the proxy.

## Data And Storage

* Per-user KV keys: `users/<userId>/history` (last 50 conversions), `users/<userId>/prefs` (default dataset, index mapping, filter mode, field stage toggle, time range) and `users/<userId>/knowledge` (uploaded Splunk knowledge).
* Shared KV keys: `knowledge/shared` (bundle written by the backend functions), `knowledge/status` (last import/sync summary), `splunk/connection` (Splunk URL, last sync) and `splunk_token` (encrypted, write-only).
* KV values are limited to about 100 KB, so knowledge bundles are gzipped and split across `<key>/g<generation>/c<n>` chunk keys with a small index at `<key>`. Each save writes a new generation and switches the index only after every chunk is stored, so a failed save leaves the previous bundle intact. Shared saves (URL import, Splunk sync) check that no other save replaced the bundle while they were merging, and merge again on top of it when one did, so two imports running at the same time both end up in the bundle. The KV store has no atomic compare-and-set, so a save that lands in the brief moment after that check can still replace another; the app reports an error rather than success when saves keep colliding. The CIM add-on alone is about 260 KB uncompressed.
* Running a query creates a search job in Cribl Search like any other search. Saving creates a saved search. `outputlookup` translations become `export mode=overwrite to lookup` (or `mode=append` with `append=t`), which writes the lookup when the query runs; `collect` becomes an export to a Lake dataset. The Run dialog names each lookup or dataset the query writes, says whether it is replaced or appended to, and warns that it cannot be undone; the Save dialog warns that every run of the saved search writes it.

## Known Limitations

* Translation is deterministic. Without loaded Splunk knowledge, field names pass through unchanged and data models, `tag=` and `eventtype=` cannot be resolved. With it, extractions that need PCRE-only regex features (lookarounds, backreferences), `FORMAT = $1::$2` key-value transforms, KV-store lookups, WILDCARD lookups and GeoIP calculations are reported rather than translated. Splunk `EXTRACT ... in <field>` runs before `REPORT` extractions, in both systems.
* Field stages are emitted for the sourcetypes the query names (`sourcetype=`, `sourcetype IN (...)`, wildcards, or through `tag=`/`eventtype=` expansion). Splunk applies every sourcetype's knowledge to its own events, so a query such as `index=main host=web1` with no sourcetype term gets no field stages. Unless the query pins a single sourcetype, each sourcetype's stages are limited to its own events; automatic lookups cannot be limited that way and are flagged.
* Result order is reproduced: `head`, `tail`, `reverse`, `dedup`, `delta`, `accum` and `streamstats` follow the order of the earlier stages (newest first for events, the `sort`, `stats ... by` or `timechart` order otherwise), `sort` keeps ties in their incoming order like Splunk, and grouped `streamstats` leaves the row order unchanged. `streamstats window=` (sliding windows) and `first()` are not supported, and `stats first()`/`last()` stay most recent/oldest (flagged when an earlier stage changed the order).
* Cribl Search's `order by` returns at most 10,000 rows. Translations that must order more rows than that (`sort 0`, `reverse`, `dedup`, `delta`, `accum`, `streamstats`) carry a warning: rows beyond 10,000 are dropped before the later stages, where Splunk keeps them. `sort` without a count, `head` and `tail` are unaffected, because Splunk keeps at most 10,000 sorted results too.
* Commands with no Cribl equivalent (`transaction`, `transpose`, `untable`, `appendcols`, `map`, `foreach`, `return`, `format`, `mvcombine`, most ML commands) are emitted as `// TODO` comments with an error note.
* Some semantics differ and are flagged as notes: `coalesce()`/`fillnull` also replace empty strings; `strcat()` treats missing fields as empty (Splunk's `.` yields null); `first()`/`last()` map to `findlatest()`/`findearliest()`; `timestats` omits empty buckets and needs the `@` snap suffix to align buckets to the clock; `stats ... by` gets a `where isnotnull()` stage because Cribl keeps a null group.
* Regular expressions: `rex`, `extract` and `replace_regex` use RE2 (no lookarounds); `matches regex` uses ECMAScript regex literals.
* Check syntax uses the Search preview endpoint. It parses and plans the query but does not apply dataset scope, filters, window functions or subqueries, so it cannot validate results. Run the query for that.
* `iplocation` requires a GeoIP `.mmdb` lookup uploaded to Cribl Search; the placeholder name `geocity` must be replaced.
* Splunk macros with arguments have no equivalent; Cribl macros are emitted as `${name}`.

## Troubleshooting

### Import from URL or Sync now fails
Check:
* "Backend engine not initialized" or a timeout: the tenant must run Cribl 4.20 or later, and the app must be installed (not only previewed) for the platform backend to run.
* "private broker request failed": the host is not reachable from the platform proxy. For GitHub, use an archive link (`.../archive/refs/heads/<branch>.tar.gz`, `.../archive/<tag>.tar.gz`), which the app fetches from `codeload.github.com`; release assets on `objects.githubusercontent.com` may not be reachable.
* HTTP 403 from the Splunk URL: the host is not in the app's External API Access list, or the token was not saved (enter it and click Save and test again).
* HTTP 401 from Splunk: the token is invalid or expired. Splunk tokens are created under Settings > Tokens.
* "Bad gateway" (HTTP 502/503/504) in Live Preview: the preview's backend functions do not exist until you click **Deploy**. Outside Live Preview, retry; the platform returns these when the app backend does not answer.

### The App Opens But Some Features Do Not Work
Possible causes:
* The header shows “Offline: translation only”: the app is running outside Cribl (for example `npm run dev` opened directly). Open it from the Cribl Apps page.
* The header shows “Partial tenant data”: one of the metadata endpoints was denied. Check the app's shared policies.

### The App Cannot Connect To An API Or Service
Check:
* The app is shared with your user by an admin (this grants the declared policies).
* Cribl Search is enabled for the workspace.

### Run in Cribl Search fails
Check:
* The Results tab shows the job's error lines. Common causes are an unresolved `<DATASET>` placeholder, an unsupported `// TODO` stage that still needs manual work, or a lookup that does not exist in this tenant.

## Development

```bash
npm install
npm run dev        # live preview (open from Cribl's app dev page for API access)
npm test           # unit tests (vitest)
npm run test:live  # differential tests against a live Splunk and Cribl Search (see tests/differential/README.md)
npm run translate -- 'index=web | stats count by host'   # CLI translation
npm run knowledge -- $SPLUNK_HOME/etc/system $SPLUNK_HOME/etc/apps/Splunk_SA_CIM --out knowledge.json   # Splunk knowledge bundle
npm run package    # build and create the .tgz app package
```

* `src/translator/` is a standalone, dependency-free module. It can be reused from Node or another app.
* `scripts/translate.ts` is a small CLI around it. Add `--json` for the full result (stages, notes, time range) and `--filters-as-where` to emit first-stage filters as `where`.
* `src/data/kql-catalog.ts` is a snapshot of the operator/function catalog from `GET /search/docs`; the app loads the live bundle at runtime and falls back to the snapshot.
* Translations are verified with a differential test suite (`tests/differential/`): the same events are loaded into Splunk (index `main`) and Cribl Search (as lookups), each SPL query runs in Splunk and its translation runs as a Cribl search job, and the rows are compared. The suites cover commands and eval functions, search-expression semantics (`OR` binds tighter than `AND` in `search`; `field!=value` requires the field), CIM knowledge and data models, and several sourcetypes in one query, in both filter modes. Unit tests only pin the emitted text; add a differential case for any change to translation semantics. The remaining differences are the documented semantic ones above.

## Project Layout

```text
src/
  App.tsx                 main UI
  knowledge/              Splunk knowledge: conf parsers, REST payload parser, PCRE→RE2 regex conversion, sourcetype shim, data models, package reader, KV packing
  api.ts                  Cribl REST calls (datasets, lookups, macros, docs, preview, jobs, saved searches, KV)
  translator/             SPL → KQL translator (lexer, expressions, search scope, commands, entry point)
  components/             Notes, Stages, Results, Reference, History and Splunk knowledge panels, confirmation dialog
  data/                   KQL catalog snapshot and cheat sheet
  examples.ts             sample SPL queries
images/                   README screenshots
tests/differential/       live Splunk vs Cribl Search comparison suite
scripts/
  translate.ts            CLI (--knowledge knowledge.json)
  knowledge-from-dir.ts   build a knowledge bundle from Splunk app folders
  prepare-git-pack.mjs    git-pack layout for the release workflow
backend/
  import-url.ts           importUrl backend function
  splunk-sync.ts          splunkSync backend function (also the nightly schedule target)
  lib/                    KV helpers and shared-bundle merge
tests/                    vitest suites
config/
  policies.yml            Cribl API paths the app needs
  proxies.yml             external hosts (GitHub; add your Splunk host)
  backend.yml             backend function declarations
  schedules.yml           nightly Splunk sync
```

## Versioning And Releases

* Semantic versioning. `npm run build` bundles the frontend and backend functions; `npm run package -- --version X.Y.Z` writes `build/cc-visicore-spl-to-kql-X.Y.Z.tgz`.
* Tagged releases carry the `.tgz` package for manual installs.

## Support

### Community Built
This app is provided as a community contribution by VisiCore. It does not carry an official support commitment from Cribl. Open an issue in the repository or email CriblPacks@VisiCoreTech.com.

## License

This app is licensed under the Apache License 2.0.

## App Metadata

| Field | Value |
|---|---|
| App Name | SPL to KQL |
| App ID | cc-visicore-spl-to-kql |
| Version | 1.2.0 |
| Author | VisiCore (Andrew Hendrix) |
| Support Model | community-built |
| Support Label | Community Built |
| Support Contact | CriblPacks@VisiCoreTech.com or GitHub issues |
| License | Apache-2.0 |
| License File | [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0.txt) |
| Product Tags | search |
| Category | Migration |
| Audience | analyst, admin, builder |
| Availability | preview |
| Requires External Access | no |
| Repository | https://github.com/Cribl-Community/cc-visicore-spl-to-kql |
| Documentation | this README |
| README Schema Version | 1.0 |
