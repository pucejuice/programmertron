// "Road network" switch: needs an OSRM-compatible server and the user's explicit consent,
// because job coordinates are sent to that server (brief 5.8).
import { OSRM_DEMO_URL } from '../net/endpoints';
import type { Settings } from '../types';
import { updateSettings } from './actions';
import { modal } from './dialogs';
import { h } from './dom';
import { getState, notify } from './state';

export function roadOn(s: Settings): boolean {
  return !!s.roadServerUrl && s.roadServerConfirmed;
}

function hostOf(v: string): string | null {
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || (u.protocol === 'http:' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname)) ? u.host : null;
  } catch {
    return null;
  }
}

export async function openRoadDialog(): Promise<void> {
  const cur = getState().settings.roadServerUrl;
  const url = h('input', { type: 'text', value: cur, placeholder: 'Address of your OSRM server', 'aria-label': 'Road routing server URL', testid: 'road-dialog-url', spellcheck: false });
  const tick = h('input', { type: 'checkbox', testid: 'road-dialog-confirm' });
  const tickText = h('span');
  const err = h('div', { class: 'err', role: 'alert' });
  const paintTick = () => { tickText.textContent = `I understand the coordinates of my jobs will be sent to ${hostOf(url.value.trim()) ?? 'this server'}.`; };
  url.addEventListener('input', () => { tick.checked = false; err.textContent = ''; paintTick(); });
  tick.addEventListener('change', () => { err.textContent = ''; });
  const demo = h('button', { type: 'button', class: 'btn small', onClick: () => { url.value = OSRM_DEMO_URL; tick.checked = false; paintTick(); } }, 'Use the public OSRM demo server');
  paintTick();

  const body = h('div', { class: 'road-dialog' },
    h('p', null, 'Road distances and drive times come from an OSRM routing server. The app asks it for a distance table for each day, then routes on real roads.'),
    h('div', { class: 'field' }, h('label', null, 'Server URL'), url),
    h('div', { class: 'btn-row' }, demo),
    h('p', { class: 'muted' }, 'The public demo server is run by the OSRM project for light use (car profile, one request per second). For regular work use your own server.'),
    h('div', { class: 'callout warn-box' },
      h('div', null, h('strong', null, 'Warning: '), 'this sends the coordinates of your jobs to that server. Straight-line mode sends nothing.'),
      h('label', { class: 'check hit' }, tick, tickText),
    ),
    err,
  );

  const ok = await modal<boolean>('Use road network', body, [
    { label: 'Cancel', value: false },
    {
      label: 'Turn on',
      value: true,
      primary: true,
      validate: () => {
        const v = url.value.trim();
        if (!hostOf(v)) { err.textContent = 'Enter the full server address, including https and the host name.'; return false; }
        if (!tick.checked) { err.textContent = 'Tick the box to confirm before turning road routing on.'; return false; }
        return true;
      },
    },
  ], false, 'road-dialog');
  if (!ok) return;
  updateSettings({ roadServerUrl: url.value.trim().replace(/\/+$/, ''), roadServerConfirmed: true });
  notify('Road network is on. Press Route to re-plan. If the server fails you will see a warning and straight-line distances are used.', 'warn');
}
