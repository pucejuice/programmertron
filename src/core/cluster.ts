import type { LatLon } from '../types';

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

/**
 * Capacity-balanced k-means with seeded k-means++ start and a balancing pass.
 * Returns the group index for each point. Deterministic for the same input.
 */
export function balancedKMeans(_points: LatLon[], _opts: ClusterOptions): number[] { throw new Error('not implemented'); }

/** Balanced capacities: n items into k groups, sizes differ by at most 1. */
export function balancedCapacities(_n: number, _k: number): number[] { throw new Error('not implemented'); }
