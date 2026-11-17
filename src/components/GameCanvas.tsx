import { useEffect, useRef } from 'react';
import { World } from '../office/World';
import { useStore, startPolling, stopPolling } from '../store/useStore';

export default function GameCanvas() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    let active: World | null = null;
    let resizeObserver: ResizeObserver | null = null;
    const element = host.current!;
    const w = new World();
    active = w;

    // Load the real agent source first so the canvas initialises with
    // the correct names. Falls back to mock silently when the DB is unavailable.
    useStore.getState().loadOpenBot().then(() => {
      if (cancelled) return;
      return w.init(element).then(() => {
        if (cancelled) return;
        // Refresh live agent state while the office is open. Cleanup stops it.
        startPolling(Number(import.meta.env.VITE_OFFICE_POLL_MS ?? 3000));
        resizeObserver = new ResizeObserver(() => active?.resize());
        resizeObserver.observe(element);
        active?.resize();
      });
    }).catch(() => {
      if (cancelled) return;
      // DB unavailable — init with whatever is in the store (mock employees)
      return w.init(element).then(() => {
        if (cancelled) return;
        resizeObserver = new ResizeObserver(() => active?.resize());
        resizeObserver.observe(element);
        active?.resize();
      });
    });

    return () => {
      cancelled = true;
      stopPolling();
      resizeObserver?.disconnect();
      active?.destroy();
    };
  }, []);
  return <div ref={host} className="canvas-host" />;
}
