import { OSM_TILE_URL } from '../../core/defaults';
import type { Base, DayMode, EndMode, LatLon } from '../../types';
import { lookupBase, makeBase, setBase, setWorkerCount, updateSettings, updateWorker } from '../actions';
import { clear, h } from '../dom';
import { fmtPoint } from '../planutil';
import { getState, notify, subscribe, type AppState } from '../state';
import { checkbox, field, numInput, pointInput } from '../widgets';

const TILE_RE = /^ht{2}ps?:$/;

function validTileUrl(v: string): boolean {
  if (!v.includes('{z}') || !v.includes('{x}') || !v.includes('{y}')) return false;
  try {
    return TILE_RE.test(new URL(v.replace(/\{[a-z]\}/g, '0')).protocol);
  } catch {
    return false;
  }
}

function hostOf(v: string): string | null {
  try {
    const u = new URL(v);
    return TILE_RE.test(u.protocol) ? u.host : null;
  } catch {
    return null;
  }
}

function structKey(s: AppState): string {
  const st = s.settings;
  return JSON.stringify([
    st.simpleMode, st.workers.map((w) => w.base), st.dayMode, st.endMode, st.startOverride, st.endPoint, st.tileUrl,
    st.roadServerUrl, st.roadServerConfirmed, !!s.extracted?.jobs.length, st.workers.length,
  ]);
}

export function mountSetup(root: HTMLElement): void {
  const baseStatus = h('div', { class: 'base-status', testid: 'base-status', role: 'status' });

  const renderBaseStatus = (s: AppState) => {
    clear(baseStatus);
    const jobs = s.extracted?.jobs.length ?? 0;
    if (s.settings.simpleMode) return void baseStatus.append(h('div', null, 'Simple mode starts at the centroid of the jobs.'));
    if (!jobs) return void baseStatus.append(h('div', { class: 'muted' }, 'Load jobs first. The town lookup runs once for each file.'));
    if (s.baseStatus === 'looking') return void baseStatus.append(h('div', null, 'Looking up the nearest town. Only the centre point of your jobs is sent.'));
    const b = s.settings.base;
    if (!b) return void baseStatus.append(h('div', { class: 'muted' }, 'No base yet; routes will use the centroid of the jobs.'));
    const how: Record<Base['source'], string> = { town: 'nearest town', centroid: 'centroid of the jobs', address: 'typed address', latlon: 'typed lat, long', click: 'picked on the map' };
    baseStatus.append(
      h('div', null, h('strong', null, b.name), ` (${how[b.source]}${b.distFromCentroidKm !== undefined ? `, ${b.distFromCentroidKm.toFixed(1)} km from the centroid of the jobs` : ''})`),
      h('div', { class: 'muted' }, fmtPoint(b)),
      ...(b.note ? [h('div', { class: 'warn' }, b.note)] : []),
    );
  };

  const render = () => {
    const s = getState();
    const set = s.settings;
    const simple = set.simpleMode;
    const hasJobs = !!s.extracted?.jobs.length;
    clear(root);
    const put = (...c: (Node | null | false)[]) => root.append(...(c.filter(Boolean) as Node[]));

    put(
      h('fieldset', { class: 'card' },
        h('legend', null, 'Routing method'),
        checkbox('Simple (old program) mode', simple, (v) => updateSettings({ simpleMode: v }), 'simple-mode'),
        h('p', { class: 'muted' }, simple
          ? 'On: one worker, no days, start at the centroid, open end, no 2-opt, straight-line distances. This matches the old desktop program exactly. Untick it to use the controls below.'
          : 'Reproduces the old desktop program exactly (one worker, nearest-neighbour from the centroid). Use it to check results against the old tool.'),
      ),
    );

    // ----- Base -----
    put(
      h('fieldset', { class: 'card', disabled: simple },
        h('legend', null, 'Base'),
        h('p', { class: 'muted' }, 'Every route starts and ends here unless you say otherwise.'),
        baseStatus,
        h('div', { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn small', disabled: !hasJobs, onClick: () => { setBase(null); void lookupBase(); } }, 'Use the nearest town again'),
        ),
        field('Change the base', pointInput({
          pickLabel: 'Set the base',
          onUse: (p, name, source) => setBase(makeBase(p, source === 'address' ? name : source === 'click' ? 'Picked on map' : 'Typed location', source === 'address' ? 'address' : source === 'click' ? 'click' : 'latlon')),
        }), 'Type an address and press Search, or type lat, long, or pick on the map.'),
      ),
    );

    // ----- Start / end -----
    const pointRow = (p: LatLon | null) => h('div', { class: 'muted' }, p ? `Point: ${fmtPoint(p)}` : 'No point set yet.');
    const endSel = h('select', { 'aria-label': 'End of each route', testid: 'end-mode' },
      h('option', { value: 'base' }, 'Back at the base'),
      h('option', { value: 'open' }, 'Open (stop at the last job)'),
      h('option', { value: 'point' }, 'At a point I choose'),
    );
    endSel.value = set.endMode;
    endSel.onchange = () => updateSettings({ endMode: endSel.value as EndMode });
    put(
      h('fieldset', { class: 'card', disabled: simple },
        h('legend', null, 'Start and end'),
        h('div', { class: 'field' }, h('label', null, 'Start'),
          h('div', { class: 'muted' }, set.startOverride ? `A point I chose (${fmtPoint(set.startOverride)})` : 'The worker\'s base (default)'),
          set.startOverride ? h('button', { type: 'button', class: 'btn small', onClick: () => updateSettings({ startOverride: null }) }, 'Use the base') : null,
          pointInput({ pickLabel: 'Set the start point', placeholder: 'Start: address, or lat, long', onUse: (p) => updateSettings({ startOverride: p }) }),
        ),
        field('End', endSel),
        set.endMode === 'point'
          ? h('div', { class: 'field' }, pointRow(set.endPoint), pointInput({ pickLabel: 'Set the end point', placeholder: 'End: address, or lat, long', onUse: (p) => updateSettings({ endPoint: p }) }))
          : null,
      ),
    );

    // ----- Workers -----
    const count = numInput(set.workers.length, (v) => setWorkerCount(v ?? 1), { min: 1, max: 10, integer: true, label: 'Number of workers', testid: 'worker-count' });
    put(
      h('fieldset', { class: 'card', disabled: simple },
        h('legend', null, 'Workers'),
        field('Number of workers (1 to 10)', count),
        h('div', { class: 'workers' }, set.workers.map((w, i) => {
          const color = h('input', { type: 'color', value: w.color, 'aria-label': `${w.name} colour` });
          color.addEventListener('change', () => updateWorker(i, { color: color.value }, false));
          const name = h('input', { type: 'text', value: w.name, maxlength: 40, 'aria-label': `Worker ${i + 1} name`, testid: `worker-name-${i}` });
          name.addEventListener('change', () => updateWorker(i, { name: name.value.trim() || `Worker ${i + 1}` }, false));
          const cap = numInput(w.capacity, (v) => updateWorker(i, { capacity: v }), { min: 1, integer: true, placeholder: 'auto', label: `${w.name} capacity (jobs)` });
          return h('div', { class: 'worker-row' },
            h('div', { class: 'row' }, color, name),
            h('div', { class: 'row' }, h('label', { class: 'inline' }, 'Max jobs', cap)),
            h('details', null,
              h('summary', null, w.base ? `Own base: ${w.base.name}` : 'Base: shared'),
              w.base ? h('div', { class: 'muted' }, fmtPoint(w.base)) : null,
              w.base ? h('button', { type: 'button', class: 'btn small', onClick: () => updateWorker(i, { base: null }) }, 'Use the shared base') : null,
              pointInput({
                pickLabel: `Set ${w.name}'s base`,
                onUse: (p, nm, src) => updateWorker(i, { base: makeBase(p, src === 'address' ? nm : src === 'click' ? 'Picked on map' : 'Typed location', src) }),
              }),
            ),
          );
        })),
        h('div', { class: 'hint' }, 'Leave "Max jobs" empty to balance the workers automatically (counts differ by at most 1).'),
      ),
    );

    // ----- Days -----
    const dayRadio = (mode: DayMode, label: string) => {
      const r = h('input', { type: 'radio', name: 'daymode', checked: set.dayMode === mode, testid: `daymode-${mode}` });
      r.addEventListener('change', () => updateSettings({ dayMode: mode }));
      return h('label', { class: 'check' }, r, label);
    };
    const hoursOk = set.hoursPerDay !== null && set.hoursPerDay > 0 && set.minutesPerJob !== null && set.minutesPerJob >= 0 && set.speedKmh !== null && set.speedKmh > 0;
    put(
      h('fieldset', { class: 'card', disabled: simple },
        h('legend', null, 'Days'),
        dayRadio('count', 'Jobs per day'),
        set.dayMode === 'count'
          ? h('div', { class: 'indent' },
              field('Jobs per day (blank = no split)', numInput(set.jobsPerDay, (v) => updateSettings({ jobsPerDay: v }), { min: 1, integer: true, label: 'Jobs per day', testid: 'jobs-per-day' })),
            )
          : null,
        dayRadio('hours', 'Hours per day'),
        set.dayMode === 'hours'
          ? h('div', { class: 'indent' },
              field('Hours per day', numInput(set.hoursPerDay, (v) => updateSettings({ hoursPerDay: v }), { min: 0.1, label: 'Hours per day', testid: 'hours-per-day' })),
              field('Minutes on site per job', numInput(set.minutesPerJob, (v) => updateSettings({ minutesPerJob: v }), { min: 0, label: 'Minutes per job', testid: 'minutes-per-job' })),
              field('Average travel speed (km/h)', numInput(set.speedKmh, (v) => updateSettings({ speedKmh: v }), { min: 0.1, label: 'Speed km/h', testid: 'speed-kmh' })),
              hoursOk ? null : h('div', { class: 'warn' }, 'Enter all three values; there are no built-in defaults.'),
            )
          : null,
        dayRadio('none', 'No day split'),
      ),
    );

    // ----- Route options -----
    put(
      h('fieldset', { class: 'card', disabled: simple },
        h('legend', null, 'Route improvement'),
        checkbox('Improve each route with 2-opt', set.twoOpt, (v) => updateSettings({ twoOpt: v }), 'two-opt'),
        field('2-opt time limit per route (seconds)', numInput(set.twoOptTimeLimitMs / 1000, (v) => updateSettings({ twoOptTimeLimitMs: Math.round((v ?? 5) * 1000) }), { min: 0.1, label: '2-opt time limit seconds' })),
      ),
    );

    // ----- Map and network -----
    const tile = h('input', { type: 'text', value: set.tileUrl, placeholder: 'Tile URL template with {z}/{x}/{y}', 'aria-label': 'Tile URL', testid: 'tile-url', spellcheck: false });
    const tileMsg = h('div', { class: 'warn', role: 'alert' });
    tile.addEventListener('change', () => {
      const v = tile.value.trim();
      tileMsg.textContent = '';
      if (v === '') return updateSettings({ tileUrl: '' }, false);
      if (!validTileUrl(v)) {
        tileMsg.textContent = 'That is not a tile URL template. It needs {z}, {x} and {y}.';
        return;
      }
      updateSettings({ tileUrl: v }, false);
    });
    const road = h('input', { type: 'text', value: set.roadServerUrl, placeholder: 'Leave empty for straight-line distances', 'aria-label': 'Road routing server URL', testid: 'road-url', spellcheck: false });
    const roadHost = hostOf(set.roadServerUrl);
    const roadMsg = h('div', { class: 'warn', role: 'alert' });
    road.addEventListener('change', () => {
      const v = road.value.trim();
      roadMsg.textContent = '';
      if (v !== '' && !hostOf(v)) {
        roadMsg.textContent = 'That is not a valid server address.';
        return;
      }
      updateSettings({ roadServerUrl: v.replace(/\/+$/, ''), roadServerConfirmed: false });
    });
    put(
      h('fieldset', { class: 'card' },
        h('legend', null, 'Map and network'),
        field('Basemap tile URL', tile, 'Tile requests tell the tile server which area you are viewing. Use the "No basemap" switch on the map to turn tiles off.'),
        tileMsg,
        h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn small', onClick: () => updateSettings({ tileUrl: OSM_TILE_URL }, false) }, 'Reset to the OpenStreetMap default')),
        field('Road routing server URL (optional)', road, 'An OSRM-compatible server, used when Distances is set to Road network at the top of the panel.'),
        roadMsg,
        set.roadServerUrl
          ? h('div', { class: 'callout warn-box' },
              h('strong', null, 'Warning: '),
              `turning this on sends the coordinates of your jobs to ${roadHost ?? 'that server'}. Only enable it for a server you trust.`,
              checkbox(`I understand my job coordinates will be sent to ${roadHost ?? 'this server'}`, set.roadServerConfirmed, (v) => {
                updateSettings({ roadServerConfirmed: v });
                if (v) notify('Road routing is on. If the server fails you will see a warning and straight-line distances are used.', 'warn');
              }, 'road-confirm'),
              set.roadServerConfirmed ? h('div', { class: 'ok' }, 'Road routing is ON.') : h('div', { class: 'muted' }, 'Not enabled until you tick the box. Distances stay straight-line.'),
            )
          : null,
      ),
    );
    renderBaseStatus(s);
  };

  let key = '';
  render();
  key = structKey(getState());
  subscribe((s, prev) => {
    const k = structKey(s);
    if (k !== key) {
      key = k;
      render();
    } else if (s.settings.base !== prev.settings.base || s.baseStatus !== prev.baseStatus || s.extracted !== prev.extracted) {
      renderBaseStatus(s);
    }
  });
}
