import type { Assignments, Cell, ColumnMapping, ExtractedJobs, Job, Table } from '../types';
import { cellToNumber, validLocation } from './location';

function cellText(c: Cell | undefined): string {
  return c === null || c === undefined ? '' : String(c);
}

/** Split rows into routable jobs (valid location) and not-routed row indexes. Duplicates kept. */
export function extractJobs(table: Table, mapping: ColumnMapping): ExtractedJobs {
  const jobs: Job[] = [];
  const notRouted: number[] = [];
  table.rows.forEach((row, i) => {
    const loc = validLocation(row[mapping.lat], row[mapping.lon]);
    if (!loc) {
      notRouted.push(i);
      return;
    }
    jobs.push({
      row: i,
      label: cellText(row[mapping.label]),
      lat: loc.lat,
      lon: loc.lon,
      manualSeq: mapping.manualSeq === null ? null : cellToNumber(row[mapping.manualSeq]),
    });
  });
  return { jobs, notRouted };
}

/**
 * Initial assignment from the worker column: distinct non-blank (trimmed) values in
 * first-seen order become worker names. Each routed row with a value gets
 * { worker, day: null, lockedWorker: true, lockedDay: false }: accepting the column is the
 * user fixing the worker by hand. Rows with a blank value are not assigned.
 */
export function assignmentsFromWorkerColumn(
  table: Table,
  jobs: ExtractedJobs,
  column: number,
): { names: string[]; assignments: Assignments } {
  const names: string[] = [];
  const index = new Map<string, number>();
  const assignments: Assignments = {};
  for (const job of jobs.jobs) {
    const v = cellText(table.rows[job.row]?.[column]).trim();
    if (v === '') continue;
    let w = index.get(v);
    if (w === undefined) {
      w = names.length;
      names.push(v);
      index.set(v, w);
    }
    assignments[job.row] = { worker: w, day: null, lockedWorker: true, lockedDay: false };
  }
  return { names, assignments };
}
