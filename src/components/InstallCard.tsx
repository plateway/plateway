import { useState } from 'react';

const KEY = 'plateway.installHidden';

/** True on an iPhone or iPad browsing in Safari, not already opened from the home screen. */
function inIosBrowser(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const installed = nav.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  return ios && !installed;
}

/** Shows how to add the app to the home screen, where its saved data is kept safely. */
export function InstallCard() {
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(KEY) === '1' || !inIosBrowser();
    } catch {
      return !inIosBrowser();
    }
  });
  if (hidden) return null;
  const hide = () => {
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      /* still hides for now */
    }
    setHidden(true);
  };
  return (
    <aside className="install" aria-label="Add to home screen">
      <div>
        <b>Add Plateway to your home screen</b>
        <span>
          Tap{' '}
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-label="Share">
            <path d="M12 15V4m0 0L8 8m4-4l4 4M5 12v7h14v-7" />
          </svg>{' '}
          <b>Share</b>, then <b>Add to Home Screen</b>. It opens full screen, and your jobs and pay are kept more safely than in a Safari tab.
        </span>
      </div>
      <button type="button" className="icon-btn small" aria-label="Hide this tip" onClick={hide}>
        ✕
      </button>
    </aside>
  );
}
