/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { lookupBaseTown, type KV } from '../src/net/base';
import { geocodeAddress, parseLatLonText } from '../src/net/geocode';
import { isAllowedUrl, nominatimReverseUrl, nominatimSearchUrl, osrmTableUrl, overpassBody, overpassQuery } from '../src/net/endpoints';
import { osrmProvider } from '../src/net/osrm';
import { rateLimited, resetRateLimits } from '../src/net/ratelimit';
import { OSM_TILE_URL } from '../src/core/defaults';

// ---- 9.7(a) source scan ---------------------------------------------------------------

interface Scan {
  strings: string[];
  code: string; // source with comments, strings and regex literals blanked out
}

/** Minimal JS/TS lexer: separates comments, string/template literals and regex literals. */
function scan(src: string): Scan {
  const strings: string[] = [];
  let code = '';
  let i = 0;
  let prev = ''; // last significant code char
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') i++;
    } else if (c === '/' && d === '*') {
      const e = src.indexOf('*/', i + 2);
      i = e < 0 ? n : e + 2;
    } else if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      let s = '';
      while (j < n && src[j] !== c) {
        if (src[j] === '\\') { s += src[j] + (src[j + 1] ?? ''); j += 2; continue; }
        s += src[j++];
      }
      strings.push(s);
      code += '""';
      prev = '"';
      i = j + 1;
    } else if (c === '/' && (prev === '' || '(,=:[!&|?{};+-*%<>~^'.includes(prev))) {
      let j = i + 1;
      let inClass = false;
      while (j < n && src[j] !== '\n') {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '[') inClass = true;
        else if (src[j] === ']') inClass = false;
        else if (src[j] === '/' && !inClass) break;
        j++;
      }
      code += '/re/';
      prev = '/';
      i = j + 1;
    } else {
      code += c;
      if (!/\s/.test(c)) prev = c;
      i++;
    }
  }
  return { strings, code };
}

function listTs(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listTs(p));
    else if (/\.(ts|tsx|js|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

describe('9.7(a) only src/net builds URLs and calls fetch', () => {
  const root = path.resolve(__dirname, '..', 'src');
  const files = listTs(root).map((f) => ({ rel: path.relative(root, f).split(path.sep).join('/'), text: fs.readFileSync(f, 'utf8') }));

  it('scanner sanity', () => {
    const s = scan(`const a = 'https://x.y'; // https://c.d\n/* http://e.f */ const r = /https?:\\/\\//; fetch(u)`);
    expect(s.strings).toEqual(['https://x.y']);
    expect(s.code).toMatch(/fetch\(/);
    expect(s.code).not.toMatch(/http/);
  });

  it('http(s):// string literals only in net/endpoints.ts and core/defaults.ts', () => {
    const bad: string[] = [];
    for (const f of files) {
      if (['net/endpoints.ts', 'core/defaults.ts'].includes(f.rel)) continue;
      for (const s of scan(f.text).strings) if (/https?:\/\//i.test(s)) bad.push(`${f.rel}: ${s}`);
    }
    expect(bad).toEqual([]);
  });

  it('fetch( is called only under src/net/, and no other network primitives are used', () => {
    const bad: string[] = [];
    for (const f of files) {
      const { code } = scan(f.text);
      if (!f.rel.startsWith('net/') && /(?<![\w$])fetch\s*\(/.test(code)) bad.push(`${f.rel}: fetch(`);
      if (/\b(XMLHttpRequest|sendBeacon|WebSocket|EventSource)\b/.test(code)) bad.push(`${f.rel}: other network API`);
    }
    expect(bad).toEqual([]);
  });
});

// ---- 9.7(b) one coordinate pair -------------------------------------------------------

const PAIR = /-?\d+\.\d+\s*(?:,|&lon=)\s*-?\d+\.\d+/g;

describe('9.7(b) at most one coordinate pair', () => {
  const c = { lat: -27.307587, lon: 152.92794925 };
  it('overpass', () => {
    const q = overpassQuery(c, 100000);
    expect(q).toBe('[out:json][timeout:25];(node["place"~"^(town|city|village)$"](around:100000,-27.308,152.928););out body;');
    expect(q.match(PAIR)).toHaveLength(1);
    expect(decodeURIComponent(overpassBody(c, 100000).replace(/^data=/, ''))).toBe(q);
    expect(overpassBody(c, 100000).startsWith('data=')).toBe(true);
  });
  it('nominatim', () => {
    expect(nominatimReverseUrl(c)).toBe('https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=-27.30759&lon=152.92795');
    expect(nominatimReverseUrl(c).match(PAIR)).toHaveLength(1);
    expect(nominatimSearchUrl('1 High St, Town')).toBe('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=1%20High%20St%2C%20Town');
    expect(nominatimSearchUrl('1 High St, Town').match(PAIR)).toBeNull();
  });
  it('osrm url', () => {
    expect(osrmTableUrl('http://localhost:5000/', [{ lat: 1, lon: 2 }, { lat: 3.5, lon: 4 }])).toBe(
      'http://localhost:5000/table/v1/driving/2.000000,1.000000;4.000000,3.500000?annotations=distance,duration',
    );
  });
});

// ---- 9.7(c) base lookup ---------------------------------------------------------------

const C = { lat: -27.3, lon: 152.9 };
const el = (name: string, place: string, dLat: number) => ({ type: 'node', lat: C.lat + dLat, lon: C.lon, tags: { name, place } });
const okJson = (elements: unknown[]) => ({ ok: true, status: 200, json: async () => ({ elements }) }) as unknown as Response;
const mem = (): KV & { m: Map<string, string> } => {
  const m = new Map<string, string>();
  return { m, get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v) };
};

describe('9.7(c) lookupBaseTown', () => {
  beforeEach(() => resetRateLimits());

  it('picks the nearest town over a nearer village, sending one POST with one pair', async () => {
    const f = vi.fn(async () => okJson([el('Vill', 'village', 0.01), el('FarTown', 'town', 0.5), el('NearCity', 'city', 0.2), el('Hamlet', 'hamlet', 0.001)]));
    const b = await lookupBaseTown(C, f as unknown as typeof fetch, null);
    expect(b).toMatchObject({ name: 'NearCity', source: 'town' });
    expect(b.distFromCentroidKm).toBeCloseTo(22.24, 1);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://overpass-api.de/api/interpreter');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Accept).toBe('application/json');
    const body = String(init.body);
    expect(body.startsWith('data=')).toBe(true);
    expect(decodeURIComponent(body).match(PAIR)).toHaveLength(1);
  });

  it('falls back to the nearest village', async () => {
    const f = vi.fn(async () => okJson([el('V2', 'village', 0.3), el('V1', 'village', -0.1)]));
    const b = await lookupBaseTown(C, f as unknown as typeof fetch, null);
    expect(b).toMatchObject({ name: 'V1', source: 'town' });
  });

  it('ignores places beyond 100 km', async () => {
    const f = vi.fn(async () => okJson([el('Far', 'town', 2)]));
    const b = await lookupBaseTown(C, f as unknown as typeof fetch, null);
    expect(b.source).toBe('centroid');
  });

  it('failure, bad status and offline give the centroid with the note', async () => {
    const note = 'Town lookup failed (offline?); using the centroid of the jobs as base.';
    for (const f of [
      vi.fn(async () => { throw new TypeError('Failed to fetch'); }),
      vi.fn(async () => ({ ok: false, status: 504, json: async () => ({}) }) as unknown as Response),
    ]) {
      resetRateLimits();
      const b = await lookupBaseTown(C, f as unknown as typeof fetch, null);
      expect(b).toEqual({ lat: C.lat, lon: C.lon, name: 'Centroid of jobs', source: 'centroid', distFromCentroidKm: 0, note });
    }
  });

  it('empty result gives the centroid', async () => {
    const b = await lookupBaseTown(C, (async () => okJson([])) as unknown as typeof fetch, null);
    expect(b.source).toBe('centroid');
    expect(b.name).toBe('Centroid of jobs');
  });

  it('caches by 2dp key; cache hit makes no fetch; failures are not cached', async () => {
    const kv = mem();
    const f = vi.fn(async () => okJson([el('T', 'town', 0.1)]));
    await lookupBaseTown(C, f as unknown as typeof fetch, kv);
    expect([...kv.m.keys()]).toEqual(['jr-base:-27.30,152.90']);
    const g = vi.fn(async () => okJson([]));
    const b = await lookupBaseTown({ lat: -27.304, lon: 152.896 }, g as unknown as typeof fetch, kv);
    expect(g).not.toHaveBeenCalled();
    expect(b).toMatchObject({ name: 'T', source: 'town' });
    resetRateLimits();
    const kv2 = mem();
    await lookupBaseTown(C, (async () => { throw new Error('x'); }) as unknown as typeof fetch, kv2);
    expect(kv2.m.size).toBe(0);
  });

  it('survives a throwing KV', async () => {
    const kv: KV = { get: () => { throw new Error('no'); }, set: () => { throw new Error('no'); } };
    const b = await lookupBaseTown(C, (async () => okJson([el('T', 'town', 0.1)])) as unknown as typeof fetch, kv);
    expect(b.name).toBe('T');
  });
});

// ---- 9.7(d) allowed URLs --------------------------------------------------------------

describe('9.7(d) isAllowedUrl', () => {
  const opts = { tileUrl: OSM_TILE_URL, roadServerUrl: '' };
  it('accepts tile, overpass, nominatim, osrm', () => {
    expect(isAllowedUrl('https://tile.openstreetmap.org/3/4/5.png', opts)).toBe(true);
    expect(isAllowedUrl('https://overpass-api.de/api/interpreter', opts)).toBe(true);
    expect(isAllowedUrl(nominatimSearchUrl('x'), opts)).toBe(true);
    const o = { ...opts, roadServerUrl: 'https://osrm.example.org/' };
    expect(isAllowedUrl('https://osrm.example.org/table/v1/driving/1,2;3,4', o)).toBe(true);
    expect(isAllowedUrl('http://localhost:5000/table/v1/driving/1,2;3,4', { ...opts, roadServerUrl: 'http://localhost:5000' })).toBe(true);
  });
  it('handles {s} subdomains', () => {
    const o = { tileUrl: 'https://{s}.tiles.example.com/{z}/{x}/{y}.png', roadServerUrl: '' };
    for (const s of ['a', 'b', 'c']) expect(isAllowedUrl(`https://${s}.tiles.example.com/1/2/3.png`, o)).toBe(true);
    expect(isAllowedUrl('https://d.tiles.example.com/1/2/3.png', o)).toBe(false);
  });
  it('rejects everything else', () => {
    expect(isAllowedUrl('https://evil.example.com/x', opts)).toBe(false);
    expect(isAllowedUrl('http://tile.openstreetmap.org/3/4/5.png', opts)).toBe(false);
    expect(isAllowedUrl('http://overpass-api.de/api/interpreter', opts)).toBe(false);
    expect(isAllowedUrl('https://tile.openstreetmap.org.evil.com/x', opts)).toBe(false);
    expect(isAllowedUrl('https://user:pw@overpass-api.de/x', opts)).toBe(false);
    expect(isAllowedUrl('not a url', opts)).toBe(false);
    expect(isAllowedUrl('ftp://tile.openstreetmap.org/x', opts)).toBe(false);
    expect(isAllowedUrl('https://osrm.example.org/x', opts)).toBe(false);
    expect(isAllowedUrl('http://osrm.example.org/x', { ...opts, roadServerUrl: 'http://osrm.example.org' })).toBe(false);
    expect(isAllowedUrl('https://tile.openstreetmap.org/1.png', { tileUrl: '', roadServerUrl: '' })).toBe(false);
  });
});

// ---- geocode, osrm, ratelimit ---------------------------------------------------------

describe('geocode', () => {
  beforeEach(() => resetRateLimits());
  it('parses hits and skips bad ones', async () => {
    const f = vi.fn(async () => ({ ok: true, status: 200, json: async () => [{ display_name: 'A, B', lat: '-33.5', lon: '151.2' }, { display_name: 'bad', lat: 'x', lon: '1' }] }) as unknown as Response);
    const hits = await geocodeAddress(' 1 High St ', f as unknown as typeof fetch);
    expect(hits).toEqual([{ name: 'A, B', lat: -33.5, lon: 151.2 }]);
    expect((f.mock.calls[0] as unknown[])[0]).toBe('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=1%20High%20St');
  });
  it('throws on HTTP error; empty query makes no request', async () => {
    const bad = vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) }) as unknown as Response);
    await expect(geocodeAddress('x', bad as unknown as typeof fetch)).rejects.toThrow(/429/);
    resetRateLimits();
    const f = vi.fn();
    expect(await geocodeAddress('  ', f as unknown as typeof fetch)).toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });
  it('parseLatLonText', () => {
    expect(parseLatLonText('-33.87, 151.21')).toEqual({ lat: -33.87, lon: 151.21 });
    expect(parseLatLonText(' -33.87   151.21 ')).toEqual({ lat: -33.87, lon: 151.21 });
    expect(parseLatLonText('-33.87,151.21')).toEqual({ lat: -33.87, lon: 151.21 });
    for (const bad of ['', 'abc', '1', '1,2,3', '91, 10', '10, 181', '0, 0', '0.0 0', '1e2, 3', '10;20', 'a, 1']) expect(parseLatLonText(bad)).toBeNull();
    expect(parseLatLonText('0, 10')).toEqual({ lat: 0, lon: 10 });
  });
});

describe('osrmProvider', () => {
  const pts = [{ lat: 1, lon: 2 }, { lat: 3, lon: 4 }];
  const resp = (body: unknown, ok = true) => (async () => ({ ok, status: ok ? 200 : 500, json: async () => body }) as unknown as Response) as unknown as typeof fetch;
  it('converts units', async () => {
    const t = await osrmProvider('http://localhost:5000', resp({ code: 'Ok', distances: [[0, 1500], [2500, 0]], durations: [[0, 120], [60, 0]] }))(pts);
    expect(t).toEqual({ km: [[0, 1.5], [2.5, 0]], min: [[0, 2], [1, 0]] });
  });
  it('throws on null entries, non-ok, bad code, bad shape', async () => {
    await expect(osrmProvider('http://l', resp({ code: 'Ok', distances: [[0, null], [1, 0]], durations: [[0, 1], [1, 0]] }))(pts)).rejects.toThrow(/unreachable/);
    await expect(osrmProvider('http://l', resp({}, false))(pts)).rejects.toThrow(/HTTP 500/);
    await expect(osrmProvider('http://l', resp({ code: 'NoTable' }))(pts)).rejects.toThrow(/NoTable/);
    await expect(osrmProvider('http://l', resp({ code: 'Ok', distances: [[0]], durations: [[0]] }))(pts)).rejects.toThrow(/malformed|no distance/);
  });
});

describe('rateLimited', () => {
  beforeEach(() => resetRateLimits());
  it('starts at most one call per interval per key, in order', async () => {
    const starts: Array<[string, number]> = [];
    const t0 = Date.now();
    const mk = (k: string, tag: string) => rateLimited(k, async () => { starts.push([tag, Date.now() - t0]); return tag; }, 120);
    const r = await Promise.all([mk('a', 'a1'), mk('a', 'a2'), mk('a', 'a3'), mk('b', 'b1')]);
    expect(r).toEqual(['a1', 'a2', 'a3', 'b1']);
    const a = starts.filter(([t]) => t.startsWith('a')).map(([, t]) => t);
    expect(a[1] - a[0]).toBeGreaterThanOrEqual(110);
    expect(a[2] - a[1]).toBeGreaterThanOrEqual(110);
    expect(starts.find(([t]) => t === 'b1')![1]).toBeLessThan(100);
  });
  it('a rejected call does not block the queue', async () => {
    const p1 = rateLimited('k', async () => { throw new Error('boom'); }, 10);
    const p2 = rateLimited('k', async () => 'ok', 10);
    await expect(p1).rejects.toThrow('boom');
    await expect(p2).resolves.toBe('ok');
  });
});
