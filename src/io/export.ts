import * as XLSX from 'xlsx';
import type { Cell, Plan, Settings, Table } from '../types';

export const APPENDED_COLUMNS = ['WORKER', 'DAY', 'SEQ', 'LEG_KM', 'CUM_KM', 'DIST_MODE', 'LOCKED', 'ROUTE_NOTE'] as const;
export const NOT_ROUTED_NOTE = 'no location - not routed';

interface Placed {
  row: number;
  worker: number | null;
  cells: Cell[]; // the 8 appended cells
}

function workerName(settings: Settings, w: number): string {
  return settings.workers[w]?.name ?? `Worker ${w + 1}`;
}

function blankAppended(note: string): Cell[] {
  return ['', '', '', '', '', '', '', note];
}

/** Rows in export order: routed (plan.routes order), unplaced routed, then not routed. */
function placeRows(table: Table, plan: Plan, settings: Settings): Placed[] {
  const n = table.rows.length;
  const seen = new Set<number>();
  const out: Placed[] = [];
  for (const route of plan.routes) {
    for (const s of route.stops) {
      if (s.row < 0 || s.row >= n || seen.has(s.row)) continue;
      seen.add(s.row);
      const a = plan.assignments[s.row];
      out.push({
        row: s.row,
        worker: route.worker,
        cells: [
          workerName(settings, route.worker),
          route.day === null ? '' : route.day,
          s.seq,
          s.legKm.toFixed(3),
          s.cumKm.toFixed(3),
          plan.distMode,
          a && (a.lockedWorker || a.lockedDay) ? 'Y' : '',
          '',
        ],
      });
    }
  }
  const notRouted = new Set(plan.notRouted.filter((r) => r >= 0 && r < n));
  // Routed rows that somehow are missing from plan.routes: never drop them.
  for (let r = 0; r < n; r++) {
    if (seen.has(r) || notRouted.has(r)) continue;
    seen.add(r);
    const a = plan.assignments[r];
    const cells = blankAppended('');
    if (a) {
      cells[0] = workerName(settings, a.worker);
      cells[1] = a.day === null ? '' : a.day;
      cells[6] = a.lockedWorker || a.lockedDay ? 'Y' : '';
    }
    out.push({ row: r, worker: a ? a.worker : null, cells });
  }
  for (let r = 0; r < n; r++) {
    if (seen.has(r)) continue;
    seen.add(r);
    out.push({ row: r, worker: null, cells: blankAppended(NOT_ROUTED_NOTE) });
  }
  return out;
}

function assemble(table: Table, placed: Placed[]): Table {
  return {
    headers: [...table.headers, ...APPENDED_COLUMNS],
    rows: placed.map((p) => [...table.rows[p.row], ...p.cells]),
    sourceName: table.sourceName,
  };
}

/** Throws unless the export has exactly one row per input row. */
export function assertExportCount(input: Table, exported: Table): void {
  if (exported.rows.length !== input.rows.length) {
    throw new Error(`Export has ${exported.rows.length} rows but the input has ${input.rows.length}. Refusing to export.`);
  }
}

/**
 * All input columns unchanged and in order, then APPENDED_COLUMNS. One row per input row,
 * exactly once. Order: worker, day, SEQ; not-routed rows last. LEG_KM/CUM_KM to 3 dp.
 */
export function buildExportTable(table: Table, plan: Plan, settings: Settings): Table {
  const out = assemble(table, placeRows(table, plan, settings));
  assertExportCount(table, out);
  return out;
}

/** Same, filtered to one worker (for the per-worker XLSX sheet). */
export function buildWorkerExportTable(table: Table, plan: Plan, settings: Settings, worker: number): Table {
  const routed = placeRows(table, plan, settings).filter((p) => p.worker === worker);
  return assemble(table, routed);
}

function csvField(c: Cell): string {
  const s = c === null || c === undefined ? '' : String(c);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV text (RFC 4180 quoting, CRLF). Prefixed with a UTF-8 BOM so Excel reads it right. */
export function toCsv(t: Table): string {
  const lines = [t.headers, ...t.rows].map((r) => r.map(csvField).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

/** Sheet name safe for Excel: no []:*?/\ , <= 31 chars, unique (case-insensitive). */
export function safeSheetName(name: string, used: Set<string>): string {
  let base = name.replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^'+|'+$/g, '');
  if (base === '') base = 'Worker';
  base = base.slice(0, 31);
  let candidate = base;
  let k = 2;
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` (${k++})`;
    candidate = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function toSheet(t: Table): XLSX.WorkSheet {
  // aoa_to_sheet keeps duplicate headers (a keyed json_to_sheet would merge them).
  return XLSX.utils.aoa_to_sheet([t.headers, ...t.rows]);
}

/** XLSX: sheet "All jobs" plus one sheet per worker (name sanitised, unique, <=31 chars). */
export function toXlsx(table: Table, plan: Plan, settings: Settings): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  XLSX.utils.book_append_sheet(wb, toSheet(buildExportTable(table, plan, settings)), safeSheetName('All jobs', used));
  const workers = [...new Set(plan.routes.map((r) => r.worker))].sort((a, b) => a - b);
  for (const w of workers) {
    const name = safeSheetName(workerName(settings, w), used);
    XLSX.utils.book_append_sheet(wb, toSheet(buildWorkerExportTable(table, plan, settings, w)), name);
  }
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer | Uint8Array;
  if (out instanceof ArrayBuffer) return out;
  const copy = new ArrayBuffer(out.byteLength);
  new Uint8Array(copy).set(out);
  return copy;
}
