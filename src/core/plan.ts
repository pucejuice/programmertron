import type {
  Assignment,
  Assignments,
  DayRoute,
  DistanceTable,
  Job,
  LatLon,
  Plan,
  PlanInput,
  Progress,
  RoadTableProvider,
  Stop,
} from '../types';
import { balancedCapacities, balancedKMeans } from './cluster';
import { estimateHours, splitDays } from './days';
import { centroid, haversineKm } from './geo';
import {
  matrixDist,
  nearestNeighbour,
  routeLength,
  sequenceWithAnchors,
  straightMatrix,
  twoOpt,
} from './route';

export interface PlanOptions {
  onProgress?: (p: Progress) => void;
  /** Polled between routes; when true, buildPlan rejects with CancelledError. */
  isCancelled?: () => boolean;
  /** Present only when settings.roadServerUrl is set and confirmed. */
  roadTable?: RoadTableProvider;
  now?: () => number;
}

export class CancelledError extends Error {
  constructor() {
    super('cancelled');
    this.name = 'CancelledError';
  }
}

interface Task {
  worker: number;
  day: number | null;
  jobs: Job[]; // row ascending
}

const ll = (p: LatLon): LatLon => ({ lat: p.lat, lon: p.lon });

function validPos(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

/**
 * The whole pipeline: worker grouping (respecting locks) -> day split -> per-day
 * nearest-neighbour + 2-opt (+ MANUAL_SEQ anchors) -> Plan. Simple mode forces
 * 1 worker, no days, start = centroid, open end, no 2-opt.
 */
/**
 * Current day of each job (keepDays mode). Jobs without one join the day whose centre is
 * nearest. Returns null when no job has a day yet (then the caller splits as usual).
 */
function keepCurrentDays(wj: Job[], asg: Assignments): number[] | null {
  const sums = new Map<number, { lat: number; lon: number; n: number }>();
  for (const j of wj) {
    const d = asg[j.row]?.day;
    if (d === null || d === undefined || !(d >= 1)) continue;
    const c = sums.get(d) ?? { lat: 0, lon: 0, n: 0 };
    c.lat += j.lat;
    c.lon += j.lon;
    c.n++;
    sums.set(d, c);
  }
  if (sums.size === 0) return null;
  const centres = [...sums].map(([d, c]) => ({ d, p: { lat: c.lat / c.n, lon: c.lon / c.n } })).sort((a, b) => a.d - b.d);
  return wj.map((j) => {
    const d = asg[j.row]?.day;
    if (d !== null && d !== undefined && d >= 1) return d;
    let best = centres[0];
    let bestKm = Infinity;
    for (const c of centres) {
      const km = haversineKm(j, c.p);
      if (km < bestKm) { bestKm = km; best = c; }
    }
    return best.d;
  });
}

export async function buildPlan(input: PlanInput, opts: PlanOptions = {}): Promise<Plan> {
  const now = opts.now ?? Date.now;
  const check = () => {
    if (opts.isCancelled && opts.isCancelled()) throw new CancelledError();
  };
  const s = input.settings;
  const simple = s.simpleMode;
  const warnings: string[] = [];
  const jobs = [...input.jobs].sort((a, b) => a.row - b.row);
  const cen = centroid(jobs);
  const sharedBase: LatLon = s.base ? ll(s.base) : cen;
  const workers = simple ? s.workers.slice(0, 1) : s.workers;
  const W = Math.max(1, workers.length);
  const prev = input.previous;
  check();

  const startFor = (w: number): LatLon => {
    if (simple) return cen;
    if (s.startOverride) return ll(s.startOverride);
    const wb = workers[w]?.base;
    return wb ? ll(wb) : sharedBase;
  };
  let warnedEnd = false;
  const endFor = (start: LatLon): LatLon | null => {
    if (simple) return null;
    if (s.endMode === 'open') return null;
    if (s.endMode === 'point') {
      if (s.endPoint) return ll(s.endPoint);
      if (!warnedEnd) {
        warnings.push('End point mode is on but no end point is set; routes have an open end.');
        warnedEnd = true;
      }
      return null;
    }
    return start;
  };

  // ---- which workers to (re)process ----
  const partial = !simple && input.onlyWorkers !== null && prev !== null;
  const processSet = new Set<number>();
  if (partial) for (const w of input.onlyWorkers as number[]) processSet.add(w);
  else for (let w = 0; w < W; w++) processSet.add(w);

  // ---- worker assignment per job ----
  const jobWorker = new Map<number, number>();
  const asg = input.assignments;
  const lockedW = (row: number): boolean => {
    const a = asg[row];
    return !!a && a.lockedWorker && a.worker >= 0 && a.worker < W;
  };
  if (simple || W === 1) {
    for (const j of jobs) jobWorker.set(j.row, 0);
  } else if (input.onlyWorkers !== null) {
    for (const j of jobs) {
      let w = asg[j.row]?.worker ?? prev?.assignments[j.row]?.worker ?? 0;
      if (!(w >= 0 && w < W)) w = 0;
      jobWorker.set(j.row, w);
    }
  } else {
    const anyLock = jobs.some((j) => lockedW(j.row));
    const fixed = jobs.map((j) => (lockedW(j.row) ? asg[j.row].worker : null));
    const set = workers.map((w) => (validPos(w.capacity) ? Math.floor(w.capacity) : null));
    let capacities: number[] | undefined;
    if (set.some((c) => c !== null)) {
      const used = set.reduce<number>((a, c) => a + (c ?? 0), 0);
      const unsetIdx = set.map((c, i) => (c === null ? i : -1)).filter((i) => i >= 0);
      const share = unsetIdx.length ? balancedCapacities(Math.max(0, jobs.length - used), unsetIdx.length) : [];
      capacities = set.map((c) => c ?? 0);
      unsetIdx.forEach((wi, q) => (capacities![wi] = share[q]));
    }
    const groups = balancedKMeans(jobs, {
      k: W,
      capacities,
      fixed: anyLock ? fixed : undefined,
      seed: s.seed,
      origin: sharedBase,
      renumberBySweep: !anyLock && capacities === undefined,
    });
    jobs.forEach((j, i) => jobWorker.set(j.row, groups[i]));
  }
  check();

  // ---- day split per processed worker ----
  const byWorker: Job[][] = Array.from({ length: W }, () => []);
  for (const j of jobs) byWorker[jobWorker.get(j.row) as number].push(j);

  const assignments: Assignments = {};
  const tasks: Task[] = [];
  const hoursMode = !simple && s.dayMode === 'hours';
  let warnedHours = false;
  for (let w = 0; w < W; w++) {
    if (!processSet.has(w)) continue;
    const wj = byWorker[w];
    if (wj.length === 0) continue;
    let days: (number | null)[];
    let splitOn = !simple && s.dayMode !== 'none';
    if (splitOn && s.dayMode === 'count' && !validPos(s.jobsPerDay)) splitOn = false;
    if (splitOn && s.dayMode === 'hours' && !(validPos(s.hoursPerDay) && validPos(s.minutesPerJob) && validPos(s.speedKmh))) {
      splitOn = false;
      if (!warnedHours) {
        warnings.push('Hours-per-day mode needs hours per day, minutes per job and speed; jobs were not split into days.');
        warnedHours = true;
      }
    }
    const kept = splitOn && partial && input.keepDays ? keepCurrentDays(wj, asg) : null;
    if (!splitOn) {
      days = wj.map(() => null);
    } else if (kept) {
      days = kept;
      const order = input.dayOrder?.[w];
      const present = [...new Set(days as number[])].sort((a, b) => a - b);
      const seq = order && order.length ? order.filter((d) => present.includes(d)) : [];
      const map = new Map<number, number>();
      [...seq, ...present.filter((d) => !seq.includes(d))].forEach((d, idx) => map.set(d, idx + 1));
      days = days.map((d) => map.get(d as number) as number);
    } else {
      const fixedDay = wj.map((j) => {
        const a = asg[j.row];
        return a && a.lockedDay && a.day !== null && a.day >= 1 ? a.day : null;
      });
      days = splitDays(wj, startFor(w), {
        mode: s.dayMode,
        jobsPerDay: s.jobsPerDay,
        hoursPerDay: s.hoursPerDay,
        minutesPerJob: s.minutesPerJob,
        speedKmh: s.speedKmh,
        seed: s.seed,
        fixedDay,
      });
      const order = input.dayOrder?.[w];
      if (order && order.length > 0) {
        const present = new Set(days as number[]);
        const seq = order.filter((d) => present.has(d));
        const rest = [...present].filter((d) => !seq.includes(d)).sort((a, b) => a - b);
        const map = new Map<number, number>();
        [...seq, ...rest].forEach((d, idx) => map.set(d, idx + 1));
        days = days.map((d) => map.get(d as number) as number);
      }
    }
    const buckets = new Map<number | null, Job[]>();
    wj.forEach((j, i) => {
      const d = days[i];
      let b = buckets.get(d);
      if (!b) buckets.set(d, (b = []));
      b.push(j);
      const old = asg[j.row];
      assignments[j.row] = {
        worker: w,
        day: d,
        lockedWorker: !!old?.lockedWorker && lockedW(j.row),
        lockedDay: !!old?.lockedDay,
      };
    });
    const keys = [...buckets.keys()].sort((a, b) => (a ?? 0) - (b ?? 0));
    for (const d of keys) tasks.push({ worker: w, day: d, jobs: buckets.get(d) as Job[] });
  }

  // unprocessed workers keep their previous assignments
  for (const j of jobs) {
    if (assignments[j.row]) continue;
    const w = jobWorker.get(j.row) as number;
    const old: Assignment | undefined = asg[j.row] ?? prev?.assignments[j.row];
    assignments[j.row] = {
      worker: w,
      day: old ? old.day : null,
      lockedWorker: !!old?.lockedWorker,
      lockedDay: !!old?.lockedDay,
    };
  }

  // ---- route each task ----
  const routes: DayRoute[] = [];
  if (partial && prev) for (const r of prev.routes) if (!processSet.has(r.worker)) routes.push(r);

  const useRoad = !!opts.roadTable && !simple;
  let roadFailed = false;
  let roadOk = 0;
  const total = tasks.length;
  opts.onProgress?.({ done: 0, total, message: 'Grouping complete' });
  // After a manual change (keepDays) only the altered days need routing: a day whose jobs,
  // hand-set order, start and end are unchanged keeps its previous route (no 2-opt, no road
  // request). Only when the distance mode matches, so a straight route is never passed off as road.
  const dayKey = (worker: number, start: LatLon, end: LatLon | null, js: { row: number; manualSeq: number | null }[]) =>
    `${worker}|${start.lat},${start.lon}|${end ? `${end.lat},${end.lon}` : '-'}|` +
    js.map((j) => `${j.row}:${j.manualSeq ?? ''}`).sort().join(',');
  const reuse = new Map<string, DayRoute>();
  if (partial && prev && input.keepDays && useRoad === (prev.distMode === 'road')) {
    for (const r of prev.routes) if (processSet.has(r.worker) && r.inputKey) reuse.set(r.inputKey, r);
  }
  for (let t = 0; t < tasks.length; t++) {
    check();
    const task = tasks[t];
    const start = startFor(task.worker);
    const end = endFor(start);
    const key = dayKey(task.worker, start, end, task.jobs);
    const old = reuse.get(key);
    let r: DayRoute;
    if (old) {
      r = { ...old, worker: task.worker, day: task.day };
      if (useRoad) roadOk++;
    } else r = { ...(await routeTask(task, start, end)), inputKey: key };
    routes.push(r);
    opts.onProgress?.({
      done: t + 1,
      total,
      message: `Routed ${workers[task.worker]?.name ?? 'worker ' + (task.worker + 1)}${task.day !== null ? ' day ' + task.day : ''}`,
    });
  }

  async function routeTask(task: Task, start: LatLon, end: LatLon | null): Promise<DayRoute> {
    const m = task.jobs.length;
    const pts: LatLon[] = [start, ...task.jobs.map(ll)];
    if (end) pts.push(end);
    const N = pts.length;
    const endNode = end ? N - 1 : null;

    let M: Float64Array | null = null;
    let minM: Float64Array | null = null;
    if (useRoad) {
      try {
        const table: DistanceTable = await (opts.roadTable as RoadTableProvider)(pts);
        if (!table || table.km.length !== N) throw new Error('road table has the wrong size');
        M = new Float64Array(N * N);
        minM = new Float64Array(N * N);
        for (let i = 0; i < N; i++) {
          for (let j = 0; j < N; j++) {
            const km = table.km[i]?.[j];
            if (typeof km !== 'number' || !Number.isFinite(km)) throw new Error('road table has missing distances');
            M[i * N + j] = km;
            const mn = table.min?.[i]?.[j];
            minM[i * N + j] = typeof mn === 'number' && Number.isFinite(mn) ? mn : 0;
          }
        }
        roadOk++;
      } catch (e) {
        roadFailed = true;
        M = null;
        minM = null;
        const label = `${workers[task.worker]?.name ?? 'Worker ' + (task.worker + 1)}${task.day !== null ? ' day ' + task.day : ''}`;
        warnings.push(
          `Road routing failed for ${label} (${e instanceof Error ? e.message : String(e)}); used straight-line distances for that route.`,
        );
      }
    }
    const straight = M === null;
    if (M === null) M = straightMatrix(pts);
    const dist = matrixDist(M, N);

    const limit = Math.max(0, s.twoOptTimeLimitMs);
    const deadline = now() + limit;
    const improve = s.twoOpt && !simple;
    const tick = () => check();
    let order: number[];
    let before: number;
    let timedOut = false;
    const anchored = task.jobs
      .map((j, i) => ({ node: i + 1, seq: j.manualSeq, row: j.row }))
      .filter((a) => a.seq !== null && Number.isFinite(a.seq))
      .sort((a, b) => (a.seq as number) - (b.seq as number) || a.row - b.row)
      .map((a) => a.node);
    if (anchored.length > 0) {
      const aSet = new Set(anchored);
      const free: number[] = [];
      for (let i = 1; i <= m; i++) if (!aSet.has(i)) free.push(i);
      const base = sequenceWithAnchors(anchored, free, dist, endNode, false, deadline, now, tick);
      order = base.order;
      before = routeLength(order, dist, endNode);
      if (improve) {
        const imp = sequenceWithAnchors(anchored, free, dist, endNode, true, deadline, now, tick);
        timedOut = imp.timedOut;
        if (routeLength(imp.order, dist, endNode) <= before) order = imp.order;
      }
    } else {
      order = nearestNeighbour(m, dist);
      before = routeLength(order, dist, endNode);
      if (improve) {
        const res = twoOpt(order, dist, endNode, deadline, now, tick);
        timedOut = res.timedOut;
        // guard (asymmetric road matrices): never accept a longer route
        if (routeLength(res.order, dist, endNode) <= before) order = res.order;
      }
    }

    const stops: Stop[] = [];
    let cum = 0;
    let prevNode = 0;
    let travelMin = 0;
    order.forEach((node, idx) => {
      const leg = dist(prevNode, node);
      cum += leg;
      const stop: Stop = { row: task.jobs[node - 1].row, seq: idx + 1, legKm: leg, cumKm: cum };
      if (!straight && minM) {
        stop.legMin = minM[prevNode * N + node];
        travelMin += stop.legMin;
      }
      stops.push(stop);
      prevNode = node;
    });
    const returnKm = endNode !== null && order.length > 0 ? dist(prevNode, endNode) : 0;
    if (!straight && minM && endNode !== null && order.length > 0) travelMin += minM[prevNode * N + endNode];
    const totalKm = cum + returnKm;

    const route: DayRoute = {
      worker: task.worker,
      day: task.day,
      start,
      end,
      stops,
      returnKm,
      totalKm,
      kmBefore2opt: before,
      kmAfter2opt: totalKm,
    };
    const notes: string[] = [];
    if (timedOut) notes.push(`2-opt stopped at the ${+(limit / 1000).toFixed(3)} s time limit`);
    const mpj = validPos(s.minutesPerJob) ? s.minutesPerJob : null;
    const spd = validPos(s.speedKmh) ? s.speedKmh : null;
    if (hoursMode || (mpj !== null && spd !== null)) {
      if (mpj !== null && (spd !== null || !straight)) {
        route.hours = straight ? estimateHours(totalKm, m, mpj, spd as number) : travelMin / 60 + (m * mpj) / 60;
        if (hoursMode && validPos(s.hoursPerDay) && route.hours > s.hoursPerDay + 1e-9) {
          notes.push(
            m === 1
              ? `A single job takes ${route.hours.toFixed(2)} h, over the ${s.hoursPerDay} h per day limit`
              : `Estimated ${route.hours.toFixed(2)} h exceeds the ${s.hoursPerDay} h per day limit`,
          );
        }
      }
    }
    if (notes.length > 0) route.note = notes.join('; ');
    return route;
  }

  routes.sort((a, b) => a.worker - b.worker || (a.day ?? 0) - (b.day ?? 0));

  let distMode: Plan['distMode'] = 'straight';
  if (useRoad) {
    const copiedStraight = partial && !!prev && prev.routes.some((r) => !processSet.has(r.worker)) && prev.distMode !== 'road';
    if (!roadFailed && roadOk > 0 && !copiedStraight) distMode = 'road';
    else if (copiedStraight && !roadFailed && roadOk > 0) {
      warnings.push('Some routes kept from the previous plan use straight-line distances; the plan is marked straight-line.');
    }
  }
  if (partial && prev && distMode === 'road' && prev.distMode !== 'road') distMode = 'straight';

  return {
    routes,
    notRouted: [...input.notRouted],
    distMode,
    warnings,
    assignments,
    centroid: cen,
  };
}
