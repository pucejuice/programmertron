import type { DayRoute } from '../../types';
import { moveDay, moveStop, reassign, unlockAll, unpinDay } from '../actions';
import { addTo, clear, h } from '../dom';
import { fmtHours, fmtKm, jobMap, routesOfWorker } from '../planutil';
import { getState, setState, subscribe, type AppState } from '../state';
import { notRoutedList } from './load';

// Drag and drop with pointer events, so it works with a finger as well as a mouse
// (HTML5 drag and drop does not fire on touch screens).
type DragItem = { kind: 'stop'; row: number; worker: number; day: number | null; index: number } | { kind: 'day'; worker: number; day: number };
type Target =
  | { kind: 'pos'; worker: number; day: number | null; index: number; el: HTMLElement; after: boolean }
  | { kind: 'day'; worker: number; day: number | null; el: HTMLElement }
  | { kind: 'worker'; worker: number; el: HTMLElement };

const GRIP = '<svg viewBox="0 0 10 16" width="10" height="16" aria-hidden="true"><g fill="currentColor"><circle cx="2.5" cy="3" r="1.4"/><circle cx="7.5" cy="3" r="1.4"/><circle cx="2.5" cy="8" r="1.4"/><circle cx="7.5" cy="8" r="1.4"/><circle cx="2.5" cy="13" r="1.4"/><circle cx="7.5" cy="13" r="1.4"/></g></svg>';
const dayAttr = (d: number | null) => (d === null ? '' : String(d));
const readDay = (v: string | undefined) => (v === undefined || v === '' ? null : Number(v));

const LOCK = '<svg class="lock" viewBox="0 0 12 12" width="11" height="11" aria-label="locked"><rect x="2" y="5.5" width="8" height="5.5" rx="1" fill="currentColor"/><path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';

export function mountPlan(root: HTMLElement): void {
  const openOverride = new Map<string, boolean>();
  const dayDetails = new Map<string, HTMLDetailsElement>();
  const rowDay = new Map<number, string>();

  function stopRow(s: AppState, r: DayRoute, st: DayRoute['stops'][number], i: number, draggable: boolean): HTMLElement {
    const job = jobMap(s.extracted).get(st.row);
    const a = s.assignments[st.row];
    const locked = !!(a && (a.lockedWorker || a.lockedDay));
    const grip = h('span', { class: 'grip', title: 'Drag to move this job', 'aria-hidden': 'true' });
    if (draggable) grip.innerHTML = GRIP;
    const el = h('div', { class: `stop${s.highlightRow === st.row ? ' hl' : ''}${draggable ? ' movable' : ''}`, 'data-row': st.row, 'data-w': r.worker, 'data-d': dayAttr(r.day), 'data-i': i, role: 'row', tabindex: 0, testid: 'plan-stop' },
      grip,
      h('span', { class: 'n' }, String(st.seq)),
      h('span', { class: 'lbl', title: job?.label }, job?.label || `Row ${st.row + 2}`),
      locked ? h('span', { class: 'lockbadge', title: 'Locked by hand' }) : h('span'),
      h('span', { class: 'km' }, st.legKm.toFixed(2)),
      h('span', { class: 'km' }, st.cumKm.toFixed(2)),
    );
    if (locked) (el.children[3] as HTMLElement).innerHTML = LOCK;
    const select = () => setState({ highlightRow: st.row });
    el.addEventListener('click', () => { if (!justDragged) select(); });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(); } });
    if (draggable) {
      const item: DragItem = { kind: 'stop', row: st.row, worker: r.worker, day: r.day, index: i };
      el.addEventListener('pointerdown', (e) => beginDrag(e, item, job?.label || `Row ${st.row + 2}`, el, e.target instanceof Element && !!e.target.closest('.grip')));
    }
    return el;
  }

  // ---------- pointer drag ----------
  let justDragged = false;

  function beginDrag(e: PointerEvent, item: DragItem, label: string, source: HTMLElement, fromGrip: boolean): void {
    if (e.button !== 0 || getState().busy) return;
    // Touch: only the grip starts a drag, so the list still scrolls with a finger.
    if (e.pointerType !== 'mouse' && !fromGrip) return;
    if (fromGrip) e.preventDefault();
    const sx = e.clientX;
    const sy = e.clientY;
    const scroller = root.closest('.panes') as HTMLElement | null;
    let started = false;
    let ghost: HTMLElement | null = null;
    let target: Target | null = null;
    let lastY = sy;
    let raf = 0;
    let hoverDay: { el: HTMLDetailsElement; since: number } | null = null;

    const clearMarks = () => root.querySelectorAll('.drop-before, .drop-after, .drop-ok').forEach((x) => x.classList.remove('drop-before', 'drop-after', 'drop-ok'));

    const find = (x: number, y: number): Target | null => {
      const hit = document.elementFromPoint(x, y);
      if (!hit || !root.contains(hit)) return null;
      const row = hit.closest('.stop[data-row]') as HTMLElement | null;
      if (row) {
        const w = Number(row.dataset.w);
        const d = readDay(row.dataset.d);
        if (item.kind === 'day') return null;
        const rect = row.getBoundingClientRect();
        const after = y > rect.top + rect.height / 2;
        let index = Number(row.dataset.i) + (after ? 1 : 0);
        if (item.worker === w && item.day === d && item.index < index) index -= 1;
        return { kind: 'pos', worker: w, day: d, index, el: row, after };
      }
      const end = hit.closest('[data-drop="end"]') as HTMLElement | null;
      if (end && item.kind === 'stop') {
        const w = Number(end.dataset.w);
        const d = readDay(end.dataset.d);
        let index = Number(end.dataset.n);
        if (item.worker === w && item.day === d) index -= 1;
        const last = end.querySelector('.stop[data-row]:last-of-type') as HTMLElement | null;
        return last ? { kind: 'pos', worker: w, day: d, index, el: last, after: true } : { kind: 'day', worker: w, day: d, el: end };
      }
      const daySum = hit.closest('[data-drop="day"]') as HTMLElement | null;
      if (daySum) {
        const w = Number(daySum.dataset.w);
        const d = readDay(daySum.dataset.d);
        if (item.kind === 'day') return w === item.worker && d !== null && d !== item.day ? { kind: 'day', worker: w, day: d, el: daySum } : null;
        return w === item.worker && d === item.day ? null : { kind: 'day', worker: w, day: d, el: daySum };
      }
      const wSum = hit.closest('[data-drop="worker"]') as HTMLElement | null;
      if (wSum && item.kind === 'stop') {
        const w = Number(wSum.dataset.w);
        return w === item.worker ? null : { kind: 'worker', worker: w, el: wSum };
      }
      return null;
    };

    const tick = () => {
      if (!started) return;
      if (scroller) {
        const r = scroller.getBoundingClientRect();
        const edge = 48;
        if (lastY < r.top + edge) scroller.scrollTop -= Math.ceil((r.top + edge - lastY) / 4);
        else if (lastY > r.bottom - edge) scroller.scrollTop += Math.ceil((lastY - (r.bottom - edge)) / 4);
      }
      if (hoverDay && !hoverDay.el.open && performance.now() - hoverDay.since > 600) hoverDay.el.open = true;
      raf = requestAnimationFrame(tick);
    };

    const move = (ev: PointerEvent) => {
      if (!started) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
        started = true;
        ghost = h('div', { class: 'drag-ghost', 'aria-hidden': 'true' }, item.kind === 'stop' ? label : `Day ${item.day}`);
        document.body.append(ghost);
        source.classList.add('dragging');
        document.body.classList.add('dragging-now');
        raf = requestAnimationFrame(tick);
      }
      ev.preventDefault();
      lastY = ev.clientY;
      ghost!.style.transform = `translate(${ev.clientX + 12}px, ${ev.clientY + 10}px)`;
      clearMarks();
      target = find(ev.clientX, ev.clientY);
      if (target) {
        if (target.kind === 'pos') target.el.classList.add(target.after ? 'drop-after' : 'drop-before');
        else target.el.classList.add('drop-ok');
      }
      const sum = target && target.kind === 'day' ? (target.el.closest('details.day') as HTMLDetailsElement | null) : null;
      if (sum !== hoverDay?.el) hoverDay = sum ? { el: sum, since: performance.now() } : null;
    };

    const finish = (apply: boolean) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', esc, true);
      cancelAnimationFrame(raf);
      clearMarks();
      ghost?.remove();
      source.classList.remove('dragging');
      document.body.classList.remove('dragging-now');
      if (!started) return;
      justDragged = true;
      setTimeout(() => { justDragged = false; }, 0);
      const t = target;
      if (!apply || !t) return;
      if (item.kind === 'day') {
        if (t.kind === 'day' && t.day !== null) void moveDay(item.worker, item.day, t.day);
        return;
      }
      if (t.kind === 'pos') void moveStop(item.row, t.worker, t.day, t.index);
      else if (t.kind === 'day') void moveStop(item.row, t.worker, t.day, null);
      else void reassign([item.row], t.worker);
    };
    const up = () => finish(true);
    const cancel = () => finish(false);
    const esc = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { ev.stopPropagation(); finish(false); } };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', esc, true);
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
      !simple && plan ? h('p', { class: 'hint' }, 'Drag a job by its grip: drop it between two stops to put it exactly there (that day keeps your order), or on a day or worker heading to let the router fit it in. On the map, drag a job onto another day\u2019s route. Drag a day heading onto another day to reorder days.') : null,
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
        const sum = h('summary', simple ? null : { 'data-drop': 'worker', 'data-w': wi },
          h('span', { class: 'dot', style: `background:${w.color}` }),
          h('span', { class: 'wname' }, w.name),
          h('span', { class: 'tot' }, [`${jobs} job${jobs === 1 ? '' : 's'}`, fmtKm(km), hrs !== null ? fmtHours(hrs) : null].filter(Boolean).join(' · ')),
        );
        wd.append(sum);
        if (routes.length && before - after > 1e-9) wd.append(h('div', { class: 'sub' }, `2-opt: ${before.toFixed(1)} km before, ${after.toFixed(1)} km after`));
        if (!routes.length) wd.append(h('div', { class: 'sub muted' }, 'No jobs. Drag a stop here to give this worker work.'));

        for (const r of routes) {
          const dkey = `w${wi}d${r.day ?? 0}`;
          const dd = h('details', { class: 'day', open: openOverride.get(dkey) ?? openDays });
          const title = r.day === null ? 'All jobs' : `Day ${r.day}`;
          const pinned = r.stops.some((st) => s.pins[st.row] !== undefined);
          const dgrip = h('span', { class: 'grip', title: 'Drag onto another day to reorder days', 'aria-hidden': 'true' });
          const dayDraggable = !simple && r.day !== null && routes.length > 1;
          if (dayDraggable) dgrip.innerHTML = GRIP;
          const dsum = h('summary', simple ? { testid: 'plan-day' } : { testid: 'plan-day', 'data-drop': 'day', 'data-w': wi, 'data-d': dayAttr(r.day) },
            dgrip,
            h('span', { class: 'dname' }, title),
            pinned ? h('span', { class: 'chip', title: 'You set the order of this day by hand' }, 'Manual order') : null,
            h('span', { class: 'tot' }, dayTotals(r)),
          );
          if (dayDraggable) {
            const item: DragItem = { kind: 'day', worker: wi, day: r.day as number };
            dgrip.addEventListener('click', (e) => e.preventDefault());
            dsum.addEventListener('pointerdown', (e) => beginDrag(e, item, title, dsum, e.target instanceof Element && !!e.target.closest('.grip')));
          }
          const body = h('div', simple ? { class: 'stops', role: 'table' } : { class: 'stops', role: 'table', 'data-drop': 'end', 'data-w': wi, 'data-d': dayAttr(r.day), 'data-n': r.stops.length });
          const info = h('div', { class: 'sub' },
            `Return to end: ${r.returnKm.toFixed(2)} km`,
            r.kmBefore2opt - r.kmAfter2opt > 1e-9 ? ` · 2-opt: ${r.kmBefore2opt.toFixed(2)} → ${r.kmAfter2opt.toFixed(2)} km` : null,
            pinned ? h('button', { type: 'button', class: 'btn small reopt', testid: 'reoptimise', onClick: () => void unpinDay(wi, r.day) }, 'Re-optimise this day') : null,
          );
          const head = h('div', { class: 'stop head' }, h('span'), h('span', null, '#'), h('span', null, 'Job'), h('span'), h('span', { class: 'km' }, 'Leg km'), h('span', { class: 'km' }, 'Cum km'));
          let filled = false;
          const fill = () => {
            if (filled) return;
            filled = true;
            addTo(body, head, r.stops.map((st, i) => stopRow(s, r, st, i, !simple)));
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
      s.plan !== prev.plan || s.assignments !== prev.assignments || s.pins !== prev.pins || s.settings.workers !== prev.settings.workers ||
      s.settings.simpleMode !== prev.settings.simpleMode || s.extracted !== prev.extracted || s.planStale !== prev.planStale || s.mapping !== prev.mapping
    ) {
      render(s);
      highlight(s);
    } else if (s.highlightRow !== prev.highlightRow || (s.tab !== prev.tab && s.tab === 'plan')) highlight(s);
  });
}
