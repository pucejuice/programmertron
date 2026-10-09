import './styles.css';
import './print.css';
import { cancelRoute, loadFile, redo, restore, runRoute, undo, updateSettings } from './ui/actions';
import { askClearAll, mountAbout } from './ui/panels/about';
import { exportCsv, exportXlsx, mountExport } from './ui/panels/export';
import { mountLoad } from './ui/panels/load';
import { mountPlan } from './ui/panels/plan';
import { mountSetup } from './ui/panels/setup';
import { h } from './ui/dom';
import { createMapView } from './ui/map';
import { closePrintView } from './ui/print';
import { getState, saveNow, setState, subscribe, type AppState, type TabId } from './ui/state';

const TABS: { id: TabId; label: string }[] = [
  { id: 'load', label: 'Load' },
  { id: 'setup', label: 'Setup' },
  { id: 'plan', label: 'Plan' },
  { id: 'export', label: 'Export' },
  { id: 'about', label: 'About' },
];

function summaryText(s: AppState): string {
  if (!s.table || !s.extracted) return 'No file loaded';
  return `Rows: ${s.table.rows.length} · Routed: ${s.extracted.jobs.length} · Not routed: ${s.extracted.notRouted.length}`;
}

function build(): void {
  const app = document.getElementById('app')!;
  const mapWrap = h('main', { class: 'map-wrap', 'aria-label': 'Map' });

  // ----- header (always visible) -----
  const summary = h('div', { class: 'summary', testid: 'summary', role: 'status' });
  const routeBtn = h('button', { type: 'button', class: 'btn primary', testid: 'route-btn', onClick: () => void runRoute(null) }, 'Route');
  const undoBtn = h('button', { type: 'button', class: 'btn', title: 'Undo (Ctrl+Z)', testid: 'undo-btn', onClick: undo }, 'Undo');
  const redoBtn = h('button', { type: 'button', class: 'btn', title: 'Redo (Ctrl+Y)', testid: 'redo-btn', onClick: redo }, 'Redo');
  const csvBtn = h('button', { type: 'button', class: 'btn', testid: 'export-csv', onClick: exportCsv }, 'CSV');
  const xlsxBtn = h('button', { type: 'button', class: 'btn', testid: 'export-xlsx', onClick: exportXlsx }, 'XLSX');
  const simple = h('input', { type: 'checkbox', testid: 'simple-mode' });
  simple.addEventListener('change', () => updateSettings({ simpleMode: simple.checked }));
  const stale = h('span', { class: 'chip warn', hidden: true }, 'Out of date: press Route');
  const notice = h('div', { class: 'notice', role: 'status', hidden: true, testid: 'notice' });

  const header = h('header', { class: 'panel-head' },
    h('div', { class: 'title-row' }, h('h1', null, 'Job Router'), stale),
    summary,
    h('div', { class: 'btn-row' }, routeBtn, undoBtn, redoBtn, h('span', { class: 'spacer' }), csvBtn, xlsxBtn),
    h('label', { class: 'check' }, simple, 'Simple (old program) mode'),
    notice,
  );

  // ----- tabs -----
  const tabBar = h('div', { class: 'tabs', role: 'tablist' });
  const panes = new Map<TabId, HTMLElement>();
  const tabBtns = new Map<TabId, HTMLElement>();
  for (const t of TABS) {
    const b = h('button', { type: 'button', role: 'tab', id: `tab-${t.id}`, 'aria-controls': `pane-${t.id}`, testid: `tab-${t.id}`, onClick: () => setState({ tab: t.id }) }, t.label);
    tabBtns.set(t.id, b);
    tabBar.append(b);
    panes.set(t.id, h('section', { class: 'pane', id: `pane-${t.id}`, role: 'tabpanel', 'aria-labelledby': `tab-${t.id}` }));
  }
  const paneWrap = h('div', { class: 'panes' }, [...panes.values()]);
  const footer = h('footer', { class: 'panel-foot' },
    h('button', { type: 'button', class: 'btn danger small', testid: 'clear-all', onClick: () => void askClearAll() }, 'Clear all data'),
    h('span', { class: 'muted' }, 'Everything stays in this browser.'),
  );
  const panel = h('aside', { class: 'panel', 'aria-label': 'Controls' }, header, tabBar, paneWrap, footer);

  // ----- busy overlay -----
  const busyMsg = h('div', { class: 'busy-msg' });
  const bar = h('progress', { max: 1, value: 0 });
  const busy = h('div', { class: 'busy', testid: 'busy', hidden: true, role: 'alertdialog', 'aria-label': 'Routing' },
    h('div', { class: 'busy-box' }, h('div', { class: 'spinner', 'aria-hidden': 'true' }), busyMsg, bar, h('button', { type: 'button', class: 'btn', testid: 'cancel-btn', onClick: cancelRoute }, 'Cancel')),
  );
  const drop = h('div', { class: 'drop-veil', hidden: true }, h('div', null, 'Drop a .csv or .xlsx file to load it'));

  app.append(mapWrap, panel, busy, drop);

  const mapView = createMapView(mapWrap);
  mountLoad(panes.get('load')!);
  mountSetup(panes.get('setup')!);
  mountPlan(panes.get('plan')!);
  mountExport(panes.get('export')!);
  mountAbout(panes.get('about')!);

  const paint = (s: AppState) => {
    summary.textContent = summaryText(s);
    const jobs = s.extracted?.jobs.length ?? 0;
    routeBtn.disabled = jobs === 0 || !!s.busy;
    undoBtn.disabled = s.undoCount === 0 || !!s.busy;
    redoBtn.disabled = s.redoCount === 0 || !!s.busy;
    csvBtn.disabled = xlsxBtn.disabled = !s.plan;
    simple.checked = s.settings.simpleMode;
    stale.hidden = !(s.planStale && s.plan);
    for (const [id, b] of tabBtns) {
      b.setAttribute('aria-selected', String(s.tab === id));
      b.classList.toggle('active', s.tab === id);
      panes.get(id)!.hidden = s.tab !== id;
    }
    notice.hidden = !s.notice;
    if (s.notice) {
      notice.className = `notice ${s.notice.kind}`;
      notice.replaceChildren(h('span', null, s.notice.text), h('button', { type: 'button', class: 'x', 'aria-label': 'Dismiss', onClick: () => setState({ notice: null }) }, '×'));
    }
    busy.hidden = !s.busy;
    if (s.busy) {
      busyMsg.textContent = s.busy.message;
      bar.max = Math.max(1, s.busy.total);
      bar.value = s.busy.done;
    }
  };
  paint(getState());
  subscribe((s, prev) => {
    paint(s);
    mapView.update(s, prev);
  });

  // ----- keyboard -----
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (getState().pickMode) setState({ pickMode: null });
      else if (document.getElementById('print-view')) closePrintView();
      else if (getState().selection.length) setState({ selection: [] });
      return;
    }
    const t = e.target as HTMLElement;
    if (t.closest('input:not([type=checkbox]):not([type=radio]), textarea, select, [contenteditable]')) return;
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
  });

  // ----- drag and drop of files anywhere -----
  let depth = 0;
  const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  window.addEventListener('dragenter', (e) => { if (hasFiles(e)) { depth++; drop.hidden = false; } });
  window.addEventListener('dragleave', (e) => { if (hasFiles(e) && --depth <= 0) { depth = 0; drop.hidden = true; } });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    drop.hidden = true;
    const f = e.dataTransfer?.files?.[0];
    if (f) void loadFile(f);
  });

  window.addEventListener('beforeunload', () => saveNow());
}

build();
restore();
