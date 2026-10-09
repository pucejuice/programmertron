// Small reusable form widgets.
import { geocodeAddress, parseLatLonText, type GeocodeHit } from '../net/geocode';
import type { LatLon } from '../types';
import { fetchFn, setPickMode } from './actions';
import { clear, h } from './dom';

let uid = 0;
export const nextId = (p: string) => `${p}-${++uid}`;

export function field(label: string, control: HTMLElement, hint?: string | null): HTMLElement {
  const id = control.id || nextId('f');
  control.id = id;
  return h('div', { class: 'field' }, h('label', { for: id }, label), control, hint ? h('div', { class: 'hint' }, hint) : null);
}

export interface NumOpts {
  min?: number;
  max?: number;
  step?: number | 'any';
  integer?: boolean;
  placeholder?: string;
  label: string;
  testid?: string;
}

/** Number input that commits on change. Blank = null. Invalid input is reverted. */
export function numInput(value: number | null, onCommit: (v: number | null) => void, o: NumOpts): HTMLInputElement {
  const el = h('input', {
    type: 'number',
    value: value === null ? '' : String(value),
    min: o.min,
    max: o.max,
    step: o.step ?? (o.integer ? 1 : 'any'),
    placeholder: o.placeholder,
    'aria-label': o.label,
    testid: o.testid,
    inputmode: 'decimal',
  });
  el.addEventListener('change', () => {
    const raw = el.value.trim();
    if (raw === '') return onCommit(null);
    const n = Number(raw);
    const ok = Number.isFinite(n) && (o.min === undefined || n >= o.min) && (o.max === undefined || n <= o.max) && (!o.integer || Number.isInteger(n));
    if (!ok) {
      el.value = value === null ? '' : String(value);
      el.classList.add('invalid');
      setTimeout(() => el.classList.remove('invalid'), 1500);
      return;
    }
    onCommit(n);
  });
  return el;
}

export function checkbox(label: string, checked: boolean, onChange: (v: boolean) => void, testid?: string, disabled = false): HTMLElement {
  const input = h('input', { type: 'checkbox', checked, testid, disabled });
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'check' }, input, label);
}

export interface PointInputOpts {
  /** Shown on the "pick on map" banner. */
  pickLabel: string;
  placeholder?: string;
  /** Called with a confirmed point. `name` is the matched place name for addresses. */
  onUse: (p: LatLon, name: string, source: 'address' | 'latlon' | 'click') => void;
}

/**
 * Address / "lat, long" / pick-on-map input. Geocoding happens only when the user presses
 * Search (never while typing), and the matched name is shown for confirmation first.
 */
export function pointInput(o: PointInputOpts): HTMLElement {
  const input = h('input', { type: 'text', placeholder: o.placeholder ?? 'Address, or lat, long', 'aria-label': 'Address or lat, long', autocomplete: 'off' });
  const search = h('button', { type: 'button', class: 'btn small', testid: 'point-search' }, 'Search');
  const pick = h('button', { type: 'button', class: 'btn small' }, 'Pick on map');
  const out = h('div', { class: 'point-out', role: 'status' });

  const showHits = (hits: GeocodeHit[]) => {
    clear(out);
    if (!hits.length) {
      out.append(h('div', { class: 'muted' }, 'No match found. Try a fuller address, or type lat, long.'));
      return;
    }
    const name = nextId('hit');
    let chosen = 0;
    out.append(h('div', { class: 'muted' }, 'Is this the place you meant?'));
    hits.forEach((hit, i) => {
      const r = h('input', { type: 'radio', name, checked: i === 0 });
      r.addEventListener('change', () => { chosen = i; });
      out.append(h('label', { class: 'check hit' }, r, `${hit.name} (${hit.lat.toFixed(4)}, ${hit.lon.toFixed(4)})`));
    });
    out.append(
      h('div', { class: 'btn-row' },
        h('button', {
          type: 'button', class: 'btn primary small', testid: 'point-confirm',
          onClick: () => {
            const hit = hits[chosen];
            clear(out);
            input.value = '';
            o.onUse({ lat: hit.lat, lon: hit.lon }, hit.name, 'address');
          },
        }, 'Yes, use this place'),
        h('button', { type: 'button', class: 'btn small', onClick: () => clear(out) }, 'No'),
      ),
    );
  };

  const run = async () => {
    const q = input.value.trim();
    clear(out);
    if (!q) return;
    const ll = parseLatLonText(q);
    if (ll) {
      input.value = '';
      o.onUse(ll, `${ll.lat.toFixed(5)}, ${ll.lon.toFixed(5)}`, 'latlon');
      return;
    }
    search.disabled = true;
    out.append(h('div', { class: 'muted' }, 'Searching. The address text is sent to Nominatim (OpenStreetMap).'));
    try {
      showHits(await geocodeAddress(q, fetchFn));
    } catch (e) {
      clear(out);
      out.append(h('div', { class: 'warn' }, `Search failed: ${e instanceof Error ? e.message : String(e)}`));
    } finally {
      search.disabled = false;
    }
  };
  search.onclick = () => void run();
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void run();
    }
  });
  pick.onclick = () => setPickMode({ label: o.pickLabel, onPick: (p) => o.onUse(p, `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`, 'click') });
  return h('div', { class: 'point-input' }, h('div', { class: 'row' }, input, search, pick), out);
}
