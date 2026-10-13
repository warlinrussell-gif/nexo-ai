import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './App.jsx';
import Overlay from './views/Overlay.jsx';
import { useStore, wireEvents } from './lib/store.js';

const isOverlay = location.hash === '#overlay';
const root = createRoot(document.getElementById('root'));

if (isOverlay) {
  document.documentElement.dataset.theme = 'dark';
  root.render(<Overlay />);
} else {
  wireEvents();
  window.__nexoStore = useStore;
  useStore.getState().boot().catch((e) => console.error(e));
  root.render(<App />);
}
