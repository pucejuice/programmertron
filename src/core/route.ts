// Sequencing of one route over an abstract distance function.
// Node 0 = start point. Nodes 1..n = jobs (in row-ascending order, so a lower node index
// means a lower row index). Node n+1 = end point, present only when the end is fixed.

export type DistFn = (i: number, j: number) => number;

/**
 * Nearest-neighbour from node 0 over nodes 1..n. Visited tracked by node index;
 * exact distance ties go to the lower node index. Returns job nodes in visit order.
 */
export function nearestNeighbour(_n: number, _dist: DistFn): number[] { throw new Error('not implemented'); }

/** Length of 0 -> order... -> (end node, if endNode !== null). */
export function routeLength(_order: number[], _dist: DistFn, _endNode: number | null): number { throw new Error('not implemented'); }

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
  _order: number[],
  _dist: DistFn,
  _endNode: number | null,
  _deadline: number,
  _now?: () => number,
): TwoOptResult { throw new Error('not implemented'); }

/**
 * Sequence with MANUAL_SEQ anchors: anchored job nodes (already sorted by their MANUAL_SEQ)
 * keep their relative order; free nodes are routed around them.
 */
export function sequenceWithAnchors(
  _anchored: number[],
  _free: number[],
  _dist: DistFn,
  _endNode: number | null,
  _useImprovement: boolean,
  _deadline: number,
): TwoOptResult { throw new Error('not implemented'); }
