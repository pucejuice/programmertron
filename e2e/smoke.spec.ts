import { test, expect } from '@playwright/test';
import { APPENDED, OVERPASS, assertOnlyOverpassOutbound, exportCsv, lockdown, route, selectNoBasemap } from './helpers';
import { FIXTURE_5_CSV } from '../src/sample';


test('sample data: 40 jobs route, export has 40 rows, only Overpass leaves the machine', async ({ page, context }) => {
  const seen = await lockdown(context);
  await page.goto('./');

  await selectNoBasemap(page);
  await page.locator('[data-testid=sample-btn]').click();
  await route(page);

  const summary = page.locator('[data-testid=summary]');
  await expect(summary).toContainText('Routed: 40');
  await expect(summary).toContainText('Not routed: 0');

  const rows = await exportCsv(page);
  const header = rows[0];
  expect(header.slice(-APPENDED.length)).toEqual(APPENDED);
  expect(rows.length - 1).toBe(40);
  const jobCol = header.indexOf('JOB');
  if (jobCol >= 0) {
    const ids = rows.slice(1).map((r) => r[jobCol]);
    expect(new Set(ids).size).toBe(40);
  }

  // Network: only Overpass, at most one coordinate pair per request, and no tiles.
  const outbound = assertOnlyOverpassOutbound(seen);
  expect(outbound.length, 'expected the base lookup to hit Overpass').toBeGreaterThanOrEqual(1);
  for (const s of outbound) {
    expect(s.url.startsWith(OVERPASS)).toBe(true);
    const payload = decodeURIComponent((s.url.split('?')[1] ?? '') + ' ' + s.body.replace(/\+/g, ' '));
    const pairs = payload.match(/-?\d{1,3}\.\d+\s*,\s*-?\d{1,3}\.\d+/g) ?? [];
    expect(pairs.length, `coordinate pairs in: ${payload}`).toBe(1);
  }
});

test('5-row fixture via file input, simple mode: P004 unrouted and last', async ({ page, context }) => {
  const seen = await lockdown(context);
  await page.goto('./');

  await selectNoBasemap(page);
  await page.locator('input[type=file][data-testid=file-input]').setInputFiles({
    name: 'fixture5.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(FIXTURE_5_CSV, 'utf8'),
  });
  await page.locator('[data-testid=tab-setup]').click();
  await page.locator('[data-testid=simple-mode]').check();
  await route(page);

  const summary = page.locator('[data-testid=summary]');
  await expect(summary).toContainText('Routed: 4');
  await expect(summary).toContainText('Not routed: 1');

  const rows = await exportCsv(page);
  const header = rows[0];
  expect(header.slice(-APPENDED.length)).toEqual(APPENDED);
  const data = rows.slice(1);
  expect(data.length).toBe(5);
  const prem = header.indexOf('Premise');
  expect(data.map((r) => r[prem])).toEqual(['P002', 'P001', 'P003', 'P005', 'P004']);
  expect(data[4][header.length - 1]).toBe('no location - not routed');

  assertOnlyOverpassOutbound(seen);
});
