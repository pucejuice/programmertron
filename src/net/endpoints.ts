// The ONLY place outbound URLs are built. Tests assert nothing else can be constructed.
import type { LatLon } from '../types';

export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
export const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';

/** Overpass QL for place=town|city|village around one point. POST body. Exactly one coordinate pair. */
export function overpassQuery(_centroid: LatLon, _radiusM: number): string { throw new Error('not implemented'); }

/** Nominatim search URL for a typed address (format=jsonv2, limit=5). */
export function nominatimSearchUrl(_query: string): string { throw new Error('not implemented'); }

/** Nominatim reverse URL for one point. */
export function nominatimReverseUrl(_p: LatLon): string { throw new Error('not implemented'); }

/** OSRM table URL: {server}/table/v1/driving/{lon,lat;...}?annotations=distance,duration */
export function osrmTableUrl(_server: string, _pts: LatLon[]): string { throw new Error('not implemented'); }

/** Host is the tile host, Overpass, Nominatim or the user's OSRM host. */
export function isAllowedUrl(_url: string, _opts: { tileUrl: string; roadServerUrl: string }): boolean { throw new Error('not implemented'); }
