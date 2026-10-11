import { expect, type APIRequestContext, type Page } from '@playwright/test';

/** A fixed afternoon in the test time zone (outside the sleep window). */
export const AFTERNOON = '2026-09-23T15:40:00-04:00';

export async function resetDb(request: APIRequestContext) {
  const r = await request.post('/api/test/reset');
  expect(r.ok()).toBeTruthy();
}

/** Freezes the server clock (and optionally the browser clock) at `iso`. */
export async function setClock(request: APIRequestContext, iso: string | null, pages: Page[] = []) {
  const r = await request.post('/api/test/clock', { data: { iso } });
  expect(r.ok()).toBeTruthy();
  for (const p of pages) if (iso) await p.clock.setFixedTime(new Date(iso));
}
