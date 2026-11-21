import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// The splash is part of index.html so it shows at once. Keep it up long enough to be seen, then fade it.
const splash = document.getElementById('splash');
const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
setTimeout(
  () => {
    splash?.classList.add('hide');
    setTimeout(() => splash?.remove(), 400);
  },
  Math.max(0, (calm ? 500 : 1400) - performance.now()),
);

// Ask the browser not to clear saved jobs and pay when space runs low.
navigator.storage?.persist?.().catch(() => {});

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
