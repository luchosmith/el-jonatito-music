// 🎧 Music: the songs as square pictures in play order. The one playing has a yellow frame and moving
// bars. Tap any song (played ones too): it plays and the list goes on from there.
// 🎧 at the top starts the music (a new random order) and, while it plays, stops it.
import { useEffect, useRef, useState } from 'react';
import { Clock12 } from './Clock12.tsx';
import { fmt12 } from '../../shared/time.ts';
import type { Song } from '../../shared/types.ts';
import type { Music } from './useMusic.ts';

/** A song's picture: its cover art, or (no cover, or it won't load) a coloured tile with its name on top and 🎵 under it. */
export function SongPicture({ song }: { song: Song }) {
  const [broken, setBroken] = useState<string | null>(null); // the cover that would not load (the big picture changes song)
  if (song.cover_url && broken !== song.cover_url) return <img src={song.cover_url} alt="" draggable={false} loading="lazy" onError={() => setBroken(song.cover_url)} />;
  let h = 0;
  for (const c of song.title) h = (h * 31 + c.charCodeAt(0)) % 360;
  return (
    <span className="song-gen" style={{ background: `hsl(${h} 65% 62%)` }}>
      <span>{song.title}</span>
      <b>🎵</b>
    </span>
  );
}

const Bars = ({ big }: { big?: boolean }) => <i className={`eq ${big ? 'big' : ''}`} aria-hidden><b /><b /><b /><b /></i>;

/** The grid shows this many tiles more each time it is scrolled to the end (a library has thousands). */
const PAGE = 300;

export function MusicView({ music, onToggle, onPick, onPause }: {
  music: Music; onToggle: () => void; onPick: (k: number) => void;
  /** the big picture: pause / go on with the same song */
  onPause: () => void;
}) {
  const now = music.current;
  // How many tiles are shown: a page at a time as the grid is scrolled, and always a little past the song playing.
  const [shown, setShown] = useState(PAGE);
  const more = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = more.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) setShown((n) => n + PAGE); }, { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const count = Math.min(music.list.length, Math.max(shown, music.cur + PAGE / 3));
  return (
    <div className="music" data-testid="music-view" data-playing={music.playing ? 'yes' : 'no'}>
      <div className="music-head">
        <button className={`music-btn ${music.playing ? 'on' : ''}`} data-testid="music-toggle" onClick={onToggle} aria-label={music.playing ? 'Stop the music' : 'Play music'}>
          🎧{music.playing && !music.paused && <Bars />}
        </button>
        {music.sleepingUntil && !music.playing ? (
          <div className="music-sleep" data-testid="music-sleeping">
            <span className="moon-big">🌙</span>
            <Clock12 at={new Date(music.sleepingUntil)} size={96} />
            <b className="time big-time">{fmt12(new Date(music.sleepingUntil))}</b>
          </div>
        ) : now ? (
          <>
            <button className={`music-cur ${music.paused ? 'paused' : ''}`} data-testid="music-now" data-song={now.id} data-paused={music.paused ? 'yes' : 'no'}
              onClick={onPause} aria-label={music.paused ? 'Go on' : 'Pause'}>
              <SongPicture song={now} />
              {music.paused ? <i className="music-resume" aria-hidden>▶</i> : <Bars big />}
            </button>
            <div className="music-info">
              <b>{now.title}</b>
              {now.artist && <small>{now.artist}</small>}
              <div className="music-bar"><i style={{ width: `${Math.round(music.progress * 100)}%` }} /></div>
            </div>
          </>
        ) : <div className="music-info" />}
      </div>
      <div className="music-grid">
        {music.list.slice(0, count).map((s, k) => (
          <button key={`${k}-${s.id}`} className={`music-tile ${k === music.cur && music.playing ? 'cur' : ''}`}
            data-testid="music-song" data-song={s.id} onClick={() => onPick(k)} aria-label={s.artist ? `${s.title}, ${s.artist}` : s.title}>
            <SongPicture song={s} />
            {k === music.cur && music.playing && !music.paused && <Bars />}
          </button>
        ))}
        <div ref={more} className="music-more" aria-hidden />
      </div>
    </div>
  );
}
