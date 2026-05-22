import { useEffect, useRef, useState } from "react";
import maplibregl, { type Map as MapLibre, type StyleSpecification, type LngLatLike } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

const VALENCIA_CENTER: LngLatLike = [-0.376, 39.467];

const BRAND = {
  agua: "#3b82f6",
  calor: "#f97316",
  sombra: "#22c55e",
  ink: "#1f2937",
} as const;

type LayerKey = "fuentes" | "urinarios" | "duchas" | "barrios";

const LAYER_META: Record<LayerKey, { label: string; color: string; description: string }> = {
  fuentes: { label: "Fuentes", color: BRAND.agua, description: "832 puntos de agua potable" },
  urinarios: { label: "Urinarios", color: BRAND.calor, description: "230 baños públicos" },
  duchas: { label: "Duchas de playa", color: "#0ea5e9", description: "71 puntos · playas urbanas" },
  barrios: { label: "Vulnerabilidad", color: BRAND.ink, description: "Tinte por vulnerabilidad demográfica" },
};

// CartoDB Positron: tiles claros, sin API key, atribución a OSM + CARTO requerida.
const STYLE: StyleSpecification = {
  version: 8,
  sources: {
    "carto-light": {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
        "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
        "https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
      ],
      tileSize: 256,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · © <a href="https://carto.com/attributions">CARTO</a>',
    },
  },
  layers: [
    { id: "carto-light", type: "raster", source: "carto-light" },
  ],
};

const VUL_COLORS: Record<string, string> = {
  "Vulnerabilidad Muy Alta": "#dc2626",
  "Vulnerabilidad Alta": "#f97316",
  "Vulnerabilidad Media": "#facc15",
  "Vulnerabilidad Baja": "#bbf7d0",
};

export default function Map() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibre | null>(null);
  const [active, setActive] = useState<Record<LayerKey, boolean>>({
    fuentes: true,
    urinarios: true,
    duchas: false,
    barrios: true,
  });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE,
      center: VALENCIA_CENTER,
      zoom: 12,
      minZoom: 10,
      maxZoom: 17,
      attributionControl: { compact: true },
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(
      new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: false,
        showUserLocation: true,
      }),
      "top-right",
    );

    map.on("load", async () => {
      // Vulnerabilidad — al fondo, así los puntos quedan encima.
      const vulnRes = await fetch("/data/vulnerabilidad-por-barrios.geojson");
      const vulnData = await vulnRes.json();
      map.addSource("vulnerabilidad", { type: "geojson", data: vulnData });
      map.addLayer({
        id: "vulnerabilidad-fill",
        type: "fill",
        source: "vulnerabilidad",
        paint: {
          "fill-color": [
            "match",
            ["get", "vul_global"],
            ...Object.entries(VUL_COLORS).flat(),
            "#e5e7eb",
          ],
          "fill-opacity": 0.25,
        },
      });
      map.addLayer({
        id: "vulnerabilidad-line",
        type: "line",
        source: "vulnerabilidad",
        paint: { "line-color": BRAND.ink, "line-width": 0.4, "line-opacity": 0.35 },
      });

      // Fuentes
      const fuentesRes = await fetch("/data/fonts-daigua-publica-fuentes-de-agua-publica.geojson");
      map.addSource("fuentes", { type: "geojson", data: await fuentesRes.json() });
      map.addLayer({
        id: "fuentes-dot",
        type: "circle",
        source: "fuentes",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 2, 14, 4, 17, 7],
          "circle-color": BRAND.agua,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1,
          "circle-opacity": 0.95,
        },
      });

      // Urinarios
      const uriRes = await fetch("/data/urinaris-urinarios.geojson");
      map.addSource("urinarios", { type: "geojson", data: await uriRes.json() });
      map.addLayer({
        id: "urinarios-dot",
        type: "circle",
        source: "urinarios",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3, 14, 6, 17, 10],
          "circle-color": BRAND.calor,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1.5,
        },
      });

      // Duchas (off por defecto)
      const duchasRes = await fetch("/data/dutxes-platja-duchas-playa.geojson");
      map.addSource("duchas", { type: "geojson", data: await duchasRes.json() });
      map.addLayer({
        id: "duchas-dot",
        type: "circle",
        source: "duchas",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3, 14, 6, 17, 9],
          "circle-color": "#0ea5e9",
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1.5,
        },
        layout: { visibility: "none" },
      });

      // Popups en clic
      const popupHtml = {
        fuentes: (p: Record<string, unknown>) =>
          `<strong>Fuente</strong><br/>${p.calle ?? "—"}<br/><span style="color:#6b7280">Código ${p.codigo ?? "?"}</span>`,
        urinarios: (p: Record<string, unknown>) =>
          `<strong>Urinario</strong><br/>${p.direccion ?? "—"}<br/><span style="color:#6b7280">${p.cabina_nor ?? 0} cabinas · ${p.cabina_min ?? 0} reducida movilidad</span>`,
        duchas: () => `<strong>Ducha de playa</strong>`,
        vulnerabilidad: (p: Record<string, unknown>) =>
          `<strong>${p.nombre ?? ""}</strong><br/>${p.vul_global ?? ""}<br/><span style="color:#6b7280">Índice global ${p.ind_global ?? "?"}</span>`,
      } as const;

      const pointLayers: Array<[string, keyof typeof popupHtml]> = [
        ["fuentes-dot", "fuentes"],
        ["urinarios-dot", "urinarios"],
        ["duchas-dot", "duchas"],
        ["vulnerabilidad-fill", "vulnerabilidad"],
      ];
      pointLayers.forEach(([layerId, kind]) => {
        map.on("click", layerId, (e) => {
          const f = e.features?.[0];
          if (!f) return;
          new maplibregl.Popup({ closeButton: true, offset: 10 })
            .setLngLat(e.lngLat)
            .setHTML(popupHtml[kind](f.properties ?? {}))
            .addTo(map);
        });
        map.on("mouseenter", layerId, () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", layerId, () => (map.getCanvas().style.cursor = ""));
      });

      setLoaded(true);
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Sincroniza el estado de toggles con la visibilidad real de las capas.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const apply = (id: string, visible: boolean) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
    };
    apply("fuentes-dot", active.fuentes);
    apply("urinarios-dot", active.urinarios);
    apply("duchas-dot", active.duchas);
    apply("vulnerabilidad-fill", active.barrios);
    apply("vulnerabilidad-line", active.barrios);
  }, [active, loaded]);

  return (
    <div
      className="relative w-full overflow-hidden rounded-3xl bg-slate-100 ring-1 ring-slate-200/60"
      style={{ height: "min(78vh, 720px)", minHeight: 520 }}
    >
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />

      <div className="pointer-events-none absolute top-4 left-4 z-10 max-w-xs space-y-3">
        <div className="pointer-events-auto rounded-2xl bg-white/95 p-4 shadow-sm backdrop-blur">
          <p className="font-display text-sm leading-tight font-medium text-slate-900">Capas</p>
          <p className="mt-0.5 text-xs text-slate-500">Activa lo que quieras ver.</p>
          <ul className="mt-3 space-y-2">
            {(Object.keys(LAYER_META) as LayerKey[]).map((k) => {
              const meta = LAYER_META[k];
              return (
                <li key={k}>
                  <label className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-1.5 transition hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={active[k]}
                      onChange={(e) => setActive((s) => ({ ...s, [k]: e.target.checked }))}
                      className="mt-1 h-4 w-4 accent-slate-900"
                    />
                    <span className="flex-1">
                      <span className="flex items-center gap-2 text-sm font-medium text-slate-900">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: meta.color }} aria-hidden />
                        {meta.label}
                      </span>
                      <span className="text-xs text-slate-500">{meta.description}</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {!loaded && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/40 text-sm text-slate-500 backdrop-blur-sm">
          Cargando datos…
        </div>
      )}
    </div>
  );
}
