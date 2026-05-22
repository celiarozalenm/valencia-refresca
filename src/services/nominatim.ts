/**
 * Geocodificador via Nominatim (OSM público, sin API key).
 * Centramos la búsqueda en València para evitar resultados de otras ciudades.
 */

const VALENCIA_VIEWBOX = "-0.50,39.55,-0.28,39.40"; // left,top,right,bottom

export interface GeocodeResult {
  lng: number;
  lat: number;
  displayName: string;
}

export async function geocode(query: string): Promise<GeocodeResult | null> {
  if (!query.trim()) return null;

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", `${query}, València, España`);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  url.searchParams.set("viewbox", VALENCIA_VIEWBOX);
  url.searchParams.set("bounded", "1");
  url.searchParams.set("countrycodes", "es");

  const res = await fetch(url.toString(), {
    headers: { "Accept-Language": "es" },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as Array<{ lat: string; lon: string; display_name: string }>;
  if (!data.length) return null;
  return {
    lat: Number(data[0].lat),
    lng: Number(data[0].lon),
    displayName: data[0].display_name,
  };
}
