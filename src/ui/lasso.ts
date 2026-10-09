// Box and lasso selection (own small implementation, no plugin).
import L from 'leaflet';

export type SelectMode = 'none' | 'box' | 'lasso';

/** Ray casting. x = lon, y = lat. */
export function pointInPolygon(lat: number, lon: number, poly: { lat: number; lng: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.lat > lat !== b.lat > lat && lon < ((b.lng - a.lng) * (lat - a.lat)) / (b.lat - a.lat) + a.lng) inside = !inside;
  }
  return inside;
}

interface Options {
  map: L.Map;
  container: HTMLElement;
  getMode: () => SelectMode;
  onDone: (polygon: L.LatLng[]) => void;
}

/**
 * Pointer-driven selection. Active when a mode is armed, or while Shift is held (box).
 * Controls laid over the map are left alone.
 */
export function attachSelection({ map, container, getMode, onDone }: Options): void {
  let drawing: { kind: 'box' | 'lasso'; start: L.LatLng; pts: L.LatLng[]; shape: L.Rectangle | L.Polyline; id: number } | null = null;

  container.addEventListener(
    'pointerdown',
    (e: PointerEvent) => {
      if (e.button !== 0 || drawing) return;
      const target = e.target as HTMLElement;
      if (target.closest('.leaflet-control, .jr-overlay, .leaflet-popup')) return;
      const mode = getMode();
      const kind: 'box' | 'lasso' | null = mode !== 'none' ? mode : e.shiftKey ? 'box' : null;
      if (!kind) return;
      e.preventDefault();
      e.stopPropagation();
      const start = map.mouseEventToLatLng(e);
      map.dragging.disable();
      container.setPointerCapture?.(e.pointerId);
      const style = { color: '#111827', weight: 2, dashArray: '5 4', fillColor: '#2563eb', fillOpacity: 0.12, interactive: false };
      const shape = kind === 'box' ? L.rectangle(L.latLngBounds(start, start), style) : L.polyline([start], style);
      shape.addTo(map);
      drawing = { kind, start, pts: [start], shape, id: e.pointerId };
    },
    true,
  );

  container.addEventListener('pointermove', (e: PointerEvent) => {
    if (!drawing || e.pointerId !== drawing.id) return;
    const p = map.mouseEventToLatLng(e);
    if (drawing.kind === 'box') (drawing.shape as L.Rectangle).setBounds(L.latLngBounds(drawing.start, p));
    else {
      drawing.pts.push(p);
      (drawing.shape as L.Polyline).setLatLngs(drawing.pts);
    }
  });

  const finish = (e: PointerEvent, cancelled: boolean) => {
    if (!drawing || e.pointerId !== drawing.id) return;
    const d = drawing;
    drawing = null;
    container.releasePointerCapture?.(e.pointerId);
    d.shape.remove();
    map.dragging.enable();
    if (cancelled) return;
    const end = map.mouseEventToLatLng(e);
    let poly: L.LatLng[];
    if (d.kind === 'box') {
      const b = L.latLngBounds(d.start, end);
      poly = [b.getSouthWest(), b.getNorthWest(), b.getNorthEast(), b.getSouthEast()];
    } else poly = d.pts;
    if (poly.length >= 3) onDone(poly);
  };
  container.addEventListener('pointerup', (e) => finish(e, false));
  container.addEventListener('pointercancel', (e) => finish(e, true));
}
