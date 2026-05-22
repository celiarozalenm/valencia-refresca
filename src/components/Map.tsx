import { useEffect, useRef, useState } from "react";
import maplibregl, { type Map as MapLibre, type StyleSpecification, type LngLatLike } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { STRINGS, type Lang } from "../i18n/strings";
import { geocode } from "../services/nominatim";
import { generateShadowWalk, googleMapsUrl, routeToGpx, type ShadowWalkResult } from "../services/shadowWalk";

const VALENCIA_CENTER: LngLatLike = [-0.376, 39.467];

const BRAND = {
  agua: "#3b82f6",
  agua_deep: "#1d4ed8",
  calor: "#f97316",
  sombra: "#22c55e",
  ink: "#1f2937",
} as const;

type LayerKey = "fuentes" | "urinarios" | "duchas" | "sombra" | "barrios";
type View = "capas" | "paseo" | "frescos";

const LAYER_COLORS: Record<LayerKey, string> = {
  fuentes: BRAND.agua,
  urinarios: BRAND.calor,
  duchas: "#0ea5e9",
  sombra: BRAND.sombra,
  barrios: BRAND.ink,
};

const SOMBRA_COLORS: Record<string, string> = {
  muy_alta: "#166534",
  alta: "#22c55e",
  media: "#86efac",
  baja: "#dcfce7",
  muy_baja: "#fef3c7",
};

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
  layers: [{ id: "carto-light", type: "raster", source: "carto-light" }],
};

const VUL_COLORS: Record<string, string> = {
  "Vulnerabilidad Muy Alta": "#dc2626",
  "Vulnerabilidad Alta": "#f97316",
  "Vulnerabilidad Media": "#facc15",
  "Vulnerabilidad Baja": "#bbf7d0",
};

interface MapProps {
  lang?: Lang;
}

export default function Map({ lang = "es" }: MapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibre | null>(null);
  const tr = STRINGS[lang].map;
  const sw = tr.shadowWalk;
  const layerNames = tr.layers;
  const sectionsT = tr.sections;
  const freshestT = tr.freshest;

  const [view, setView] = useState<View>("capas");
  const [active, setActive] = useState<Record<LayerKey, boolean>>({
    fuentes: true,
    urinarios: true,
    duchas: false,
    sombra: false,
    barrios: true,
  });
  const [loaded, setLoaded] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Paseo de la sombra state
  const [address, setAddress] = useState("");
  const [duration, setDuration] = useState<number>(30);
  const [walkPending, setWalkPending] = useState(false);
  const [walkError, setWalkError] = useState<string | null>(null);
  const [walkResult, setWalkResult] = useState<ShadowWalkResult | null>(null);
  const [walkOrigin, setWalkOrigin] = useState<[number, number] | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    setSidebarOpen(mq.matches);
  }, []);

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
      const sombraRes = await fetch("/data/barrios-sombra.geojson");
      const sombraData = await sombraRes.json();
      map.addSource("sombra", { type: "geojson", data: sombraData });
      map.addLayer({
        id: "sombra-fill",
        type: "fill",
        source: "sombra",
        paint: {
          "fill-color": ["match", ["get", "sombra_bucket"], ...Object.entries(SOMBRA_COLORS).flat(), "#e5e7eb"],
          "fill-opacity": 0.45,
        },
        layout: { visibility: "none" },
      });
      map.addLayer({
        id: "sombra-line",
        type: "line",
        source: "sombra",
        paint: { "line-color": BRAND.sombra, "line-width": 0.5, "line-opacity": 0.5 },
        layout: { visibility: "none" },
      });

      const vulnRes = await fetch("/data/vulnerabilidad-por-barrios.geojson");
      const vulnData = await vulnRes.json();
      map.addSource("vulnerabilidad", { type: "geojson", data: vulnData });
      map.addLayer({
        id: "vulnerabilidad-fill",
        type: "fill",
        source: "vulnerabilidad",
        paint: {
          "fill-color": ["match", ["get", "vul_global"], ...Object.entries(VUL_COLORS).flat(), "#e5e7eb"],
          "fill-opacity": 0.25,
        },
      });
      map.addLayer({
        id: "vulnerabilidad-line",
        type: "line",
        source: "vulnerabilidad",
        paint: { "line-color": BRAND.ink, "line-width": 0.4, "line-opacity": 0.35 },
      });

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

      // Capa para la ruta del paseo fresco (vacía al principio)
      map.addSource("walk-route", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "walk-route-line",
        type: "line",
        source: "walk-route",
        paint: {
          "line-color": BRAND.agua_deep,
          "line-width": 5,
          "line-opacity": 0.9,
        },
        layout: { "line-cap": "round", "line-join": "round" },
      });

      const popupHtml = {
        fuentes: (p: Record<string, unknown>) =>
          `<strong>Fuente</strong><br/>${p.calle ?? "Sin dirección"}<br/><span style="color:#6b7280">Código ${p.codigo ?? "?"}</span>`,
        urinarios: (p: Record<string, unknown>) =>
          `<strong>Urinario</strong><br/>${p.direccion ?? "Sin dirección"}<br/><span style="color:#6b7280">${p.cabina_nor ?? 0} cabinas · ${p.cabina_min ?? 0} reducida movilidad</span>`,
        duchas: () => `<strong>Ducha de playa</strong>`,
        sombra: (p: Record<string, unknown>) =>
          `<strong>${p.nombre ?? ""}</strong><br/>${Number(p.arboles ?? 0).toLocaleString("es-ES")} árboles<br/><span style="color:#6b7280">${p.arboles_per_km2 ?? "?"} árboles/km²</span>`,
        vulnerabilidad: (p: Record<string, unknown>) =>
          `<strong>${p.nombre ?? ""}</strong><br/>${p.vul_global ?? ""}<br/><span style="color:#6b7280">Índice global ${p.ind_global ?? "?"}</span>`,
      } as const;

      const pointLayers: Array<[string, keyof typeof popupHtml]> = [
        ["fuentes-dot", "fuentes"],
        ["urinarios-dot", "urinarios"],
        ["duchas-dot", "duchas"],
        ["sombra-fill", "sombra"],
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

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const apply = (id: string, visible: boolean) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
    };
    apply("fuentes-dot", active.fuentes);
    apply("urinarios-dot", active.urinarios);
    apply("duchas-dot", active.duchas);
    apply("sombra-fill", active.sombra);
    apply("sombra-line", active.sombra);
    apply("vulnerabilidad-fill", active.barrios);
    apply("vulnerabilidad-line", active.barrios);
  }, [active, loaded]);

  // Render walk route on the map
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded) return;
    const src = map.getSource("walk-route") as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    if (!walkResult) {
      src.setData({ type: "FeatureCollection", features: [] });
      return;
    }
    src.setData({
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: {}, geometry: walkResult.route.geometry }],
    });

    const coords = walkResult.route.geometry.coordinates as Array<[number, number]>;
    if (coords.length) {
      const bounds = coords.reduce(
        (b, c) => b.extend(c as LngLatLike),
        new maplibregl.LngLatBounds(coords[0] as LngLatLike, coords[0] as LngLatLike),
      );
      map.fitBounds(bounds, { padding: 80, duration: 800 });
    }
  }, [walkResult, loaded]);

  async function handleGenerateWalk(e?: React.FormEvent) {
    e?.preventDefault();
    setWalkError(null);
    setWalkResult(null);
    if (!address.trim()) return;
    setWalkPending(true);
    try {
      const g = await geocode(address.trim());
      if (!g) {
        setWalkError(sw.notFound);
        return;
      }
      const origin: [number, number] = [g.lng, g.lat];
      setWalkOrigin(origin);
      const result = await generateShadowWalk(origin, duration);
      if (!result) {
        setWalkError(sw.routeFailed);
        return;
      }
      setWalkResult(result);
    } catch {
      setWalkError(sw.routeFailed);
    } finally {
      setWalkPending(false);
    }
  }

  function handleUseMyLocation() {
    if (!navigator.geolocation) return;
    setWalkPending(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const origin: [number, number] = [pos.coords.longitude, pos.coords.latitude];
        setAddress(`${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`);
        setWalkOrigin(origin);
        try {
          const result = await generateShadowWalk(origin, duration);
          if (!result) {
            setWalkError(sw.routeFailed);
            return;
          }
          setWalkResult(result);
        } finally {
          setWalkPending(false);
        }
      },
      () => {
        setWalkPending(false);
      },
      { enableHighAccuracy: true },
    );
  }

  function handleShare() {
    if (!walkResult) return;
    const km = (walkResult.route.distanceMeters / 1000).toFixed(2);
    const min = Math.round(walkResult.route.durationSeconds / 60);
    const text = `${sw.shareTitle}: ${km} km · ${min} min · ${walkResult.shadePercent}% bajo sombra`;
    if (navigator.share) {
      navigator.share({ title: sw.shareTitle, text, url: window.location.href }).catch(() => {});
    } else {
      navigator.clipboard.writeText(`${text}\n${window.location.href}`).catch(() => {});
    }
  }

  function handleOpenInGoogleMaps() {
    if (!walkResult || !walkOrigin) return;
    window.open(googleMapsUrl(walkOrigin, walkResult.waypoints), "_blank");
  }

  function handleDownloadGpx() {
    if (!walkResult) return;
    const gpx = routeToGpx(walkResult.route);
    const blob = new Blob([gpx], { type: "application/gpx+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "paseo-fresco-valencia.gpx";
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleResetWalk() {
    setWalkResult(null);
    setWalkError(null);
    setAddress("");
    setWalkOrigin(null);
  }

  const homeHref = lang === "va" ? "/val/" : "/";

  const tabs: Array<{ key: View; label: string; icon: React.ReactNode }> = [
    {
      key: "capas",
      label: sectionsT.capas,
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <polygon points="12 2 2 7 12 12 22 7 12 2" />
          <polyline points="2 17 12 22 22 17" />
          <polyline points="2 12 12 17 22 12" />
        </svg>
      ),
    },
    {
      key: "paseo",
      label: sectionsT.paseo,
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="13" cy="4" r="2" />
          <path d="M5 22 L9 16 L9 11 L13 13 L16 18 L20 17" />
          <path d="M9 11 L7 8" />
        </svg>
      ),
    },
    {
      key: "frescos",
      label: sectionsT.frescos,
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <line x1="3" y1="20" x2="21" y2="20" />
          <rect x="5" y="11" width="3" height="9" />
          <rect x="11" y="7" width="3" height="13" />
          <rect x="17" y="14" width="3" height="6" />
        </svg>
      ),
    },
  ];

  return (
    <div className="relative flex h-full w-full overflow-hidden bg-slate-100">
      {/* Sidebar */}
      <aside className="z-20 hidden h-full w-80 shrink-0 flex-col border-r border-slate-200 bg-white shadow-sm md:flex">
        {/* Header: Logo + V Refresca */}
        <div className="border-b border-slate-100 px-5 py-4">
          <a href={homeHref} className="flex items-center gap-2.5 text-(--color-ink) transition hover:opacity-80">
            <svg width="32" height="32" viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg" aria-hidden>
              <g transform="translate(48 30)">
                <g fill="#f97316">
                  <circle cx="0" cy="0" r="11" />
                  <rect x="-1.2" y="-19" width="2.4" height="5" rx="1.2" />
                  <rect x="-1.2" y="14" width="2.4" height="5" rx="1.2" />
                  <rect x="14" y="-1.2" width="5" height="2.4" rx="1.2" />
                  <rect x="-19" y="-1.2" width="5" height="2.4" rx="1.2" />
                  <rect x="-1.2" y="-19" width="2.4" height="5" rx="1.2" transform="rotate(45)" />
                  <rect x="-1.2" y="-19" width="2.4" height="5" rx="1.2" transform="rotate(135)" />
                  <rect x="-1.2" y="-19" width="2.4" height="5" rx="1.2" transform="rotate(-45)" />
                  <rect x="-1.2" y="-19" width="2.4" height="5" rx="1.2" transform="rotate(-135)" />
                </g>
              </g>
              <path d="M30 12 C 38 26, 48 38, 48 50 C 48 60, 40 67, 30 67 C 20 67, 12 60, 12 50 C 12 38, 22 26, 30 12 Z" fill="#3b82f6" />
            </svg>
            <span className="font-display text-lg leading-tight font-semibold">
              València<br /><span className="font-medium">Refresca</span>
            </span>
          </a>
        </div>

        {/* Section tabs */}
        <nav className="border-b border-slate-100 px-2 py-2">
          <ul className="flex flex-col gap-0.5">
            {tabs.map((tab) => {
              const isActive = view === tab.key;
              return (
                <li key={tab.key}>
                  <button
                    type="button"
                    onClick={() => setView(tab.key)}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition ${
                      isActive
                        ? "bg-(--color-agua-soft) text-(--color-agua-deep)"
                        : "text-slate-700 hover:bg-slate-100"
                    }`}
                    aria-current={isActive ? "page" : undefined}
                  >
                    <span className={isActive ? "text-(--color-agua-deep)" : "text-slate-500"}>{tab.icon}</span>
                    {tab.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Section body */}
        <div className="flex-1 overflow-y-auto">
          {view === "capas" && (
            <div className="px-5 pt-5 pb-6">
              <p className="font-display text-base leading-tight font-semibold text-slate-900">{tr.panelTitle}</p>
              <p className="mt-1 text-xs text-slate-500">{tr.panelHelp}</p>
              <ul className="mt-4 space-y-1">
                {(Object.keys(layerNames) as LayerKey[]).map((k) => {
                  const meta = layerNames[k];
                  return (
                    <li key={k}>
                      <label className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2 transition hover:bg-slate-50">
                        <input
                          type="checkbox"
                          checked={active[k]}
                          onChange={(e) => setActive((s) => ({ ...s, [k]: e.target.checked }))}
                          className="mt-1 h-4 w-4 accent-slate-900"
                        />
                        <span className="flex-1">
                          <span className="flex items-center gap-2 text-sm font-medium text-slate-900">
                            <span className="h-2.5 w-2.5 rounded-full" style={{ background: LAYER_COLORS[k] }} aria-hidden />
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
          )}

          {view === "paseo" && (
            <div className="px-5 pt-5 pb-6">
              <p className="font-display text-base leading-tight font-semibold text-slate-900">{sw.title}</p>
              <p className="mt-1 text-xs text-slate-500">{sw.subtitle}</p>

              {!walkResult && !walkPending && (
                <div className="mt-5 space-y-3">
                  <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">{sw.howTitle}</p>
                  {sw.steps.map((s) => (
                    <div key={s.title} className="rounded-xl bg-(--color-agua-soft)/40 px-3 py-2.5">
                      <p className="text-sm font-semibold text-slate-900">{s.title}</p>
                      <p className="mt-0.5 text-xs text-slate-600">{s.desc}</p>
                    </div>
                  ))}
                </div>
              )}

              {!walkResult && (
                <form className="mt-5 space-y-4" onSubmit={handleGenerateWalk}>
                  <div>
                    <label className="text-xs font-semibold tracking-wider uppercase text-slate-500">
                      {sw.addressLabel}
                    </label>
                    <input
                      type="text"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      placeholder={sw.addressPlaceholder}
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 outline-none transition focus:border-(--color-agua-deep) focus:ring-2 focus:ring-(--color-agua-soft)"
                      disabled={walkPending}
                    />
                    <button
                      type="button"
                      onClick={handleUseMyLocation}
                      className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-(--color-agua-deep) hover:underline"
                      disabled={walkPending}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="2" x2="12" y2="22" />
                        <line x1="2" y1="12" x2="22" y2="12" />
                      </svg>
                      {sw.useMyLocation}
                    </button>
                  </div>

                  <div>
                    <label className="text-xs font-semibold tracking-wider uppercase text-slate-500">
                      {sw.durationLabel}
                    </label>
                    <div className="mt-2 grid grid-cols-4 gap-1.5">
                      {sw.durationOptions.map((opt) => {
                        const isActive = duration === opt.value;
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => setDuration(opt.value)}
                            className={`rounded-lg px-2 py-2 text-sm font-medium transition ${
                              isActive
                                ? "bg-(--color-agua-deep) text-white"
                                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                            }`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={walkPending || !address.trim()}
                    className="w-full rounded-full bg-(--color-agua-deep) px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {walkPending ? sw.generating : sw.generate}
                  </button>

                  {walkError && (
                    <p className="text-xs text-red-600">{walkError}</p>
                  )}
                </form>
              )}

              {walkResult && (
                <div className="mt-5 space-y-4">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="rounded-xl bg-slate-50 px-3 py-3">
                      <p className="text-[10px] tracking-wider uppercase text-slate-500">{sw.resultDistance}</p>
                      <p className="mt-1 font-display text-lg font-semibold text-slate-900">
                        {(walkResult.route.distanceMeters / 1000).toFixed(2)} <span className="text-xs font-medium text-slate-500">km</span>
                      </p>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-3 py-3">
                      <p className="text-[10px] tracking-wider uppercase text-slate-500">{sw.resultTime}</p>
                      <p className="mt-1 font-display text-lg font-semibold text-slate-900">
                        {Math.round(walkResult.route.durationSeconds / 60)} <span className="text-xs font-medium text-slate-500">min</span>
                      </p>
                    </div>
                    <div className="rounded-xl bg-(--color-sombra-soft) px-3 py-3">
                      <p className="text-[10px] tracking-wider uppercase text-slate-500">{sw.resultShade}</p>
                      <p className="mt-1 font-display text-lg font-semibold text-(--color-sombra-deep)">
                        {walkResult.shadePercent}<span className="text-xs font-medium text-slate-500">%</span>
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <button
                      type="button"
                      onClick={handleOpenInGoogleMaps}
                      className="flex w-full items-center justify-center gap-2 rounded-full bg-(--color-agua-deep) px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-900"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                        <circle cx="12" cy="10" r="3" />
                      </svg>
                      {sw.openInMaps}
                    </button>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={handleShare}
                        className="flex items-center justify-center gap-1.5 rounded-full border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <circle cx="18" cy="5" r="3" />
                          <circle cx="6" cy="12" r="3" />
                          <circle cx="18" cy="19" r="3" />
                          <line x1="8.6" y1="13.5" x2="15.4" y2="17.5" />
                          <line x1="15.4" y1="6.5" x2="8.6" y2="10.5" />
                        </svg>
                        {sw.share}
                      </button>
                      <button
                        type="button"
                        onClick={handleDownloadGpx}
                        className="flex items-center justify-center gap-1.5 rounded-full border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <polyline points="7 10 12 15 17 10" />
                          <line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                        GPX
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={handleResetWalk}
                      className="w-full rounded-full text-center text-xs font-medium text-slate-500 transition hover:text-slate-900"
                    >
                      {sw.reset}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {view === "frescos" && (
            <div className="px-5 pt-5 pb-6">
              <p className="font-display text-base leading-tight font-semibold text-slate-900">{freshestT.title}</p>
              <p className="mt-1 text-xs text-slate-500">{freshestT.subtitle}</p>
              <div className="mt-6 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
                {freshestT.soon}
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* Map container */}
      <div className="relative flex-1">
        <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />

        {/* Mobile sidebar trigger */}
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          className="absolute top-3 left-3 z-10 flex items-center gap-2 rounded-full bg-white/95 px-4 py-2 text-sm font-medium text-slate-900 shadow-md backdrop-blur md:hidden"
          aria-label={tr.openPanel}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
          {tr.pillLabel}
        </button>

        {!loaded && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/40 text-sm text-slate-500 backdrop-blur-sm">
            {tr.loading}
          </div>
        )}
      </div>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-30 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setSidebarOpen(false)} aria-hidden />
          <aside className="absolute top-0 left-0 h-full w-80 max-w-[85vw] overflow-y-auto bg-white shadow-xl">
            {/* Cierre */}
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <a href={homeHref} className="flex items-center gap-2.5 text-(--color-ink)">
                <span className="font-display text-lg font-semibold">València Refresca</span>
              </a>
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                className="text-slate-500 hover:text-slate-900"
                aria-label={tr.closePanel}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                  <line x1="6" y1="6" x2="18" y2="18" />
                  <line x1="18" y1="6" x2="6" y2="18" />
                </svg>
              </button>
            </div>
            {/* Aquí podrían reusarse las tabs y secciones; por simplicidad,
                en móvil mostramos solo las capas (la versión completa va en escritorio) */}
            <div className="px-5 pt-5 pb-6">
              <ul className="space-y-1">
                {(Object.keys(layerNames) as LayerKey[]).map((k) => {
                  const meta = layerNames[k];
                  return (
                    <li key={k}>
                      <label className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2 transition hover:bg-slate-50">
                        <input
                          type="checkbox"
                          checked={active[k]}
                          onChange={(e) => setActive((s) => ({ ...s, [k]: e.target.checked }))}
                          className="mt-1 h-4 w-4 accent-slate-900"
                        />
                        <span className="flex-1">
                          <span className="flex items-center gap-2 text-sm font-medium text-slate-900">
                            <span className="h-2.5 w-2.5 rounded-full" style={{ background: LAYER_COLORS[k] }} aria-hidden />
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
          </aside>
        </div>
      )}
    </div>
  );
}
