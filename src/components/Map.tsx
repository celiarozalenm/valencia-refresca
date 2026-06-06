import { useEffect, useRef, useState } from "react";
import maplibregl, { type Map as MapLibre, type StyleSpecification, type LngLatLike } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { STRINGS, LANGS, homeHref, mapaHref, type Lang } from "../i18n/strings";
import { geocode } from "../services/nominatim";
import { generateShadowWalk, googleMapsUrl, routeToGpx, type ShadowWalkResult } from "../services/shadowWalk";
import FreshestRanking from "./FreshestRanking";
import Participar from "./Participar";
import Recientes from "./Recientes";
import { buildFeedbackPopup } from "./feedbackPopup";
import type { EntityType } from "../services/comments";

const VALENCIA_CENTER: LngLatLike = [-0.376, 39.467];

const BRAND = {
  agua: "#3b82f6",
  agua_deep: "#1d4ed8",
  calor: "#f97316",
  sombra: "#22c55e",
  ink: "#1f2937",
} as const;

type LayerKey = "fuentes" | "urinarios" | "duchas" | "lavapies" | "verdes" | "sombra" | "barrios";
type View = "capas" | "cerca" | "paseo" | "frescos" | "participa" | "recientes" | "acerca";
// Tipos de punto "reportable" para los que tiene sentido buscar el más cercano.
type AmenityKind = "fuentes" | "urinarios" | "duchas" | "lavapies";
type PopupKind = AmenityKind | "verdes" | "sombra" | "vulnerabilidad";
interface AmenityPoint {
  lng: number;
  lat: number;
  props: Record<string, unknown>;
}
interface NearestResult extends AmenityPoint {
  kind: AmenityKind;
  dist: number;
}

// Distancia haversine en metros entre dos coordenadas [lng/lat].
function haversineMeters(aLng: number, aLat: number, bLng: number, bLat: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

const LAYER_COLORS: Record<LayerKey, string> = {
  fuentes: BRAND.agua,
  urinarios: BRAND.calor,
  duchas: "#0ea5e9",
  lavapies: "#06b6d4",
  verdes: "#16a34a",
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
  const sidebarT = tr.sidebar;
  const layerNames = tr.layers;
  const sectionsT = tr.sections;
  const freshestT = tr.freshest;
  const aboutT = STRINGS[lang].about;
  const langT = STRINGS[lang].langSwitch;
  const cercaT = tr.cerca;

  const initialView = ((): View => {
    if (typeof window === "undefined") return "capas";
    const hash = window.location.hash.replace("#", "");
    if (
      hash === "cerca" ||
      hash === "paseo" ||
      hash === "frescos" ||
      hash === "participa" ||
      hash === "recientes" ||
      hash === "acerca"
    )
      return hash;
    return "capas";
  })();
  const [view, setView] = useState<View>(initialView);
  const [active, setActive] = useState<Record<LayerKey, boolean>>({
    fuentes: true,
    urinarios: true,
    duchas: false,
    lavapies: false,
    verdes: false,
    sombra: false,
    barrios: true,
  });
  const [loaded, setLoaded] = useState(false);
  const [counts, setCounts] = useState<Partial<Record<LayerKey, number>>>({});
  const verdesLoadedRef = useRef(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [langMenuOpen, setLangMenuOpen] = useState(false);

  // "Cerca de ti": puntos cargados + opener de popup (asignados al cargar el mapa)
  const amenitiesRef = useRef<Record<AmenityKind, AmenityPoint[]>>({
    fuentes: [],
    urinarios: [],
    duchas: [],
    lavapies: [],
  });
  const openPopupRef = useRef<((kind: PopupKind, props: Record<string, unknown>, lng: number, lat: number) => void) | null>(null);
  const [cercaPending, setCercaPending] = useState(false);
  const [cercaError, setCercaError] = useState<string | null>(null);
  const [cercaResults, setCercaResults] = useState<NearestResult[]>([]);
  // Capas overlay panel: empieza expandido en escritorio, plegado en móvil
  const [layersExpanded, setLayersExpanded] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return window.matchMedia("(min-width: 768px)").matches;
  });

  // Paseo de la sombra state
  const [address, setAddress] = useState("");
  const [duration, setDuration] = useState<number>(30);
  const [walkPending, setWalkPending] = useState(false);
  const [walkError, setWalkError] = useState<string | null>(null);
  const [walkResult, setWalkResult] = useState<ShadowWalkResult | null>(null);
  const [walkOrigin, setWalkOrigin] = useState<[number, number] | null>(null);

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

      const loadedCounts: Partial<Record<LayerKey, number>> = {};
      const featureCount = (d: unknown): number =>
        d && typeof d === "object" && Array.isArray((d as { features?: unknown[] }).features)
          ? (d as { features: unknown[] }).features.length
          : 0;

      const fuentesData = await (await fetch("/data/fonts-daigua-publica-fuentes-de-agua-publica.geojson")).json();
      loadedCounts.fuentes = featureCount(fuentesData);
      map.addSource("fuentes", { type: "geojson", data: fuentesData });
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

      const uriData = await (await fetch("/data/urinaris-urinarios.geojson")).json();
      loadedCounts.urinarios = featureCount(uriData);
      map.addSource("urinarios", { type: "geojson", data: uriData });
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

      const duchasData = await (await fetch("/data/dutxes-platja-duchas-playa.geojson")).json();
      loadedCounts.duchas = featureCount(duchasData);
      map.addSource("duchas", { type: "geojson", data: duchasData });
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

      const lavapiesData = await (await fetch("/data/llavapeus-platges-lavapies-playas.geojson")).json();
      loadedCounts.lavapies = featureCount(lavapiesData);
      map.addSource("lavapies", { type: "geojson", data: lavapiesData });
      map.addLayer({
        id: "lavapies-dot",
        type: "circle",
        source: "lavapies",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3, 14, 6, 17, 9],
          "circle-color": LAYER_COLORS.lavapies,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1.5,
        },
        layout: { visibility: "none" },
      });

      setCounts((c) => ({ ...c, ...loadedCounts }));

      // Guarda los puntos (lng/lat + props) para la búsqueda "Cerca de ti".
      const toPoints = (data: unknown): AmenityPoint[] => {
        const feats = (data as { features?: Array<{ geometry?: { type?: string; coordinates?: number[] }; properties?: Record<string, unknown> }> }).features;
        if (!Array.isArray(feats)) return [];
        return feats
          .filter((f) => f.geometry?.type === "Point" && Array.isArray(f.geometry.coordinates))
          .map((f) => ({ lng: f.geometry!.coordinates![0], lat: f.geometry!.coordinates![1], props: f.properties ?? {} }));
      };
      amenitiesRef.current = {
        fuentes: toPoints(fuentesData),
        urinarios: toPoints(uriData),
        duchas: toPoints(duchasData),
        lavapies: toPoints(lavapiesData),
      };

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
        lavapies: (p: Record<string, unknown>) =>
          `<strong>Lavapiés de playa</strong><br/>${p.calle ?? "Playa"}`,
        verdes: (p: Record<string, unknown>) =>
          `<strong>${p.nombre ?? "Espacio verde"}</strong><br/>${p.tipologia ?? ""}<br/><span style="color:#6b7280">${Number(p.sup_total ?? 0).toLocaleString("es-ES")} m²${p.barrio ? ` · ${p.barrio}` : ""}</span>`,
        sombra: (p: Record<string, unknown>) =>
          `<strong>${p.nombre ?? ""}</strong><br/>${Number(p.arboles ?? 0).toLocaleString("es-ES")} árboles<br/><span style="color:#6b7280">${p.arboles_per_km2 ?? "?"} árboles/km²</span>`,
        vulnerabilidad: (p: Record<string, unknown>) =>
          `<strong>${p.nombre ?? ""}</strong><br/>${p.vul_global ?? ""}<br/><span style="color:#6b7280">Índice global ${p.ind_global ?? "?"}</span>`,
      } as const;

      // Reportable amenities open an interactive feedback popup (👍/👎 + comment);
      // returns null for non-reportable kinds so they fall back to plain HTML.
      const feedbackArgs = (
        kind: keyof typeof popupHtml,
        p: Record<string, unknown>,
      ): { entityType: EntityType; entityId: string; title: string; address: string; extra: string } | null => {
        if (kind === "fuentes") {
          const id = String(p.codigo ?? p.objectid ?? "").trim();
          if (!id) return null;
          return { entityType: "fuente", entityId: id, title: "Fuente de agua", address: String(p.calle ?? "Sin dirección"), extra: p.codigo ? `Código ${p.codigo}` : "" };
        }
        if (kind === "urinarios") {
          const id = String(p.objectid ?? "").trim();
          if (!id) return null;
          return { entityType: "urinario", entityId: id, title: "Urinario", address: String(p.direccion ?? "Sin dirección"), extra: `${p.cabina_nor ?? 0} cabina(s) · ${p.cabina_min ?? 0} movilidad reducida` };
        }
        if (kind === "duchas") {
          const id = String(p.codigo ?? p.objectid ?? "").trim();
          if (!id) return null;
          return { entityType: "ducha", entityId: id, title: "Ducha de playa", address: String(p.calle ?? "Sin dirección"), extra: p.codigo ? `Código ${p.codigo}` : "" };
        }
        return null;
      };

      // Prioridad al hacer clic: los puntos "reportables" (fuente, urinario,
      // ducha) ganan SIEMPRE a los polígonos que los cubren. Vulnerabilidad y
      // sombra cubren toda la ciudad y, con handlers por capa, robaban el clic
      // y abrían su popup en vez del de feedback con 👍/👎.
      const pointLayers: Array<[string, keyof typeof popupHtml]> = [
        ["fuentes-dot", "fuentes"],
        ["urinarios-dot", "urinarios"],
        ["duchas-dot", "duchas"],
        ["lavapies-dot", "lavapies"],
        ["verdes-fill", "verdes"],
        ["sombra-fill", "sombra"],
        ["vulnerabilidad-fill", "vulnerabilidad"],
      ];
      // Un único popup compartido: clicar otro punto reemplaza el abierto.
      let activePopup: maplibregl.Popup | null = null;
      const openPopup = (kind: PopupKind, props: Record<string, unknown>, lng: number, lat: number) => {
        const fb = feedbackArgs(kind, props);
        activePopup?.remove();
        const popup = new maplibregl.Popup({ closeButton: true, offset: 10, maxWidth: "320px" }).setLngLat([lng, lat]);
        if (fb) {
          popup.setDOMContent(buildFeedbackPopup({ ...fb, lat, lng, lang }));
        } else {
          popup.setHTML(popupHtml[kind](props));
        }
        popup.on("close", () => {
          if (activePopup === popup) activePopup = null;
        });
        popup.addTo(map);
        activePopup = popup;
      };
      openPopupRef.current = openPopup;
      map.on("click", (e) => {
        const candidateIds = pointLayers.map(([id]) => id).filter((id) => map.getLayer(id));
        const hits = map.queryRenderedFeatures(e.point, { layers: candidateIds });
        if (!hits.length) return;
        let chosen: { kind: keyof typeof popupHtml; props: Record<string, unknown> } | null = null;
        for (const [layerId, kind] of pointLayers) {
          const hit = hits.find((h) => h.layer?.id === layerId);
          if (hit) {
            chosen = { kind, props: (hit.properties ?? {}) as Record<string, unknown> };
            break;
          }
        }
        if (!chosen) return;
        openPopup(chosen.kind, chosen.props, e.lngLat.lng, e.lngLat.lat);
      });
      pointLayers.forEach(([layerId]) => {
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
    apply("lavapies-dot", active.lavapies);
    apply("verdes-fill", active.verdes);
    apply("verdes-line", active.verdes);
    apply("sombra-fill", active.sombra);
    apply("sombra-line", active.sombra);
    apply("vulnerabilidad-fill", active.barrios);
    apply("vulnerabilidad-line", active.barrios);
  }, [active, loaded]);

  // Espacios verdes: 6 MB de polígonos. Se cargan sólo la primera vez que se activan.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded || !active.verdes || verdesLoadedRef.current) return;
    verdesLoadedRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const data = await (await fetch("/data/espais-verds-espacios-verdes.geojson")).json();
        if (cancelled || !mapRef.current) return;
        if (!map.getSource("verdes")) {
          const beforeId = map.getLayer("fuentes-dot") ? "fuentes-dot" : undefined;
          map.addSource("verdes", { type: "geojson", data });
          map.addLayer(
            {
              id: "verdes-fill",
              type: "fill",
              source: "verdes",
              paint: { "fill-color": LAYER_COLORS.verdes, "fill-opacity": 0.55 },
            },
            beforeId,
          );
          map.addLayer(
            {
              id: "verdes-line",
              type: "line",
              source: "verdes",
              paint: { "line-color": "#166534", "line-width": 1.2, "line-opacity": 0.9 },
            },
            beforeId,
          );
        }
        setCounts((c) => ({ ...c, verdes: Array.isArray(data.features) ? data.features.length : 0 }));
      } catch {
        // Permitir reintento al volver a activar la capa.
        verdesLoadedRef.current = false;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active.verdes, loaded]);

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

  // El mapa necesita "resize" cuando aparece/desaparece el panel overlay grande
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const t = setTimeout(() => map.resize(), 350);
    return () => clearTimeout(t);
  }, [view, walkResult]);

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

  // "Cerca de ti": calcula el punto más cercano de cada tipo a una ubicación.
  function findNearest(lng: number, lat: number): NearestResult[] {
    const kinds: AmenityKind[] = ["fuentes", "urinarios", "duchas", "lavapies"];
    const out: NearestResult[] = [];
    for (const kind of kinds) {
      let best: AmenityPoint | null = null;
      let bestD = Infinity;
      for (const pt of amenitiesRef.current[kind]) {
        const d = haversineMeters(lng, lat, pt.lng, pt.lat);
        if (d < bestD) {
          bestD = d;
          best = pt;
        }
      }
      if (best) out.push({ ...best, kind, dist: bestD });
    }
    out.sort((a, b) => a.dist - b.dist);
    return out;
  }

  function handleLocateNearby() {
    if (!navigator.geolocation) {
      setCercaError(cercaT.denied);
      return;
    }
    setCercaPending(true);
    setCercaError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCercaResults(findNearest(pos.coords.longitude, pos.coords.latitude));
        setCercaPending(false);
      },
      () => {
        setCercaError(cercaT.denied);
        setCercaPending(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  // Lleva el resultado al mapa: enciende su capa, vuela y abre su ficha.
  function focusAmenity(r: NearestResult) {
    setActive((s) => ({ ...s, [r.kind]: true }));
    setView("capas");
    setMobileNavOpen(false);
    setTimeout(() => {
      const map = mapRef.current;
      if (!map) return;
      map.flyTo({ center: [r.lng, r.lat], zoom: 16, duration: 800 });
      map.once("moveend", () => openPopupRef.current?.(r.kind, r.props, r.lng, r.lat));
    }, 420);
  }

  const homeUrl = homeHref(lang);

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
      key: "cerca",
      label: sectionsT.cerca,
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
          <circle cx="12" cy="10" r="3" />
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
    {
      key: "participa",
      label: sectionsT.participa,
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </svg>
      ),
    },
    {
      key: "recientes",
      label: sectionsT.recientes,
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
      ),
    },
  ];

  const SidebarNav = (
    <>
      <div className="border-b border-slate-100 px-5 py-4">
        <a href={homeUrl} className="flex items-center gap-2.5 text-(--color-ink) transition hover:opacity-80" onClick={() => setMobileNavOpen(false)}>
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
          <span className="font-display text-base leading-tight font-semibold">
            València<br /><span className="font-medium">Refresca</span>
          </span>
        </a>
      </div>
      <nav className="flex-1 px-2 py-3">
        <ul className="flex flex-col gap-0.5">
          {tabs.map((tab) => {
            const isActive = view === tab.key;
            return (
              <li key={tab.key}>
                <button
                  type="button"
                  onClick={() => {
                    setView(tab.key);
                    setMobileNavOpen(false);
                  }}
                  className={`flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition ${
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
      {/* Acerca de: abajo, separado de las secciones del mapa */}
      <div className="px-2 pb-2">
        <button
          type="button"
          onClick={() => {
            setView("acerca");
            setMobileNavOpen(false);
          }}
          className={`flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition ${
            view === "acerca"
              ? "bg-(--color-agua-soft) text-(--color-agua-deep)"
              : "text-slate-700 hover:bg-slate-100"
          }`}
          aria-current={view === "acerca" ? "page" : undefined}
        >
          <span className={view === "acerca" ? "text-(--color-agua-deep)" : "text-slate-500"}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
          </span>
          {sectionsT.acerca}
        </button>
      </div>
      <div className="border-t border-slate-100 px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <a
            href={homeUrl}
            onClick={() => setMobileNavOpen(false)}
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-(--color-ink)"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
            {sidebarT.homeCta}
          </a>

          {/* Selector de idioma (desplegable, abre hacia arriba) */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setLangMenuOpen((o) => !o)}
              aria-haspopup="true"
              aria-expanded={langMenuOpen}
              aria-label={langT.aria}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-100"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400" aria-hidden>
                <circle cx="12" cy="12" r="10" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
              <span className="text-(--color-calor-deep)">{langT[lang]}</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`text-slate-400 transition ${langMenuOpen ? "rotate-180" : ""}`} aria-hidden>
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {langMenuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setLangMenuOpen(false)} aria-hidden />
                <div className="absolute right-0 bottom-full z-20 mb-2 w-40 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                  {LANGS.map((l) => {
                    const isCurrent = l === lang;
                    const full = l === "es" ? langT.labelEs : l === "va" ? langT.labelVa : langT.labelEn;
                    return (
                      <a
                        key={l}
                        href={mapaHref(l)}
                        className={`flex items-center justify-between gap-3 px-3 py-2 text-sm transition ${
                          isCurrent
                            ? "bg-(--color-agua-soft) font-semibold text-(--color-agua-deep)"
                            : "text-slate-700 hover:bg-slate-100"
                        }`}
                        aria-current={isCurrent ? "true" : undefined}
                      >
                        <span>{full}</span>
                        <span className="text-[10px] font-semibold tracking-wider text-slate-400">{langT[l]}</span>
                      </a>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );

  const showMap = view === "capas" || (view === "paseo" && walkResult !== null);

  return (
    <div className="relative flex h-full w-full overflow-hidden bg-slate-100">
      {/* Sidebar (escritorio) */}
      <aside className="z-20 hidden h-full w-56 shrink-0 flex-col border-r border-slate-200 bg-white shadow-sm md:flex">
        {SidebarNav}
      </aside>

      {/* Sidebar móvil */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileNavOpen(false)} aria-hidden />
          <aside className="absolute top-0 left-0 flex h-full w-64 max-w-[85vw] flex-col bg-white shadow-xl">
            {SidebarNav}
          </aside>
        </div>
      )}

      {/* Main area */}
      <div className="relative flex-1">
        {/* El mapa está siempre montado, sólo se oculta visualmente */}
        <div
          ref={containerRef}
          style={{ position: "absolute", inset: 0 }}
          className={showMap ? "block" : "invisible"}
        />

        {/* Botón de menú móvil — z alto para que siempre quede por encima de las secciones */}
        <button
          type="button"
          onClick={() => setMobileNavOpen(true)}
          className="absolute top-3 left-3 z-30 flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-white/95 text-slate-900 shadow-md backdrop-blur md:hidden"
          aria-label="Abrir navegación"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>

        {/* Overlay panel: Capas (sobre el mapa) */}
        {view === "capas" && (
          <div className="pointer-events-none absolute top-16 left-3 z-10 max-w-xs md:top-6 md:left-6">
            <div className="pointer-events-auto rounded-2xl bg-white/95 shadow-lg backdrop-blur">
              <button
                type="button"
                onClick={() => setLayersExpanded((v) => !v)}
                aria-expanded={layersExpanded}
                aria-controls="capas-list"
                className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left transition hover:bg-slate-50/60"
              >
                <span className="flex items-center gap-2">
                  {/* Dots de las capas activas */}
                  <span className="flex -space-x-1.5">
                    {(Object.keys(layerNames) as LayerKey[])
                      .filter((k) => active[k])
                      .slice(0, 4)
                      .map((k) => (
                        <span
                          key={k}
                          className="h-3 w-3 rounded-full ring-2 ring-white"
                          style={{ background: LAYER_COLORS[k] }}
                          aria-hidden
                        />
                      ))}
                  </span>
                  <span>
                    <span className="block font-display text-sm leading-tight font-semibold text-slate-900">{tr.panelTitle}</span>
                    {layersExpanded && <span className="mt-0.5 block text-xs text-slate-500">{tr.panelHelp}</span>}
                  </span>
                </span>
                <svg
                  className={`h-4 w-4 shrink-0 text-slate-500 transition ${layersExpanded ? "rotate-180" : ""}`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
              {layersExpanded && (
              <ul id="capas-list" className="space-y-1.5 px-4 pt-1 pb-4">
                {(Object.keys(layerNames) as LayerKey[]).map((k) => {
                  const meta = layerNames[k];
                  const count = counts[k];
                  return (
                    <li key={k}>
                      <label className="flex cursor-pointer items-start gap-2.5 rounded-lg px-1.5 py-1 transition hover:bg-slate-50">
                        <input
                          type="checkbox"
                          checked={active[k]}
                          onChange={(e) => setActive((s) => ({ ...s, [k]: e.target.checked }))}
                          className="mt-0.5 h-4 w-4 cursor-pointer accent-slate-900"
                        />
                        <span className="flex-1">
                          <span className="flex items-center gap-2 text-sm font-medium text-slate-900">
                            <span className="h-2.5 w-2.5 rounded-full" style={{ background: LAYER_COLORS[k] }} aria-hidden />
                            {meta.label}
                          </span>
                          <span className="text-xs text-slate-500">{meta.description}</span>
                        </span>
                        {count != null && (
                          <span className="mt-0.5 shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-slate-500">
                            {count.toLocaleString("es-ES")}
                          </span>
                        )}
                      </label>
                    </li>
                  );
                })}
              </ul>
              )}
            </div>
          </div>
        )}

        {/* Paseo fresco: pantalla form (cuando NO hay resultado) */}
        {view === "paseo" && !walkResult && (
          <div className="absolute inset-0 z-10 overflow-y-auto bg-(--color-bone)">
            <div className="mx-auto max-w-3xl px-6 pt-16 pb-12 md:px-10 md:pt-6 md:pb-16">
              <h1 className="font-display text-4xl leading-tight text-(--color-agua-deep) md:text-5xl">
                {sw.title}
              </h1>
              <p className="mt-3 max-w-xl text-(--color-ink-soft) md:text-lg">{sw.subtitle}</p>

              <div className="mt-10 grid gap-4 md:grid-cols-3">
                {sw.steps.map((s) => (
                  <div key={s.title} className="rounded-2xl bg-white p-5 ring-1 ring-(--color-ink)/8">
                    <p className="font-display text-base font-semibold text-(--color-ink)">{s.title}</p>
                    <p className="mt-1.5 text-sm leading-relaxed text-(--color-ink-soft)">{s.desc}</p>
                  </div>
                ))}
              </div>

              <form className="mt-10 space-y-6 rounded-2xl bg-white p-6 ring-1 ring-(--color-ink)/8 md:p-8" onSubmit={handleGenerateWalk}>
                <div>
                  <label className="text-xs font-semibold tracking-wider uppercase text-(--color-ink-soft)">
                    {sw.addressLabel}
                  </label>
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder={sw.addressPlaceholder}
                    className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-base text-slate-900 placeholder-slate-400 outline-none transition focus:border-(--color-agua-deep) focus:ring-2 focus:ring-(--color-agua-soft)"
                    disabled={walkPending}
                  />
                  <button
                    type="button"
                    onClick={handleUseMyLocation}
                    className="mt-2 inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-(--color-agua-deep) hover:underline"
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
                  <label className="text-xs font-semibold tracking-wider uppercase text-(--color-ink-soft)">
                    {sw.durationLabel}
                  </label>
                  <div className="mt-2 grid grid-cols-4 gap-2">
                    {sw.durationOptions.map((opt) => {
                      const isActive = duration === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setDuration(opt.value)}
                          className={`cursor-pointer rounded-lg px-2 py-2.5 text-sm font-medium transition ${
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
                  className="w-full cursor-pointer rounded-full bg-(--color-agua-deep) px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {walkPending ? sw.generating : sw.generate}
                </button>

                {walkError && <p className="text-sm text-red-600">{walkError}</p>}
              </form>
            </div>
          </div>
        )}

        {/* Paseo fresco: resultado (panel flotante sobre mapa) */}
        {view === "paseo" && walkResult && (
          <div className="pointer-events-none absolute top-4 left-4 z-10 max-w-xs md:top-6 md:left-6">
            <div className="pointer-events-auto rounded-2xl bg-white/95 p-4 shadow-lg backdrop-blur md:w-80 md:p-5">
              <p className="font-display text-sm font-semibold text-slate-900">{sw.title}</p>
              <p className="mt-0.5 text-xs text-slate-500">{walkOrigin ? address : ""}</p>

              <div className="mt-4 grid grid-cols-3 gap-2">
                <div className="rounded-xl bg-slate-50 px-2 py-2.5 text-center">
                  <p className="text-[10px] tracking-wider uppercase text-slate-500">{sw.resultDistance}</p>
                  <p className="mt-0.5 font-display text-base font-semibold text-slate-900">
                    {(walkResult.route.distanceMeters / 1000).toFixed(1)}<span className="ml-0.5 text-[10px] font-medium text-slate-500">km</span>
                  </p>
                </div>
                <div className="rounded-xl bg-slate-50 px-2 py-2.5 text-center">
                  <p className="text-[10px] tracking-wider uppercase text-slate-500">{sw.resultTime}</p>
                  <p className="mt-0.5 font-display text-base font-semibold text-slate-900">
                    {Math.round(walkResult.route.durationSeconds / 60)}<span className="ml-0.5 text-[10px] font-medium text-slate-500">min</span>
                  </p>
                </div>
                <div className="rounded-xl bg-(--color-sombra-soft) px-2 py-2.5 text-center">
                  <p className="text-[10px] tracking-wider uppercase text-slate-500">{sw.resultShade}</p>
                  <p className="mt-0.5 font-display text-base font-semibold text-(--color-sombra-deep)">
                    {walkResult.shadePercent}<span className="ml-0.5 text-[10px] font-medium text-slate-500">%</span>
                  </p>
                </div>
              </div>

              <div className="mt-4 space-y-2">
                <button
                  type="button"
                  onClick={handleOpenInGoogleMaps}
                  className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-(--color-agua-deep) px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-900"
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
                    className="flex cursor-pointer items-center justify-center gap-1.5 rounded-full border border-slate-300 px-2 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    {sw.share}
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadGpx}
                    className="flex cursor-pointer items-center justify-center gap-1.5 rounded-full border border-slate-300 px-2 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    {sw.download}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={handleResetWalk}
                  className="w-full cursor-pointer text-center text-xs font-medium text-slate-500 transition hover:text-slate-900"
                >
                  {sw.reset}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Cerca de ti: geolocaliza y lista lo más cercano */}
        {view === "cerca" && (
          <div className="absolute inset-0 z-10 overflow-y-auto bg-(--color-bone)">
            <div className="mx-auto max-w-2xl px-6 pt-16 pb-12 md:px-10 md:pt-6 md:pb-16">
              <h1 className="font-display text-4xl leading-[1.1] text-(--color-agua-deep) md:text-5xl">{cercaT.title}</h1>
              <p className="mt-3 max-w-xl text-(--color-ink-soft) md:text-lg">{cercaT.subtitle}</p>

              <button
                type="button"
                onClick={handleLocateNearby}
                disabled={cercaPending}
                className="mt-8 inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-(--color-agua-deep) px-6 py-3.5 text-sm font-semibold text-white transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <circle cx="12" cy="12" r="3" />
                  <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
                  <circle cx="12" cy="12" r="9" />
                </svg>
                {cercaPending ? cercaT.locating : cercaT.locate}
              </button>

              {cercaError && <p className="mt-3 text-sm text-red-600">{cercaError}</p>}

              {!cercaPending && cercaResults.length === 0 && !cercaError && (
                <p className="mt-6 text-sm text-(--color-ink-soft)">{cercaT.intro}</p>
              )}

              {cercaResults.length > 0 && (
                <ul className="mt-8 grid gap-3 sm:grid-cols-2">
                  {cercaResults.map((r) => {
                    const addr = String(r.props.calle ?? r.props.direccion ?? r.props.nombre ?? "");
                    return (
                      <li key={r.kind}>
                        <button
                          type="button"
                          onClick={() => focusAmenity(r)}
                          className="flex w-full cursor-pointer items-center gap-3 rounded-2xl bg-white p-4 text-left ring-1 ring-(--color-ink)/8 transition hover:ring-(--color-agua-deep)/30"
                        >
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full" style={{ background: `${LAYER_COLORS[r.kind]}1f` }} aria-hidden>
                            <span className="h-3 w-3 rounded-full" style={{ background: LAYER_COLORS[r.kind] }} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-semibold text-(--color-ink)">{layerNames[r.kind].label}</span>
                            {addr && <span className="block truncate text-xs text-(--color-ink-soft)">{addr}</span>}
                          </span>
                          <span className="shrink-0 text-right">
                            <span className="block font-display text-base font-semibold text-(--color-agua-deep)">{formatDistance(r.dist)}</span>
                            <span className="block text-[10px] text-slate-400">{cercaT.viewOnMap}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        )}

        {/* Barrios frescos: pantalla de contenido */}
        {view === "frescos" && (
          <div className="absolute inset-0 z-10 overflow-y-auto bg-(--color-bone)">
            <div className="mx-auto max-w-5xl px-6 pt-16 pb-12 md:px-10 md:pt-6 md:pb-16">
              <h1 className="font-display text-4xl leading-tight text-(--color-agua-deep) md:text-5xl">{freshestT.title}</h1>
              <p className="mt-3 max-w-2xl text-(--color-ink-soft) md:text-lg">{freshestT.subtitle}</p>
              <div className="mt-10">
                <FreshestRanking lang={lang} />
              </div>
            </div>
          </div>
        )}

        {view === "participa" && (
          <div className="absolute inset-0 z-10 overflow-y-auto bg-(--color-bone) pt-12 md:pt-0">
            <Participar lang={lang} />
          </div>
        )}

        {view === "recientes" && (
          <div className="absolute inset-0 z-10 overflow-y-auto bg-(--color-bone) pt-12 md:pt-0">
            <Recientes lang={lang} />
          </div>
        )}

        {/* Acerca de: ficha del proyecto */}
        {view === "acerca" && (
          <div className="absolute inset-0 z-10 overflow-y-auto bg-(--color-bone)">
            <div className="mx-auto max-w-3xl px-6 pt-16 pb-12 md:px-10 md:pt-6 md:pb-16">
              <p className="font-display text-xs font-semibold tracking-wider uppercase text-(--color-calor-deep)">{aboutT.eyebrow}</p>
              <h1 className="mt-2 font-display text-4xl leading-[1.1] text-(--color-agua-deep) md:text-5xl">{aboutT.title}</h1>
              <p className="mt-4 max-w-2xl text-(--color-ink-soft) md:text-lg">{aboutT.lede}</p>

              <div className="mt-10">
                <h2 className="font-display text-lg font-semibold text-(--color-ink)">{aboutT.datasetsTitle}</h2>
                <p className="mt-1 text-sm text-(--color-ink-soft)">{aboutT.datasetsCaption}</p>
                <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                  {aboutT.datasets.map((d) => (
                    <li key={d.label}>
                      <div className="rounded-xl bg-white px-4 py-3 ring-1 ring-(--color-ink)/8">
                        <span className="text-sm font-medium text-(--color-ink)">{d.label}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mt-10">
                <h2 className="font-display text-lg font-semibold text-(--color-ink)">{aboutT.stackTitle}</h2>
                <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                  {aboutT.stack.map((s) => (
                    <li key={s.name} className="rounded-xl bg-white p-4 ring-1 ring-(--color-ink)/8">
                      <p className="text-sm font-semibold text-(--color-ink)">{s.name}</p>
                      <p className="mt-0.5 text-xs text-(--color-ink-soft)">{s.desc}</p>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mt-10 rounded-2xl bg-white p-6 ring-1 ring-(--color-ink)/8">
                <h2 className="font-display text-lg font-semibold text-(--color-ink)">{aboutT.reproTitle}</h2>
                <p className="mt-2 text-sm leading-relaxed text-(--color-ink-soft)">{aboutT.reproBody}</p>
                <div className="mt-4 flex flex-wrap gap-3">
                  <a
                    href="https://github.com/celiarozalenm/valencia-refresca"
                    target="_blank"
                    rel="noopener"
                    className="inline-flex items-center gap-2 rounded-full bg-(--color-agua-deep) px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-900"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2.16c-3.2.7-3.88-1.36-3.88-1.36-.52-1.34-1.28-1.7-1.28-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.23-1.28-5.23-5.7 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.04 0 0 .96-.31 3.15 1.18a10.92 10.92 0 0 1 5.74 0c2.18-1.49 3.14-1.18 3.14-1.18.62 1.58.23 2.75.11 3.04.74.81 1.18 1.84 1.18 3.1 0 4.43-2.69 5.4-5.25 5.69.41.36.78 1.06.78 2.15v3.18c0 .31.21.67.8.56C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z" />
                    </svg>
                    {aboutT.ctaRepo}
                  </a>
                  <a
                    href="https://valencia.opendatasoft.com"
                    target="_blank"
                    rel="noopener"
                    className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-5 py-2.5 text-sm font-semibold text-(--color-ink) transition hover:bg-slate-50"
                  >
                    {aboutT.ctaPortal}
                  </a>
                </div>
              </div>

              <div className="mt-10 grid gap-6 sm:grid-cols-2">
                <div>
                  <h2 className="font-display text-sm font-semibold tracking-wider uppercase text-slate-500">{aboutT.authorTitle}</h2>
                  <p className="mt-2 text-sm font-medium text-(--color-ink)">{aboutT.authorName}</p>
                  <p className="mt-0.5 text-sm text-(--color-ink-soft)">{aboutT.authorRole}</p>
                  <a href={`mailto:${aboutT.authorContact}`} className="mt-1 inline-block text-sm font-medium text-(--color-agua-deep) hover:underline">
                    {aboutT.authorContact}
                  </a>
                </div>
                <div>
                  <h2 className="font-display text-sm font-semibold tracking-wider uppercase text-slate-500">{aboutT.licenseTitle}</h2>
                  <p className="mt-2 text-sm leading-relaxed text-(--color-ink-soft)">{aboutT.licenseBody}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {!loaded && showMap && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/40 text-sm text-slate-500 backdrop-blur-sm">
            {tr.loading}
          </div>
        )}
      </div>
    </div>
  );
}
