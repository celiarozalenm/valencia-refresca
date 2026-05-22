/**
 * Cliente OSRM público (peatonal). Sin API key.
 * https://project-osrm.org/docs/v5.24.0/api/
 */

export interface OsrmRoute {
  geometry: GeoJSON.LineString;
  distanceMeters: number;
  durationSeconds: number;
}

const OSRM_BASE = "https://router.project-osrm.org/route/v1/foot";

export async function fetchWalkingRoute(coords: Array<[number, number]>): Promise<OsrmRoute | null> {
  if (coords.length < 2) return null;
  const path = coords.map(([lng, lat]) => `${lng},${lat}`).join(";");
  const url = `${OSRM_BASE}/${path}?overview=full&geometries=geojson&steps=false`;

  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const route = data?.routes?.[0];
  if (!route) return null;
  return {
    geometry: route.geometry as GeoJSON.LineString,
    distanceMeters: route.distance,
    durationSeconds: route.duration,
  };
}
