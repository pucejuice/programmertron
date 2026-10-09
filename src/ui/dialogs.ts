import { h } from './dom';
import { colLetter } from './planutil';

interface Button<T> {
  label: string;
  value: T;
  primary?: boolean;
  /** Return false to keep the dialog open (e.g. validation failed). */
  validate?: () => boolean;
}

/** Generic modal. Resolves with the pressed button's value, or `cancelValue` on Esc / backdrop. */
export function modal<T>(title: string, body: HTMLElement, buttons: Button<T>[], cancelValue: T, testid?: string): Promise<T> {
  return new Promise((resolve) => {
    const previous = document.activeElement as HTMLElement | null;
    const close = (v: T) => {
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      previous?.focus?.();
      resolve(v);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(cancelValue);
      }
    };
    const btnEls = buttons.map((b) =>
      h('button', {
        type: 'button',
        class: b.primary ? 'btn primary' : 'btn',
        onClick: () => {
          if (b.validate && !b.validate()) return;
          close(b.value);
        },
      }, b.label),
    );
    const overlay = h('div', { class: 'modal-backdrop', onMousedown: (e: Event) => { if (e.target === overlay) close(cancelValue); } },
      h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title, testid },
        h('h2', null, title),
        body,
        h('div', { class: 'modal-actions' }, btnEls),
      ),
    );
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(overlay);
    (btnEls.find((_, i) => buttons[i].primary) ?? btnEls[0])?.focus();
  });
}

export function confirmBox(title: string, message: string, okLabel = 'OK'): Promise<boolean> {
  return modal<boolean>(title, h('p', null, message), [
    { label: 'Cancel', value: false },
    { label: okLabel, value: true, primary: true },
  ], false);
}

/** Header list for pickers: duplicate names are told apart by column number and letter. */
export function headerOptions(headers: string[]): HTMLOptionElement[] {
  return headers.map((name, i) =>
    h('option', { value: String(i) }, `${colLetter(i)} (col ${i + 1}): ${name.trim() === '' ? '(blank header)' : name}`),
  );
}

export function chooseSheet(sheets: string[]): Promise<string | null> {
  const sel = h('select', { 'aria-label': 'Sheet', testid: 'sheet-select' }, sheets.map((s) => h('option', { value: s }, s)));
  return modal<string | null>('Choose a sheet', h('div', null, h('p', null, 'This workbook has several sheets. Which one holds the jobs?'), sel), [
    { label: 'Cancel', value: null },
    { label: 'Use this sheet', value: 'ok', primary: true },
  ], null).then((v) => (v === null ? null : sel.value));
}

/** The lat/lon were not found by name. Never guess: the user picks. */
export function chooseLatLon(headers: string[], preset: { lat: number | null; lon: number | null }): Promise<{ lat: number; lon: number } | null> {
  const latSel = h('select', { 'aria-label': 'Latitude column', testid: 'map-lat' }, headerOptions(headers));
  const lonSel = h('select', { 'aria-label': 'Longitude column', testid: 'map-lon' }, headerOptions(headers));
  latSel.insertBefore(h('option', { value: '' }, '- choose -'), latSel.firstChild);
  lonSel.insertBefore(h('option', { value: '' }, '- choose -'), lonSel.firstChild);
  latSel.value = preset.lat === null ? '' : String(preset.lat);
  lonSel.value = preset.lon === null ? '' : String(preset.lon);
  const err = h('p', { class: 'error', role: 'alert' });
  const body = h('div', { class: 'form' },
    h('p', null, 'I could not find both a latitude and a longitude column by name. Pick the two columns that hold them.'),
    h('label', null, 'Latitude column', latSel),
    h('label', null, 'Longitude column', lonSel),
    err,
  );
  return modal<string | null>('Which columns are the location?', body, [
    { label: 'Cancel', value: null },
    {
      label: 'Use these columns',
      value: 'ok',
      primary: true,
      validate: () => {
        if (latSel.value === '' || lonSel.value === '') { err.textContent = 'Choose both columns.'; return false; }
        if (latSel.value === lonSel.value) { err.textContent = 'Latitude and longitude must be different columns.'; return false; }
        return true;
      },
    },
  ], null, 'mapping-dialog').then((v) => (v === null ? null : { lat: Number(latSel.value), lon: Number(lonSel.value) }));
}
