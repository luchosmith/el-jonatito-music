// 🎧 Music: one audio player for the whole app. The songs play in a random order; when the list ends,
// a new random order starts. Each song's volume is evened out when its loudness is known (no sudden loud
// songs); a song that can't be played is skipped.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.ts';
import type { Song, SongList } from '../../shared/types.ts';

/** A volume can only turn a song down: louder-than-target songs come down to it, quieter ones stay as they are. */
const volumeFor = (s: Song) => (s.gain_db === null ? 1 : Math.min(1, 10 ** (s.gain_db / 20)));

/** This many songs failing in a row (e.g. the NAS is away, or bedtime locked the files): stop trying. */
const MAX_FAILS = 3;

const shuffle = (n: number) => {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

export interface Music {
  playing: boolean;
  /** the song is paused (tap the big picture): it goes on from the same spot when tapped again */
  paused: boolean;
  /** the songs in play order */
  list: Song[];
  /** where in `list` we are */
  cur: number;
  current: Song | null;
  /** 0..1 through the current song */
  progress: number;
  /** after bedtime: when music wakes up again */
  sleepingUntil: string | null;
  /** starts a new random order; 'locked' after bedtime, 'empty' with no songs */
  start: () => Promise<'playing' | 'locked' | 'empty'>;
  stop: () => void;
  /** pause / go on with the same song, from the same spot */
  togglePause: () => void;
  /** plays the song at this place in the list; the list goes on from there */
  playAt: (k: number) => void;
}

export function useMusic(): Music {
  const audio = useMemo(() => new Audio(), []);
  const [songs, setSongs] = useState<Song[]>([]);
  const [order, setOrder] = useState<number[]>([]);
  const [cur, setCur] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [sleepingUntil, setSleepingUntil] = useState<string | null>(null);
  // The audio events need the latest list without re-subscribing.
  const state = useRef({ songs, order, cur, playing, paused, fails: 0 });
  state.current = { ...state.current, songs, order, cur, playing, paused };

  const playAtIn = useCallback((k: number, ord: number[], list: Song[]) => {
    const song = list[ord[k]];
    if (!song) return;
    audio.src = song.audio_url;
    audio.volume = volumeFor(song);
    void audio.play().catch(() => undefined);
    setCur(k);
    setProgress(0);
    setPlaying(true);
    setPaused(false);
  }, [audio]);

  const stop = useCallback(() => {
    state.current.fails = 0;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    setPlaying(false);
    setPaused(false);
    setProgress(0);
  }, [audio]);

  const togglePause = useCallback(() => {
    if (!state.current.playing) return;
    if (state.current.paused) {
      void audio.play().catch(() => undefined);
      setPaused(false);
    } else {
      audio.pause();
      setPaused(true);
    }
  }, [audio]);

  const start = useCallback(async () => {
    const r = await api.get<SongList>('/api/songs');
    if (r.locked) {
      setSleepingUntil(r.unlock_at);
      return 'locked' as const;
    }
    setSleepingUntil(null);
    if (!r.songs.length) return 'empty' as const;
    const ord = shuffle(r.songs.length);
    setSongs(r.songs);
    setOrder(ord);
    playAtIn(0, ord, r.songs);
    return 'playing' as const;
  }, [playAtIn]);

  const playAt = useCallback((k: number) => playAtIn(k, state.current.order, state.current.songs), [playAtIn]);

  useEffect(() => {
    const next = () => {
      const { order: ord, cur: k, songs: list } = state.current;
      if (k + 1 < ord.length) return playAtIn(k + 1, ord, list);
      const fresh = shuffle(list.length); // the end of the list: a new random order
      setOrder(fresh);
      playAtIn(0, fresh, list);
    };
    const tick = () => setProgress(audio.duration ? audio.currentTime / audio.duration : 0);
    const started = () => { state.current.fails = 0; };
    // A song that can't be played is skipped; several in a row stop the music.
    const failed = () => {
      if (!state.current.playing || !audio.getAttribute('src')) return;
      if (++state.current.fails >= MAX_FAILS) return stop();
      next();
    };
    audio.addEventListener('ended', next);
    audio.addEventListener('timeupdate', tick);
    audio.addEventListener('playing', started);
    audio.addEventListener('error', failed);
    return () => {
      audio.removeEventListener('ended', next);
      audio.removeEventListener('timeupdate', tick);
      audio.removeEventListener('playing', started);
      audio.removeEventListener('error', failed);
    };
  }, [audio, playAtIn, stop]);

  useEffect(() => () => audio.pause(), [audio]);

  const list = order.map((i) => songs[i]).filter((s): s is Song => !!s);
  return { playing, paused, list, cur, current: playing ? list[cur] ?? null : null, progress, sleepingUntil, start, stop, togglePause, playAt };
}
