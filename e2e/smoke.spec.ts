import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { FIXTURE_5_CSV } from '../src/sample';

const OVERPASS = 'https://overpass-api.de/api/interpreter';
const FAKE_TOWN = {
  elements: [{ type: 'node', lat: -27.4, lon: 152.9, tags: { place: 'town', name: 'Testville' } }],
};

interface Seen {
  url: string;
  method: string;
  host: string;
  body: string;
}

const isLocal = (host: string) => host === 'localhost' || host === '127.0.0.1';

/** Block everything non-local, mock Overpass, record every outbound request. */
async function lockdown(context: BrowserContext): Promise<Seen[]> {
  const seen: Seen[] = [];
  await context.route('**/*', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (u.protocol === 'data:' || u.protocol === 'blob:') return route.continue();
    seen.push({ url: req.url(), method: req.method(), host: u.hostname, body: req.postData() ?? '' });
    if (isLocal(u.hostname)) return route.continue();
    if (u.hostname === 'overpass-api.de') {
      if (req.method() === 'OPTIONS') {
        return route.fulfill({
          status: 204,
          headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' },
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify(FAKE_TOWN),
      });
    }
    return route.abort();
  });
  return seen;
}

/** [data-testid=no-basemap] may be a checkbox or an <option> of a select. */
async function selectNoBasemap(page: Page) {
  const el = page.locator('[data-testid=no-basemap]');
  await expect(el).toHaveCount(1);
  const tag = await el.evaluate((n) => n.tagName.toLowerCase());
  if (tag === 'option') {
    const value = await el.evaluate((n) => (n as HTMLOptionElement).value);
    await el.locator('xpath=ancestor::select[1]').selectOption(value);
  } else if (tag === 'input') {
    const type = await el.evaluate((n) => (n as HTMLInputElement).type);
    if (type === 'radio' || type === 'checkbox') await el.check();
    else await el.click();
  } else {
    await el.click();
  }
}

async function route(page: Page) {
  await page.locator('[data-testid=route-btn]').click();
  await page.locator('[data-testid=busy]').waitFor({ state: 'hidden' });
}

/** Minimal RFC 4180 parser (quotes, doubled quotes, CRLF). */
function parseCsv(text: string): string[][] {
  const t = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"') {
        if (t[i + 1] === '"') { cell += '"'; i++; } else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

async function exportCsv(page: Page): Promise<string[][]> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('[data-testid=export-csv]').click(),
  ]);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return parseCsv(Buffer.concat(chunks).toString('utf8'));
}

const APPENDED = ['WORKER', 'DAY', 'SEQ', 'LEG_KM', 'CUM_KM', 'DIST_MODE', 'LOCKED', 'ROUTE_NOTE'];

function assertOnlyOverpassOutbound(seen: Seen[]) {
  const outbound = seen.filter((s) => !isLocal(s.host));
  for (const s of outbound) expect(s.host, `unexpected outbound request ${s.url}`).toBe('overpass-api.de');
  return outbound;
}

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
