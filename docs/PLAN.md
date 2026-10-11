# El Jonatito Music: Plan

## Where we are

### v0.1: the clone

The 🎧 Music feature of El Jonatito, extracted into its own app and working just like the original: a random
play order shown as a grid of covers, tap to play, pause/resume, an optional sleep lock (`SLEEP_WINDOW`).

Left behind on purpose (they belong to El Jonatito, not to a music player): login and roles, the tap log
("what he picked"), the orbit 🎧 badge, the "home" face button, pausing for voice notes, and stopping the
music when a film starts.

### v0.2: the library database (step 1, done)

- **A database row for every audio file** on the NAS (`/mnt/nfsserver/Media/Music`, an NFS mount): all its
  metadata (tags, every raw tag as JSON, duration, format, codec, bitrate, sample rate, channels, bit depth,
  ReplayGain), its size and modified time, a quick fingerprint, and **where it is** (a root folder + the path
  inside it). See [server/schema.sql](../server/schema.sql).
- **Duplicates are kept**, one row each, to be sorted out later from the database. Identical copies share a
  `quick_hash`; the README has queries to find them.
- **Played in place**: files are streamed from the NAS mount through the server; nothing on the NAS is ever
  written. Covers are made on first view (from the file, else its folder's `cover.jpg` etc.) and cached.
- **Incremental rescans** (`npm run library:scan`): only new or changed files are read; files that are gone
  are marked `missing`. A scan of an empty or unmounted folder stops without changing anything.
- **Even volume** without rewriting files: the player turns loud songs down using their measured loudness
  (`npm run library:loudness`, resumable, hours for the whole library) or else their ReplayGain tags.
- **Versioned schema** with migrations and automatic backups ([server/migrate.ts](../server/migrate.ts)).
  The 145 songs copied from El Jonatito are kept as the app's "uploads" folder.

## Next steps

### 2. Library management (finishing "songs over the network")

- **Rescan from the app** (a button / an API call), and maybe a scheduled rescan, instead of only the CLI.
- **Duplicates**: a way to review them (same `quick_hash`; same title + artist + similar duration) and
  choose which copy the player uses, e.g. prefer FLAC over MP3. Non-identical copies (different rips or
  encodings) could be found with an audio fingerprint (Chromaprint / `fpcalc`).
- **Formats browsers can't play** (WMA, ALAC, APE ...): transcode on the fly with ffmpeg, or leave them out
  (as now).
- **Artists and albums as their own tables** (built from the tags), so browsing and search don't depend on
  spelling; album covers shared per album.
- **Play history**: play count and last played, for "recently played" and smarter shuffles.
- **The grid** now shows thousands of songs a page at a time; with search and playlists the default view may
  become a playlist or an album list instead of the whole library.

### 3. Search

Find songs by title, artist, album, genre or year.

- SQLite FTS5 over the metadata, accent- and case-insensitive (the same idea as `songKey` in
  `server/songs.ts`: "Tuttí-Frutti" finds "tutti frutti").
- `GET /api/songs?q=…` plus a search box in the UI; results can be played directly or added to a playlist.

### 4. Playlists

Users create, name, reorder and delete playlists.

- `playlists` (id, name, cover, created / updated) and `playlist_songs` (playlist, song, position).
- The player plays a playlist in order or shuffled; "all songs" stays as the default list.
- UI: a playlist picker next to 🎧, add to playlist from the grid and from search results, drag to reorder.

### 5. Login

Not needed while the app is used at home only. Before it is reachable from outside the home network, it
needs one (El Jonatito's `server/auth.ts`, with cookies and tokens, can be reused).

## Open questions

- **Duplicates**: which copy should win by default (FLAC over MP3? the one with the most tags?), or should
  the user choose per album?
- **Clients**: will other devices play over the network (phones, other rooms), or is it still one tablet?
- **Users**: are playlists shared by everyone, or does each person have their own?
- **Kid mode**: should this app keep the simple picture-only kid view as its own mode (as in El Jonatito)
  alongside a fuller adult view with search and playlists?
