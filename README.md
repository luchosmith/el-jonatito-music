# El Jonatito Music

A standalone music player, extracted from the 🎧 Music feature of El Jonatito. It plays a music library in
place (for example a NAS share), with every audio file catalogued in a database. The player works just like
the original: the songs play in a random order, shown as a grid of square cover pictures in play order.

- **🎧** starts the music (a new random order); tap it again to stop.
- **Tap any song** (played ones too): it plays, and the list goes on from there. At the end of the list, a
  new random order starts.
- **Tap the big picture** to pause the song; tap it again to resume from the same spot.
- A song with no cover art gets a coloured tile with its name.
- **Even volume**: songs louder than −16 LUFS are turned down (from their measured loudness, else their
  ReplayGain tags), so no song is suddenly loud. A song that can't be played is skipped.
- **Optional sleep lock**: set `SLEEP_WINDOW=20:30-07:00` and the music sleeps at night (a 🌙 and the time
  it wakes up). The server enforces it on the audio files too.

See [docs/PLAN.md](docs/PLAN.md) for where this is going (playlists, search).

## Requirements

- Node.js ≥ 22.13 (uses the built-in `node:sqlite`; no native modules)
- `ffmpeg` and `ffprobe` on the `PATH` (metadata, cover art, loudness)

## Getting started

```sh
npm install
npm run library:scan -- /mnt/nfsserver/Media/Music   # catalogue the library (a few minutes the first time)
npm start                                           # builds the web app and serves http://localhost:8090
```

## The library

A **library folder** (a "root") is read in place and never written to. `npm run library:scan -- <folder>`
adds it the first time; `npm run library:scan` on its own rescans every folder added before. Each scan:

- adds **one row per audio file**, duplicates included (they can be sorted out later from the database);
- reads **all its metadata** with `ffprobe`: title, artist, album, album artist, track / disc numbers, year,
  genre, composer, every raw tag (as JSON), duration, container, codec, bitrate, sample rate, channels,
  bit depth and ReplayGain;
- stores **where it is**: the root + the path inside it, so a moved mount means changing one row;
- records size, modified time and a **quick fingerprint** (sha256 of the size and the first and last 64 KB):
  identical copies share it;
- notes the **cover**: a picture inside the file, or one in its folder (`cover.jpg`, `folder.jpg`, `front.jpg`
  ...; a `Disc 1` folder uses its album's). Covers are made into 300 px JPEGs the first time they are shown,
  and cached in `data/uploads/covers`;
- skips Synology's `@eaDir` / `#recycle`, hidden files (incl. macOS `._` copies) and anything that isn't audio.

Scanning again only reads new and changed files (by size and modified time). Files that are gone are
marked `missing` (and come back if they return). If the folder is empty or not there, as when the NAS isn't
mounted, the scan stops and nothing changes.

Files browsers can't play (WMA, ALAC, APE ...) are in the database but not in the player.

**Loudness**: `npm run library:loudness` measures each song (EBU R128) so the player can even out the ones
without ReplayGain tags. It decodes every file, so the first run over a big library takes hours; stop it
any time and run it again later: it goes on where it was. `npm run library:loudness -- 500` does 500.

### Uploads

The app also has its own **uploads** folder (`data/uploads/songs`): `npm run music:import -- <folder>`
copies songs into it, evened out to −16 LUFS as 192 kbps MP3s, skipping ones already there (same file name,
or the same title and artist ignoring case and accents). `npm run music:from-jonatito -- ~/el-jonatito/src/data`
copies El Jonatito's songs, covers and hidden flags into it (El Jonatito is only read).

## Scripts

| Command | What it does |
| --- | --- |
| `npm start` | Build the web app and start the server |
| `npm run dev` / `npm run dev:web` | Server with auto-restart / web build in watch mode |
| `npm run library:scan [-- <folder>]` | Add and scan a library folder / rescan all of them |
| `npm run library:loudness [-- <n>]` | Measure the loudness of songs not measured yet |
| `npm run music:import -- <folder>` | Copy a folder of songs into the uploads folder (evened out) |
| `npm run music:normalize` | Even out uploaded songs that weren't evened out on import |
| `npm run music:from-jonatito -- <data folder>` | Copy the songs from an El Jonatito data folder into uploads |
| `npm run typecheck` | TypeScript check |
| `npm test` | Unit tests, then Playwright end-to-end tests |

## Configuration (environment variables)

| Variable | Default | |
| --- | --- | --- |
| `PORT` | `8090` | HTTP port |
| `DATA_DIR` | `data` | Database, uploads and cover cache (relative to the project) |
| `DB_FILE` | `music.sqlite` | Database file name inside `DATA_DIR` |
| `SLEEP_WINDOW` | *(none)* | e.g. `20:30-07:00`: no music in that window (it may wrap midnight) |
| `TEST_MODE` | | `1` registers the `/api/test/*` controls (used by the e2e tests only) |

There is no login: it is meant for a home network.

## Database

`data/music.sqlite` (SQLite; see [server/schema.sql](server/schema.sql)): `roots` (library folders and the
uploads folder) and `songs` (a row per audio file). The schema is versioned (`PRAGMA user_version`); an older
database is upgraded when the app opens it, after a backup copy is written next to it
([server/migrate.ts](server/migrate.ts)).

Some handy queries (`sqlite3 data/music.sqlite`):

```sql
-- identical files in more than one place
SELECT quick_hash, COUNT(*) n, GROUP_CONCAT(path, ' | ') FROM songs GROUP BY quick_hash HAVING n > 1 ORDER BY n DESC;
-- the same song (title + artist), any format
SELECT lower(artist), lower(title), COUNT(*) n FROM songs GROUP BY 1, 2 HAVING n > 1 ORDER BY n DESC;
-- what's in the library, by codec
SELECT codec, COUNT(*), ROUND(SUM(size) / 1e9, 1) AS gb FROM songs WHERE missing = 0 GROUP BY codec;
```

## Layout

```
server/              node:http server, no framework
  app.ts             wiring + static file serving
  routes/songs.ts    the player's API (below)
  library.ts         library folders: scan, metadata, fingerprint, covers, loudness
  songs.ts           the uploads folder: import (names, de-duplication, cover art, evening out)
  schema.sql         the latest schema; migrate.ts upgrades older databases
shared/              types and time helpers used by both sides
web/src/             React app (bundled by esbuild: scripts/build-web.mjs)
  useMusic.ts        the one audio player: shuffle, next, pause, volume, sleep lock
  MusicView.tsx      the page: 🎧, now playing, the grid
test/                unit tests (node:test)
e2e/                 Playwright tests; fixtures: three tiny songs, and a tiny library folder
data/                runtime data, not in git: music.sqlite, uploads/songs, uploads/covers
```

## API

| | |
| --- | --- |
| `GET /api/songs` | `{ songs, locked, unlock_at }`: the playable songs (not missing, a format browsers play); hidden ones left out (`?all=1` includes them) |
| `PATCH /api/songs/:id` | `{ "hidden": true \| false }` |
| `GET /api/songs/:id/file` | the audio, from wherever it is (supports Range); `423` while the sleep lock is on |
| `GET /api/songs/:id/cover` | its cover (300 px JPEG, made the first time); `404` when it has none |
| `GET /api/health` | `{ ok: true }` |
