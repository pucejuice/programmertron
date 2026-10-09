import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import type { Cell, Table } from '../types';

function isBlankCell(c: Cell | undefined): boolean {
  return c === null || c === undefined || (typeof c === 'string' && c.trim() === '');
}

/**
 * Turn raw arrays into a Table. Row 0 is the header. Short rows are padded with ''. If any
 * row is longer than the header, the headers are extended with '' so no cell is lost.
 */
function toTable(raw: Cell[][], sourceName?: string): Table {
  const rows = raw.map((r) => r.slice());
  if (rows.length === 0) return { headers: [], rows: [], sourceName };
  const headerRow = rows.shift() as Cell[];
  const headers = headerRow.map((h) => (h === null || h === undefined ? '' : String(h)));
  let width = headers.length;
  for (const r of rows) if (r.length > width) width = r.length;
  while (headers.length < width) headers.push('');
  const padded = rows.map((r) => {
    const out: Cell[] = r.map((c) => (c === undefined ? '' : c));
    while (out.length < width) out.push('');
    return out;
  });
  return { headers, rows: padded, sourceName };
}

function dropTrailingBlankRows(raw: Cell[][]): Cell[][] {
  let end = raw.length;
  while (end > 1 && raw[end - 1].every(isBlankCell)) end--;
  // A file that is only a blank line has no header either.
  if (end === 1 && raw[0].every(isBlankCell)) end = 0;
  return raw.slice(0, end);
}

/** Parse CSV text as arrays (PapaParse header:false). Strips a leading BOM. Skips fully blank trailing lines. */
export function parseCsv(text: string, sourceName?: string): Table {
  let t = text;
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
  const res = Papa.parse<string[]>(t, { header: false, skipEmptyLines: false, dynamicTyping: false });
  const raw = dropTrailingBlankRows(res.data as Cell[][]);
  if (raw.length > 0 && typeof raw[0][0] === 'string' && raw[0][0].charCodeAt(0) === 0xfeff) {
    raw[0][0] = raw[0][0].slice(1);
  }
  return toTable(raw, sourceName);
}

function readBook(data: ArrayBuffer): XLSX.WorkBook {
  return XLSX.read(new Uint8Array(data), { type: 'array' });
}

/** Sheet names of an XLSX workbook. */
export function listXlsxSheets(data: ArrayBuffer): string[] {
  return readBook(data).SheetNames.slice();
}

/** Parse one sheet (default: first) as arrays. First row = headers. */
export function parseXlsx(data: ArrayBuffer, sheetName?: string): Table {
  const wb = readBook(data);
  const name = sheetName ?? wb.SheetNames[0];
  const ws = name === undefined ? undefined : wb.Sheets[name];
  if (!ws) throw new Error(sheetName ? `Sheet "${sheetName}" not found in the workbook.` : 'The workbook has no sheets.');
  const aoa = XLSX.utils.sheet_to_json<Cell[]>(ws, { header: 1, defval: '', raw: true, blankrows: false });
  const raw = aoa.map((r) => r.map((c) => (c === null || c === undefined ? '' : (c as Cell))));
  if (raw.length > 0) {
    raw[0] = raw[0].map((h) => (typeof h === 'string' ? h : String(h)));
    const first = raw[0][0];
    if (typeof first === 'string' && first.charCodeAt(0) === 0xfeff) raw[0][0] = first.slice(1);
  }
  return toTable(raw, name);
}
