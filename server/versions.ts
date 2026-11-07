// Copies of the same song: the library has many (Elvis's "Don't Be Cruel" 30 times: albums, compilations, box
// sets). Copies are grouped (songs.version_key) and one of each group is the main copy (songs.is_main), the one
// the player plays; the others stay in the library. Rebuilt after every scan, like the genres.
//
// The same song = the same main artist and title, once the noise is taken out of the title ("(Remastered 2009)",
// "[Explicit]", "- Mono"), and about the same length. Live versions, remixes, demos, takes ... are songs of
// their own; a live recording is one per album (each live album is another performance).
import type { Db } from './db.ts';
import { songKey } from './songs.ts';

/** A bracket or " - ..." part of a title that says nothing about the recording: left out when comparing. */
const NOISE = /^(\d{4}\s*)?(digital(ly)?\s*)?remaster(ed)?(\s*\d{4})?(\s*version)?$|^(\d{4}\s*)?(re-?)?master(ed)?(\s*\d{4})?$|^(mono|stereo)(\s*version)?$|^explicit|^clean|^bonus(\s*track)?$|^(album|single|lp|original|45|7"?|7 inch)\s*version$|^((radio|single|album)\s*)?edit$|^original\s*mix$|^deluxe|^\d{4}$|^(feat|ft|featuring|with)\b/;

/** A part of a title that marks another recording: kept, so it is a song of its own. */
const VARIANT = /\b(live|en vivo|ao vivo|unplugged|in concert|remix(ed)?|rmx|mix|dub|demo|take|alternate|alt\.?|outtake|rehearsal|session|acoustic|acustic[oa]|instrumental|karaoke|a cappella|reprise|extended|version|versión|cover)\b/;

/** An album that is a live recording ("Elvis: Live in Las Vegas", "MTV Unplugged", "En Vivo"). */
const LIVE_ALBUM = /\b(live|en vivo|ao vivo|unplugged|in concert)\b/;

/** Copies further apart than this (seconds) are other recordings (an extended version, a different take). */
const SAME_LENGTH_S = 10;

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/**
 * "The Beatles feat. X" -> "beatles": the main artist, without "The" and guests. Not split on "," or "&":
 * those are in band names (Earth, Wind & Fire; Simon & Garfunkel).
 */
export function artistKey(artist: string | null): string {
  if (!artist) return '';
  const main = fold(artist).split(/\s+(?:feat\.?|ft\.?|featuring|with|vs\.?)\s+|\s*[([](?:feat|ft)\b/)[0];
  return songKey(main.replace(/^the\s+/, ''));
}

/**
 * A title without its noise, and what makes it another recording: "Hound Dog (2012 Remaster)" -> { base: hounddog,
 * variant: '' }; "Hound Dog (Live)" -> variant "live"; any other bracket stays part of the title.
 */
export function titleKey(title: string, album: string | null): { base: string; variant: string } {
  const variants: string[] = [];
  let base = fold(title);
  // Bracketed parts: (…) and […]
  base = base.replace(/\s*[([]([^)\]]*)[)\]]/g, (whole, inner: string) => {
    const q = inner.trim();
    if (NOISE.test(q)) return '';
    if (VARIANT.test(q)) {
      variants.push(songKey(q));
      return '';
    }
    return whole; // something else ("(Love Theme)"): part of the title
  });
  // A " - …" ending ("Song - 2012 Remaster", "Song - Live at Wembley")
  const dash = /\s+-\s+([^-]+)$/.exec(base);
  if (dash) {
    const q = dash[1].trim();
    if (NOISE.test(q)) base = base.slice(0, dash.index);
    else if (VARIANT.test(q)) {
      variants.push(songKey(q));
      base = base.slice(0, dash.index);
    }
  }
  // Live: each album is another performance (Madison Square Garden 1972 is not Las Vegas 1975).
  const live = variants.some((v) => /live|vivo|unplugged|concert/.test(v)) || (!!album && LIVE_ALBUM.test(fold(album)));
  if (live) variants.push(`live:${songKey(album ?? '')}`);
  return { base: songKey(base), variant: variants.sort().join('+') };
}

interface Copy {
  id: number; title: string; artist: string | null; album: string | null; album_artist: string | null; year: number | null;
  duration_s: number | null; codec: string | null; bitrate: number | null; sample_rate: number | null; bit_depth: number | null;
  tags: string | null; missing: number; hidden: number;
  preferred: number; cover: string | null; embedded_cover: number; folder_cover: string | null; kind: string;
}

const LOSSLESS = ['flac', 'alac', 'wavpack', 'ape'];
const isLossless = (c: Copy) => LOSSLESS.includes(c.codec ?? '') || (c.codec ?? '').startsWith('pcm_');
const COMPILATION_ALBUM = /greatest hits|best of|the very best|\bhits\b|collection|anthology|essential|\bgold\b|platinum|ultimate|definitive|the complete|masters|box set|\bnow\b.*\bmusic\b|compilation|grandes exitos|lo mejor|exitos/;
function isCompilation(c: Copy): boolean {
  if (c.album_artist && /^(various( artists)?|va|varios( artistas)?)$/i.test(c.album_artist.trim())) return true;
  if (c.tags && /"(compilation|tcmp)"\s*:\s*"1"/i.test(c.tags)) return true;
  return !!c.album && COMPILATION_ALBUM.test(fold(c.album));
}

/**
 * How good the sound is, comparable within lossless or within lossy: for lossless the resolution (24-bit/96 kHz
 * over 16-bit/44.1 kHz; a FLAC's bitrate only says how well it compressed), for lossy the bitrate in 64 kbps steps.
 */
const quality = (c: Copy) => (isLossless(c) ? (c.bit_depth ?? 16) * (c.sample_rate ?? 44100) : Math.floor((c.bitrate ?? 0) / 64000));

/**
 * Orders the copies of a song, best first: the one picked by hand; one that is there and plays; one not hidden;
 * lossless (FLAC); from the original album, not a compilation; better sound; the earliest year; with a cover;
 * the first one added.
 */
export function bestFirst(copies: Copy[], playable: (c: Copy) => boolean): Copy[] {
  const rank = (c: Copy): number[] => [
    -c.preferred, c.missing, playable(c) ? 0 : 1, c.hidden, isLossless(c) ? 0 : 1, isCompilation(c) ? 1 : 0, -quality(c), c.year ?? 9999, c.cover !== '' && (c.cover || c.embedded_cover || c.folder_cover) ? 0 : 1, c.id,
  ];
  return [...copies].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i];
    return 0;
  });
}

/** Rebuilds songs.version_key and songs.is_main. Returns how many songs and how many of them are main copies. */
export function rebuildVersions(db: Db, playableCodecs: string[]): { songs: number; main: number } {
  const songs = db.all<Copy>(
    `SELECT s.id, s.title, s.artist, s.album, s.album_artist, s.year, s.duration_s, s.codec, s.bitrate, s.sample_rate, s.bit_depth, s.tags, s.missing, s.hidden, s.preferred,
            s.cover, s.embedded_cover, s.folder_cover, r.kind
     FROM songs s JOIN roots r ON r.id = s.root_id`);
  const playable = (c: Copy) => c.kind === 'uploads' || playableCodecs.includes(c.codec ?? '');
  // Same artist + title + kind of recording ...
  const groups = new Map<string, Copy[]>();
  for (const s of songs) {
    const artist = artistKey(s.artist ?? s.album_artist);
    const { base, variant } = titleKey(s.title, s.album);
    const key = artist && base ? `${artist}|${base}|${variant}` : `song:${s.id}`; // no artist: not grouped ("Intro")
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  // ... and about the same length (an extended version or another take is longer or shorter).
  const keyOf = new Map<number, string>();
  const main = new Set<number>();
  const hidden = new Set<number>(); // a song hidden (any copy of it) is hidden, copies found later too
  for (const [key, copies] of groups) {
    const clusters: Copy[][] = [];
    for (const c of copies.filter((x) => x.duration_s !== null).sort((x, y) => x.duration_s! - y.duration_s!)) {
      const last = clusters[clusters.length - 1];
      if (last && c.duration_s! - last[last.length - 1].duration_s! <= SAME_LENGTH_S) last.push(c);
      else clusters.push([c]);
    }
    // A copy whose length is not known goes with the most copies (most likely the usual recording).
    const unknown = copies.filter((x) => x.duration_s === null);
    if (unknown.length) {
      if (clusters.length) clusters.reduce((a, b) => (b.length > a.length ? b : a)).push(...unknown);
      else clusters.push(unknown);
    }
    clusters.forEach((cluster, part) => {
      for (const c of cluster) keyOf.set(c.id, part ? `${key}#${part}` : key);
      main.add(bestFirst(cluster, playable)[0].id);
      if (cluster.some((c) => c.hidden)) for (const c of cluster) hidden.add(c.id);
    });
  }
  db.tx(() => {
    for (const s of songs) {
      db.run('UPDATE songs SET version_key = ?, is_main = ?, hidden = ? WHERE id = ?', keyOf.get(s.id)!, main.has(s.id) ? 1 : 0, hidden.has(s.id) ? 1 : s.hidden, s.id);
    }
  });
  return { songs: songs.length, main: main.size };
}
