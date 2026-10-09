import { describe, expect, it } from 'vitest';
import { FIXTURE_5_CSV } from '../src/sample';
import { parseCsv, parseXlsx, listXlsxSheets } from '../src/io/parse';
import { APPENDED_COLUMNS, NOT_ROUTED_NOTE, assertExportCount, buildExportTable, safeSheetName, toCsv, toXlsx } from '../src/io/export';
import { fixturePlan } from './io-helpers';
import type { Table } from '../src/types';

describe('parseCsv', () => {
  it('pads short rows, extends headers for long rows, drops trailing blank lines, strips BOM', () => {
    const t = parseCsv('﻿A,B\n1\n2,3,4\n\n\n');
    expect(t.headers).toEqual(['A', 'B', '']);
    expect(t.rows).toEqual([['1', '', ''], ['2', '3', '4']]);
  });
  it('strips a BOM that survives inside the first header cell', () => {
    expect(parseCsv('"﻿A",B\n1,2').headers).toEqual(['A', 'B']);
  });
  it('handles quoted commas, quotes and newlines', () => {
    const t = parseCsv('a,b\n"x, y","he said ""hi""\nline2"\n');
    expect(t.rows[0]).toEqual(['x, y', 'he said "hi"\nline2']);
  });
  it('empty text gives an empty table', () => {
    expect(parseCsv('')).toMatchObject({ headers: [], rows: [] });
  });
});

describe('export of the 5-row fixture', () => {
  const table = parseCsv(FIXTURE_5_CSV);
  const { plan, settings } = fixturePlan();
  const ex = buildExportTable(table, plan, settings);

  it('has 5 rows, original columns then appended columns', () => {
    expect(ex.rows).toHaveLength(5);
    expect(ex.headers).toEqual([...table.headers, ...APPENDED_COLUMNS]);
  });
  it('orders routed rows by plan, P004 last with the note', () => {
    expect(ex.rows.map((r) => r[0])).toEqual(['P002', 'P001', 'P003', 'P005', 'P004']);
    const w = table.headers.length;
    const last = ex.rows[4];
    expect(last.slice(w)).toEqual(['', '', '', '', '', '', '', NOT_ROUTED_NOTE]);
    expect(ex.rows[0].slice(w)).toEqual(['Worker 1', '', 1, '4.500', '4.500', 'straight', 'Y', '']);
    expect(ex.rows[3].slice(w)[3]).toBe('11.123');
  });
  it('CSV has 5 data rows with P004 last', () => {
    const back = parseCsv(toCsv(ex));
    expect(back.rows).toHaveLength(5);
    expect(back.rows[4][0]).toBe('P004');
    expect(back.rows[4][back.headers.indexOf('ROUTE_NOTE')]).toBe(NOT_ROUTED_NOTE);
  });
  it('XLSX All jobs sheet has 5 data rows with P004 last; worker sheet has 4', () => {
    const buf = toXlsx(table, plan, settings);
    expect(listXlsxSheets(buf)).toEqual(['All jobs', 'Worker 1']);
    const all = parseXlsx(buf, 'All jobs');
    expect(all.rows).toHaveLength(5);
    expect(all.rows[4][0]).toBe('P004');
    expect(all.rows[4][all.headers.indexOf('ROUTE_NOTE')]).toBe(NOT_ROUTED_NOTE);
    expect(parseXlsx(buf, 'Worker 1').rows.map((r) => r[0])).toEqual(['P002', 'P001', 'P003', 'P005']);
  });
  it('never drops a routed row missing from plan.routes', () => {
    const p = structuredClone(plan);
    p.routes[0].stops = p.routes[0].stops.filter((s) => s.row !== 2);
    const e = buildExportTable(table, p, settings);
    expect(e.rows.map((r) => r[0])).toEqual(['P002', 'P001', 'P005', 'P003', 'P004']);
    expect(() => assertExportCount(table, { ...e, rows: e.rows.slice(1) })).toThrow();
  });
});

describe('column preservation (brief 9.3)', () => {
  const csv = '﻿Name,Assigned To,Lat,Long,Assigned To\r\nA,x,-33.1,151.2,y\r\nB,,-33.2,151.3,\r\n';
  const table = parseCsv(csv);
  const { plan, settings } = fixturePlan();
  plan.notRouted = [];
  plan.routes[0].stops = [
    { row: 1, seq: 1, legKm: 1, cumKm: 1 },
    { row: 0, seq: 2, legKm: 2, cumKm: 3 },
  ];
  plan.assignments = {};
  const ex = buildExportTable(table, plan, settings);
  const expected = ['Name', 'Assigned To', 'Lat', 'Long', 'Assigned To', ...APPENDED_COLUMNS];

  it('BOM stripped, duplicates kept', () => {
    expect(table.headers).toEqual(['Name', 'Assigned To', 'Lat', 'Long', 'Assigned To']);
  });
  it('CSV round trip', () => {
    const text = toCsv(ex);
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain('\r\n');
    const back = parseCsv(text);
    expect(back.headers).toEqual(expected);
    expect(back.rows[0].slice(0, 5)).toEqual(table.rows[1]);
  });
  it('XLSX round trip', () => {
    const back = parseXlsx(toXlsx(table, plan, settings));
    expect(back.headers).toEqual(expected);
    expect(back.rows[1].slice(0, 5)).toEqual(table.rows[0]);
  });
  it('keeps numbers as numbers in XLSX', () => {
    const t: Table = { headers: ['n', 'Lat', 'Long'], rows: [[5, 1, 2], ['007', 3, 4]] };
    const p = fixturePlan();
    p.plan.notRouted = [0, 1];
    p.plan.routes = [];
    const back = parseXlsx(toXlsx(t, p.plan, p.settings), 'All jobs');
    expect(back.rows[0][0]).toBe(5);
    expect(back.rows[1][0]).toBe('007');
  });
});

describe('toCsv quoting and sheet names', () => {
  it('quotes commas, quotes, newlines', () => {
    const t: Table = { headers: ['a', 'b'], rows: [['x,y', 'q"r'], ['l1\nl2', null]] };
    expect(toCsv(t)).toBe('﻿a,b\r\n"x,y","q""r"\r\n"l1\nl2",\r\n');
  });
  it('sanitises, truncates and uniquifies', () => {
    const used = new Set<string>();
    const a = safeSheetName('A/B:C*D?[E]\\F' + 'x'.repeat(40), used);
    expect(a).not.toMatch(/[[\]:*?/\\]/);
    expect(a.length).toBeLessThanOrEqual(31);
    const b = safeSheetName('A/B:C*D?[E]\\F' + 'x'.repeat(40), used);
    expect(b).not.toBe(a);
    expect(b.length).toBeLessThanOrEqual(31);
    expect(safeSheetName('all jobs', new Set(['all jobs']))).toBe('all jobs (2)');
  });
});
