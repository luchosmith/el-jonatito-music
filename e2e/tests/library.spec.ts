// A library folder (like the NAS) played in place: FLAC and MP3 straight from the folder, covers from the
// files or their folders, duplicates kept, formats browsers can't play left out of the player.
import { expect, test } from '@playwright/test';
import { AFTERNOON, resetDb, setClock } from './helpers.ts';

test.beforeEach(async ({ request, page }) => {
  await resetDb(request);
  await setClock(request, AFTERNOON, [page]);
  expect(await (await request.post('/api/test/library')).json()).toEqual({ files: 7, added: 7, updated: 0, unchanged: 0, missing: 0 });
});

test('the library plays from its folder: every playable file (the duplicate too), with covers', async ({ page, request }) => {
  const { songs } = await (await request.get('/api/songs')).json();
  // 7 files; the WMA is in the library but not in the player.
  expect(songs.map((s: { title: string }) => s.title).sort()).toEqual(['1979', 'Disc Track', 'First', 'First', 'Loose Song', 'Second']);
  expect(songs.find((s: { title: string }) => s.title === 'First').gain_db).toBe(-4); // its ReplayGain: -6 dB at -18 LUFS
  await page.goto('/');
  await page.getByTestId('music-toggle').click();
  await expect(page.getByTestId('music-song')).toHaveCount(6);
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
