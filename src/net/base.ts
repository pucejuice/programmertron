import type { Base, LatLon } from '../types';

export type FetchFn = typeof fetch;

export interface KV {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

/**
 * Nearest place=town|city to the centroid (within 100 km), else nearest place=village.
 * Sends ONLY the centroid. Cached by centroid rounded to 2 dp. On failure/offline returns
 * the centroid as base with a visible note.
 */
export function lookupBaseTown(_centroid: LatLon, _fetchFn: FetchFn, _cache: KV | null): Promise<Base> { throw new Error('not implemented'); }
