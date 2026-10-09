import { describe, expect, it } from 'vitest';
import { buildPlan } from '../src/core/plan';
import { matrixDist, nearestNeighbour, routeLength, straightMatrix, twoOpt } from '../src/core/route';
import { input, syntheticJobs } from './core-helpers';

function setup(n: number, seed: number, withEnd: boolean) {
  const jobs = syntheticJobs(n, seed);
  const pts = [{ lat: -32.5, lon: 148.5 }, ...jobs];
  if (withEnd) pts.push({ lat: -32.4, lon: 148.7 });
  const dist = matrixDist(straightMatrix(pts), pts.length);
  return { dist, end: withEnd ? pts.length - 1 : null };
}

describe('2-opt', () => {
  for (const withEnd of [false, true]) {
    it(`never increases km, keeps permutation (end ${withEnd ? 'fixed' : 'open'})`, () => {
      for (let seed = 1; seed <= 5; seed++) {
        const { dist, end } = setup(60, seed, withEnd);
        const nn = nearestNeighbour(60, dist);
        const before = routeLength(nn, dist, end);
        const res = twoOpt(nn, dist, end, Infinity);
        expect(routeLength(res.order, dist, end)).toBeLessThanOrEqual(before + 1e-9);
        expect([...res.order].sort((a, b) => a - b)).toEqual(Array.from({ length: 60 }, (_, i) => i + 1));
        expect(res.timedOut).toBe(false);
      }
    });
  }

  it('is deterministic', () => {
    const { dist, end } = setup(80, 7, true);
    const nn = nearestNeighbour(80, dist);
    const a = twoOpt(nn, dist, end, Infinity).order;
    const b = twoOpt(nn, dist, end, Infinity).order;
    expect(a).toEqual(b);
  });

  it('stops at the deadline', () => {
    const { dist, end } = setup(200, 3, false);
    const nn = nearestNeighbour(200, dist);
    const res = twoOpt(nn, dist, end, -1);
    expect(res.timedOut).toBe(true);
  });

  it('plan: start and end fixed, km after <= before, deterministic', async () => {
    const jobs = syntheticJobs(50, 11);
    const base = { name: 'B', source: 'click' as const, lat: -32.5, lon: 148.5 };
    const inp = input(jobs, { base, dayMode: 'none', endMode: 'base' });
    const p1 = await buildPlan(inp);
    const p2 = await buildPlan(inp);
    expect(p1).toEqual(p2);
    const r = p1.routes[0];
    expect(r.start).toEqual({ lat: -32.5, lon: 148.5 });
    expect(r.end).toEqual({ lat: -32.5, lon: 148.5 });
    expect(r.kmAfter2opt).toBeLessThanOrEqual(r.kmBefore2opt + 1e-9);
    expect(r.stops[0].legKm).toBeGreaterThan(0);
    expect(r.returnKm).toBeGreaterThan(0);
    expect(r.totalKm).toBeCloseTo(r.stops[r.stops.length - 1].cumKm + r.returnKm, 9);
  });
});
