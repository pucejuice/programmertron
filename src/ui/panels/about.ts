import { OSM_COPYRIGHT_URL } from '../../core/defaults';
import { clear, h } from '../dom';
import { clearAllData } from '../actions';
import { confirmBox } from '../dialogs';
import { getState, subscribe } from '../state';

export async function askClearAll(): Promise<void> {
  const ok = await confirmBox('Clear all data?', 'This removes the loaded jobs, your settings, the saved plan and the town cache from this browser. Plan files you saved to disk are not touched.', 'Clear all data');
  if (ok) clearAllData();
}

export function mountAbout(root: HTMLElement): void {
  const render = () => {
    const tile = getState().settings.tileUrl;
    clear(root);
    root.append(
      h('div', { class: 'card about' },
        h('h3', null, 'Your data stays in your browser'),
        h('ul', null,
          h('li', null, 'Your job file is read and processed on this computer only. There is no server, no upload, no analytics and no tracking.'),
          h('li', null, 'No job address, row or location is sent to anyone, with the four exceptions below.'),
        ),
        h('h3', null, 'What does leave this computer'),
        h('ol', null,
          h('li', null, h('strong', null, 'Map tiles. '), 'The basemap is fetched from a tile server. Each request tells that server which area of the map you are looking at (not individual jobs). Tick "No basemap" on the map to draw jobs and routes on a blank background and send no tile requests at all.'),
          h('li', null, h('strong', null, 'Nearest town. '), 'When you load a file, one single point is sent to OpenStreetMap Overpass: the average position (centroid) of all your jobs, to find the nearest town for the base. Nothing else. The answer is remembered in this browser. If it fails or you are offline, the centroid is used as the base.'),
          h('li', null, h('strong', null, 'Typed addresses. '), 'If you type an address for a base, start or end point and press Search, that text is sent to OpenStreetMap Nominatim to find it. It is only sent when you press Search, never while you type.'),
          h('li', null, h('strong', null, 'Road routing server (off by default). '), 'Only if you enter a server address in Setup and tick the confirmation box are job coordinates sent, to that server and no other.'),
        ),
        h('h3', null, 'Stored in this browser'),
        h('p', null, 'So that a refresh does not lose your work, the app keeps your loaded jobs, settings and plan in this browser\'s local storage. It never leaves this browser. Use "Clear all data" to remove it, and always do so on a shared computer.'),
        h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn danger', onClick: () => void askClearAll() }, 'Clear all data')),
        h('h3', null, 'Current map tiles'),
        tile
          ? h('p', null, 'Tile URL: ', h('code', { testid: 'about-tile-url' }, tile), ' ', h('a', { href: OSM_COPYRIGHT_URL, target: '_blank', rel: 'noopener noreferrer' }, '© OpenStreetMap contributors'))
          : h('p', null, h('code', { testid: 'about-tile-url' }, 'No basemap'), ': no tile requests are made.'),
        h('h3', null, 'Limits'),
        h('p', { class: 'muted' }, 'Distances are straight-line (haversine) unless you set a road server. Routes are a practical tour, not a proven optimum. The old-program mode reproduces the original nearest-neighbour order.'),
      ),
    );
  };
  render();
  let last = getState().settings.tileUrl;
  subscribe((s) => {
    if (s.settings.tileUrl !== last) {
      last = s.settings.tileUrl;
      render();
    }
  });
}
