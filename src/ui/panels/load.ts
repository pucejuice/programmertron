import { NOT_ROUTED_NOTE } from '../../io/export';
import { detectWorkerColumns } from '../../io/columns';
import { loadFile, loadSample, setLabelColumn, useWorkerColumn } from '../actions';
import { addTo, clear, h } from '../dom';
import { headerOptions } from '../dialogs';
import { getState, subscribe, type AppState } from '../state';

const MAX_LISTED = 200;

export function notRoutedList(s: AppState): HTMLElement {
  const nr = s.extracted?.notRouted ?? [];
  const labelCol = s.mapping?.label ?? 0;
  const items = nr.slice(0, MAX_LISTED).map((r) => {
    const label = String(s.table?.rows[r]?.[labelCol] ?? '').trim();
    return h('li', null, `Row ${r + 2}${label ? ` (${label})` : ''}: ${NOT_ROUTED_NOTE}`);
  });
  return h('div', { class: 'not-routed', testid: 'not-routed-list' },
    h('h3', null, `Not routed (${nr.length})`),
    nr.length === 0
      ? h('p', { class: 'muted' }, 'Every row has a valid location.')
      : h('div', null,
          h('p', { class: 'muted' }, 'These rows have a blank, non-numeric or out-of-range location (or exactly 0, 0). They are kept, listed last in every export.'),
          h('ul', null, items, nr.length > MAX_LISTED ? h('li', null, `...and ${nr.length - MAX_LISTED} more`) : null),
        ),
  );
}

export function mountLoad(root: HTMLElement): void {
  const fileInput = h('input', { type: 'file', accept: '.csv,.xlsx,.txt,.json', testid: 'file-input', id: 'file-input', 'aria-label': 'Choose a CSV or XLSX file' });
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (f) void loadFile(f).finally(() => { fileInput.value = ''; });
  });
  const picker = h('div', { class: 'card' },
    h('h3', null, 'Load jobs'),
    h('p', { class: 'muted' }, 'Choose a .csv or .xlsx file, or drop one anywhere on this page. It is read in your browser and never uploaded.'),
    h('div', { class: 'row' }, fileInput),
    h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn', testid: 'sample-btn', onClick: () => void loadSample() }, 'Try sample data')),
  );
  const dyn = h('div', { class: 'load-dyn' });
  root.append(picker, dyn);

  const render = (s: AppState) => {
    clear(dyn);
    if (!s.table || !s.mapping || !s.extracted) return;
    const m = s.mapping;
    const labelSel = h('select', { 'aria-label': 'Job label column', testid: 'label-col' }, headerOptions(s.table.headers));
    labelSel.value = String(m.label);
    labelSel.onchange = () => setLabelColumn(Number(labelSel.value));

    const nums = m.manualSeq === null ? 0 : s.extracted.jobs.filter((j) => j.manualSeq !== null).length;
    const cands = detectWorkerColumns(s.table.headers);
    let workerCard: HTMLElement | null = null;
    if (m.worker !== null) {
      workerCard = h('div', { class: 'callout' }, `Using column "${s.table.headers[m.worker]}" (col ${m.worker + 1}) for the initial worker assignment. Those jobs are locked to their worker.`);
    } else if (cands.length > 0) {
      const sel = h('select', { 'aria-label': 'Worker column', testid: 'worker-col' }, cands.map((c) => h('option', { value: String(c) }, `col ${c + 1}: ${s.table!.headers[c]}`)));
      workerCard = h('div', { class: 'callout' },
        h('strong', null, 'Worker column found. '),
        cands.length === 1 ? `Use "${s.table.headers[cands[0]]}" as the starting worker for each job?` : 'Several columns look like worker names. Which one should be used as the starting worker for each job?',
        cands.length > 1 ? sel : null,
        h('div', { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn small primary', testid: 'worker-col-use', onClick: () => useWorkerColumn(cands.length === 1 ? cands[0] : Number(sel.value)) }, 'Use it'),
          h('span', { class: 'muted' }, 'Not used unless you accept.'),
        ),
      );
    }

    addTo(dyn,
      h('div', { class: 'card' },
        h('h3', null, s.fileName || 'Loaded file'),
        h('div', { class: 'stats' },
          h('div', null, h('b', null, String(s.table.rows.length)), ' rows'),
          h('div', null, h('b', null, String(s.extracted.jobs.length)), ' routed'),
          h('div', null, h('b', null, String(s.extracted.notRouted.length)), ' not routed'),
        ),
        h('p', { class: 'muted' }, `Location columns: latitude = "${s.table.headers[m.lat]}" (col ${m.lat + 1}), longitude = "${s.table.headers[m.lon]}" (col ${m.lon + 1}).`),
        h('div', { class: 'field' }, h('label', null, 'Job label (shown on the map)'), labelSel),
        m.manualSeq !== null
          ? h('p', { class: 'muted' }, `MANUAL_SEQ column found: ${nums} job${nums === 1 ? '' : 's'} with a number keep that order within their day; the other jobs are routed around them.`)
          : null,
      ),
      workerCard,
      h('div', { class: 'card' }, notRoutedList(s)),
    );
  };

  render(getState());
  subscribe((s, prev) => {
    if (s.table !== prev.table || s.mapping !== prev.mapping || s.extracted !== prev.extracted || s.fileName !== prev.fileName) render(s);
  });
}
