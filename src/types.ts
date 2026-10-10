// Shared types. This file is the contract between core/, io/, net/, worker/ and ui/.
// Change it only deliberately: every module depends on it.

export interface LatLon {
  lat: number;
  lon: number;
}

/** A cell as read from CSV (always string) or XLSX (string/number/boolean). Blank = '' or null. */
export type Cell = string | number | boolean | null;

/**
 * The input file, parsed as arrays. Never keyed by header name: real files have duplicate
 * header names (e.g. `Assigned To` twice) and a keyed parse would merge them.
 */
export interface Table {
  headers: string[];
  /** rows[i] has the same length as headers (padded with '' if the source row was short). */
  rows: Cell[][];
  /** Sheet name for XLSX, file name for CSV. Informational only. */
  sourceName?: string;
}

/** Which columns of the Table mean what. All values are column indexes into Table.headers. */
export interface ColumnMapping {
  lat: number;
  lon: number;
  /** Column shown as the job label on the map. Default 0. */
  label: number;
  /** Column whose values seed the worker assignment, if the user accepted it. */
  worker: number | null;
  /** Column named MANUAL_SEQ, if present. */
  manualSeq: number | null;
}

/** A routable job: a Table row with a valid location. */
export interface Job {
  /** Index into Table.rows. The identity of a job everywhere in the app. */
  row: number;
  label: string;
  lat: number;
  lon: number;
  /** Numeric MANUAL_SEQ value, if any. */
  manualSeq: number | null;
}

export interface ExtractedJobs {
  jobs: Job[]; // sorted by row ascending
  /** Row indexes with blank / non-numeric / out-of-range / (0,0) location. */
  notRouted: number[];
}

export type BaseSource = 'town' | 'centroid' | 'address' | 'latlon' | 'click';

export interface Base extends LatLon {
  name: string;
  source: BaseSource;
  /** Distance from the jobs' centroid, km (for display). */
  distFromCentroidKm?: number;
  /** Visible note, e.g. "Town lookup failed; using the centroid as base". */
  note?: string;
}

export interface WorkerConfig {
  name: string;
  color: string; // CSS colour, e.g. '#1f77b4'
  /** Own base; null = use the shared base. */
  base: Base | null;
  /** Max jobs for this worker; null = balanced automatically. */
  capacity: number | null;
}

export type DayMode = 'none' | 'count' | 'hours';

export type EndMode = 'base' | 'open' | 'point';

export interface Settings {
  /** "Simple (old program)": 1 worker, no days, start = centroid, open end, no 2-opt. */
  simpleMode: boolean;
  workers: WorkerConfig[]; // length 1..10
  /** Shared base (town lookup result or user override). null until known; then centroid is used. */
  base: Base | null;
  /** Start override for every route; null = worker base / shared base. */
  startOverride: LatLon | null;
  endMode: EndMode;
  /** Used when endMode === 'point'. */
  endPoint: LatLon | null;
  dayMode: DayMode;
  /** dayMode 'count'. Default 7. */
  jobsPerDay: number | null;
  /** dayMode 'hours'. All user-entered, no hidden defaults. */
  hoursPerDay: number | null;
  minutesPerJob: number | null;
  speedKmh: number | null;
  twoOpt: boolean;
  /** Per-route 2-opt time limit. Default 5000. */
  twoOptTimeLimitMs: number;
  /** Tile URL template; '' = no basemap. Default OSM. */
  tileUrl: string;
  /** OSRM-compatible server URL; '' = straight-line (default). */
  roadServerUrl: string;
  /** User ticked "I understand job coordinates are sent to this server". */
  roadServerConfirmed: boolean;
  /** Seed for k-means++ (deterministic). */
  seed: number;
}

/** Per-job assignment state, keyed by Job.row. */
export interface Assignment {
  worker: number; // index into Settings.workers
  /** 1-based day number within the worker; null = not split. */
  day: number | null;
  /** User fixed the worker by hand. */
  lockedWorker: boolean;
  /** User fixed the day by hand. */
  lockedDay: boolean;
}

export type Assignments = Record<number, Assignment>;

export type DistMode = 'straight' | 'road';

export interface Stop {
  row: number;
  /** 1-based stop number within the day. */
  seq: number;
  /** From the previous stop (the start point for stop 1). */
  legKm: number;
  cumKm: number;
  /** Road mode only. */
  legMin?: number;
}

export interface DayRoute {
  worker: number;
  /** 1-based; null when the worker's jobs are not split into days. */
  day: number | null;
  start: LatLon;
  /** null = open end. */
  end: LatLon | null;
  stops: Stop[];
  /** Last stop to end (0 when open end). Reported in day totals, not as a row. */
  returnKm: number;
  /** Sum of legs + returnKm. */
  totalKm: number;
  /** Total km after nearest-neighbour, before 2-opt. */
  kmBefore2opt: number;
  kmAfter2opt: number;
  /** Estimated hours (travel + on-site), when hours mode is on or speed known. */
  hours?: number;
  /** e.g. "2-opt stopped at the 5 s time limit". */
  note?: string;
}

export interface Plan {
  /** Ordered by worker, then day. */
  routes: DayRoute[];
  /** Row indexes, input order. */
  notRouted: number[];
  distMode: DistMode;
  /** Visible warnings, e.g. road server failed, fell back to straight-line. */
  warnings: string[];
  /** Final assignments (worker + day per routed row, locks preserved). */
  assignments: Assignments;
  centroid: LatLon;
}

/** Everything the router needs. Plain data so it can be posted to a Web Worker. */
export interface PlanInput {
  jobs: Job[];
  notRouted: number[];
  settings: Settings;
  /** Previous assignments; locked entries are respected. May be empty. */
  assignments: Assignments;
  /**
   * Re-route only these workers (keep their current assignments, re-sequence and re-split
   * unlocked days). null = full re-run including automatic worker grouping.
   */
  onlyWorkers: number[] | null;
  /** Previous plan, needed when onlyWorkers is set (unaffected routes are copied). */
  previous: Plan | null;
  /**
   * Manual day order per worker: dayOrder[worker] = list of old day numbers in the new order.
   * Applied after day splitting. Optional.
   */
  dayOrder?: Record<number, number[]>;
  /**
   * Partial re-route only: keep every job's current day from `assignments` instead of
   * re-splitting (used after manual changes, so only the moved jobs change day). Jobs with
   * no day join the existing day with the nearest centre. Days are renumbered 1..k.
   */
  keepDays?: boolean;
}

export interface Progress {
  done: number;
  total: number;
  message: string;
}

/** Road distances for a list of points, km and minutes, [i][j]. */
export interface DistanceTable {
  km: number[][];
  min: number[][];
}

/** Fetches a road table for the points (OSRM). Throws on failure. */
export type RoadTableProvider = (points: LatLon[]) => Promise<DistanceTable>;
