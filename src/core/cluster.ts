import type { LatLon } from '../types';
import { sweepAngle } from './geo';

export interface ClusterOptions {
  /** Number of groups. */
  k: number;
  /** Max size per group; length k. Default: balanced so sizes differ by at most 1. */
  capacities?: number[];
  /** fixed[i] = group index for point i (locked), or null. */
  fixed?: (number | null)[];
  /** Seed for k-means++ init. */
  seed: number;
  /** Used to number groups deterministically (sweep order around this point). */
  origin: LatLon;
  /**
   * When true (default) group indexes are renumbered by sweep angle of group centroid around
   * origin. Must be false when fixed[] is given and group index carries meaning (workers).
   */
  renumberBySweep?: boolean;
}

/** Balanced capacities: n items into k groups, sizes differ by at most 1 (larger groups first). */
export function balancedCapacities(n: number, k: number): number[] {
  const base = Math.floor(n / k);
  const extra = n - base * k;
  const caps: number[] = [];
  for (let g = 0; g < k; g++) caps.push(base + (g < extra ? 1 : 0));
  return caps;
}

/** Small seeded PRNG (mulberry32). Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NEAREST = 6;

/**
 * Capacity-balanced k-means with seeded k-means++ start and a balancing pass.
 * Returns the group index for each point. Deterministic for the same input.
 *
 * Method: planar projection (lon scaled by cos(mean lat)); k-means++ init (fixed groups start
 * at the mean of their fixed points); Lloyd iterations whose assignment step is a greedy
 * capacity-constrained pass over (point, near-cluster) pairs sorted by distance; then
 * improvement passes of single moves and pairwise swaps that lower the squared distance to
 * group centroids while respecting capacities. Sizes never exceed capacities; if capacities
 * cannot hold every point the last groups are extended, so no point is ever dropped.
 */
export function balancedKMeans(points: LatLon[], opts: ClusterOptions): number[] {
  const n = points.length;
  const k = Math.max(1, Math.floor(opts.k));
  if (n === 0) return [];
  if (k === 1) return new Array(n).fill(0);

  const fixed: (number | null)[] = new Array(n).fill(null);
  let hasFixed = false;
  if (opts.fixed) {
    for (let i = 0; i < n; i++) {
      const f = opts.fixed[i];
      if (f !== null && f !== undefined && Number.isInteger(f) && f >= 0 && f < k) {
        fixed[i] = f;
        hasFixed = true;
      }
    }
  }

  // Capacities: start from given/balanced, raise to hold fixed points, extend the last groups.
  const cap = (opts.capacities && opts.capacities.length === k ? opts.capacities : balancedCapacities(n, k)).map(
    (c) => Math.max(0, Math.floor(c)),
  );
  const fixedCount = new Array(k).fill(0);
  for (let i = 0; i < n; i++) if (fixed[i] !== null) fixedCount[fixed[i] as number]++;
  for (let g = 0; g < k; g++) if (cap[g] < fixedCount[g]) cap[g] = fixedCount[g];
  let deficit = n - cap.reduce((a, b) => a + b, 0);
  for (let g = k - 1; deficit > 0; g = g === 0 ? k - 1 : g - 1) {
    cap[g]++;
    deficit--;
  }

  // Planar projection.
  let meanLat = 0;
  for (const p of points) meanLat += p.lat;
  meanLat /= n;
  const cx = Math.cos((meanLat * Math.PI) / 180);
  const X = new Float64Array(n);
  const Y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    X[i] = points[i].lon * cx;
    Y[i] = points[i].lat;
  }

  const free: number[] = [];
  for (let i = 0; i < n; i++) if (fixed[i] === null) free.push(i);

  const assign = new Int32Array(n);
  for (let i = 0; i < n; i++) assign[i] = fixed[i] === null ? -1 : (fixed[i] as number);

  const rng = mulberry32(opts.seed);
  const centX = new Float64Array(k);
  const centY = new Float64Array(k);
  const haveCenter = new Uint8Array(k);

  // --- init ---
  if (hasFixed) {
    const sx = new Float64Array(k);
    const sy = new Float64Array(k);
    for (let i = 0; i < n; i++) {
      const f = fixed[i];
      if (f !== null) {
        sx[f] += X[i];
        sy[f] += Y[i];
      }
    }
    for (let g = 0; g < k; g++) {
      if (fixedCount[g] > 0) {
        centX[g] = sx[g] / fixedCount[g];
        centY[g] = sy[g] / fixedCount[g];
        haveCenter[g] = 1;
      }
    }
  }
  if (free.length > 0) {
    const minD = new Float64Array(n).fill(Infinity);
    const usedPt = new Uint8Array(n);
    const refreshMin = (g: number) => {
      for (const i of free) {
        const dx = X[i] - centX[g];
        const dy = Y[i] - centY[g];
        const d = dx * dx + dy * dy;
        if (d < minD[i]) minD[i] = d;
      }
    };
    for (let g = 0; g < k; g++) if (haveCenter[g]) refreshMin(g);
    let anyCenter = haveCenter.some((v) => v === 1);
    for (let g = 0; g < k; g++) {
      if (haveCenter[g]) continue;
      let pick = -1;
      if (!anyCenter) {
        pick = free[Math.min(free.length - 1, Math.floor(rng() * free.length))];
      } else {
        let sum = 0;
        for (const i of free) if (!usedPt[i]) sum += minD[i];
        if (sum > 0) {
          let r = rng() * sum;
          for (const i of free) {
            if (usedPt[i]) continue;
            r -= minD[i];
            if (r < 0) {
              pick = i;
              break;
            }
          }
          if (pick < 0) {
            for (let q = free.length - 1; q >= 0; q--) if (!usedPt[free[q]] && minD[free[q]] > 0) { pick = free[q]; break; }
          }
        }
        if (pick < 0) {
          // all remaining points coincide with centres: take any unused point
          const unused = free.filter((i) => !usedPt[i]);
          const pool = unused.length > 0 ? unused : free;
          pick = pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
        }
      }
      usedPt[pick] = 1;
      centX[g] = X[pick];
      centY[g] = Y[pick];
      haveCenter[g] = 1;
      anyCenter = true;
      refreshMin(g);
    }
  } else {
    for (let g = 0; g < k; g++) if (!haveCenter[g]) { centX[g] = X[0]; centY[g] = Y[0]; }
  }

  const recompute = () => {
    const sx = new Float64Array(k);
    const sy = new Float64Array(k);
    const cnt = new Int32Array(k);
    for (let i = 0; i < n; i++) {
      const g = assign[i];
      if (g >= 0) {
        sx[g] += X[i];
        sy[g] += Y[i];
        cnt[g]++;
      }
    }
    for (let g = 0; g < k; g++) {
      if (cnt[g] > 0) {
        centX[g] = sx[g] / cnt[g];
        centY[g] = sy[g] / cnt[g];
      }
    }
  };

  const m = Math.min(k, NEAREST);
  // nearest m clusters of point i, ascending by distance (ties: lower cluster index)
  const nearestOf = (i: number, outG: Int32Array, outD: Float64Array) => {
    let cntFound = 0;
    for (let g = 0; g < k; g++) {
      const dx = X[i] - centX[g];
      const dy = Y[i] - centY[g];
      const d = dx * dx + dy * dy;
      if (cntFound < m || d < outD[cntFound - 1]) {
        let p = cntFound < m ? cntFound : m - 1;
        while (p > 0 && outD[p - 1] > d) {
          outD[p] = outD[p - 1];
          outG[p] = outG[p - 1];
          p--;
        }
        outD[p] = d;
        outG[p] = g;
        if (cntFound < m) cntFound++;
      }
    }
  };

  const nbG = new Int32Array(m);
  const nbD = new Float64Array(m);

  // --- Lloyd with capacity-constrained greedy assignment ---
  for (let iter = 0; iter < 40; iter++) {
    const rem = cap.map((c, g) => c - fixedCount[g]);
    const pairs: { d: number; i: number; g: number }[] = [];
    for (const i of free) {
      nearestOf(i, nbG, nbD);
      for (let q = 0; q < m; q++) pairs.push({ d: nbD[q], i, g: nbG[q] });
    }
    pairs.sort((a, b) => a.d - b.d || a.i - b.i || a.g - b.g);
    const next = new Int32Array(n);
    for (let i = 0; i < n; i++) next[i] = fixed[i] === null ? -1 : (fixed[i] as number);
    for (const p of pairs) {
      if (next[p.i] === -1 && rem[p.g] > 0) {
        next[p.i] = p.g;
        rem[p.g]--;
      }
    }
    for (const i of free) {
      if (next[i] !== -1) continue;
      let bg = -1;
      let bd = Infinity;
      for (let g = 0; g < k; g++) {
        if (rem[g] <= 0) continue;
        const dx = X[i] - centX[g];
        const dy = Y[i] - centY[g];
        const d = dx * dx + dy * dy;
        if (d < bd) {
          bd = d;
          bg = g;
        }
      }
      next[i] = bg;
      rem[bg]--;
    }
    let changed = false;
    for (let i = 0; i < n; i++) {
      if (assign[i] !== next[i]) {
        changed = true;
        assign[i] = next[i];
      }
    }
    recompute();
    if (!changed) break;
  }

  // --- balancing / improvement passes: moves into spare capacity and pairwise swaps ---
  const members: number[][] = Array.from({ length: k }, () => []);
  for (let i = 0; i < n; i++) members[assign[i]].push(i);
  const sq = (i: number, g: number) => {
    const dx = X[i] - centX[g];
    const dy = Y[i] - centY[g];
    return dx * dx + dy * dy;
  };
  for (let pass = 0; pass < 25; pass++) {
    let moved = false;
    for (const i of free) {
      const c = assign[i];
      const dic = sq(i, c);
      nearestOf(i, nbG, nbD);
      let bestGain = 1e-12;
      let bestH = -1;
      let bestJ = -1; // -1 = plain move
      for (let q = 0; q < m; q++) {
        const h = nbG[q];
        if (h === c) continue;
        const dih = nbD[q];
        if (members[h].length < cap[h]) {
          const gain = dic - dih;
          if (gain > bestGain) {
            bestGain = gain;
            bestH = h;
            bestJ = -1;
          }
        }
        for (const j of members[h]) {
          if (fixed[j] !== null) continue;
          const gain = dic + sq(j, h) - dih - sq(j, c);
          if (gain > bestGain) {
            bestGain = gain;
            bestH = h;
            bestJ = j;
          }
        }
      }
      if (bestH >= 0) {
        const rm = (arr: number[], v: number) => {
          const p = arr.indexOf(v);
          arr[p] = arr[arr.length - 1];
          arr.pop();
        };
        rm(members[c], i);
        members[bestH].push(i);
        assign[i] = bestH;
        if (bestJ >= 0) {
          rm(members[bestH], bestJ);
          members[c].push(bestJ);
          assign[bestJ] = c;
        }
        moved = true;
      }
    }
    if (!moved) break;
    recompute();
  }

  const out: number[] = Array.from(assign);

  const renumber = opts.renumberBySweep ?? !hasFixed;
  if (!renumber) return out;
  const sLat = new Float64Array(k);
  const sLon = new Float64Array(k);
  const cnt = new Int32Array(k);
  for (let i = 0; i < n; i++) {
    sLat[out[i]] += points[i].lat;
    sLon[out[i]] += points[i].lon;
    cnt[out[i]]++;
  }
  const keyed: { g: number; a: number }[] = [];
  for (let g = 0; g < k; g++) {
    const a = cnt[g] > 0 ? sweepAngle(opts.origin, { lat: sLat[g] / cnt[g], lon: sLon[g] / cnt[g] }) : Infinity;
    keyed.push({ g, a });
  }
  keyed.sort((p, q) => p.a - q.a || p.g - q.g);
  const map = new Int32Array(k);
  keyed.forEach((e, idx) => (map[e.g] = idx));
  return out.map((g) => map[g]);
}
