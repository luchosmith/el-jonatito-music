-- The latest schema (a new database starts here; server/migrate.ts upgrades older ones).

-- Where songs live: a folder (e.g. a NAS share), read in place and never written to; or the app's own
-- uploads folder (songs imported with `npm run music:import`, evened out and stored in data/uploads/songs).
CREATE TABLE IF NOT EXISTS roots (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kind          TEXT NOT NULL CHECK (kind IN ('folder', 'uploads')),
  path          TEXT UNIQUE,                    -- absolute; NULL for uploads (it follows DATA_DIR)
  name          TEXT NOT NULL,
  added_at      TEXT NOT NULL,
  last_scan_at  TEXT
);

-- Every song / audio file: one row each (duplicates included), with all its metadata and where it is.
CREATE TABLE IF NOT EXISTS songs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  root_id       INTEGER NOT NULL REFERENCES roots(id),
  path          TEXT NOT NULL,                  -- relative to the root
  -- what it is (from the tags; the title falls back to the file name)
  title         TEXT NOT NULL,
  artist        TEXT,
  album         TEXT,
  album_artist  TEXT,
  track_no      INTEGER,
  track_total   INTEGER,
  disc_no       INTEGER,
  disc_total    INTEGER,
  year          INTEGER,
  genre         TEXT,
  composer      TEXT,
  tags          TEXT,                           -- every tag in the file, as JSON
  -- the audio
  duration_s    REAL,
  format        TEXT,                           -- container, e.g. flac, mp3, mov,mp4,m4a,...
  codec         TEXT,                           -- e.g. flac, mp3, aac, alac; NULL when the file could not be read
  bitrate       INTEGER,
  sample_rate   INTEGER,
  channels      INTEGER,
  bit_depth     INTEGER,
  -- loudness
  rg_track_gain REAL,                           -- ReplayGain tags (dB), when the file has them
  rg_album_gain REAL,
  loudness_lufs REAL,                           -- measured (npm run library:loudness), NULL until then
  normalized    INTEGER NOT NULL DEFAULT 0,     -- 1 = the file itself was evened out to -16 LUFS (uploads only)
  -- the file
  size          INTEGER,
  mtime         TEXT,
  quick_hash    TEXT,                           -- sha256 of size + first and last 64 KB: the same file elsewhere has the same one
  -- cover art
  embedded_cover INTEGER NOT NULL DEFAULT 0,    -- the file has a picture inside
  folder_cover  TEXT,                           -- a picture next to it (cover.jpg, folder.jpg, ...), relative to the root
  cover         TEXT,                           -- the cached 300 px JPEG in uploads/covers; '' = tried, none usable
  -- copies of the same song (server/versions.ts): the player plays the main copy of each
  version_key   TEXT,                           -- the same for every copy of a song (same artist, title, kind of recording, length)
  is_main       INTEGER NOT NULL DEFAULT 1,     -- 1 = the copy the player plays
  preferred     INTEGER NOT NULL DEFAULT 0,     -- 1 = picked by hand as the main copy
  -- bookkeeping
  source        TEXT UNIQUE,                    -- uploads: the original file name (importing again skips it)
  hidden        INTEGER NOT NULL DEFAULT 0,
  missing       INTEGER NOT NULL DEFAULT 0,     -- 1 = not found at the last scan
  added_at      TEXT NOT NULL,
  scanned_at    TEXT,
  UNIQUE (root_id, path)
);
CREATE INDEX IF NOT EXISTS songs_title ON songs(title COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS songs_artist ON songs(artist COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS songs_album ON songs(album COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS songs_quick_hash ON songs(quick_hash);
CREATE INDEX IF NOT EXISTS songs_version ON songs(version_key);

-- Genres for filtering: made from the songs' genre tags (songs.genre, left as it is) by server/genres.ts,
-- which splits tags like "Pop, Rock", merges spellings and sorts genres into families. Rebuilt after every scan.
CREATE TABLE IF NOT EXISTS genres (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL UNIQUE COLLATE NOCASE
);
CREATE TABLE IF NOT EXISTS song_genres (
  song_id       INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  genre_id      INTEGER NOT NULL REFERENCES genres(id) ON DELETE CASCADE,
  PRIMARY KEY (song_id, genre_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS song_genres_genre ON song_genres(genre_id, song_id);
-- Which genre is a kind of which (Nu Metal -> Metal; Pop-Punk -> Punk and Pop): picking a genre picks those under it.
CREATE TABLE IF NOT EXISTS genre_parents (
  genre_id      INTEGER NOT NULL REFERENCES genres(id) ON DELETE CASCADE,
  parent_id     INTEGER NOT NULL REFERENCES genres(id) ON DELETE CASCADE,
  PRIMARY KEY (genre_id, parent_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS genre_parents_parent ON genre_parents(parent_id, genre_id);
