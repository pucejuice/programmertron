import type { Assignments, ColumnMapping, ExtractedJobs, Table } from '../types';

/** Split rows into routable jobs (valid location) and not-routed row indexes. Duplicates kept. */
export function extractJobs(_table: Table, _mapping: ColumnMapping): ExtractedJobs { throw new Error('not implemented'); }

/**
 * Initial assignment from the worker column: distinct non-blank values in first-seen order
 * become worker names. Returns names and per-row assignment (lockedWorker false).
 */
export function assignmentsFromWorkerColumn(
  _table: Table,
  _jobs: ExtractedJobs,
  _column: number,
): { names: string[]; assignments: Assignments } { throw new Error('not implemented'); }
