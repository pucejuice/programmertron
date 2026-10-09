import type { Table } from '../types';

/** Parse CSV text as arrays (PapaParse header:false). Strips a leading BOM. Skips fully blank trailing lines. */
export function parseCsv(_text: string, _sourceName?: string): Table { throw new Error('not implemented'); }

/** Sheet names of an XLSX workbook. */
export function listXlsxSheets(_data: ArrayBuffer): string[] { throw new Error('not implemented'); }

/** Parse one sheet (default: first) as arrays. First row = headers. */
export function parseXlsx(_data: ArrayBuffer, _sheetName?: string): Table { throw new Error('not implemented'); }
