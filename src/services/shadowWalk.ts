/**
 * Genera un paseo en bucle desde un origen, sesgando los waypoints hacia
 * los barrios con mayor densidad de arbolado.
 *
 * Estrategia (MVP):
 * 1. Cargar polígonos de barrios con bucket de sombra.
 * 2. Generar candidatos de waypoints a ~D/4 de distancia (4 segmentos en bucle).
 * 3. Filtrar/priorizar los que caen dentro de barrios "alta"/"muy_alta".
 * 4. Pedir a OSRM la ruta peatonal a través de [origen, w1, w2, w3, origen].
 * 5. Puntuar % de la ruta dentro de polígonos sombreados.
 */
import { fetchWalkingRoute, type OsrmRoute } from "./osrm";

const WALK_SPEED_M_PER_MIN = 75; // ~4.5 km/h

const SHADE_BUCKETS = new Set(["alta", "muy_alta"]);

type Feature = GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon, { sombra_bucket?: string }>;
type Collection = GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, { sombra_bucket?: string }>;

let cachedSombra: Collection | null = null;

async function loadSombra(): Promise<Collection> {
  if (cachedSombra) return cachedSombra;
  const res = await fetch("/data/barrios-sombra.geojson");
  cachedSombra = (await res.json()) as Collection;
  return cachedSombra;
}

function pointInRing(pt: [number, number], ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInFeature(pt: [number, number], f: Feature): boolean {
  const g = f.geometry;
  if (g.type === "Polygon") {
    if (!pointInRing(pt, g.coordinates[0])) return false;
    for (let i = 1; i < g.coordinates.length; i++) {
      if (pointInRing(pt, g.coordinates[i])) return false;
    }
    return true;
  }
  if (g.type === "MultiPolygon") {
    return g.coordinates.some((poly) => {
      if (!pointInRing(pt, poly[0])) return false;
      for (let i = 1; i < poly.length; i++) {
        if (pointInRing(pt, poly[i])) return false;
      }
      return true;
    });
  }
  return false;
}

function bucketAtPoint(pt: [number, number], features: Feature[]): string | null {
  for (const f of features) {
    if (pointInFeature(pt, f)) return f.properties?.sombra_bucket ?? null;
  }
  return null;
}

// Mueve un punto N metros en una dirección (grados)
function offsetPoint(lng: number, lat: number, meters: number, bearingDeg: number): [number, number] {
  const R = 6378137;
  const brng = (bearingDeg * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lng1 = (lng * Math.PI) / 180;
  const d = meters / R;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng));
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
    );
  return [(lng2 * 180) / Math.PI, (lat2 * 180) / Math.PI];
}

export interface ShadowWalkResult {
  route: OsrmRoute;
  shadePercent: number; // 0-100
  waypoints: Array<[number, number]>;
}

export async function generateShadowWalk(
  origin: [number, number],
  durationMinutes: number,
): Promise<ShadowWalkResult | null> {
  const totalMeters = durationMinutes * WALK_SPEED_M_PER_MIN;
  const radius = totalMeters / 4; // 4 segmentos en el bucle

  const sombra = await loadSombra();
  const features = sombra.features;

  // Probar 8 bearings de partida y elegir el que maximice la sombra
  let best: ShadowWalkResult | null = null;
  const bearings = [0, 45, 90, 135, 180, 225, 270, 315];

  for (const startBearing of bearings) {
    const w1 = offsetPoint(origin[0], origin[1], radius, startBearing);
    const w2 = offsetPoint(origin[0], origin[1], radius * 1.2, (startBearing + 90) % 360);
    const w3 = offsetPoint(origin[0], origin[1], radius, (startBearing + 180) % 360);

    const route = await fetchWalkingRoute([origin, w1, w2, w3, origin]);
    if (!route) continue;

    // Muestrear la ruta cada ~50m y contar % bajo sombra alta
    const coords = route.geometry.coordinates as Array<[number, number]>;
    let shadeHits = 0;
    for (const c of coords) {
      const bucket = bucketAtPoint(c, features);
      if (bucket && SHADE_BUCKETS.has(bucket)) shadeHits++;
    }
    const shadePercent = coords.length ? Math.round((shadeHits / coords.length) * 100) : 0;

    if (!best || shadePercent > best.shadePercent) {
      best = { route, shadePercent, waypoints: [w1, w2, w3] };
    }

    // Corta pronto si encontramos algo > 60%
    if (shadePercent > 60) break;
  }

  return best;
}

/** Construye URL de Google Maps con la ruta como waypoints. */
export function googleMapsUrl(origin: [number, number], waypoints: Array<[number, number]>): string {
  const fmt = ([lng, lat]: [number, number]) => `${lat},${lng}`;
  const wp = waypoints.map(fmt).join("|");
  return `https://www.google.com/maps/dir/?api=1&origin=${fmt(origin)}&destination=${fmt(origin)}&waypoints=${encodeURIComponent(wp)}&travelmode=walking`;
}

/** Construye un fichero GPX a partir de la ruta. */
export function routeToGpx(route: OsrmRoute, name = "Paseo fresco · València Refresca"): string {
  const coords = route.geometry.coordinates as Array<[number, number]>;
  const points = coords
    .map(([lng, lat]) => `<trkpt lat="${lat.toFixed(6)}" lon="${lng.toFixed(6)}"/>`)
    .join("\n      ");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="València Refresca" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${name}</name>
    <trkseg>
      ${points}
    </trkseg>
  </trk>
</gpx>`;
}
