import { useEffect, useRef, useState, type ComponentType } from "react";
import { STRINGS, type Lang } from "../i18n/strings";

// Carga el componente Map solo cuando entra (o se acerca a) el viewport.
// MapLibre + GeoJSONs (~600 KB) no entran en el bundle inicial.

interface Props {
  lang?: Lang;
}

export default function MapLazy({ lang = "es" }: Props) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [MapComponent, setMapComponent] = useState<ComponentType<{ lang: Lang }> | null>(null);

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

  if (MapComponent) return <MapComponent lang={lang} />;

  return (
    <div
      ref={sentinelRef}
      className="relative h-full w-full bg-slate-100"
    >
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-slate-600">
        <div className="h-8 w-8 animate-pulse rounded-full bg-slate-300" aria-hidden />
        <p className="text-sm">{STRINGS[lang].map.loading}</p>
      </div>
    </div>
  );
}
