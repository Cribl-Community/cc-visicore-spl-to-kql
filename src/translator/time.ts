/**
 * Splunk relative-time helpers.
 *
 * Cribl Search's time-range picker accepts the same relative syntax Splunk
 * uses (`-24h`, `-1d@d`, `now`, `@d`), so earliest/latest are passed through.
 * Inside expressions (relative_time / span) we need real conversions.
 */

const UNIT_MAP: Record<string, string> = {
  s: 's',
  sec: 's',
  secs: 's',
  second: 's',
  seconds: 's',
  m: 'm',
  min: 'm',
  mins: 'm',
  minute: 'm',
  minutes: 'm',
  h: 'h',
  hr: 'h',
  hrs: 'h',
  hour: 'h',
  hours: 'h',
  d: 'd',
  day: 'd',
  days: 'd',
  w: 'w',
  week: 'w',
  weeks: 'w',
  mon: 'mon',
  month: 'mon',
  months: 'mon',
  y: 'y',
  yr: 'y',
  year: 'y',
  years: 'y',
};

export interface Span {
  n: number;
  unit: string; // s m h d w mon y
}

/** Parse a Splunk span like `5m`, `1h`, `30`, `1mon`. Bare numbers are seconds. */
export function parseSpan(span: string): Span | null {
  const m = /^(\d+)([a-zA-Z]*)$/.exec(span.trim());
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const unit = m[2] ? UNIT_MAP[m[2].toLowerCase()] : 's';
  if (!unit) return null;
  return { n, unit };
}

/** Render a span as a KQL timespan literal (`5m`, `1h`, `1d`). Weeks become days. */
export function spanToTimespan(span: Span): { literal: string; note?: string } {
  switch (span.unit) {
    case 'w':
      return { literal: `${span.n * 7}d` };
    case 'mon':
      return { literal: `${span.n * 30}d`, note: 'Month spans are approximated as 30 days in bin(); use timestats span=1mon for calendar months.' };
    case 'y':
      return { literal: `${span.n * 365}d`, note: 'Year spans are approximated as 365 days in bin().' };
    default:
      return { literal: `${span.n}${span.unit}` };
  }
}

/**
 * Render a span for timestats span=. Cribl aligns buckets to the search's
 * earliest time; the snap suffix (e.g. `15m@h`) aligns them to the clock the
 * way Splunk does. Supports mon and y natively.
 */
export function spanToTimestats(span: Span, snap?: string): string {
  const base = `${span.n}${span.unit}`;
  if (snap) return `${base}@${snap}`;
  const auto: Record<string, string> = { s: 'm', m: 'h', h: 'd', d: 'd', w: 'w', mon: 'mon', y: 'y' };
  const s = auto[span.unit];
  return s ? `${base}@${s}` : base;
}

/**
 * Convert a Splunk relative time modifier (`-1d@d`, `@h`, `+30m`, `now`) applied to
 * a KQL datetime expression. Returns null if it cannot be expressed.
 */
export function relativeTimeToKql(base: string, modifier: string): { kql: string; note?: string } | null {
  const mod = modifier.trim();
  if (mod === 'now' || mod === '') return { kql: base };
  const m = /^([+-]?\d+[a-zA-Z]*)?(?:@([a-zA-Z0-9]+))?$/.exec(mod);
  if (!m) return null;
  let expr = base;
  let note: string | undefined;
  if (m[1]) {
    const sign = m[1].startsWith('-') ? '-' : '+';
    const span = parseSpan(m[1].replace(/^[+-]/, ''));
    if (!span) return null;
    const ts = spanToTimespan(span);
    note = ts.note;
    expr = `${expr} ${sign} ${ts.literal}`;
  }
  if (m[2]) {
    const snap = m[2].toLowerCase();
    const inner = expr;
    if (/^(s|sec|second)s?$/.test(snap)) expr = `bin(${inner}, 1s)`;
    else if (/^(m|min|minute)s?$/.test(snap)) expr = `bin(${inner}, 1m)`;
    else if (/^(h|hr|hour)s?$/.test(snap)) expr = `bin(${inner}, 1h)`;
    else if (/^(d|day)s?$/.test(snap)) expr = `startofday(${inner})`;
    else if (/^(w|week)s?\d?$/.test(snap)) expr = `startofweek(${inner})`;
    else if (/^(mon|month)s?$/.test(snap)) expr = `startofmonth(${inner})`;
    else if (/^(y|yr|year)s?$/.test(snap)) expr = `startofyear(${inner})`;
    else if (/^(q|qtr|quarter)s?$/.test(snap)) return null;
    else return null;
  }
  return { kql: expr, note };
}
