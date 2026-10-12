import { describe, expect, it } from 'vitest';
import { buildPlan } from '../src/core/plan';
import { PARITY_40_CSV } from '../src/sample';
import { input, jobsFromCsv } from './core-helpers';

// Manual moves re-route with keepDays: only the moved job changes day; nothing else is re-split.
describe('keepDays (manual moves)', () => {
  it('moving one job into another day leaves every other job in its day', async () => {
    const { jobs } = jobsFromCsv(PARITY_40_CSV);
    const first = await buildPlan(input(jobs, { dayMode: 'count', jobsPerDay: 7 }));
    const moved = first.routes[0].stops[0].row; // a day-1 job
    const assignments = { ...first.assignments, [moved]: { worker: 0, day: 3, lockedWorker: true, lockedDay: true } };
    const next = await buildPlan(input(jobs, { dayMode: 'count', jobsPerDay: 7 }, { assignments, onlyWorkers: [0], previous: first, keepDays: true }));
    for (const j of jobs) {
      const want = j.row === moved ? 3 : first.assignments[j.row].day;
      expect(next.assignments[j.row].day, `row ${j.row}`).toBe(want);
    }
    const size = (p: typeof first, d: number) => p.routes.find((r) => r.day === d)!.stops.length;
    expect(size(next, 1)).toBe(size(first, 1) - 1);
    expect(size(next, 3)).toBe(size(first, 3) + 1); // over the 7/day target is allowed for a manual move
    expect(next.routes.flatMap((r) => r.stops).length).toBe(40);
  });

  it('a job with no day joins the nearest day; a day emptied by moves disappears', async () => {
    const { jobs } = jobsFromCsv(PARITY_40_CSV);
    const first = await buildPlan(input(jobs, { dayMode: 'count', jobsPerDay: 7 }));
    const day6 = first.routes.find((r) => r.day === 6)!.stops.map((s) => s.row);
    const assignments = { ...first.assignments };
    for (const r of day6) assignments[r] = { worker: 0, day: null, lockedWorker: true, lockedDay: false };
    const next = await buildPlan(input(jobs, { dayMode: 'count', jobsPerDay: 7 }, { assignments, onlyWorkers: [0], previous: first, keepDays: true }));
    expect(next.routes.map((r) => r.day)).toEqual([1, 2, 3, 4, 5]);
    expect(next.routes.flatMap((r) => r.stops).length).toBe(40);
    for (const j of jobs) if (!day6.includes(j.row)) expect(next.assignments[j.row].day).toBe(first.assignments[j.row].day);
  });

  it('pinned (MANUAL_SEQ) order is kept exactly within a kept day', async () => {
    const { jobs } = jobsFromCsv(PARITY_40_CSV);
    const first = await buildPlan(input(jobs, { dayMode: 'count', jobsPerDay: 7 }));
    const d1 = first.routes[0].stops.map((s) => s.row);
    const want = [...d1].reverse();
    const pinned = jobs.map((j) => (want.includes(j.row) ? { ...j, manualSeq: want.indexOf(j.row) + 1 } : j));
    const next = await buildPlan(input(pinned, { dayMode: 'count', jobsPerDay: 7 }, { assignments: first.assignments, onlyWorkers: [0], previous: first, keepDays: true }));
    expect(next.routes[0].stops.map((s) => s.row)).toEqual(want);
  });
});

describe('manual changes re-route only the altered days', () => {
  const straightKm = (pts: { lat: number; lon: number }[]) =>
    pts.map((a) => pts.map((b) => Math.hypot(a.lat - b.lat, a.lon - b.lon) * 111));
  const roadSpy = () => {
    const calls: number[] = [];
    const fn = async (pts: { lat: number; lon: number }[]) => {
      calls.push(pts.length);
      const km = straightKm(pts);
      return { km, min: km.map((r) => r.map((v) => v)) };
    };
    return { calls, fn };
  };
  const road = { roadServerUrl: 'https://osrm.example.org', roadServerConfirmed: true, dayMode: 'count' as const, jobsPerDay: 7 };

  it('moving a job between two days routes exactly those two days; the rest are reused untouched', async () => {
    const { jobs } = jobsFromCsv(PARITY_40_CSV);
    const spy0 = roadSpy();
    const first = await buildPlan(input(jobs, road), { roadTable: spy0.fn });
    expect(first.distMode).toBe('road');
    expect(spy0.calls.length).toBe(6);
    const moved = first.routes[0].stops[0].row;
    const assignments = { ...first.assignments, [moved]: { worker: 0, day: 3, lockedWorker: true, lockedDay: true } };
    const spy = roadSpy();
    const next = await buildPlan(input(jobs, road, { assignments, onlyWorkers: [0], previous: first, keepDays: true }), { roadTable: spy.fn });
    expect(spy.calls.length).toBe(2);
    expect(next.distMode).toBe('road');
    for (const d of [2, 4, 5, 6]) {
      expect(next.routes.find((r) => r.day === d)).toEqual(first.routes.find((r) => r.day === d));
    }
    expect(next.routes.flatMap((r) => r.stops).length).toBe(40);
  });

  it('reordering within one day routes only that day; reordering days routes none', async () => {
    const { jobs } = jobsFromCsv(PARITY_40_CSV);
    const first = await buildPlan(input(jobs, road), { roadTable: roadSpy().fn });
    const d2 = first.routes[1].stops.map((s) => s.row).reverse();
    const pinned = jobs.map((j) => (d2.includes(j.row) ? { ...j, manualSeq: d2.indexOf(j.row) + 1 } : j));
    const spy = roadSpy();
    const next = await buildPlan(input(pinned, road, { assignments: first.assignments, onlyWorkers: [0], previous: first, keepDays: true }), { roadTable: spy.fn });
    expect(spy.calls.length).toBe(1);
    expect(next.routes[1].stops.map((s) => s.row)).toEqual(d2);

    const spy2 = roadSpy();
    const swapped = await buildPlan(
      input(jobs, road, { assignments: first.assignments, onlyWorkers: [0], previous: first, keepDays: true, dayOrder: { 0: [2, 1, 3, 4, 5, 6] } }),
      { roadTable: spy2.fn },
    );
    expect(spy2.calls.length).toBe(0);
    expect(swapped.routes[0].stops).toEqual(first.routes[1].stops);
    expect(swapped.routes[1].stops).toEqual(first.routes[0].stops);
    expect(swapped.distMode).toBe('road');
  });
});
