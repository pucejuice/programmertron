// Sequencing of one route over an abstract distance function.
// Node 0 = start point. Nodes 1..n = jobs (in row-ascending order, so a lower node index
// means a lower row index). Node n+1 = end point, present only when the end is fixed.
//
// 2-opt move order (documented for the README): first-improvement. Passes scan i ascending
// (1..n-1), and for each i, j ascending (i+1..n); the first move saving more than 1e-9 km is
// applied immediately (segment i..j reversed) and the scan continues from the next j. Passes
// repeat until one finds no improvement or the deadline passes.

import type { LatLon } from '../types';
import { haversineKm } from './geo';

export type DistFn = (i: number, j: number) => number;

const EPS = 1e-9;

/** Row-major N x N straight-line matrix and a DistFn over it. */
export function straightMatrix(pts: LatLon[]): Float64Array {
  const N = pts.length;
  const M = new Float64Array(N * N);
  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      const d = haversineKm(pts[i], pts[j]);
      M[i * N + j] = d;
      M[j * N + i] = d;
    }
  }
  return M;
}

export function matrixDist(M: Float64Array, N: number): DistFn {
  return (i, j) => M[i * N + j];
}

/**
 * Nearest-neighbour from node 0 over nodes 1..n. Visited tracked by node index;
 * exact distance ties go to the lower node index. Returns job nodes in visit order.
 */
export function nearestNeighbour(n: number, dist: DistFn): number[] {
  const visited = new Uint8Array(n + 1);
  const order: number[] = [];
  let cur = 0;
  for (let step = 0; step < n; step++) {
    let best = -1;
    let bestD = Infinity;
    for (let c = 1; c <= n; c++) {
      if (visited[c]) continue;
      const d = dist(cur, c);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    visited[best] = 1;
    order.push(best);
    cur = best;
  }
  return order;
}

/** Length of 0 -> order... -> (end node, if endNode !== null). */
export function routeLength(order: number[], dist: DistFn, endNode: number | null): number {
  let total = 0;
  let prev = 0;
  for (const node of order) {
    total += dist(prev, node);
    prev = node;
  }
  if (endNode !== null) total += dist(prev, endNode);
  return total;
}

export interface TwoOptResult {
  order: number[];
  timedOut: boolean;
}

/**
 * 2-opt with node 0 fixed as predecessor of the first stop and endNode fixed when not null
 * (open end: the last job may move). Deterministic move order; accept only savings > 1e-9.
 * Stops on a pass with no improvement or when now() > deadline.
 */
export function twoOpt(
  order: number[],
  dist: DistFn,
  endNode: number | null,
  deadline: number,
  now: () => number = Date.now,
  tick?: () => void,
): TwoOptResult {
  return twoOptImpl(order, dist, endNode, deadline, now, Infinity, tick);
}

/** Same as twoOpt but with a cap on the number of passes (used for estimates). */
export function twoOptLimited(
  order: number[],
  dist: DistFn,
  endNode: number | null,
  maxPasses: number,
): TwoOptResult {
  return twoOptImpl(order, dist, endNode, Infinity, Date.now, maxPasses);
}

function twoOptImpl(
  order: number[],
  dist: DistFn,
  endNode: number | null,
  deadline: number,
  now: () => number,
  maxPasses: number,
  tick?: () => void,
): TwoOptResult {
  const m = order.length;
  const t: number[] = new Array(m + 2);
  t[0] = 0;
  for (let i = 0; i < m; i++) t[i + 1] = order[i];
  t[m + 1] = endNode === null ? -1 : endNode;
  let timedOut = false;
  let improved = true;
  let passes = 0;
  outer: while (improved && passes < maxPasses) {
    improved = false;
    passes++;
    for (let i = 1; i < m; i++) {
      if (tick) tick();
      if (now() > deadline) {
        timedOut = true;
        break outer;
      }
      for (let j = i + 1; j <= m; j++) {
        const a = t[i - 1];
        const b = t[i];
        const c = t[j];
        const d = t[j + 1];
        let delta = dist(a, c) - dist(a, b);
        if (d >= 0) delta += dist(b, d) - dist(c, d);
        if (delta < -EPS) {
          for (let lo = i, hi = j; lo < hi; lo++, hi--) {
            const tmp = t[lo];
            t[lo] = t[hi];
            t[hi] = tmp;
          }
          improved = true;
        }
      }
    }
  }
  return { order: t.slice(1, m + 1), timedOut };
}

/**
 * Sequence with MANUAL_SEQ anchors: anchored job nodes (already sorted by their MANUAL_SEQ)
 * keep their relative order; free nodes are routed around them. Free nodes are placed by
 * cheapest insertion (ascending node index, first cheapest position), then optionally improved
 * by relocating/or-opt moves (segments of 1..3 consecutive free nodes, either orientation) of
 * free nodes only. Anchors are never moved relative to each other.
 */
export function sequenceWithAnchors(
  anchored: number[],
  free: number[],
  dist: DistFn,
  endNode: number | null,
  useImprovement: boolean,
  deadline: number,
  now: () => number = Date.now,
  tick?: () => void,
): TwoOptResult {
  const end = endNode === null ? -1 : endNode;
  let route = anchored.slice();
  for (const x of free) {
    let bestP = 0;
    let bestC = Infinity;
    for (let p = 0; p <= route.length; p++) {
      const a = p === 0 ? 0 : route[p - 1];
      const b = p < route.length ? route[p] : end;
      let cost = dist(a, x);
      if (b >= 0) cost += dist(x, b) - dist(a, b);
      if (cost < bestC) {
        bestC = cost;
        bestP = p;
      }
    }
    route.splice(bestP, 0, x);
  }
  if (!useImprovement || free.length === 0) return { order: route, timedOut: false };

  let maxNode = 0;
  for (const v of route) if (v > maxNode) maxNode = v;
  const isFree = new Uint8Array(maxNode + 1);
  for (const x of free) isFree[x] = 1;

  let timedOut = false;
  let improved = true;
  let passes = 0;
  outer: while (improved && passes < 100) {
    improved = false;
    passes++;
    for (let L = 1; L <= 3; L++) {
      for (let s = 0; s + L <= route.length; s++) {
        if (tick) tick();
        if (now() > deadline) {
          timedOut = true;
          break outer;
        }
        let ok = true;
        for (let q = s; q < s + L; q++) {
          if (!isFree[route[q]]) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
        const prev = s === 0 ? 0 : route[s - 1];
        const next = s + L < route.length ? route[s + L] : end;
        const first = route[s];
        const last = route[s + L - 1];
        let removeGain = dist(prev, first);
        if (next >= 0) removeGain += dist(last, next) - dist(prev, next);
        if (removeGain <= EPS) continue;
        const rest = route.slice(0, s).concat(route.slice(s + L));
        let bestP = -1;
        let bestRev = false;
        let bestCost = Infinity;
        for (let p = 0; p <= rest.length; p++) {
          if (p === s) continue;
          const a = p === 0 ? 0 : rest[p - 1];
          const b = p < rest.length ? rest[p] : end;
          const base = b >= 0 ? dist(a, b) : 0;
          const cf = dist(a, first) + (b >= 0 ? dist(last, b) : 0) - base;
          if (cf < bestCost) {
            bestCost = cf;
            bestP = p;
            bestRev = false;
          }
          if (L > 1) {
            const cr = dist(a, last) + (b >= 0 ? dist(first, b) : 0) - base;
            if (cr < bestCost) {
              bestCost = cr;
              bestP = p;
              bestRev = true;
            }
          }
        }
        if (bestP >= 0 && removeGain - bestCost > EPS) {
          let seg = route.slice(s, s + L);
          if (bestRev) seg = seg.reverse();
          rest.splice(bestP, 0, ...seg);
          route = rest;
          improved = true;
        }
      }
    }
  }
  return { order: route, timedOut };
}
