import { useEffect, useRef } from 'react';
import { World } from '../office/World';
import { useStore, startPolling, stopPolling } from '../store/useStore';

export default function GameCanvas() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = host.current!;
    const world = new World();
    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;

    const start = async () => {
      // Load the real agent source first so the canvas initialises with the
      // correct names. `loadOpenBot` resolves every fetch error into the mock
      // fallback itself, so this never rejects on a missing database.
      await useStore.getState().loadOpenBot();
      if (cancelled) return;
      await world.init(element);
      if (cancelled) return;
      // Refresh live agent state while the office is open. Cleanup stops it.
      startPolling(Number(import.meta.env.VITE_OFFICE_POLL_MS ?? 3000));
      resizeObserver = new ResizeObserver(() => world.resize());
      resizeObserver.observe(element);
      world.resize();
    };
    void start();

    return () => {
      cancelled = true;
      stopPolling();
      resizeObserver?.disconnect();
      world.destroy();
    };
  }, []);
  return <div ref={host} className="canvas-host" />;
}
