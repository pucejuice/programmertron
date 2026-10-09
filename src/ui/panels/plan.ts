import type { DayRoute } from '../../types';
import { moveDay, reassign, unlockAll } from '../actions';
import { addTo, clear, h } from '../dom';
import { fmtHours, fmtKm, jobMap, routesOfWorker } from '../planutil';
import { getState, setState, subscribe, type AppState } from '../state';
import { notRoutedList } from './load';

type Drag = { kind: 'stop'; row: number } | { kind: 'day'; worker: number; day: number };
let drag: Drag | null = null;

const LOCK = '<svg class="lock" viewBox="0 0 12 12" width="11" height="11" aria-label="locked"><rect x="2" y="5.5" width="8" height="5.5" rx="1" fill="currentColor"/><path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';

export function mountPlan(root: HTMLElement): void {
  const openOverride = new Map<string, boolean>();
  const dayDetails = new Map<string, HTMLDetailsElement>();
  const rowDay = new Map<number, string>();

  function stopRow(s: AppState, r: DayRoute, st: DayRoute['stops'][number], draggable: boolean): HTMLElement {
    const job = jobMap(s.extracted).get(st.row);
    const a = s.assignments[st.row];
    const locked = !!(a && (a.lockedWorker || a.lockedDay));
    const el = h('div', { class: `stop${s.highlightRow === st.row ? ' hl' : ''}`, 'data-row': st.row, draggable, role: 'row', tabindex: 0, testid: 'plan-stop' },
      h('span', { class: 'n' }, String(st.seq)),
      h('span', { class: 'lbl', title: job?.label }, job?.label || `Row ${st.row + 2}`),
      locked ? h('span', { class: 'lockbadge', title: 'Locked by hand' }) : h('span'),
      h('span', { class: 'km' }, st.legKm.toFixed(2)),
      h('span', { class: 'km' }, st.cumKm.toFixed(2)),
    );
    if (locked) (el.children[2] as HTMLElement).innerHTML = LOCK;
    const select = () => setState({ highlightRow: st.row });
    el.addEventListener('click', select);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(); } });
    if (draggable) {
      el.addEventListener('dragstart', (e) => {
        drag = { kind: 'stop', row: st.row };
        e.dataTransfer?.setData('text/plain', String(st.row));
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
        el.classList.add('dragging');
      });
      el.addEventListener('dragend', () => { drag = null; el.classList.remove('dragging'); });
    }
    if (r.day !== null) makeDrop(el, r.worker, r.day);
    return el;
  }

  function makeDrop(el: HTMLElement, worker: number, day: number | null): void {
    const ok = () => !!drag && (drag.kind === 'stop' || (day !== null && drag.worker === worker && drag.day !== day));
    el.addEventListener('dragover', (e) => {
      if (!ok()) return;
      e.preventDefault();
      el.classList.add('drop-ok');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drop-ok'));
    el.addEventListener('drop', (e) => {
      el.classList.remove('drop-ok');
      const d = drag;
      if (!d || !ok()) return;
      drag = null;
      e.preventDefault();
      e.stopPropagation();
      if (d.kind === 'stop') void reassign([d.row], worker, day);
      else if (day !== null) void moveDay(worker, d.day, day);
    });
  }

  function dayTotals(r: DayRoute): string {
    const parts = [`${r.stops.length} job${r.stops.length === 1 ? '' : 's'}`, fmtKm(r.totalKm)];
    if (r.hours !== undefined) parts.push(fmtHours(r.hours));
    return parts.join(' · ');
  }

  function render(s: AppState): void {
    clear(root);
    dayDetails.clear();
    rowDay.clear();
    const plan = s.plan;
    const simple = s.settings.simpleMode;
    const locks = Object.values(s.assignments).filter((a) => a.lockedWorker || a.lockedDay).length;

    addTo(root,
      h('div', { class: 'plan-bar' },
        h('span', { class: 'muted' }, `${locks} locked job${locks === 1 ? '' : 's'}`),
        h('button', { type: 'button', class: 'btn small', testid: 'unlock-all', disabled: locks === 0, onClick: () => unlockAll() }, 'Unlock all'),
      ),
      s.planStale && plan ? h('div', { class: 'callout warn-box' }, 'Settings or data changed since this plan was built. Press Route to update it.') : null,
      ...(plan?.warnings ?? []).map((w) => h('div', { class: 'callout warn-box', role: 'alert' }, w)),
      !plan ? h('p', { class: 'muted' }, s.extracted?.jobs.length ? 'No plan yet. Press Route.' : 'Load a file first.') : null,
      !simple && plan ? h('p', { class: 'hint' }, 'Drag a stop onto another day or worker to move and lock it. Drag a day heading onto another day to reorder days.') : null,
    );

    if (plan) {
      const total = plan.routes.reduce((a, r) => a + r.stops.length, 0);
      const openDays = total <= 80;
      s.settings.workers.forEach((w, wi) => {
        const routes = routesOfWorker(plan, wi);
        if (simple && wi > 0) return;
        const jobs = routes.reduce((a, r) => a + r.stops.length, 0);
        const km = routes.reduce((a, r) => a + r.totalKm, 0);
        const before = routes.reduce((a, r) => a + r.kmBefore2opt, 0);
        const after = routes.reduce((a, r) => a + r.kmAfter2opt, 0);
        const hrs = routes.some((r) => r.hours !== undefined) ? routes.reduce((a, r) => a + (r.hours ?? 0), 0) : null;
        const wkey = `w${wi}`;
        const wd = h('details', { class: 'worker', open: openOverride.get(wkey) ?? true, testid: 'plan-worker' });
        wd.addEventListener('toggle', () => openOverride.set(wkey, wd.open));
        const sum = h('summary', null,
          h('span', { class: 'dot', style: `background:${w.color}` }),
          h('span', { class: 'wname' }, w.name),
          h('span', { class: 'tot' }, [`${jobs} job${jobs === 1 ? '' : 's'}`, fmtKm(km), hrs !== null ? fmtHours(hrs) : null].filter(Boolean).join(' · ')),
        );
        if (!simple) makeDrop(sum, wi, null);
        wd.append(sum);
        if (routes.length && before - after > 1e-9) wd.append(h('div', { class: 'sub' }, `2-opt: ${before.toFixed(1)} km before, ${after.toFixed(1)} km after`));
        if (!routes.length) wd.append(h('div', { class: 'sub muted' }, 'No jobs. Drag a stop here to give this worker work.'));

        for (const r of routes) {
          const dkey = `w${wi}d${r.day ?? 0}`;
          const dd = h('details', { class: 'day', open: openOverride.get(dkey) ?? openDays });
          const title = r.day === null ? 'All jobs' : `Day ${r.day}`;
          const dsum = h('summary', { draggable: !simple && r.day !== null, testid: 'plan-day' },
            h('span', { class: 'dname' }, title),
            h('span', { class: 'tot' }, dayTotals(r)),
          );
          if (!simple && r.day !== null) {
            dsum.addEventListener('dragstart', (e) => {
              drag = { kind: 'day', worker: wi, day: r.day as number };
              e.dataTransfer?.setData('text/plain', `day ${r.day}`);
              if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
            });
            dsum.addEventListener('dragend', () => { drag = null; });
            makeDrop(dsum, wi, r.day);
          }
          const body = h('div', { class: 'stops', role: 'table' });
          const info = h('div', { class: 'sub' },
            `Return to end: ${r.returnKm.toFixed(2)} km`,
            r.kmBefore2opt - r.kmAfter2opt > 1e-9 ? ` · 2-opt: ${r.kmBefore2opt.toFixed(2)} → ${r.kmAfter2opt.toFixed(2)} km` : null,
          );
          const head = h('div', { class: 'stop head' }, h('span', null, '#'), h('span', null, 'Job'), h('span'), h('span', { class: 'km' }, 'Leg km'), h('span', { class: 'km' }, 'Cum km'));
          let filled = false;
          const fill = () => {
            if (filled) return;
            filled = true;
            addTo(body, head, r.stops.map((st) => stopRow(s, r, st, !simple)));
          };
          for (const st of r.stops) rowDay.set(st.row, dkey);
          dd.append(dsum, info);
          if (r.note) dd.append(h('div', { class: 'sub warn', testid: 'route-note' }, r.note));
          dd.append(body);
          if (dd.open) fill();
          dd.addEventListener('toggle', () => { openOverride.set(dkey, dd.open); if (dd.open) fill(); });
          dayDetails.set(dkey, dd);
          wd.append(dd);
        }
        root.append(wd);
      });
    }
    root.append(h('div', { class: 'card' }, notRoutedList(s)));
  }

  function highlight(s: AppState): void {
    root.querySelectorAll('.stop.hl').forEach((e) => e.classList.remove('hl'));
    if (s.highlightRow === null) return;
    const key = rowDay.get(s.highlightRow);
    if (key) {
      const dd = dayDetails.get(key);
      if (dd && !dd.open) dd.open = true;
    }
    const el = root.querySelector(`.stop[data-row="${s.highlightRow}"]`);
    if (el) {
      el.classList.add('hl');
      if (s.tab === 'plan') el.scrollIntoView({ block: 'nearest' });
    }
  }

  render(getState());
  subscribe((s, prev) => {
    if (
      s.plan !== prev.plan || s.assignments !== prev.assignments || s.settings.workers !== prev.settings.workers ||
      s.settings.simpleMode !== prev.settings.simpleMode || s.extracted !== prev.extracted || s.planStale !== prev.planStale || s.mapping !== prev.mapping
    ) {
      render(s);
      highlight(s);
    } else if (s.highlightRow !== prev.highlightRow || (s.tab !== prev.tab && s.tab === 'plan')) highlight(s);
  });
}
