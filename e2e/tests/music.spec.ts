// 🎧 Music: the songs in a random order, as square pictures in play order; 🎧 starts and stops them;
// the big picture pauses; at night (SLEEP_WINDOW) the music is sleeping.
import { expect, test, type Page } from '@playwright/test';
import { AFTERNOON, resetDb, setClock } from './helpers.ts';

test.beforeEach(async ({ request, page }) => {
  await resetDb(request);
  await setClock(request, AFTERNOON, [page]);
  expect(await (await request.post('/api/test/songs')).json()).toEqual({ added: 3, skipped: 0 });
});

const nowPlaying = (page: Page) => page.getByTestId('music-now').getAttribute('data-song');
const order = async (page: Page) => page.getByTestId('music-song').evaluateAll((els) => els.map((e) => e.getAttribute('data-song')));

test('🎧 plays the songs in a random order; the page shows them in play order; a tap plays from there; it goes on by itself', async ({ page }) => {
  await page.goto('/');
  const firstFile = page.waitForRequest(/\/api\/songs\/\d+\/file/);
  await page.getByTestId('music-toggle').click();
  await firstFile; // the music really starts
  await expect(page.getByTestId('music-view')).toHaveAttribute('data-playing', 'yes');
  await expect(page.getByTestId('music-song')).toHaveCount(3);
  // Square tiles that never overlap (the page scrolls when there are many).
  const tiles = await page.getByTestId('music-song').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((b) => [b.x, b.y, b.width, b.height]));
  for (const [, , w, h] of tiles) expect([Math.round(w), Math.round(h)]).toEqual([104, 104]);
  const list = await order(page);
  expect(await nowPlaying(page)).toBe(list[0]);
  await expect(page.getByTestId('music-song').first()).toHaveClass(/cur/);
  // A song with cover art shows it; one without gets a coloured tile with its name.
  await expect(page.locator('[data-testid="music-song"] img')).toHaveCount(1);
  await expect(page.getByTestId('music-song').filter({ hasText: 'Short Song' })).toBeVisible();

  // Tap the second one: it plays (yellow frame); the first is not faded and can be tapped again.
  await page.getByTestId('music-song').nth(1).click();
  await expect.poll(() => nowPlaying(page)).toBe(list[1]);
  await expect(page.getByTestId('music-song').nth(1)).toHaveClass(/cur/);
  await expect(page.getByTestId('music-song').first()).toHaveCSS('opacity', '1');
  // Each test song is 2 s long: the list goes on to the third by itself.
  await expect.poll(() => nowPlaying(page), { timeout: 8000 }).toBe(list[2]);
  // A song already played: tap it, it plays again and the list goes on from there.
  await page.getByTestId('music-song').first().click();
  await expect.poll(() => nowPlaying(page)).toBe(list[0]);
  await expect(page.getByTestId('music-song').first()).toHaveClass(/cur/);
});

test('🎧 again stops the music; a hidden song is left out', async ({ page, request }) => {
  await page.goto('/');
  await page.getByTestId('music-toggle').click();
  await expect(page.getByTestId('music-view')).toHaveAttribute('data-playing', 'yes');
  await page.getByTestId('music-toggle').click();
  await expect(page.getByTestId('music-view')).toHaveAttribute('data-playing', 'no');
  await expect(page.getByTestId('music-now')).toHaveCount(0);
  // Hide a song: the next start has the other two (and ?all=1 still lists it).
  const songs = (await (await request.get('/api/songs')).json()).songs;
  expect((await request.patch(`/api/songs/${songs[0].id}`, { data: { hidden: true } })).ok()).toBeTruthy();
  expect((await (await request.get('/api/songs')).json()).songs).toHaveLength(2);
  expect((await (await request.get('/api/songs?all=1')).json()).songs).toHaveLength(3);
  await page.getByTestId('music-toggle').click();
  await expect(page.getByTestId('music-song')).toHaveCount(2);
  await expect(page.locator(`[data-testid="music-song"][data-song="${songs[0].id}"]`)).toHaveCount(0);
});

test('tapping the big picture pauses the same song, and tapping again goes on (no new song, no restart)', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('music-toggle').click();
  await expect(page.getByTestId('music-view')).toHaveAttribute('data-playing', 'yes');
  const song = await nowPlaying(page);
  const files: string[] = [];
  page.on('request', (r) => { if (/\/api\/songs\/\d+\/file/.test(r.url())) files.push(r.url()); });
  await page.getByTestId('music-now').click();
  await expect(page.getByTestId('music-now')).toHaveAttribute('data-paused', 'yes');
  await page.waitForTimeout(3000); // longer than a whole test song: had it kept playing, the next one would be on
  expect(await nowPlaying(page)).toBe(song);
  await page.getByTestId('music-now').click();
  await expect(page.getByTestId('music-now')).toHaveAttribute('data-paused', 'no');
  expect(await nowPlaying(page)).toBe(song);
  expect(files.filter((u) => u.endsWith(`/api/songs/${song}/file`)).length).toBeLessThanOrEqual(1); // not loaded again from the start
  await expect(page.getByTestId('music-view')).toHaveAttribute('data-playing', 'yes'); // still on
});

test('at night the music is sleeping: a moon and when it wakes up; the files are locked too', async ({ page, request }) => {
  await setClock(request, '2026-09-23T21:30:00-04:00', [page]);
  await page.goto('/');
  await page.getByTestId('music-toggle').click();
  await expect(page.getByTestId('music-sleeping')).toContainText('7:00');
  await expect(page.getByTestId('music-view')).toHaveAttribute('data-playing', 'no');
  const songs = (await (await request.get('/api/songs')).json()).songs;
  expect((await request.get(`/api/songs/${songs[0].id}/file`)).status()).toBe(423);
});

test('with no songs, 🎧 says how to add some', async ({ page, request }) => {
  await resetDb(request);
  await page.goto('/');
  await page.getByTestId('music-toggle').click();
  await expect(page.getByTestId('music-empty')).toBeVisible();
});
