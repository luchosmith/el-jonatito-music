# El Jonatito Music

A standalone music player, extracted from the 🎧 Music feature of El Jonatito. For now it
works just like the original: the song library plays in a random order, shown as a grid of square cover
pictures in play order.

- **🎧** starts the music (a new random order); tap it again to stop.
- **Tap any song** (played ones too): it plays, and the list goes on from there. At the end of the list, a
  new random order starts.
- **Tap the big picture** to pause the song; tap it again to resume from the same spot.
- A song with no cover art gets a coloured tile with its name.
- **Optional sleep lock**: set `SLEEP_WINDOW=20:30-07:00` and the music sleeps at night (a 🌙 and the time
  it wakes up). The server enforces it on the audio files too.

See [docs/PLAN.md](docs/PLAN.md) for where this is going (playlists, search, network-stored songs).

## Requirements

- Node.js ≥ 22.13 (uses the built-in `node:sqlite`; no native modules)
- `ffmpeg` and `ffprobe` on the `PATH` (song import: tags, cover art, loudness)

## Getting started

```sh
npm install
npm run music:import -- ~/Music/some-folder   # add songs (or see "Copying the library" below)
npm start                                     # builds the web app and serves http://localhost:8090
```

### Copying the library from El Jonatito

```sh
npm run music:from-jonatito -- ~/el-jonatito/src/data
```

This copies El Jonatito's songs (already evened out), their covers and their hidden flags into `data/`. It
only reads El Jonatito: the database is copied to a temp folder before it is opened. Run it again at any
time; songs already here are skipped.

## Scripts

| Command | What it does |
| --- | --- |
| `npm start` | Build the web app and start the server |
| `npm run dev` / `npm run dev:web` | Server with auto-restart / web build in watch mode |
| `npm run music:import -- <folder>` | Import a folder of audio files (MP3, M4A, AAC, OGG, Opus, WebM, FLAC, WAV) |
| `npm run music:normalize` | Even out the loudness of any songs that weren't evened out on import |
| `npm run music:from-jonatito -- <data folder>` | Copy the library from an El Jonatito data folder |
| `npm run typecheck` | TypeScript check |
| `npm test` | Unit tests, then Playwright end-to-end tests |

On import, every song is:
- **named** from its tags, or from its file name (track numbers and `[Explicit]` dropped; `Artist - Title` split);
- **de-duplicated**: same file name, or the same title and artist ignoring case and accents, is skipped;
- **evened out** to −16 LUFS (EBU R128, two-pass, linear) and stored as a 192 kbps MP3, so no song is suddenly loud;
- given its **embedded cover art** as a 300 px square JPEG, when it has any.

## Configuration (environment variables)

| Variable | Default | |
| --- | --- | --- |
| `PORT` | `8090` | HTTP port |
| `DATA_DIR` | `data` | Database and uploaded files (relative to the project) |
| `DB_FILE` | `music.sqlite` | Database file name inside `DATA_DIR` |
| `SLEEP_WINDOW` | *(none)* | e.g. `20:30-07:00`: no music in that window (it may wrap midnight) |
| `TEST_MODE` | | `1` registers the `/api/test/*` controls (used by the e2e tests only) |

There is no login: it is meant for a home network. (See the plan: network access will need one.)

## Layout

```
server/            node:http server, no framework
  app.ts           wiring + static file serving
  routes/songs.ts  GET /api/songs, PATCH /api/songs/:id, GET /api/songs/:id/file, GET /api/covers/:file
  songs.ts         import: tags, names, de-duplication, cover art, loudness
  schema.sql       the songs table
shared/            types and time helpers used by both sides
web/src/           React app (bundled by esbuild: scripts/build-web.mjs)
  useMusic.ts      the one audio player: shuffle, next, pause, sleep lock
  MusicView.tsx    the page: 🎧, now playing, the grid
test/              unit tests (node:test)
e2e/               Playwright tests + three tiny fixture songs
data/              runtime data, not in git: music.sqlite, uploads/songs, uploads/covers
```

## API

| | |
| --- | --- |
| `GET /api/songs` | `{ songs, locked, unlock_at }`; hidden songs left out (`?all=1` includes them) |
| `PATCH /api/songs/:id` | `{ "hidden": true \| false }` |
| `GET /api/songs/:id/file` | the audio (supports Range); `423` while the sleep lock is on |
| `GET /api/covers/:file` | a cover picture |
| `GET /api/health` | `{ ok: true }` |
