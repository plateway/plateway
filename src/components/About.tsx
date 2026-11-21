import { useEffect, useRef } from 'react';
import { APP_NAME, CONTACT, SOURCE_URL } from '../brand';
import { create } from 'zustand';

const useAbout = create<{ open: boolean; set: (open: boolean) => void }>((set) => ({ open: false, set: (open) => set({ open }) }));
export const openAbout = () => useAbout.getState().set(true);

export function AboutButton({ className = 'link' }: { className?: string }) {
  return (
    <button type="button" className={className} onClick={openAbout}>
      About {APP_NAME}
    </button>
  );
}

export function AboutDialog() {
  const { open, set } = useAbout();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="full-dialog" onClose={() => set(false)} aria-labelledby="about-title">
      <div className="dialog-head">
        <h2 id="about-title">About {APP_NAME}</h2>
        <button type="button" className="icon-btn" aria-label="Close" onClick={() => set(false)}>
          ✕
        </button>
      </div>
      <div className="dialog-scroll about">
        <p>
          {APP_NAME} helps vehicle delivery drivers plan their day. It is free, made by a driver, and is <b>not connected to or approved by</b> any vehicle logistics or auction company.
        </p>

        <h3>What stays on your phone</h3>
        <p>Your jobs, history, pay and settings are kept on this phone only. Nobody else can see them, including whoever made the app. Screenshots of job sheets are read on the phone and are not uploaded.</p>

        <h3>What is sent to work out routes</h3>
        <ul>
          <li>Postcodes, and your location if you tap "Use my location", go to postcodes.io to find where they are.</li>
          <li>The points of your day go to the OSRM road routing servers (run by the OSRM project and FOSSGIS) and, in Solo mode, to Transitous for buses and trains.</li>
          <li>Map pictures come from OpenFreeMap.</li>
        </ul>
        <p>These are free services run by volunteers. They see the places asked about and your internet address, not your name. Nothing is sold or used for adverts.</p>

        <h3>Where the data comes from</h3>
        <ul>
          <li>
            Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>, available under the Open Database Licence.{' '}
            <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noopener noreferrer">
              Fix the map
            </a>
            .
          </li>
          <li>
            Map tiles: <a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">OpenFreeMap</a>, <a href="https://openmaptiles.org" target="_blank" rel="noopener noreferrer">© OpenMapTiles</a>.
          </li>
          <li>
            Road routes: <a href="https://project-osrm.org" target="_blank" rel="noopener noreferrer">OSRM</a> and <a href="https://routing.openstreetmap.de/about.html" target="_blank" rel="noopener noreferrer">FOSSGIS</a>.
          </li>
          <li>
            Buses and trains: <a href="https://transitous.org" target="_blank" rel="noopener noreferrer">Transitous</a>, using{' '}
            <a href="https://transitous.org/sources/" target="_blank" rel="noopener noreferrer">
              these timetable sources
            </a>
            .
          </li>
          <li>
            Postcodes: <a href="https://postcodes.io" target="_blank" rel="noopener noreferrer">postcodes.io</a>. Contains OS data © Crown copyright and database right. Contains Royal Mail data © Royal Mail copyright and database right. Source: Office for National Statistics, licensed under the{' '}
            <a href="https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/" target="_blank" rel="noopener noreferrer">
              Open Government Licence v3.0
            </a>
            .
          </li>
          <li>Reading screenshots: Tesseract.js.</li>
        </ul>

        <h3>Times, pay and fares</h3>
        <p>Drive times use normal road speeds, not live traffic. Bus and train times come from published timetables. Pay is worked out from the rates you set and may differ from your payslip. Train fares are a rough guide, not real ticket prices.</p>

        {(CONTACT || SOURCE_URL) && (
          <>
            <h3>Contact</h3>
            {CONTACT && (
              <p>
                Questions or problems: <a href={CONTACT.startsWith('http') ? CONTACT : `mailto:${CONTACT}`}>{CONTACT.replace(/^https?:\/\//, '')}</a>
              </p>
            )}
            {SOURCE_URL && (
              <p>
                The code is open source:{' '}
                <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer">
                  {SOURCE_URL.replace(/^https?:\/\//, '')}
                </a>
              </p>
            )}
          </>
        )}
      </div>
    </dialog>
  );
}
