import { useEffect } from 'react';
import GameCanvas from './components/GameCanvas';
import HUD from './components/HUD';
import CharacterInfo from './components/CharacterInfo';
import { useStore } from './store/useStore';
import { applyTheme, watchSystemTheme } from './theme';

export default function App() {
  const themeMode = useStore((s) => s.themeMode);

  // Repaint the palette whenever the mode changes; while it is `system`, keep
  // listening to the OS so a light/dark switch needs no reload.
  useEffect(() => {
    applyTheme(themeMode);
    if (themeMode !== 'system') return;
    return watchSystemTheme((resolved) => {
      document.documentElement.dataset.theme = resolved;
    });
  }, [themeMode]);

  return (
    <div className="app-shell">
      <HUD />
      <main className="office-stage">
        <GameCanvas />
        <CharacterInfo />
      </main>
    </div>
  );
}
