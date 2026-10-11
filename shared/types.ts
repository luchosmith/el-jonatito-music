// Shapes shared by the server and the web app.

/** A song in the library. */
export interface Song {
  id: number;
  title: string;
  artist: string | null;
  cover_url: string | null;
  audio_url: string;
  hidden: boolean;
}
export interface SongList {
  songs: Song[];
  /** the sleep lock: no music at night (only when SLEEP_WINDOW is set) */
  locked: boolean;
  unlock_at: string | null;
}
