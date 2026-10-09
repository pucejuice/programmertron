import type { Plan, Settings, Table } from '../types';

export const APPENDED_COLUMNS = ['WORKER', 'DAY', 'SEQ', 'LEG_KM', 'CUM_KM', 'DIST_MODE', 'LOCKED', 'ROUTE_NOTE'] as const;
export const NOT_ROUTED_NOTE = 'no location - not routed';

/**
 * All input columns unchanged and in order, then APPENDED_COLUMNS. One row per input row,
 * exactly once. Order: worker, day, SEQ; not-routed rows last. LEG_KM/CUM_KM to 3 dp.
 */
export function buildExportTable(_table: Table, _plan: Plan, _settings: Settings): Table { throw new Error('not implemented'); }

/** Same, filtered to one worker (for the per-worker XLSX sheet). */
export function buildWorkerExportTable(_table: Table, _plan: Plan, _settings: Settings, _worker: number): Table { throw new Error('not implemented'); }

/** CSV text (RFC 4180 quoting, CRLF). Prefixed with a UTF-8 BOM so Excel reads it right. */
export function toCsv(_t: Table): string { throw new Error('not implemented'); }

/** XLSX: sheet "All jobs" plus one sheet per worker (name sanitised, unique, <=31 chars). */
export function toXlsx(_table: Table, _plan: Plan, _settings: Settings): ArrayBuffer { throw new Error('not implemented'); }
