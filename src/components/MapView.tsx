import { LngLatBounds, Map as MapLibre, Marker, setWorkerUrl, type GeoJSONSource } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// The map draws its tiles in a background worker. The bundler has to be told to ship that file.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { useEffect, useRef, useState } from 'react';
import type { Coords } from '../lib/types';

export type MapLine = {
  id: string;
  coords: Coords;
  color: string;
  width: number;
  /** Dotted, for walking. */
  dotted?: boolean;
  /** Dashed, for a leg whose real path is not known (a train with no track shape). */
  dashed?: boolean;
  /** Lines with a higher number are drawn on top. */
  order?: number;
  dim?: boolean;
};

export type MapPin = {
  id: string;
  lon: number;
  lat: number;
  label: string;
  title: string;
  color?: string;
  solid?: boolean;
};

type Props = {
  lines: MapLine[];
  pins: MapPin[];
  /** Changing this refits the map to everything, or to `focus` when given. */
  fitKey: string;
  focus?: Coords | null;
  /** Screen space covered by the panel, so the route is centred in what is visible. */
  padding: { top: number; bottom: number; left: number; right: number };
};

setWorkerUrl(workerUrl);

/** Free vector map from OpenStreetMap data. No key needed. */
const STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const UK = new LngLatBounds([-6.5, 49.9], [1.9, 58.7]);

function toFeatures(lines: MapLine[]) {
  return {
    type: 'FeatureCollection' as const,
    features: lines
      .filter((l) => l.coords.length > 1)
      .map((l) => ({
        type: 'Feature' as const,
        properties: { color: l.color, width: l.width, kind: l.dotted ? 'dotted' : l.dashed ? 'dashed' : 'solid', order: l.order ?? 0, dim: !!l.dim },
        geometry: { type: 'LineString' as const, coordinates: l.coords },
      })),
  };
}

export function MapView({ lines, pins, fitKey, focus, padding }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibre | null>(null);
  const markers = useRef<Marker[]>([]);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!box.current) return;
    const m = new MapLibre({ container: box.current, style: STYLE, bounds: UK, attributionControl: false, dragRotate: false, pitchWithRotate: false });
    m.touchZoomRotate.disableRotation();
    map.current = m;
    m.on('load', () => {
      m.addSource('routes', { type: 'geojson', data: toFeatures([]) });
      const base = { 'line-cap': 'round' as const, 'line-join': 'round' as const, 'line-sort-key': ['get', 'order'] as never };
      const opacity = ['case', ['get', 'dim'], 0.25, 1] as never;
      m.addLayer({ id: 'route-casing', type: 'line', source: 'routes', filter: ['==', ['get', 'kind'], 'solid'], layout: base, paint: { 'line-color': '#ffffff', 'line-width': ['+', ['get', 'width'], 3] as never, 'line-opacity': opacity } });
      m.addLayer({ id: 'route-solid', type: 'line', source: 'routes', filter: ['==', ['get', 'kind'], 'solid'], layout: base, paint: { 'line-color': ['get', 'color'] as never, 'line-width': ['get', 'width'] as never, 'line-opacity': opacity } });
      m.addLayer({ id: 'route-dotted', type: 'line', source: 'routes', filter: ['==', ['get', 'kind'], 'dotted'], layout: base, paint: { 'line-color': ['get', 'color'] as never, 'line-width': ['get', 'width'] as never, 'line-dasharray': [0.2, 1.8], 'line-opacity': opacity } });
      m.addLayer({ id: 'route-dashed', type: 'line', source: 'routes', filter: ['==', ['get', 'kind'], 'dashed'], layout: { ...base, 'line-cap': 'butt' }, paint: { 'line-color': ['get', 'color'] as never, 'line-width': ['get', 'width'] as never, 'line-dasharray': [2.2, 1.6], 'line-opacity': opacity } });
      setReady(true);
    });
    m.on('error', (e) => {
      // A failed style means no map at all; failed single tiles are not worth a message.
      if (!m.isStyleLoaded() && String(e.error?.message ?? '').includes('style')) setFailed(true);
    });
    const ro = new ResizeObserver(() => m.resize());
    ro.observe(box.current);
    return () => {
      ro.disconnect();
      m.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    (m.getSource('routes') as GeoJSONSource).setData(toFeatures(lines));
  }, [lines, ready]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    for (const old of markers.current) old.remove();
    markers.current = pins.map((p) => {
      const el = document.createElement('div');
      el.className = `pin${p.solid ? ' solid' : ''}`;
      el.style.setProperty('--c', p.color ?? '#0B0B0B');
      el.textContent = p.label;
      el.title = p.title;
      el.setAttribute('aria-label', p.title);
      return new Marker({ element: el, anchor: 'center' }).setLngLat([p.lon, p.lat]).addTo(m);
    });
  }, [pins, ready]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const pts: Coords = focus?.length ? focus : [...lines.flatMap((l) => l.coords), ...pins.map((p): [number, number] => [p.lon, p.lat])];
    if (!pts.length) return;
    const b = new LngLatBounds(pts[0], pts[0]);
    for (const p of pts) b.extend(p);
    const size = m.getContainer().getBoundingClientRect();
    // Padding larger than the map itself would throw; fall back to a small even margin.
    const fits = padding.left + padding.right + 60 < size.width && padding.top + padding.bottom + 60 < size.height;
    m.fitBounds(b, { padding: fits ? padding : 30, maxZoom: 15, duration: 600 });
  }, [fitKey, focus, ready]);

  return (
    <div className="map" data-ready={ready}>
      <div ref={box} className="map-canvas" role="application" aria-label="Map of the route" />
      <p className="map-credit">
        ©{' '}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">
          OpenStreetMap
        </a>{' '}
        ·{' '}
        <a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">
          OpenFreeMap
        </a>{' '}
        ·{' '}
        <a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noopener noreferrer">
          Fix the map
        </a>
      </p>
      {failed && <p className="map-msg">The map could not load. Your plan is still worked out below; check your connection to see it on the map.</p>}
    </div>
  );
}
