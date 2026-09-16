import type { Knowledge } from '../knowledge/types';

/**
 * Shared types for the SPL → Cribl Search KQL translator.
 *
 * The translator is deterministic and rule-based: every SPL command is handled by
 * a dedicated handler that emits zero or more KQL pipeline stages plus notes that
 * explain what was translated, what was approximated, and what needs a human.
 */

export type NoteLevel = 'info' | 'warning' | 'error';

export interface Note {
  level: NoteLevel;
  /** 1-based index of the SPL pipeline stage the note is about (0 = whole query). */
  stage: number;
  /** SPL command the note is about (e.g. "stats"). */
  command: string;
  message: string;
}

export interface TimeRange {
  earliest?: string;
  latest?: string;
}

export interface StageResult {
  /** 1-based stage index in the SPL pipeline. */
  index: number;
  /** Original SPL text for the stage. */
  spl: string;
  /** SPL command name ("search" for the implicit first stage). */
  command: string;
  /** Emitted KQL stages (without the leading pipe). Empty when nothing was emitted. */
  kql: string[];
  /** True if the stage could not be translated at all. */
  unsupported: boolean;
}

export interface TranslationResult {
  /** The full KQL query, one pipeline stage per line. */
  kql: string;
  stages: StageResult[];
  notes: Note[];
  timeRange: TimeRange;
  /** Cribl dataset ids referenced (after applying indexMap). */
  datasets: string[];
  /** Splunk index names as written in the SPL. */
  indexes: string[];
  /** Sourcetypes referenced by the scope (after tag/eventtype expansion). */
  sourcetypes: string[];
  /** Lookup table names referenced. */
  lookups: string[];
  /** Macro names referenced. */
  macros: string[];
  /** Count of stages that could not be translated. */
  unsupportedCount: number;
}

export interface TranslateOptions {
  /**
   * Dataset to use when the SPL has no index= clause. Cribl Search requires a
   * dataset scope, so the translator emits a placeholder and a note if this is unset.
   */
  defaultDataset?: string;
  /** Known Cribl Search dataset ids; used to warn about unknown index names. */
  knownDatasets?: string[];
  /** Known Cribl Search lookup file names; used to warn about unknown lookups. */
  knownLookups?: string[];
  /** Known Cribl Search macro ids; used to warn about unknown macros. */
  knownMacros?: string[];
  /**
   * Emit first-stage filters as a `where` stage instead of Cribl's initial
   * scope predicate. Slower on real datasets (no push-down) but lets the
   * preview endpoint, which ignores scope predicates, evaluate them.
   */
  filtersAsWhere?: boolean;
  /** Splunk index (or sourcetype) name → Cribl dataset id overrides (e.g. { main: "default_logs" }). */
  indexMap?: Record<string, string>;
  /** Splunk knowledge objects (props/transforms, eventtypes, tags, data models) used to reproduce search-time fields. */
  knowledge?: Knowledge;
  /** Emit search-time field stages for sourcetypes found in the knowledge (default true when knowledge is set). */
  applyShim?: boolean;
}

/** Mutable state threaded through the translation of one query. */
export interface Ctx {
  opts: TranslateOptions;
  notes: Note[];
  stage: number;
  command: string;
  /**
   * SPL field name → KQL field name. Populated when an aggregation produces a
   * Splunk-style name like `sum(bytes)` that KQL cannot use verbatim.
   */
  fieldAliases: Map<string, string>;
  datasets: Set<string>;
  indexes: Set<string>;
  lookups: Set<string>;
  macros: Set<string>;
  /** Sourcetypes referenced by the scope (after tag/eventtype expansion). */
  sourcetypes: Set<string>;
  /** Data model object names whose `Object.field` prefix is stripped from field references. */
  dmPrefixes: Set<string>;
  timeRange: TimeRange;
  /** True while translating a subsearch (append/join/union); subqueries need the explicit `cribl` keyword. */
  inSubsearch: boolean;
  note(level: NoteLevel, message: string): void;
}

export function createCtx(opts: TranslateOptions, inSubsearch = false): Ctx {
  const ctx: Ctx = {
    opts,
    notes: [],
    stage: 0,
    command: '',
    fieldAliases: new Map(),
    datasets: new Set(),
    indexes: new Set(),
    lookups: new Set(),
    macros: new Set(),
    sourcetypes: new Set(),
    dmPrefixes: new Set(),
    timeRange: {},
    inSubsearch,
    note(level, message) {
      ctx.notes.push({ level, stage: ctx.stage, command: ctx.command, message });
    },
  };
  return ctx;
}
