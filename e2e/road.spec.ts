import { test, expect } from '@playwright/test';
import { exportCsv, lockdown, route, selectNoBasemap } from './helpers';

const R = 6371000;
const hav = (a: number[], b: number[]) => {
  const r = Math.PI / 180;
  const d = Math.sin(((b[1] - a[1]) * r) / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(((b[0] - a[0]) * r) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(d));
};

test('road network: consent dialog, road distances, road paths drawn on the map', async ({ page, context }) => {
  const seen = await lockdown(context);
  let tables = 0;
  let routes = 0;
  // Fake OSRM server (registered after lockdown, so it takes precedence for this host).
  await context.route('https://router.project-osrm.org/**', async (r) => {
    const u = new URL(r.request().url());
    const coords = u.pathname.split('/').pop()!.split(';').map((c) => c.split(',').map(Number));
    const headers = { 'access-control-allow-origin': '*' };
    if (u.pathname.includes('/table/')) {
      tables++;
      const dist = coords.map((a) => coords.map((b) => hav(a, b) * 1.3));
      return r.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify({ code: 'Ok', distances: dist, durations: dist.map((row) => row.map((m) => m / 22)) }) });
    }
    routes++;
    // A wiggly path: three extra points between every pair of stops.
    const path: number[][] = [];
    for (let i = 0; i < coords.length - 1; i++) {
      const [a, b] = [coords[i], coords[i + 1]];
      for (let k = 0; k < 4; k++) path.push([a[0] + ((b[0] - a[0]) * k) / 4 + (k % 2) * 0.01, a[1] + ((b[1] - a[1]) * k) / 4]);
    }
    path.push(coords[coords.length - 1]);
    return r.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify({ code: 'Ok', routes: [{ geometry: { type: 'LineString', coordinates: path } }] }) });
  });

  await page.goto('./');
  await selectNoBasemap(page);
  await page.locator('[data-testid=sample-btn]').click();
  await route(page);
  const vertices = () => page.locator('path.leaflet-interactive[stroke-linejoin]').evaluateAll((els) =>
    els.map((e) => (e.getAttribute('d') ?? '').split(/[ML]/).length - 1).reduce((a, b) => a + b, 0),
  );
  const straight = await vertices();
  expect(tables + routes).toBe(0);

  // Road network needs the tick box.
  await page.locator('[data-testid=dist-road]').click();
  await page.getByRole('button', { name: 'Use the public OSRM demo server' }).click();
  await page.getByRole('button', { name: 'Turn on' }).click();
  await expect(page.locator('[data-testid=road-dialog]')).toBeVisible();
  expect(tables + routes).toBe(0);
  await page.locator('[data-testid=road-dialog-confirm]').check();
  await page.getByRole('button', { name: 'Turn on' }).click();
  await expect(page.locator('[data-testid=dist-road]')).toHaveAttribute('aria-pressed', 'true');

  await route(page);
  expect(tables).toBeGreaterThan(0);
  // Road paths load one route at a time; the drawn lines gain the extra road points.
  await expect(page.locator('[data-testid=road-paths-status]')).toBeHidden({ timeout: 20000 });
  await expect.poll(vertices, { timeout: 20000 }).toBeGreaterThan(straight * 2);
  expect(routes).toBeGreaterThan(0);

  const rows = await exportCsv(page);
  const mode = rows[0].indexOf('DIST_MODE');
  expect(new Set(rows.slice(1).map((r) => r[mode]))).toEqual(new Set(['road']));

  // Back to straight line: nothing more is sent to the road server.
  await page.locator('[data-testid=dist-straight]').click();
  const before = tables + routes;
  await route(page);
  expect(tables + routes).toBe(before);
  const hosts = new Set(seen.map((s) => s.host).filter((h) => h !== '127.0.0.1' && h !== 'localhost'));
  for (const h of hosts) expect(['overpass-api.de', 'router.project-osrm.org']).toContain(h);
});
