import { useEffect, useRef, useState, type ComponentType } from "react";

// Carga el componente Map solo cuando entra (o se acerca a) el viewport.
// MapLibre + GeoJSONs (~600 KB) no entran en el bundle inicial.

export default function MapLazy() {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [MapComponent, setMapComponent] = useState<ComponentType | null>(null);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;

    let cancelled = false;

    const load = () => {
      if (cancelled) return;
      import("./Map").then((mod) => {
        if (!cancelled) setMapComponent(() => mod.default);
      });
    };

    if (typeof IntersectionObserver === "undefined") {
      load();
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            observer.disconnect();
            load();
            break;
          }
        }
      },
      { rootMargin: "300px" },
    );

    observer.observe(node);

    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, []);

  if (MapComponent) return <MapComponent />;

  return (
    <div
      ref={sentinelRef}
      className="relative w-full overflow-hidden rounded-3xl bg-slate-100 ring-1 ring-slate-200/60"
      style={{ height: "min(78vh, 720px)", minHeight: 520 }}
    >
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-slate-500">
        <div className="h-8 w-8 animate-pulse rounded-full bg-slate-300" aria-hidden />
        <p className="text-sm">El mapa se cargará al acercarte…</p>
      </div>
    </div>
  );
}
