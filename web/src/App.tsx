// The whole app is the 🎧 Music page: 🎧 starts the songs (a new random order); while they play, it stops them.
import { useState } from 'react';
import { MusicView } from './MusicView.tsx';
import { useMusic } from './useMusic.ts';

export function App() {
  const music = useMusic();
  const [empty, setEmpty] = useState(false);

  const toggleMusic = async () => {
    if (music.playing) return music.stop();
    setEmpty((await music.start()) === 'empty');
  };

  return (
    <div className="app" data-testid="app">
      <MusicView music={music} onToggle={() => void toggleMusic()} onPause={music.togglePause} onPick={music.playAt} />
      {empty && <p className="music-empty" data-testid="music-empty">No songs yet. Add some with <code>npm run music:import -- &lt;folder&gt;</code></p>}
    </div>
  );
}
