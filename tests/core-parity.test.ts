import { describe, expect, it } from 'vitest';
import { buildPlan } from '../src/core/plan';
import { centroid } from '../src/core/geo';
import { FIXTURE_5_CSV, FIXTURE_5_EXPECTED, PARITY_40_CSV, PARITY_40_EXPECTED } from '../src/sample';
import { input, jobsFromCsv, simpleSettings } from './core-helpers';

describe('parity (Simple mode)', () => {
  it('reproduces the 40-job order and total km', async () => {
    const { jobs, notRouted } = jobsFromCsv(PARITY_40_CSV);
    const plan = await buildPlan(input(jobs, simpleSettings(), { notRouted }));
    expect(plan.centroid.lat).toBeCloseTo(PARITY_40_EXPECTED.centroid.lat, 6);
    expect(plan.centroid.lon).toBeCloseTo(PARITY_40_EXPECTED.centroid.lon, 6);
    expect(plan.routes).toHaveLength(1);
    const r = plan.routes[0];
    expect(r.day).toBeNull();
    expect(r.end).toBeNull();
    expect(r.returnKm).toBe(0);
    const byRow = new Map(jobs.map((j) => [j.row, j.label]));
    expect(r.stops.map((s) => byRow.get(s.row))).toEqual(PARITY_40_EXPECTED.order);
    expect(Math.abs(r.totalKm - PARITY_40_EXPECTED.totalKm)).toBeLessThan(0.001);
    expect(r.kmBefore2opt).toBe(r.kmAfter2opt);
  });

  it('centroid helper is the plain mean', () => {
    const { jobs } = jobsFromCsv(PARITY_40_CSV);
    const c = centroid(jobs);
    expect(c.lat).toBeCloseTo(PARITY_40_EXPECTED.centroid.lat, 6);
  });
});

describe('5-row fixture', () => {
  it('routes P002,P001,P003,P005 and leaves P004 not routed', async () => {
    const { jobs, notRouted } = jobsFromCsv(FIXTURE_5_CSV);
    expect(notRouted).toEqual([3]);
    const plan = await buildPlan(input(jobs, simpleSettings(), { notRouted }));
    expect(plan.centroid.lat).toBeCloseTo(FIXTURE_5_EXPECTED.centroid.lat, 6);
    expect(plan.centroid.lon).toBeCloseTo(FIXTURE_5_EXPECTED.centroid.lon, 6);
    const label = new Map(jobs.map((j) => [j.row, j.label]));
    expect(plan.routes[0].stops.map((s) => label.get(s.row))).toEqual(FIXTURE_5_EXPECTED.order);
    expect(plan.notRouted).toEqual([3]);
    // duplicate coordinates are routed consecutively with a zero leg
    expect(plan.routes[0].stops[2].legKm).toBe(0);
  });
});
