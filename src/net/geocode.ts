import type { FetchFn } from './base';

export interface GeocodeHit {
  name: string;
  lat: number;
  lon: number;
}

/** Geocode a typed address via Nominatim. Only called when the user presses Search. */
export function geocodeAddress(_query: string, _fetchFn: FetchFn): Promise<GeocodeHit[]> { throw new Error('not implemented'); }

/** Parse "lat, long" typed by the user. null if invalid. */
export function parseLatLonText(_s: string): { lat: number; lon: number } | null { throw new Error('not implemented'); }
