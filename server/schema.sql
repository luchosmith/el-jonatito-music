-- The song library: imported from a folder; played in a random order.
CREATE TABLE IF NOT EXISTS songs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  title         TEXT NOT NULL,
  artist        TEXT,
  file          TEXT NOT NULL,                  -- in uploads/songs
  cover         TEXT,                           -- in uploads/covers (from the file's own picture), or NULL
  source        TEXT UNIQUE,                    -- the original file name: importing again skips it
  hidden        INTEGER NOT NULL DEFAULT 0,
  normalized    INTEGER NOT NULL DEFAULT 0,     -- 1 = its loudness was evened out (all songs play at the same volume)
  added_at      TEXT NOT NULL
);
