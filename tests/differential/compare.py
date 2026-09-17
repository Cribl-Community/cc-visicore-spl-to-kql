"""Result comparison for the differential tests: Splunk rows vs Cribl Search rows.

Pure functions with no environment access, so `test_compare.py` can prove the comparator rejects wrong
results. The rules are strict by default; every relaxation is narrow and named:

* Row count must match. The one exception is `stats`/`tstats` without `by` over no events, where Splunk
  returns a single all-zero row and Cribl returns none.
* Fields are the union over every Splunk row (plus Cribl-only fields), not the first row's keys, so a
  field that is missing from some rows is still compared where it appears.
* Row order is compared whenever the SPL's final result order is defined (an order-giving command such as
  `sort`, `tail`, `reverse`, `top` or `rare` after the last command that builds a new result set).
  Otherwise rows are matched as a multiset. A case can override with `ordered: True/False` plus a reason.
"""
import datetime
import json
import re

# Commands that build a new result set whose order is not defined in Cribl (Splunk sorts some of them).
RESHAPE = {'stats', 'tstats', 'chart', 'timechart', 'xyseries', 'untable', 'transpose', 'datamodel', 'from', 'inputlookup', 'append', 'join'}
# Commands whose output order is defined and must be reproduced.
ORDERING = {'sort', 'tail', 'reverse', 'top', 'rare'}


def stage_commands(spl):
    """Command name of each pipeline stage (quote- and bracket-aware enough for the test cases)."""
    stages, depth, quote, cur = [], 0, None, ''
    for ch in spl:
        if quote:
            cur += ch
            if ch == quote:
                quote = None
            continue
        if ch in '"\'':
            quote = ch
        elif ch == '[':
            depth += 1
        elif ch == ']':
            depth -= 1
        elif ch == '|' and depth == 0:
            stages.append(cur)
            cur = ''
            continue
        cur += ch
    stages.append(cur)
    out = []
    for i, s in enumerate(stages):
        m = re.match(r'\s*([A-Za-z_]+)', s)
        if not s.strip():
            continue
        # The first stage without a pipe is the implicit search.
        out.append(('search' if i == 0 and not spl.lstrip().startswith('|') else (m.group(1).lower() if m else ''), s.strip()))
    return out


def ordered_result(spl):
    ordered = False
    for cmd, _ in stage_commands(spl):
        if cmd in RESHAPE:
            ordered = False
        elif cmd in ORDERING:
            ordered = True
    return ordered


def empty_aggregate(spl):
    """True when the final result-building stage is stats/tstats without `by` (one row even over no events)."""
    last = None
    for cmd, text in stage_commands(spl):
        if cmd in RESHAPE:
            last = (cmd, text)
    return bool(last) and last[0] in ('stats', 'tstats') and not re.search(r'\bby\b', last[1], re.I)


def num(v):
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        try:
            return float(v)
        except ValueError:
            return None
    return None


def norm(v):
    if isinstance(v, str) and re.match(r'^\d{4}-\d\d-\d\dT', v):
        v = datetime.datetime.fromisoformat(v).timestamp()
    n = num(v)
    if n is not None:
        return round(n, 6)
    if isinstance(v, list):
        return sorted(str(norm(x)) for x in v)
    return '' if v is None else str(v)


def eq(a, b, tol, rel):
    na, nb = num(norm(a)), num(norm(b))
    if na is not None and nb is not None:
        return abs(na - nb) <= (tol * max(1.0, abs(na)) if rel else tol)
    return norm(a) == norm(b)


def all_zero(rows):
    return all(num(v) == 0.0 or v in ('', None) for r in rows for k, v in r.items() if not k.startswith('_'))


def compare_rows(spl, srows, crows, opt=None):
    """Return (status, message). Status is PASS, ROWS, EMPTY or DIFF."""
    opt = opt or {}
    tol, rel = opt.get('tol', 1e-6), opt.get('rel', False)
    if opt.get('dropzero'):
        srows = [r for r in srows if any(num(v) not in (None, 0.0) for k, v in r.items() if k != '_time' and not k.startswith('_'))]
    if len(srows) == 1 and not crows and all_zero(srows) and empty_aggregate(spl):
        return 'PASS', '(aggregate over no events: Splunk returns one zero row, Cribl none)'
    if not srows and not crows:
        return 'PASS', '(both empty)'
    if not srows:
        return 'EMPTY', f'splunk returned no rows; cribl {len(crows)} rows: {crows[:2]}'

    def visible(k):
        return not k.startswith('_') or k == '_time'

    fields = []
    for r in srows:
        for k in r:
            if visible(k) and k not in fields:
                fields.append(k)
    # Splunk keeps data model prefixes (Web.action) in tstats output; Cribl output is unprefixed.
    unprefixed = {f.split('.', 1)[1] if '.' in f else f for f in fields}
    for r in crows:
        for k in r:
            if visible(k) and k not in fields and k not in unprefixed:
                fields.append(k)
                unprefixed.add(k)

    def cget(row, f):
        return row.get(f, row.get(f.split('.', 1)[1] if '.' in f else f))

    def key(row, get):
        return json.dumps([norm(get(row, f)) for f in fields], sort_keys=True)

    if len(srows) != len(crows):
        return 'ROWS', f'splunk {len(srows)} rows vs cribl {len(crows)} rows\nfields={fields}\nS={srows[:3]}\nC={crows[:3]}'
    ordered = opt['ordered'] if 'ordered' in opt else ordered_result(spl)
    if ordered:
        ss, cs = srows, crows
    else:
        ss = sorted(srows, key=lambda r: key(r, lambda row, f: row.get(f)))
        cs = sorted(crows, key=lambda r: key(r, cget))
    for i, (sr, cr) in enumerate(zip(ss, cs)):
        bad = [f for f in fields if not eq(sr.get(f), cget(cr, f), tol, rel)]
        if bad:
            where = f'row {i + 1} (ordered)' if ordered else 'after sorting both sides'
            return 'DIFF', f'{where}, fields {bad}:\n{ {f: sr.get(f) for f in fields} }\nvs { {f: cget(cr, f) for f in fields} }'
    return 'PASS', '(ordered)' if ordered else ''
