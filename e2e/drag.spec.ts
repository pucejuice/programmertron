import { test, expect, type Locator, type Page } from '@playwright/test';
import { exportCsv, lockdown, route, selectNoBasemap } from './helpers';

/** Drag with the mouse (pointer events) from one element to a spot on another. */
async function dragTo(page: Page, from: Locator, to: Locator, where: 'top' | 'bottom' | 'center') {
  await from.scrollIntoViewIfNeeded();
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  const y = where === 'top' ? b.y + b.height * 0.2 : where === 'bottom' ? b.y + b.height * 0.8 : b.y + b.height / 2;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 8, a.y + a.height / 2 + 8, { steps: 3 });
  await page.mouse.move(b.x + b.width / 2, y, { steps: 12 });
  await page.mouse.up();
}

const stops = (page: Page, d: number) => page.locator(`.stop[data-row][data-w="0"][data-d="${d}"]`);
const labels = (page: Page, d: number) => stops(page, d).locator('.lbl').allInnerTexts();
const idle = (page: Page) => expect(page.locator('[data-testid=busy]')).toBeHidden();

test.beforeEach(async ({ page, context }) => {
  await lockdown(context);
  await page.goto('./');
  await selectNoBasemap(page);
  await page.locator('[data-testid=sample-btn]').click();
  await route(page);
});

test('plan list: reorder within a day, move between days, drop on a day heading, re-optimise, undo', async ({ page }) => {
  await page.locator('[data-testid=tab-plan]').click();

  // 1. Last stop of day 1 dragged above the first: the day keeps exactly that order.
  const d1 = await labels(page, 1);
  await dragTo(page, stops(page, 1).last().locator('.grip'), stops(page, 1).first(), 'top');
  await expect.poll(() => labels(page, 1)).toEqual([d1[d1.length - 1], ...d1.slice(0, -1)]);
  await idle(page);
  await expect(page.locator('summary[data-d="1"] .chip', { hasText: 'Manual order' })).toBeVisible();

  // 2. First stop of day 2 dropped after the last stop of day 1.
  const moved = (await labels(page, 2))[0];
  await dragTo(page, stops(page, 2).first().locator('.grip'), stops(page, 1).last(), 'bottom');
  await expect.poll(async () => (await labels(page, 1)).at(-1)).toBe(moved);
  await idle(page);

  // 3. A stop dropped on the "Day 3" heading joins day 3 (the router places it).
  const third = (await labels(page, 1))[2];
  await dragTo(page, stops(page, 1).nth(2).locator('.grip'), page.locator('summary[data-drop="day"][data-w="0"][data-d="3"]'), 'center');
  await expect.poll(() => labels(page, 3)).toContain(third);
  await idle(page);

  // 4. Re-optimise day 1: the manual-order chip goes away.
  await page.locator('summary[data-d="1"]').locator('xpath=..').locator('[data-testid=reoptimise]').click();
  await expect(page.locator('summary[data-d="1"] .chip', { hasText: 'Manual order' })).toHaveCount(0);
  await idle(page);

  // 5. Undo brings the manual order back.
  await page.locator('[data-testid=undo-btn]').click();
  await expect(page.locator('summary[data-d="1"] .chip', { hasText: 'Manual order' })).toBeVisible();

  // Every job still exported exactly once.
  const rows = await exportCsv(page);
  const ids = rows.slice(1).map((r) => r[0]);
  expect(ids.length).toBe(40);
  expect(new Set(ids).size).toBe(40);
});

test('map: drag a job marker onto another day\'s stop to move it there', async ({ page }) => {
  await page.locator('[data-testid=tab-plan]').click();
  const row = await stops(page, 1).first().getAttribute('data-row');
  const targetRow = await stops(page, 2).first().getAttribute('data-row');
  const from = page.locator(`.jr-pin[data-row="${row}"]`);
  const to = page.locator(`.jr-pin[data-row="${targetRow}"]`);
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 4, b.y + b.height / 2 + 4, { steps: 15 });
  await expect(page.locator('[data-testid=map-drag-hint]')).toContainText('day 2');
  await page.mouse.up();
  await expect(page.locator(`.stop[data-row="${row}"]`)).toHaveAttribute('data-d', '2');
  await idle(page);

  // Dropped on empty map, a marker snaps back and nothing changes.
  const before = await labels(page, 2);
  const c = (await page.locator(`.jr-pin[data-row="${targetRow}"]`).boundingBox())!;
  await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
  await page.mouse.down();
  await page.mouse.move(5, 300, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  expect(await labels(page, 2)).toEqual(before);
});
