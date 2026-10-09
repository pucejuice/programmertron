import { describe, expect, it } from 'vitest';
import { FIXTURE_5_CSV } from '../src/sample';
import { parseCsv } from '../src/io/parse';
import { detectLatLon, detectManualSeq, detectWorkerColumns, normHeader } from '../src/io/columns';
import { assignmentsFromWorkerColumn, extractJobs } from '../src/io/jobs';
import { parsePlanFile, serializePlanFile } from '../src/io/planfile';
import { defaultSettings } from '../src/core/defaults';
import type { ColumnMapping, Table } from '../src/types';
import { fixturePlan } from './io-helpers';

describe('columns', () => {
  it('normalises', () => expect(normHeader('  LaT ')).toBe('lat'));
  it('detects lat/lon, first match wins', () => {
    expect(detectLatLon(['Premise', ' Latitude ', 'LNG', 'lat', 'Long'])).toEqual({ lat: 1, lon: 2 });
    expect(detectLatLon(['a', 'b'])).toEqual({ lat: null, lon: null });
    expect(detectLatLon(['x', 'lon'])).toEqual({ lat: null, lon: 1 });
  });
  it('finds all worker columns', () => {
    const h = ['id', 'Assigned To', ...Array(30).fill('x'), 'Assigned To', 'Crew', 'Tech', 'Worker'];
    expect(detectWorkerColumns(h)).toEqual([1, 32, 33, 34, 35]);
  });
  it('MANUAL_SEQ', () => {
    expect(detectManualSeq(['a', ' manual_seq '])).toBe(1);
    expect(detectManualSeq(['a'])).toBeNull();
  });
});

describe('extractJobs', () => {
  const mk = (rows: string[][]): Table => ({ headers: ['id', 'Lat', 'Long', 'MANUAL_SEQ'], rows });
  const mapping: ColumnMapping = { lat: 1, lon: 2, label: 0, worker: null, manualSeq: 3 };

  it('fixture: P004 not routed, duplicates kept', () => {
    const t = parseCsv(FIXTURE_5_CSV);
    const r = extractJobs(t, { lat: 2, lon: 3, label: 0, worker: null, manualSeq: null });
    expect(r.jobs.map((j) => j.label)).toEqual(['P001', 'P002', 'P003', 'P005']);
    expect(r.notRouted).toEqual([3]);
    expect(r.jobs[0]).toMatchObject({ row: 0, lat: -33.87, lon: 151.21, manualSeq: null });
    expect(r.jobs[2]).toMatchObject({ lat: -33.87, lon: 151.21 });
  });
  it('rejects invalid locations', () => {
    const t = mk([
      ['ok', '-33.5', '151.5', '3'],
      ['blank', '', '151', ''],
      ['spaces', '  ', '151', ''],
      ['abc', 'abc', '151', ''],
      ['91', '91', '151', ''],
      ['-181', '10', '-181', ''],
      ['zero', '0', '0', ''],
      ['zero2', '0.0', ' 0 ', ''],
      ['lat0', '0', '10', ''],
      ['pad', ' 12.5 ', ' 100 ', 'x'],
    ]);
    const r = extractJobs(t, mapping);
    expect(r.jobs.map((j) => j.label)).toEqual(['ok', 'lat0', 'pad']);
    expect(r.notRouted).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(r.jobs.map((j) => j.manualSeq)).toEqual([3, null, null]);
  });
  it('accepts numeric cells (xlsx) and stringifies labels', () => {
    const t: Table = { headers: ['id', 'Lat', 'Long'], rows: [[12, -33, 151], [null, 'NaN', 1]] };
    const r = extractJobs(t, { lat: 1, lon: 2, label: 0, worker: null, manualSeq: null });
    expect(r.jobs[0].label).toBe('12');
    expect(r.notRouted).toEqual([1]);
  });
});

describe('assignmentsFromWorkerColumn', () => {
  it('names in first-seen order, locked workers, blanks unassigned', () => {
    const t: Table = {
      headers: ['id', 'Lat', 'Long', 'Worker'],
      rows: [['a', '1', '1', ' Bob '], ['b', '2', '2', 'Amy'], ['c', '3', '3', ''], ['d', '4', '4', 'Bob'], ['e', '', '', 'Zed']],
    };
    const ex = extractJobs(t, { lat: 1, lon: 2, label: 0, worker: 3, manualSeq: null });
    const { names, assignments } = assignmentsFromWorkerColumn(t, ex, 3);
    expect(names).toEqual(['Bob', 'Amy']);
    expect(assignments).toEqual({
      0: { worker: 0, day: null, lockedWorker: true, lockedDay: false },
      1: { worker: 1, day: null, lockedWorker: true, lockedDay: false },
      3: { worker: 0, day: null, lockedWorker: true, lockedDay: false },
    });
  });
});

describe('planfile', () => {
  const t = parseCsv(FIXTURE_5_CSV);
  const { plan, settings } = fixturePlan();
  const base = {
    table: t,
    mapping: { lat: 2, lon: 3, label: 0, worker: null, manualSeq: null } as ColumnMapping,
    settings,
    assignments: plan.assignments,
    dayOrder: { 0: [2, 1] },
    plan,
  };
  it('round trips', () => {
    const f = parsePlanFile(serializePlanFile(base));
    expect(f.format).toBe('job-router-plan');
    expect(f.version).toBe(1);
    expect(f.table).toEqual({ ...t, sourceName: undefined });
    expect(f.settings).toEqual(settings);
    expect(f.plan).toEqual(plan);
    expect(f.dayOrder).toEqual({ 0: [2, 1] });
    expect(parsePlanFile(serializePlanFile({ ...base, plan: null })).plan).toBeNull();
  });
  it('gives readable errors', () => {
    expect(() => parsePlanFile('{nope')).toThrow(/not valid JSON/);
    expect(() => parsePlanFile('[]')).toThrow(/object/);
    expect(() => parsePlanFile('{"format":"x"}')).toThrow(/not a Job Router plan/);
    expect(() => parsePlanFile('{"format":"job-router-plan","version":2}')).toThrow(/version 2/);
    const f = JSON.parse(serializePlanFile(base));
    f.table.rows[0].pop();
    expect(() => parsePlanFile(JSON.stringify(f))).toThrow(/row 1 has/);
    const g = JSON.parse(serializePlanFile(base));
    g.mapping.lat = 99;
    expect(() => parsePlanFile(JSON.stringify(g))).toThrow(/mapping.lat/);
    const h = JSON.parse(serializePlanFile(base));
    delete h.settings;
    expect(() => parsePlanFile(JSON.stringify(h))).toThrow(/settings/);
  });
  it('defaults still valid shape', () => {
    expect(defaultSettings().workers.length).toBe(1);
  });
});
