// Printable run sheets: an in-page A4 preview (print CSS does the rest). No tiles needed.
import type { DayRoute, LatLon } from '../types';
import { NOT_ROUTED_NOTE } from '../io/export';
import { fmtHours, fmtPoint, jobMap } from './planutil';
import { addTo, clear, h } from './dom';
import { getState } from './state';

export interface PrintOptions {
  worker: number | 'all';
  /** Table column indexes to print next to the job label. */
  extraCols: number[];
}

/** Static route sketch: equirectangular projection of the day's points, fitted to the box. */
export function routeSketchSvg(points: LatLon[], stopCount: number, color: string, hasEnd: boolean): string {
  const W = 360;
  const H = 230;
  const pad = 16;
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const k = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const spanX = Math.max((maxLon - minLon) * k, 1e-9);
  const spanY = Math.max(maxLat - minLat, 1e-9);
  const scale = Math.min((W - 2 * pad) / spanX, (H - 2 * pad) / spanY);
  const offX = (W - spanX * scale) / 2;
  const offY = (H - spanY * scale) / 2;
  const xy = (p: LatLon): [number, number] => [offX + (p.lon - minLon) * k * scale, offY + (maxLat - p.lat) * scale];
  const pts = points.map(xy);
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  let g = '';
  pts.forEach(([x, y], i) => {
    if (i === 0) {
      g += `<rect x="${(x - 5).toFixed(1)}" y="${(y - 5).toFixed(1)}" width="10" height="10" fill="#111827"/>`;
    } else if (i <= stopCount) {
      g += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="7" fill="${color}" stroke="#fff" stroke-width="1"/><text x="${x.toFixed(1)}" y="${(y + 3).toFixed(1)}" text-anchor="middle" font-size="8" font-weight="700" fill="#fff" stroke="#000" stroke-width="0.25">${i}</text>`;
    } else if (hasEnd) {
      g += `<rect x="${(x - 4).toFixed(1)}" y="${(y - 4).toFixed(1)}" width="8" height="8" fill="none" stroke="#111827" stroke-width="2"/>`;
    }
  });
  return `<svg class="sketch" viewBox="0 0 ${W} ${H}" role="img" aria-label="Route sketch, not to scale"><rect width="${W}" height="${H}" fill="#fff" stroke="#9ca3af"/><polyline points="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>${g}</svg>`;
}

function sheet(r: DayRoute, opts: PrintOptions): HTMLElement {
  const s = getState();
  const w = s.settings.workers[r.worker];
  const jobs = jobMap(s.extracted);
  const headers = s.table?.headers ?? [];
  const title = `${w?.name ?? 'Worker'}${r.day !== null ? `, day ${r.day}` : ''}`;
  const pts: LatLon[] = [r.start];
  const rows = r.stops.map((st) => {
    const j = jobs.get(st.row);
    if (j) pts.push({ lat: j.lat, lon: j.lon });
    return h('tr', null,
      h('td', { class: 'tick' }, ''),
      h('td', { class: 'num' }, String(st.seq)),
      h('td', null, j?.label || `Row ${st.row + 2}`),
      opts.extraCols.map((c) => h('td', null, String(s.table?.rows[st.row]?.[c] ?? ''))),
      h('td', { class: 'num' }, st.legKm.toFixed(2)),
      h('td', { class: 'num' }, st.cumKm.toFixed(2)),
    );
  });
  if (r.end) pts.push(r.end);
  const totals = [`${r.stops.length} job${r.stops.length === 1 ? '' : 's'}`, `${r.totalKm.toFixed(1)} km${r.end ? ` (including ${r.returnKm.toFixed(1)} km to the end)` : ''}`];
  if (r.hours !== undefined) totals.push(`about ${fmtHours(r.hours)}`);
  const svg = h('div', { class: 'sketch-wrap' });
  svg.innerHTML = routeSketchSvg(pts, r.stops.length, w?.color ?? '#1f77b4', r.end !== null);
  return h('section', { class: 'sheet', testid: 'run-sheet' },
    h('header', null, h('h2', null, title), h('div', { class: 'meta' }, `${s.fileName} · printed ${new Date().toLocaleDateString()}`)),
    h('div', { class: 'meta' }, `Start: ${fmtPoint(r.start)}${r.end ? ` · End: ${fmtPoint(r.end)}` : ' · Open end'}`),
    h('table', null,
      h('thead', null, h('tr', null, h('th', { class: 'tick' }, 'Done'), h('th', null, '#'), h('th', null, 'Job'), opts.extraCols.map((c) => h('th', null, headers[c] || `Col ${c + 1}`)), h('th', null, 'Leg km'), h('th', null, 'Cum km'))),
      h('tbody', null, rows),
    ),
    h('div', { class: 'totals' }, h('strong', null, 'Day totals: '), totals.join(' · ')),
    svg,
    h('div', { class: 'meta small' }, 'Sketch only, not to scale. Square = start; numbers = stops.'),
  );
}

export function closePrintView(): void {
  document.getElementById('print-view')?.remove();
  document.body.classList.remove('print-open');
}

export function openPrintView(opts: PrintOptions): void {
  const s = getState();
  if (!s.plan) return;
  closePrintView();
  const routes = s.plan.routes.filter((r) => opts.worker === 'all' || r.worker === opts.worker);
  const root = h('div', { id: 'print-view', class: 'print-view', testid: 'print-view', role: 'dialog', 'aria-label': 'Run sheets' });
  const bar = h('div', { class: 'print-bar' },
    h('strong', null, `Run sheets (${routes.length})`),
    h('button', { type: 'button', class: 'btn primary', onClick: () => window.print() }, 'Print'),
    h('button', { type: 'button', class: 'btn', testid: 'print-close', onClick: closePrintView }, 'Close'),
  );
  const pages = h('div', { class: 'pages' });
  addTo(pages, routes.map((r) => sheet(r, opts)));
  if (opts.worker === 'all' && s.plan.notRouted.length) {
    const labelCol = s.mapping?.label ?? 0;
    pages.append(
      h('section', { class: 'sheet' },
        h('header', null, h('h2', null, 'Not routed')),
        h('table', null,
          h('thead', null, h('tr', null, h('th', null, 'Row'), h('th', null, 'Job'), h('th', null, 'Note'))),
          h('tbody', null, s.plan.notRouted.map((r) => h('tr', null, h('td', { class: 'num' }, String(r + 2)), h('td', null, String(s.table?.rows[r]?.[labelCol] ?? '')), h('td', null, NOT_ROUTED_NOTE)))),
        ),
      ),
    );
  }
  if (routes.length === 0 && pages.childElementCount === 0) {
    clear(pages);
    pages.append(h('p', null, 'Nothing to print for that choice.'));
  }
  root.append(bar, pages);
  document.body.append(root);
  document.body.classList.add('print-open');
}
