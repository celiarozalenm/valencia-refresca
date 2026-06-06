import { useEffect, useRef, useState } from "react";
import type { Lang } from "../i18n/strings";
import { fetchFeed, type FeedEntry } from "../services/feed";
import type { EntityType } from "../services/comments";
import { formatRelativeTime } from "../services/reportsTime";

interface Props {
  lang?: Lang;
}

const POLL_INTERVAL_MS = 30_000;
const PAGE_SIZE = 20;

interface Copy {
  tag: string;
  title: string;
  lede: string;
  refresh: string;
  autorefresh: string;
  loading: string;
  empty: string;
  error: string;
  more: string;
  unknownPlace: string;
  kind: Record<EntityType, string>;
}

const COPY: Record<Lang, Copy> = {
  es: {
    tag: "En directo",
    title: "Lo último que ha pasado en València",
    lede: "Comentarios sobre fuentes, urinarios y duchas que vecinos como tú han enviado en los últimos días. Se actualiza solo.",
    refresh: "Actualizar ahora",
    autorefresh: "Refresco automático cada 30 s",
    loading: "Cargando…",
    empty: "Todavía no hay comentarios. ¡Sé el primero desde el mapa o en Participa!",
    error: "No se pudo cargar el hilo. Inténtalo de nuevo.",
    more: "Ver más",
    unknownPlace: "Punto sin nombre",
    kind: { fuente: "Fuente", urinario: "Urinario", ducha: "Ducha de playa" },
  },
  va: {
    tag: "En directe",
    title: "L’últim que ha passat a València",
    lede: "Comentaris sobre fonts, urinaris i dutxes que veïns com tu han enviat els últims dies. S’actualitza sol.",
    refresh: "Actualitzar ara",
    autorefresh: "Refresc automàtic cada 30 s",
    loading: "Carregant…",
    empty: "Encara no hi ha comentaris. Sigues el primer des del mapa o a Participa!",
    error: "No s’ha pogut carregar el fil. Torna-ho a provar.",
    more: "Veure’n més",
    unknownPlace: "Punt sense nom",
    kind: { fuente: "Font", urinario: "Urinari", ducha: "Dutxa de platja" },
  },
  en: {
    tag: "Live",
    title: "Latest in València",
    lede: "Comments on fountains, public toilets and showers that residents like you have sent over the last few days. Auto-updates.",
    refresh: "Refresh now",
    autorefresh: "Auto-refresh every 30 s",
    loading: "Loading…",
    empty: "No comments yet. Be the first from the map or in Get involved!",
    error: "Couldn’t load the feed. Try again.",
    more: "See more",
    unknownPlace: "Unnamed point",
    kind: { fuente: "Fountain", urinario: "Toilet", ducha: "Beach shower" },
  },
};

export default function Recientes({ lang = "es" }: Props) {
  const tr = COPY[lang];
  const [entries, setEntries] = useState<FeedEntry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const headerRef = useRef<HTMLDivElement>(null);

  async function load(targetLimit = limit) {
    setRefreshing(true);
    try {
      const res = await fetchFeed(targetLimit, 0);
      setEntries(res.entries);
      setTotal(res.total);
      setError(null);
    } catch {
      setError(tr.error);
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    load(limit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limit]);

  // Always fetch from the top so new comments appear and the visible list keeps its length.
  useEffect(() => {
    const id = setInterval(() => load(limit), POLL_INTERVAL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limit]);

  const canShowMore = entries !== null && entries.length < total;

  return (
    <div className="mx-auto max-w-3xl px-4 pt-16 pb-12 sm:px-6 md:pt-6 md:pb-16">
      <header ref={headerRef} className="mb-5 sm:mb-7 scroll-mt-24">
        <span className="uppercase tracking-[0.18em] text-[11px] font-bold text-[var(--color-agua-deep)]">
          {tr.tag}
        </span>
        <h1 className="text-3xl sm:text-4xl font-bold text-[var(--color-ink)] mt-1 leading-tight" style={{ fontFamily: "var(--font-display)" }}>
          {tr.title}
        </h1>
        <p className="text-sm sm:text-base text-[var(--color-ink-soft)] mt-2 max-w-xl">{tr.lede}</p>
        <div className="mt-3 flex items-center gap-3 text-xs text-stone-500 flex-wrap">
          <button
            type="button"
            onClick={() => load(page)}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-stone-200 bg-white hover:bg-stone-50 disabled:opacity-50 transition-colors cursor-pointer"
          >
            ↻ {tr.refresh}
          </button>
          <span>{tr.autorefresh}</span>
        </div>
      </header>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 mb-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {entries === null ? (
        <div className="py-16 text-center text-sm text-stone-500">{tr.loading}</div>
      ) : entries.length === 0 ? (
        <div className="rounded-xl bg-stone-50 border border-stone-200 px-6 py-10 text-center text-sm text-stone-600">
          {tr.empty}
        </div>
      ) : (
        <>
          <ul className="flex flex-col gap-2.5" aria-live="polite" aria-busy={refreshing}>
            {entries.map((e, idx) => (
              <FeedRow key={`${e.kind}-${e.id}-${e.ts}-${idx}`} entry={e} lang={lang} tr={tr} />
            ))}
          </ul>

          {canShowMore && (
            <div className="mt-6 flex justify-center">
              <button
                type="button"
                onClick={() => setLimit((l) => l + PAGE_SIZE)}
                disabled={refreshing}
                className="px-4 py-1.5 rounded-full border border-stone-200 bg-white text-sm text-stone-700 hover:bg-stone-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                {tr.more}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FeedRow({ entry, lang, tr }: { entry: FeedEntry; lang: Lang; tr: Copy }) {
  const good = entry.sentiment === "good";
  const place = entry.meta?.name;
  return (
    <li className="rounded-xl border border-stone-200 bg-white px-4 py-3 flex gap-3 items-start">
      <div
        className={`shrink-0 mt-0.5 w-9 h-9 rounded-full flex items-center justify-center text-lg ${
          good
            ? "bg-[var(--color-sombra-soft)] text-[var(--color-sombra-deep)]"
            : "bg-[#fbe7dd] text-[#b8431b]"
        }`}
      >
        {good ? "👍" : "👎"}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-agua-deep)]">
            {tr.kind[entry.entityType]}
          </span>
          <span className="text-xs text-stone-400">·</span>
          <span className="text-xs text-stone-500">{formatRelativeTime(entry.ts, lang)}</span>
        </div>
        <div className="text-sm text-stone-800 mt-1 truncate">{place ?? tr.unknownPlace}</div>
        {entry.text && (
          <div
            className={`mt-2 text-sm rounded-md px-3 py-2 border-l-2 ${
              good
                ? "bg-[var(--color-sombra-soft)] border-[var(--color-sombra-deep)] text-stone-800"
                : "bg-[#fbe7dd] border-[#b8431b] text-stone-800"
            }`}
          >
            “{entry.text}”
          </div>
        )}
      </div>
    </li>
  );
}
