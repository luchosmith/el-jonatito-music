// A library folder (like the NAS) played in place: FLAC and MP3 straight from the folder, covers from the
// files or their folders, duplicates kept, formats browsers can't play left out of the player.
import { expect, test } from '@playwright/test';
import { AFTERNOON, resetDb, setClock } from './helpers.ts';

test.beforeEach(async ({ request, page }) => {
  await resetDb(request);
  await setClock(request, AFTERNOON, [page]);
  expect(await (await request.post('/api/test/library')).json()).toEqual({ files: 7, added: 7, updated: 0, unchanged: 0, missing: 0 });
});

test('the library plays from its folder: one copy of each playable song, with covers', async ({ page, request }) => {
  const { songs } = await (await request.get('/api/songs')).json();
  // 7 files; the WMA is in the library but not in the player; "First" (also in the album's copy) plays once.
  expect(songs.map((s: { title: string }) => s.title).sort()).toEqual(['1979', 'Disc Track', 'First', 'Loose Song', 'Second']);
  expect(songs.find((s: { title: string }) => s.title === 'First').gain_db).toBe(-4); // its ReplayGain: -6 dB at -18 LUFS
  await page.goto('/');
  await page.getByTestId('music-toggle').click();
  await expect(page.getByTestId('music-song')).toHaveCount(5);
  // The album's picture (its folder), a disc folder's (its album's); the rest get a coloured tile with the name.
  await expect(page.locator('[data-testid="music-song"] img')).toHaveCount(3);
  await expect.poll(() => page.locator('[data-testid="music-song"] img').evaluateAll((els) => els.map((e) => (e as HTMLImageElement).naturalWidth))).toEqual([300, 300, 300]);
  await expect(page.getByTestId('music-song').filter({ hasText: '1979' })).toBeVisible();
  // Hovering a cover shows the song and its artist.
  await expect(page.getByRole('button', { name: 'Second, Artist A' })).toHaveAttribute('title', 'Second — Artist A');
  await expect(page.getByTestId('music-song').filter({ hasText: '1979' })).toHaveAttribute('title', '1979');
  // A FLAC straight from the folder plays.
  await page.getByRole('button', { name: 'Second, Artist A' }).click();
  await expect(page.getByTestId('music-now')).toHaveAttribute('data-song', String(songs.find((s: { title: string }) => s.title === 'Second').id));
  await expect.poll(() => page.locator('.music-bar i').evaluate((e) => parseFloat((e as HTMLElement).style.width))).toBeGreaterThan(0);
});

test('copies of a song: listed together; another can be made the main one; hiding hides them all', async ({ request }) => {
  const first = (await (await request.get('/api/songs')).json()).songs.find((s: { title: string }) => s.title === 'First');
  const versions = await (await request.get(`/api/songs/${first.id}/versions`)).json();
  expect(versions.map((v: { path: string; main: boolean }) => [v.path, v.main])).toEqual([
    ['Artist A/Album One/01 - First.flac', true], ['Artist A/Album One (copy)/01 - First.flac', false]]); // the one with a cover
  const other = versions[1].id;
  expect((await request.patch(`/api/songs/${other}`, { data: { main: true } })).ok()).toBeTruthy();
  const ids = async () => (await (await request.get('/api/songs')).json()).songs.filter((s: { title: string }) => s.title === 'First').map((s: { id: number }) => s.id);
  expect(await ids()).toEqual([other]);
  expect((await request.patch(`/api/songs/${first.id}`, { data: { hidden: true } })).ok()).toBeTruthy();
  expect(await ids()).toEqual([]);
  expect((await (await request.get(`/api/songs/${first.id}/versions`)).json()).length).toBe(2);
});
