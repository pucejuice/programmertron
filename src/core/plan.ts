import type { PlanInput, Plan, Progress, RoadTableProvider } from '../types';

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

/**
 * The whole pipeline: worker grouping (respecting locks) -> day split -> per-day
 * nearest-neighbour + 2-opt (+ MANUAL_SEQ anchors) -> Plan. Simple mode forces
 * 1 worker, no days, start = centroid, open end, no 2-opt.
 */
export async function buildPlan(_input: PlanInput, _opts?: PlanOptions): Promise<Plan> { throw new Error('not implemented'); }
