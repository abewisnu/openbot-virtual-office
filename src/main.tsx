import { createRoot } from 'react-dom/client';
import App from './App';
import { useStore } from './store/useStore';
import './styles/index.css';

// Screenshot tooling (tmp/shoot.mjs) reads and drives the store through this
// handle to reproduce the documented frames. Dev-only, one line, no behavior.
if (import.meta.env.DEV) {
  (window as unknown as { __OVO_STORE__: typeof useStore }).__OVO_STORE__ = useStore;
}

createRoot(document.getElementById('root')!).render(<App />);
