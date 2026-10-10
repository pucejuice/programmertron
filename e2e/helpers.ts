import { expect, type Page, type BrowserContext } from '@playwright/test';

export const OVERPASS = 'https://overpass-api.de/api/interpreter';
const FAKE_TOWN = {
  elements: [{ type: 'node', lat: -27.4, lon: 152.9, tags: { place: 'town', name: 'Testville' } }],
};

export interface Seen {
  url: string;
  method: string;
  host: string;
  body: string;
}

export const isLocal = (host: string) => host === 'localhost' || host === '127.0.0.1';

/** Block everything non-local, mock Overpass, record every outbound request. */
export async function lockdown(context: BrowserContext): Promise<Seen[]> {
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
export async function selectNoBasemap(page: Page) {
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

export async function route(page: Page) {
  await page.locator('[data-testid=route-btn]').click();
  await page.locator('[data-testid=busy]').waitFor({ state: 'hidden' });
}

/** Minimal RFC 4180 parser (quotes, doubled quotes, CRLF). */
export function parseCsv(text: string): string[][] {
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

export async function exportCsv(page: Page): Promise<string[][]> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('[data-testid=export-csv]').click(),
  ]);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return parseCsv(Buffer.concat(chunks).toString('utf8'));
}

export const APPENDED = ['WORKER', 'DAY', 'SEQ', 'LEG_KM', 'CUM_KM', 'DIST_MODE', 'LOCKED', 'ROUTE_NOTE'];

export function assertOnlyOverpassOutbound(seen: Seen[]) {
  const outbound = seen.filter((s) => !isLocal(s.host));
  for (const s of outbound) expect(s.host, `unexpected outbound request ${s.url}`).toBe('overpass-api.de');
  return outbound;
}
