import { useEffect, useMemo, useState } from "react";
import { STRINGS, type Lang } from "../i18n/strings";

type Bucket = "muy_alta" | "alta" | "media" | "baja" | "muy_baja";

interface BarrioProps {
  nombre: string;
  area_km2: number;
  arboles: number;
  arboles_per_km2: number;
  sombra_bucket: Bucket;
}

type Collection = GeoJSON.FeatureCollection<GeoJSON.Geometry, BarrioProps>;

const BUCKET_ORDER: Bucket[] = ["muy_alta", "alta", "media", "baja", "muy_baja"];

const BUCKET_COLORS: Record<Bucket, string> = {
  muy_alta: "#166534",
  alta: "#22c55e",
  media: "#86efac",
  baja: "#fde68a",
  muy_baja: "#f97316",
};

interface Props {
  lang?: Lang;
}

export default function FreshestRanking({ lang = "es" }: Props) {
  const tr = STRINGS[lang].map.freshest;
  const numFmt = useMemo(() => new Intl.NumberFormat(lang === "va" ? "ca" : "es-ES"), [lang]);

  const [barrios, setBarrios] = useState<BarrioProps[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/data/barrios-sombra.geojson")
      .then((r) => r.json())
      .then((data: Collection) => {
        if (cancelled) return;
        const arr = data.features
          .map((f) => f.properties)
          .filter((p) => Number.isFinite(p.arboles_per_km2));
        setBarrios(arr);
      })
      .catch(() => setBarrios([]));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!barrios) {
    return (
      <div className="text-sm text-slate-500">{tr.loading}</div>
    );
  }

  const sorted = [...barrios].sort((a, b) => b.arboles_per_km2 - a.arboles_per_km2);
  const top = sorted.slice(0, 10);
  const bottom = sorted.slice(-10).reverse();
  const maxDensity = sorted[0]?.arboles_per_km2 ?? 1;
  const minDensity = sorted[sorted.length - 1]?.arboles_per_km2 ?? 1;
  // Para la brecha usamos el menor valor NO cero (algunos barrios tienen 0
  // árboles registrados, lo que rompería la división y el ratio dejaría de
  // ser interpretable).
  const minNonZero = [...sorted].reverse().find((b) => b.arboles_per_km2 > 0)?.arboles_per_km2 ?? 1;
  const gap = Math.round(maxDensity / minNonZero);

  const dist = BUCKET_ORDER.map((b) => ({
    bucket: b,
    count: barrios.filter((p) => p.sombra_bucket === b).length,
  }));
  const distMax = Math.max(...dist.map((d) => d.count), 1);

  return (
    <div className="space-y-10">
      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        <StatCard
          label={tr.statMost}
          value={top[0]?.nombre.toLocaleLowerCase().replace(/^./, (c) => c.toUpperCase()) ?? "—"}
          sub={`${numFmt.format(Math.round(top[0]?.arboles_per_km2 ?? 0))} ${tr.unit}`}
          accent="sombra"
        />
        <StatCard
          label={tr.statLeast}
          value={bottom[0]?.nombre.toLocaleLowerCase().replace(/^./, (c) => c.toUpperCase()) ?? "—"}
          sub={`${numFmt.format(Math.round(bottom[0]?.arboles_per_km2 ?? 0))} ${tr.unit}`}
          accent="calor"
        />
        <StatCard
          label={tr.statGap}
          value={`${numFmt.format(gap)}×`}
          sub={`${numFmt.format(Math.round(maxDensity))} vs ${numFmt.format(Math.round(minNonZero))}`}
          accent="agua"
        />
        <StatCard
          label={tr.statTotal}
          value={numFmt.format(barrios.length)}
          sub={lang === "va" ? "barris" : "barrios"}
          accent="ink"
        />
      </div>

      {/* Top + Bottom rankings */}
      <div className="grid gap-6 md:grid-cols-2">
        <RankingList
          title={tr.topTitle}
          items={top}
          maxDensity={maxDensity}
          unit={tr.unit}
          color="var(--color-sombra-deep)"
          softColor="var(--color-sombra-soft)"
          numFmt={numFmt}
        />
        <RankingList
          title={tr.bottomTitle}
          items={bottom}
          maxDensity={maxDensity}
          unit={tr.unit}
          color="var(--color-calor-deep)"
          softColor="var(--color-calor-soft)"
          numFmt={numFmt}
        />
      </div>

      {/* Distribution by bucket */}
      <div className="rounded-2xl bg-white p-6 ring-1 ring-(--color-ink)/8 md:p-7">
        <p className="font-display text-lg font-semibold text-(--color-ink)">{tr.distTitle}</p>
        <p className="mt-1 text-sm text-(--color-ink-soft)">{tr.distCaption}</p>
        <ul className="mt-5 space-y-3">
          {dist.map((d) => (
            <li key={d.bucket}>
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 font-medium text-(--color-ink)">
                  <span className="h-3 w-3 rounded-full" style={{ background: BUCKET_COLORS[d.bucket] }} aria-hidden />
                  {tr.bucket[d.bucket]}
                </span>
                <span className="font-display font-semibold text-(--color-ink)">{numFmt.format(d.count)}</span>
              </div>
              <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${(d.count / distMax) * 100}%`, background: BUCKET_COLORS[d.bucket] }}
                />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: string;
  sub: string;
  accent: "sombra" | "calor" | "agua" | "ink";
}

function StatCard({ label, value, sub, accent }: StatCardProps) {
  const map = {
    sombra: { bg: "var(--color-sombra-soft)", fg: "var(--color-sombra-deep)" },
    calor: { bg: "var(--color-calor-soft)", fg: "var(--color-calor-deep)" },
    agua: { bg: "var(--color-agua-soft)", fg: "var(--color-agua-deep)" },
    ink: { bg: "#f1f5f9", fg: "#1f2937" },
  } as const;
  const c = map[accent];
  return (
    <div className="rounded-2xl bg-white p-4 ring-1 ring-(--color-ink)/8 md:p-5">
      <p className="text-[10px] font-semibold tracking-wider uppercase text-(--color-ink-soft)">{label}</p>
      <p className="mt-1.5 font-display text-2xl leading-tight font-semibold" style={{ color: c.fg }}>
        {value}
      </p>
      <p className="mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: c.bg, color: c.fg }}>
        {sub}
      </p>
    </div>
  );
}

interface RankingListProps {
  title: string;
  items: BarrioProps[];
  maxDensity: number;
  unit: string;
  color: string;
  softColor: string;
  numFmt: Intl.NumberFormat;
}

function RankingList({ title, items, maxDensity, unit, color, softColor, numFmt }: RankingListProps) {
  return (
    <div className="rounded-2xl bg-white p-5 ring-1 ring-(--color-ink)/8 md:p-6">
      <p className="font-display text-lg font-semibold text-(--color-ink)">{title}</p>
      <ol className="mt-4 space-y-3">
        {items.map((b, i) => (
          <li key={b.nombre} className="flex items-center gap-3">
            <span className="w-5 text-right text-xs font-semibold text-(--color-ink-soft)">{i + 1}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm font-medium text-(--color-ink)">
                  {b.nombre.toLocaleLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase())}
                </span>
                <span className="shrink-0 text-xs font-semibold" style={{ color }}>
                  {numFmt.format(Math.round(b.arboles_per_km2))} <span className="font-medium text-(--color-ink-soft)">{unit}</span>
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full" style={{ background: softColor }}>
                <div
                  className="h-full rounded-full"
                  style={{ width: `${Math.max(2, (b.arboles_per_km2 / maxDensity) * 100)}%`, background: color }}
                />
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
