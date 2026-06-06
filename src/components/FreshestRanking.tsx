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

type SortMode = "density" | "total";

interface Props {
  lang?: Lang;
}

function capitalize(str: string): string {
  return str.toLocaleLowerCase().replace(/(^|[\s\-'])\S/g, (c) => c.toUpperCase());
}

export default function FreshestRanking({ lang = "es" }: Props) {
  const tr = STRINGS[lang].map.freshest;
  const numFmt = useMemo(() => new Intl.NumberFormat(lang === "va" ? "ca" : "es-ES"), [lang]);

  const [barrios, setBarrios] = useState<BarrioProps[] | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("density");

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
    return <div className="text-sm text-slate-500">{tr.loading}</div>;
  }

  const totalTrees = barrios.reduce((s, b) => s + (b.arboles ?? 0), 0);
  const totalArea = barrios.reduce((s, b) => s + (b.area_km2 ?? 0), 0);
  const avgDensity = totalArea > 0 ? totalTrees / totalArea : 0;
  const highCount = barrios.filter(
    (b) => b.sombra_bucket === "alta" || b.sombra_bucket === "muy_alta",
  ).length;
  const lowCount = barrios.filter(
    (b) => b.sombra_bucket === "baja" || b.sombra_bucket === "muy_baja",
  ).length;
  const highPct = barrios.length > 0 ? Math.round((highCount / barrios.length) * 100) : 0;

  const sortKey = sortMode === "density" ? "arboles_per_km2" : "arboles";
  const sorted = [...barrios].sort((a, b) => b[sortKey] - a[sortKey]);
  const top = sorted.slice(0, 10);
  const bottom = sorted.slice(-10).reverse();
  const maxValue = sorted[0]?.[sortKey] ?? 1;
  const minDensity = [...barrios].sort((a, b) => a.arboles_per_km2 - b.arboles_per_km2)[0]?.arboles_per_km2 ?? 0;
  const maxDensity = [...barrios].sort((a, b) => b.arboles_per_km2 - a.arboles_per_km2)[0]?.arboles_per_km2 ?? 1;
  const minNonZero =
    [...barrios].filter((b) => b.arboles_per_km2 > 0).sort((a, b) => a.arboles_per_km2 - b.arboles_per_km2)[0]
      ?.arboles_per_km2 ?? 1;
  const gap = Math.round(maxDensity / minNonZero);

  const dist = BUCKET_ORDER.map((b) => ({
    bucket: b,
    count: barrios.filter((p) => p.sombra_bucket === b).length,
  }));
  const distMax = Math.max(...dist.map((d) => d.count), 1);

  const insightGap = tr.insightGap.replace("{gap}", numFmt.format(gap));
  const insightHigh = tr.insightHigh
    .replace("{high}", String(highCount))
    .replace("{total}", String(barrios.length));
  const insightLow = tr.insightLow.replace("{low}", String(lowCount));

  return (
    <div className="space-y-10">
      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        <KpiCard label={tr.kpiTrees} value={numFmt.format(totalTrees)} unit={tr.unitTree} />
        <KpiCard label={tr.kpiBarrios} value={numFmt.format(barrios.length)} unit={tr.unitBarrios} />
        <KpiCard label={tr.kpiAvg} value={numFmt.format(Math.round(avgDensity))} unit={tr.unitAvg} />
        <KpiCard label={tr.kpiHigh} value={`${highPct}%`} unit={`${highCount}/${barrios.length}`} />
      </div>

      {/* Spotlight: max / min / gap */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4">
        <SpotlightCard
          label={tr.statMost}
          name={capitalize(top.sort((a, b) => b.arboles_per_km2 - a.arboles_per_km2)[0]?.nombre ?? "—")}
          sub={`${numFmt.format(Math.round(maxDensity))} ${tr.unit}`}
          accent="sombra"
        />
        <SpotlightCard
          label={tr.statLeast}
          name={capitalize(
            [...barrios].sort((a, b) => a.arboles_per_km2 - b.arboles_per_km2)[0]?.nombre ?? "—",
          )}
          sub={`${numFmt.format(Math.round(minDensity))} ${tr.unit}`}
          accent="calor"
        />
        <SpotlightCard
          label={tr.statGap}
          name={`${numFmt.format(gap)}×`}
          sub={`${numFmt.format(Math.round(maxDensity))} vs ${numFmt.format(Math.round(minNonZero))}`}
          accent="agua"
        />
      </div>

      {/* Rankings with toggle */}
      <div>
        <div className="mb-4 flex items-center justify-end">
          <div className="inline-flex rounded-full bg-slate-100 p-1 text-xs font-medium">
            <button
              type="button"
              onClick={() => setSortMode("density")}
              className={`cursor-pointer rounded-full px-3 py-1.5 transition ${
                sortMode === "density" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"
              }`}
            >
              {tr.toggleDensity}
            </button>
            <button
              type="button"
              onClick={() => setSortMode("total")}
              className={`cursor-pointer rounded-full px-3 py-1.5 transition ${
                sortMode === "total" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"
              }`}
            >
              {tr.toggleTotal}
            </button>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <RankingList
            title={tr.topTitle}
            items={top}
            maxValue={maxValue}
            sortKey={sortKey}
            unit={sortMode === "density" ? tr.unit : tr.unitTotal}
            color="var(--color-sombra-deep)"
            softColor="var(--color-sombra-soft)"
            numFmt={numFmt}
          />
          <RankingList
            title={tr.bottomTitle}
            items={bottom}
            maxValue={maxValue}
            sortKey={sortKey}
            unit={sortMode === "density" ? tr.unit : tr.unitTotal}
            color="var(--color-calor-deep)"
            softColor="var(--color-calor-soft)"
            numFmt={numFmt}
          />
        </div>
      </div>

      {/* Distribution */}
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

      {/* Insights */}
      <div className="rounded-2xl bg-(--color-agua-soft)/40 p-6 ring-1 ring-(--color-ink)/8 md:p-7">
        <p className="font-display text-lg font-semibold text-(--color-ink)">{tr.insightsTitle}</p>
        <ul className="mt-4 space-y-3">
          <InsightItem text={insightGap} />
          <InsightItem text={insightHigh} />
          <InsightItem text={insightLow} />
        </ul>
      </div>
    </div>
  );
}

interface KpiCardProps {
  label: string;
  value: string;
  unit: string;
}

function KpiCard({ label, value, unit }: KpiCardProps) {
  return (
    <div className="rounded-2xl bg-white p-4 ring-1 ring-(--color-ink)/8 md:p-5">
      <p className="text-[10px] font-semibold tracking-wider uppercase text-(--color-ink-soft)">{label}</p>
      <p className="mt-1.5 font-display text-3xl leading-none font-semibold text-(--color-ink)">{value}</p>
      <p className="mt-1.5 text-xs text-(--color-ink-soft)">{unit}</p>
    </div>
  );
}

interface SpotlightCardProps {
  label: string;
  name: string;
  sub: string;
  accent: "sombra" | "calor" | "agua";
}

function SpotlightCard({ label, name, sub, accent }: SpotlightCardProps) {
  const map = {
    sombra: { bg: "var(--color-sombra-soft)", fg: "var(--color-sombra-deep)" },
    calor: { bg: "var(--color-calor-soft)", fg: "var(--color-calor-deep)" },
    agua: { bg: "var(--color-agua-soft)", fg: "var(--color-agua-deep)" },
  } as const;
  const c = map[accent];
  return (
    <div className="rounded-2xl bg-white p-4 ring-1 ring-(--color-ink)/8 md:p-5">
      <p className="text-[10px] font-semibold tracking-wider uppercase text-(--color-ink-soft)">{label}</p>
      <p className="mt-1.5 font-display text-2xl leading-tight font-semibold" style={{ color: c.fg }}>
        {name}
      </p>
      <p className="mt-2 inline-block rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: c.bg, color: c.fg }}>
        {sub}
      </p>
    </div>
  );
}

interface RankingListProps {
  title: string;
  items: BarrioProps[];
  maxValue: number;
  sortKey: "arboles_per_km2" | "arboles";
  unit: string;
  color: string;
  softColor: string;
  numFmt: Intl.NumberFormat;
}

function RankingList({ title, items, maxValue, sortKey, unit, color, softColor, numFmt }: RankingListProps) {
  return (
    <div className="rounded-2xl bg-white p-5 ring-1 ring-(--color-ink)/8 md:p-6">
      <p className="font-display text-lg font-semibold text-(--color-ink)">{title}</p>
      <ol className="mt-4 space-y-3">
        {items.map((b, i) => {
          const v = b[sortKey];
          return (
            <li key={b.nombre} className="flex items-center gap-3">
              <span className="w-5 text-right text-xs font-semibold text-(--color-ink-soft)">{i + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-medium text-(--color-ink)">{capitalize(b.nombre)}</span>
                  <span className="shrink-0 text-xs font-semibold" style={{ color }}>
                    {numFmt.format(Math.round(v))} <span className="font-medium text-(--color-ink-soft)">{unit}</span>
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full" style={{ background: softColor }}>
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${Math.max(2, (v / maxValue) * 100)}%`, background: color }}
                  />
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function InsightItem({ text }: { text: string }) {
  return (
    <li className="flex items-start gap-3 text-sm leading-relaxed text-(--color-ink)">
      <span className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-(--color-agua-deep)" aria-hidden />
      <span>{text}</span>
    </li>
  );
}
