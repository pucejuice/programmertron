import type { RoadTableProvider } from '../types';
import type { FetchFn } from './base';

/** Provider fetching an OSRM table (km, minutes) from the user's server. Throws on failure. */
export function osrmProvider(_serverUrl: string, _fetchFn: FetchFn): RoadTableProvider { throw new Error('not implemented'); }
