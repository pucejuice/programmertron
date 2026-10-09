// Leaflet map: tiles (optional), job markers, route lines, bases, selection and popups.
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { OSM_COPYRIGHT_URL, OSM_TILE_URL } from '../core/defaults';
import { centroid } from '../core/geo';
import type { Job, LatLon } from '../types';
import { reassign, unlockRows, updateSettings } from './actions';
import { clear, h } from './dom';
import { attachSelection, pointInPolygon, type SelectMode } from './lasso';
import { indexPlan, jobMap, routesOfWorker } from './planutil';
import { getState, notify, setState, type AppState } from './state';

/** Above this many jobs, markers are drawn on a canvas instead of as DOM icons. */
export const CANVAS_THRESHOLD = 500;
const GREY = '#6b7280';
const LOCK_SVG =
  '<svg class="lock" viewBox="0 0 12 12" width="12" height="12" aria-label="locked"><rect x="2" y="5.5" width="8" height="5.5" rx="1" fill="#111827"/><path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" fill="none" stroke="#111827" stroke-width="1.4"/></svg>';

function textOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '#fff';
  const n = parseInt(m[1], 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.62 ? '#111827' : '#ffffff';
}

let lastTile = OSM_TILE_URL;

export interface MapView {
  update(s: AppState, prev: AppState): void;
}

export function createMapView(wrap: HTMLElement): MapView {
  const canvasEl = h('div', { class: 'map-canvas', testid: 'map' });
  const boxBtn = h('button', { type: 'button', class: 'btn small', title: 'Draw a rectangle to select jobs (or hold Shift and drag)' }, 'Box select');
  const lassoBtn = h('button', { type: 'button', class: 'btn small', title: 'Draw freehand around jobs to select them' }, 'Lasso');
  const fitBtn = h('button', { type: 'button', class: 'btn small', title: 'Zoom to all jobs' }, 'Zoom to jobs');
  const noBasemap = h('input', { type: 'checkbox', testid: 'no-basemap', id: 'no-basemap' });
  const bar = h('div', { class: 'jr-overlay jr-mapbar' },
    h('div', { class: 'btn-row' }, boxBtn, lassoBtn, fitBtn),
    h('label', { class: 'check', for: 'no-basemap' }, noBasemap, 'No basemap'),
  );
  const selText = h('span', { class: 'sel-text' });
  const selWorker = h('select', { 'aria-label': 'Assign selected jobs to worker', testid: 'sel-worker' });
  const selAssign = h('button', { type: 'button', class: 'btn primary small', testid: 'sel-assign' }, 'Assign');
  const selClear = h('button', { type: 'button', class: 'btn small' }, 'Clear');
  const selBar = h('div', { class: 'jr-overlay jr-selbar', hidden: true }, selText, selWorker, selAssign, selClear);
  const pickText = h('span');
  const pickCancel = h('button', { type: 'button', class: 'btn small' }, 'Cancel');
  const pickBar = h('div', { class: 'jr-overlay jr-pickbar', hidden: true, role: 'status' }, pickText, pickCancel);
  const hint = h('div', { class: 'jr-overlay jr-hint' }, h('strong', null, 'No jobs yet'), h('span', null, 'Load a CSV or XLSX file, or try the sample data. The basemap loads once data is loaded.'));
  wrap.append(canvasEl, bar, selBar, pickBar, hint);

  const map = L.map(canvasEl, { zoomControl: true, boxZoom: false, preferCanvas: false, zoomSnap: 0.5, attributionControl: true });
  map.attributionControl.setPrefix(false);
  map.setView([-30, 147], 4);

  const canvas = L.canvas({ padding: 0.5 });
  const routeLayer = L.layerGroup().addTo(map);
  const baseLayer = L.layerGroup().addTo(map);
  const markerLayer = L.layerGroup().addTo(map);
  const selLayer = L.layerGroup().addTo(map);
  const hiLayer = L.layerGroup().addTo(map);
  let tile: L.TileLayer | null = null;
  let tileUrl = '';

  let mode: SelectMode = 'none';
  const setMode = (m: SelectMode) => {
    mode = m;
    boxBtn.classList.toggle('active', m === 'box');
    lassoBtn.classList.toggle('active', m === 'lasso');
    wrap.classList.toggle('selecting', m !== 'none');
  };
  boxBtn.onclick = () => setMode(mode === 'box' ? 'none' : 'box');
  lassoBtn.onclick = () => setMode(mode === 'lasso' ? 'none' : 'lasso');
  const fit = () => {
    const jobs = getState().extracted?.jobs ?? [];
    if (!jobs.length) return;
    map.fitBounds(L.latLngBounds(jobs.map((j) => [j.lat, j.lon] as [number, number])), { padding: [30, 30], maxZoom: 15 });
  };
  fitBtn.onclick = fit;
  noBasemap.onchange = () => {
    const cur = getState().settings.tileUrl;
    if (noBasemap.checked) {
      if (cur) lastTile = cur;
      updateSettings({ tileUrl: '' }, false);
    } else updateSettings({ tileUrl: lastTile || OSM_TILE_URL }, false);
  };

  attachSelection({
    map,
    container: canvasEl,
    getMode: () => mode,
    onDone: (poly) => {
      const jobs = getState().extracted?.jobs ?? [];
      const rows = jobs.filter((j) => pointInPolygon(j.lat, j.lon, poly)).map((j) => j.row);
      setMode('none');
      if (rows.length === 0) notify('No jobs inside that selection.', 'info');
      setState({ selection: rows });
    },
  });

  map.on('click', (e: L.LeafletMouseEvent) => {
    const pm = getState().pickMode;
    if (!pm) return;
    setState({ pickMode: null });
    pm.onPick({ lat: e.latlng.lat, lon: e.latlng.lng });
  });
  pickCancel.onclick = () => setState({ pickMode: null });
  selClear.onclick = () => setState({ selection: [] });
  selAssign.onclick = () => void reassign(getState().selection, Number(selWorker.value));

  new ResizeObserver(() => map.invalidateSize()).observe(canvasEl);

  // ---------- drawing ----------

  function popupContent(row: number): HTMLElement {
    const s = getState();
    const job = jobMap(s.extracted).get(row);
    const info = indexPlan(s.plan).get(row);
    const a = s.assignments[row];
    const workers = s.settings.workers;
    const wNow = info?.route.worker ?? a?.worker ?? 0;
    const el = h('div', { class: 'popup' }, h('strong', null, job?.label || `Row ${row + 1}`), h('div', { class: 'muted' }, `Input row ${row + 2}`));
    if (info) {
      const r = info.route;
      el.append(h('div', null, `${workers[r.worker]?.name ?? 'Worker'}${r.day !== null ? `, day ${r.day}` : ''}, stop ${info.stop.seq}`));
    } else el.append(h('div', { class: 'muted' }, 'Not routed yet'));
    if (s.settings.simpleMode) {
      el.append(h('div', { class: 'muted' }, 'Simple mode: one worker, no days.'));
      return el;
    }
    const wSel = h('select', { 'aria-label': 'Worker', testid: 'popup-worker' }, workers.map((w, i) => h('option', { value: String(i) }, w.name)));
    wSel.value = String(wNow);
    const daySel = h('select', { 'aria-label': 'Day', testid: 'popup-day' });
    const fillDays = () => {
      clear(daySel);
      const w = Number(wSel.value);
      const days = routesOfWorker(s.plan, w).map((r) => r.day).filter((d): d is number => d !== null);
      const max = days.length ? Math.max(...days) : 0;
      daySel.append(h('option', { value: '' }, 'Day: automatic'));
      for (let d = 1; d <= max + 1; d++) daySel.append(h('option', { value: String(d) }, d <= max ? `Day ${d}` : `Day ${d} (new)`));
      const cur = info && info.route.worker === w ? info.route.day : null;
      daySel.value = a?.lockedDay && cur !== null ? String(cur) : '';
    };
    fillDays();
    wSel.onchange = () => {
      map.closePopup();
      void reassign([row], Number(wSel.value));
    };
    daySel.onchange = () => {
      map.closePopup();
      void reassign([row], Number(wSel.value), daySel.value === '' ? null : Number(daySel.value));
    };
    el.append(
      h('label', null, 'Worker', wSel),
      ...(s.settings.dayMode !== 'none' ? [h('label', null, 'Day', daySel)] : []),
      a?.lockedWorker || a?.lockedDay
        ? h('div', { class: 'popup-lock' }, h('span', { class: 'lockline' }, 'Locked by hand'), h('button', { type: 'button', class: 'btn small', onClick: () => { map.closePopup(); unlockRows([row]); } }, 'Unlock'))
        : h('div', { class: 'muted' }, 'Choosing a worker or day locks this job.'),
    );
    return el;
  }

  function drawData(s: AppState): void {
    routeLayer.clearLayers();
    markerLayer.clearLayers();
    baseLayer.clearLayers();
    selLayer.clearLayers();
    const jobs = s.extracted?.jobs ?? [];
    const big = jobs.length > CANVAS_THRESHOLD;
    const workers = s.settings.workers;
    const colorOf = (w: number | undefined) => (w === undefined ? GREY : (workers[w]?.color ?? GREY));
    const byRow = jobMap(s.extracted);
    const idx = indexPlan(s.plan);

    if (s.plan) {
      for (const r of s.plan.routes) {
        const pts: [number, number][] = [[r.start.lat, r.start.lon]];
        for (const st of r.stops) {
          const j = byRow.get(st.row);
          if (j) pts.push([j.lat, j.lon]);
        }
        if (r.end) pts.push([r.end.lat, r.end.lon]);
        const line = L.polyline(pts, {
          color: colorOf(r.worker),
          weight: 3,
          opacity: 0.75,
          dashArray: r.day !== null && r.day % 2 === 0 ? '7 6' : undefined,
          renderer: big ? canvas : undefined,
          interactive: !big,
        });
        if (!big) line.bindTooltip(`${workers[r.worker]?.name ?? 'Worker'}${r.day !== null ? `, day ${r.day}` : ''}: ${r.totalKm.toFixed(1)} km`, { sticky: true });
        routeLayer.addLayer(line);
      }
    }

    for (const j of jobs) {
      const info = idx.get(j.row);
      const a = s.assignments[j.row];
      const w = info?.route.worker ?? a?.worker;
      const color = colorOf(w);
      const locked = !!(a && (a.lockedWorker || a.lockedDay));
      let m: L.Marker | L.CircleMarker;
      if (big) {
        m = L.circleMarker([j.lat, j.lon], {
          radius: 5, color: locked ? '#111827' : '#ffffff', weight: locked ? 3 : 1, fillColor: color, fillOpacity: 0.95, renderer: canvas, bubblingMouseEvents: false,
        });
      } else {
        const label = info ? String(info.stop.seq) : '';
        m = L.marker([j.lat, j.lon], {
          icon: L.divIcon({
            className: 'jr-pin-wrap',
            html: `<span class="jr-pin" style="background:${color};color:${textOn(color)}">${label}</span>${locked ? LOCK_SVG : ''}`,
            iconSize: [24, 24],
            iconAnchor: [12, 12],
          }),
          riseOnHover: true,
          keyboard: false,
          bubblingMouseEvents: false,
        });
      }
      m.on('click', () => setState({ highlightRow: j.row }));
      m.bindPopup(() => popupContent(j.row), { minWidth: 190 });
      m.bindTooltip(j.label || `Row ${j.row + 2}`, { direction: 'top', offset: [0, big ? -4 : -10] });
      markerLayer.addLayer(m);
    }

    for (const row of s.selection) {
      const j = byRow.get(row);
      if (j) selLayer.addLayer(L.circleMarker([j.lat, j.lon], { radius: 15, color: '#2563eb', weight: 3, fill: false, interactive: false }));
    }

    drawBases(s, jobs);
  }

  function drawBases(s: AppState, jobs: Job[]): void {
    if (!jobs.length) return;
    const set = s.settings;
    const add = (p: LatLon, cls: string, text: string, tip: string, color?: string) => {
      baseLayer.addLayer(
        L.marker([p.lat, p.lon], {
          icon: L.divIcon({
            className: 'jr-pin-wrap',
            html: `<span class="${cls}" style="${color ? `background:${color};color:${textOn(color)}` : ''}">${text}</span>`,
            iconSize: [26, 26],
            iconAnchor: [13, 13],
          }),
          zIndexOffset: -500,
          keyboard: false,
        }).bindTooltip(tip, { direction: 'top', offset: [0, -12] }),
      );
    };
    if (set.simpleMode) {
      const c = s.plan?.centroid ?? centroid(jobs);
      add(c, 'jr-base', 'B', 'Start: centroid of the jobs (Simple mode)');
      return;
    }
    const shared: LatLon = set.base ?? s.plan?.centroid ?? centroid(jobs);
    add(shared, 'jr-base', 'B', `Base: ${set.base?.name ?? 'centroid of the jobs'}`);
    set.workers.forEach((w, i) => {
      if (w.base) add(w.base, 'jr-base worker', 'B', `${w.name}: own base (${w.base.name})`, w.color);
      void i;
    });
    if (set.startOverride) add(set.startOverride, 'jr-point', 'S', 'Start point');
    if (set.endMode === 'point' && set.endPoint) add(set.endPoint, 'jr-point', 'E', 'End point');
  }

  function drawHighlight(s: AppState): void {
    hiLayer.clearLayers();
    if (s.highlightRow === null) return;
    const j = jobMap(s.extracted).get(s.highlightRow);
    if (!j) return;
    hiLayer.addLayer(L.circleMarker([j.lat, j.lon], { radius: 18, color: '#f59e0b', weight: 4, fill: false, interactive: false }));
    if (!map.getBounds().pad(-0.1).contains([j.lat, j.lon])) map.panTo([j.lat, j.lon]);
  }

  function drawTiles(s: AppState): void {
    // No tile request is made before data is loaded: nothing about the view leaves the machine until then.
    const want = s.extracted && s.extracted.jobs.length > 0 ? s.settings.tileUrl : '';
    if (want === tileUrl) return;
    tileUrl = want;
    if (tile) {
      tile.remove();
      tile = null;
    }
    if (want) {
      tile = L.tileLayer(want, {
        maxZoom: 19,
        attribution: `&copy; <a href="${OSM_COPYRIGHT_URL}" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>`,
      }).addTo(map);
    }
    wrap.classList.toggle('no-basemap', !want);
  }

  function drawChrome(s: AppState): void {
    noBasemap.checked = s.settings.tileUrl === '';
    hint.hidden = !!(s.extracted && s.extracted.jobs.length);
    selBar.hidden = s.selection.length === 0;
    if (s.selection.length) {
      selText.textContent = `${s.selection.length} job${s.selection.length === 1 ? '' : 's'} selected`;
      const cur = selWorker.value;
      clear(selWorker);
      s.settings.workers.forEach((w, i) => selWorker.append(h('option', { value: String(i) }, w.name)));
      if (cur && Number(cur) < s.settings.workers.length) selWorker.value = cur;
      selAssign.disabled = s.settings.simpleMode || !!s.busy;
      selAssign.title = s.settings.simpleMode ? 'Not available in Simple mode' : '';
    }
    pickBar.hidden = !s.pickMode;
    if (s.pickMode) pickText.textContent = `${s.pickMode.label}: click the map (Esc to cancel)`;
    wrap.classList.toggle('picking', !!s.pickMode);
  }

  // First paint.
  const first = getState();
  drawTiles(first);
  drawData(first);
  drawChrome(first);

  return {
    update(s, prev) {
      drawTiles(s);
      drawChrome(s);
      const dataChanged =
        s.extracted !== prev.extracted || s.plan !== prev.plan || s.assignments !== prev.assignments || s.settings !== prev.settings || s.selection !== prev.selection;
      if (dataChanged) drawData(s);
      if (s.extracted !== prev.extracted && s.extracted && s.extracted.jobs.length && (!prev.extracted || prev.table !== s.table)) fit();
      if (dataChanged || s.highlightRow !== prev.highlightRow) drawHighlight(s);
    },
  };
}
