# El Jonatito Music: Plan

## Where we are (v0.1, the clone)

The 🎧 Music feature of El Jonatito, extracted into its own app and working just like the original:

- one `songs` table (title, artist, file, cover, source file name, hidden, normalized, added_at);
- songs imported from a local folder into `data/uploads/songs` (evened out to −16 LUFS, cover art extracted);
- one page: 🎧 start/stop, a random play order shown as a grid of covers, tap to play, pause/resume;
- an optional sleep lock (`SLEEP_WINDOW`), enforced on the server;
- no login; meant for a home network.

What was left behind on purpose, because it belongs to El Jonatito rather than to a music player: login and
roles, the tap log ("what he picked"), the orbit 🎧 badge, the "home" face button, pausing for voice notes,
and stopping the music when a film starts.

## Future features

### 1. A database entry for every song, with all its metadata and file location

Every song / audio file gets a row in the database holding all of its metadata and where the file lives.
This is the foundation for the other features, so it comes first.

- **Metadata**: title, artist, album, album artist, track and disc number, year, genre, duration, codec,
  bitrate, sample rate, loudness (measured LUFS), file size, a content hash (SHA-256: finds duplicates and
  moved files), cover art, and the full raw tag set (JSON) so nothing in the file is lost.
- **File location**: where the file lives (a local path, a network share or a URL) as a separate field from
  the metadata, so a file can move without its song changing. A song may also have a normalized copy for
  playback alongside its original.
- **Bookkeeping**: added / modified / last-scanned times, play count and last played (useful for search and
  playlists later).
- Likely split `artists` and `albums` into their own tables rather than free text, so search and browsing
  don't depend on spelling.
- Needs a schema-version / migration step (El Jonatito's `server/migrate.ts` is the pattern to follow), plus a
  migration for the current `songs` rows.

### 2. Songs accessed over the network

Song files won't have to be copied into `data/uploads`: the app reads them where they are, at the location
stored in the database (for example a NAS or another machine on the network).

- An importer/scanner that walks a library location, reads tags with `ffprobe`, and adds or updates the
  database entries (by content hash, so renamed or moved files aren't duplicated).
- Playback streams from the stored location through the server (`/api/songs/:id/file` keeps working, with
  Range support) so browsers never need direct access to the share.
- Decide where loudness normalization fits: a normalized copy stored next to the original, a cache, or
  on-the-fly gain (ReplayGain-style: store the measured loudness and set the volume in the player).
- Once it is reachable beyond one trusted device, it needs **a login** (El Jonatito's `server/auth.ts`, with
  cookies and tokens, can be reused).

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

## Suggested order

1. Metadata DB + migrations (the foundation for everything else).
2. The network library scanner + streaming from the stored location.
3. Search.
4. Playlists.
5. Login, before the app is opened up beyond the home network.

## Open questions

- **Network storage**: what will hold the files (a NAS share mounted on the server, SMB/NFS, an HTTP or
  object store)? This decides whether the server reads a mounted path or fetches over the network.
- **Clients**: will other devices play over the network (phones, other rooms), or is it still one tablet?
  This decides how soon login is needed.
- **Users**: are playlists shared by everyone, or does each person have their own?
- **Kid mode**: should this app keep the simple picture-only kid view as its own mode (as in El Jonatito)
  alongside a fuller adult view with search and playlists?
