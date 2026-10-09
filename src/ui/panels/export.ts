import { buildExportTable, toCsv, toXlsx } from '../../io/export';
import { loadFile, savePlanFile } from '../actions';
import { addTo, clear, downloadBlob, h } from '../dom';
import { baseName } from '../planutil';
import { openPrintView } from '../print';
import { getState, notify, subscribe, type AppState } from '../state';
import { field } from '../widgets';

export function exportCsv(): void {
  const s = getState();
  if (!s.table || !s.plan) return notify('Press Route first: exports include the routing columns.', 'warn');
  try {
    const text = toCsv(buildExportTable(s.table, s.plan, s.settings));
    downloadBlob(new Blob([text], { type: 'text/csv;charset=utf-8' }), `${baseName(s.fileName)}-routed.csv`);
  } catch (e) {
    notify(`CSV export failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
  }
}

export function exportXlsx(): void {
  const s = getState();
  if (!s.table || !s.plan) return notify('Press Route first: exports include the routing columns.', 'warn');
  try {
    const buf = toXlsx(s.table, s.plan, s.settings);
    downloadBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${baseName(s.fileName)}-routed.xlsx`);
  } catch (e) {
    notify(`XLSX export failed: ${e instanceof Error ? e.message : String(e)}`, 'error');
  }
}

export function mountExport(root: HTMLElement): void {
  const render = (s: AppState) => {
    clear(root);
    const has = !!s.plan;
    const workerSel = h('select', { 'aria-label': 'Worker for run sheets', testid: 'sheet-worker' },
      h('option', { value: 'all' }, 'All workers'),
      s.settings.workers.map((w, i) => h('option', { value: String(i) }, w.name)),
    );
    const colBoxes = (s.table?.headers ?? []).map((name, i) => {
      const c = h('input', { type: 'checkbox', value: String(i) });
      return h('label', { class: 'check' }, c, `${name || '(blank)'} (col ${i + 1})`);
    });
    const colList = h('details', null, h('summary', null, 'Extra columns on the run sheet'), h('div', { class: 'checklist' }, colBoxes));
    const planInput = h('input', { type: 'file', accept: '.json', 'aria-label': 'Open a plan file', testid: 'planfile-input' });
    planInput.addEventListener('change', () => {
      const f = planInput.files?.[0];
      if (f) void loadFile(f).finally(() => { planInput.value = ''; });
    });
    addTo(root,
      s.planStale && has ? h('div', { class: 'callout warn-box' }, 'The plan is out of date with the settings. Press Route first if you want the exports to match.') : null,
      h('div', { class: 'card' },
        h('h3', null, 'Spreadsheet'),
        h('p', { class: 'muted' }, 'Every input column is kept, in order, then WORKER, DAY, SEQ, LEG_KM, CUM_KM, DIST_MODE, LOCKED, ROUTE_NOTE. Not-routed rows come last. The XLSX has an "All jobs" sheet and one sheet per worker.'),
        h('div', { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn', disabled: !has, onClick: exportCsv }, 'Download CSV'),
          h('button', { type: 'button', class: 'btn', disabled: !has, onClick: exportXlsx }, 'Download XLSX'),
        ),
        has ? null : h('p', { class: 'muted' }, 'Route first.'),
      ),
      h('div', { class: 'card' },
        h('h3', null, 'Run sheets'),
        h('p', { class: 'muted' }, 'One A4 page per worker per day: a table of stops, the day totals and a small route sketch. Open the preview, then Print.'),
        field('For', workerSel),
        colList,
        h('div', { class: 'btn-row' },
          h('button', {
            type: 'button', class: 'btn primary', disabled: !has, testid: 'open-sheets',
            onClick: () => {
              const extra = [...colList.querySelectorAll<HTMLInputElement>('input:checked')].map((i) => Number(i.value));
              openPrintView({ worker: workerSel.value === 'all' ? 'all' : Number(workerSel.value), extraCols: extra });
            },
          }, 'Open run sheets'),
        ),
      ),
      h('div', { class: 'card' },
        h('h3', null, 'Plan file'),
        h('p', { class: 'muted' }, 'Saves the job rows, settings, assignments and locks to a .json file on your disk. Nothing is uploaded.'),
        h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn', disabled: !s.table, testid: 'save-plan', onClick: savePlanFile }, 'Save plan file')),
        field('Open a plan file', planInput),
      ),
    );
  };
  render(getState());
  subscribe((s, prev) => {
    if (s.plan !== prev.plan || s.table !== prev.table || s.settings.workers !== prev.settings.workers || s.planStale !== prev.planStale) render(s);
  });
}
