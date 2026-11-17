import GameCanvas from './components/GameCanvas';
import HUD from './components/HUD';
import CharacterInfo from './components/CharacterInfo';

export default function App() {
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
