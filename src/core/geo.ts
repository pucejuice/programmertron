import type { LatLon } from '../types';

export const EARTH_RADIUS_KM = 6371;

/** Haversine great-circle distance, Earth radius 6371 km (parity with the old program). */
export function haversineKm(_a: LatLon, _b: LatLon): number { throw new Error('not implemented'); }

/** Arithmetic mean of lats and of lons. */
export function centroid(_pts: LatLon[]): LatLon { throw new Error('not implemented'); }

/**
 * Parse a lat/lon pair from cells. Returns null when blank, non-numeric, |lat|>90, |lon|>180
 * or exactly (0,0).
 */
export function parseLocation(_lat: unknown, _lon: unknown): LatLon | null { throw new Error('not implemented'); }

/** Bearing-like angle of p around origin, radians in [0, 2π), 0 = north, clockwise. Used for sweep order. */
export function sweepAngle(_origin: LatLon, _p: LatLon): number { throw new Error('not implemented'); }
