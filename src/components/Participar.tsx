import { useEffect, useMemo, useRef, useState } from "react";
import type { Lang } from "../i18n/strings";
import { loadAmenities, type Amenity } from "../services/entities";
import {
  fetchComments,
  submitComment,
  type Comment,
  type EntityType,
  type Sentiment,
} from "../services/comments";
import { formatRelativeTime } from "../services/reportsTime";

interface Props {
  lang?: Lang;
}

const TABS: EntityType[] = ["fuente", "urinario", "ducha"];
const PAGE_SIZE = 24;

interface Copy {
  tag: string;
  title: string;
  lede: string;
  search: string;
  count: (n: number) => string;
  empty: string;
  loading: string;
  tabs: Record<EntityType, string>;
  prev: string;
  next: string;
  pageInfo: (p: number, t: number) => string;
}

const COPY: Record<Lang, Copy> = {
  es: {
    tag: "Tu voz cuenta",
    title: "Participa",
    lede: "Busca una fuente, urinario o ducha y dinos si funciona o está en mal estado. Sin registro: tus avisos ayudan a otros vecinos y al Ayuntamiento.",
    search: "Buscar por dirección…",
    count: (n) => `${n.toLocaleString("es-ES")} puntos`,
    empty: "No hay resultados para tu búsqueda.",
    loading: "Cargando…",
    tabs: { fuente: "Fuentes", urinario: "Urinarios", ducha: "Duchas de playa" },
    prev: "Anterior",
    next: "Siguiente",
    pageInfo: (p, t) => `Página ${p} de ${t}`,
  },
  va: {
    tag: "La teua veu compta",
    title: "Participa",
    lede: "Busca una font, urinari o dutxa i dis-nos si funciona o està en mal estat. Sense registre: els teus avisos ajuden altres veïns i l’Ajuntament.",
    search: "Cerca per adreça…",
    count: (n) => `${n.toLocaleString("ca-ES")} punts`,
    empty: "No hi ha resultats per a la teua cerca.",
    loading: "Carregant…",
    tabs: { fuente: "Fonts", urinario: "Urinaris", ducha: "Dutxes de platja" },
    prev: "Anterior",
    next: "Següent",
    pageInfo: (p, t) => `Pàgina ${p} de ${t}`,
  },
  en: {
    tag: "Your voice counts",
    title: "Get involved",
    lede: "Find a fountain, public toilet or beach shower and tell us whether it works or is in bad shape. No sign-up: your reports help other residents and the City Council.",
    search: "Search by address…",
    count: (n) => `${n.toLocaleString("en-US")} points`,
    empty: "No results for your search.",
    loading: "Loading…",
    tabs: { fuente: "Fountains", urinario: "Toilets", ducha: "Beach showers" },
    prev: "Previous",
    next: "Next",
    pageInfo: (p, t) => `Page ${p} of ${t}`,
  },
};

export default function Participar({ lang = "es" }: Props) {
  const tr = COPY[lang];
  const [tab, setTab] = useState<EntityType>("fuente");
  const [all, setAll] = useState<Amenity[] | null>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const headerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setAll(null);
    setPage(0);
    setOpenId(null);
    loadAmenities(tab)
      .then((list) => {
        if (!cancelled) setAll(list);
      })
      .catch(() => {
        if (!cancelled) setAll([]);
      });
    return () => {
      cancelled = true;
    };
  }, [tab]);

  const filtered = useMemo(() => {
    if (!all) return [];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (a) => a.address.toLowerCase().includes(q) || a.title.toLowerCase().includes(q),
    );
  }, [all, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageItems = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  function goTo(next: number) {
    const clamped = Math.max(0, Math.min(totalPages - 1, next));
    if (clamped === safePage) return;
    setPage(clamped);
    setOpenId(null);
    headerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      <header ref={headerRef} className="mb-6 scroll-mt-24">
        <span className="uppercase tracking-[0.18em] text-[11px] font-bold text-[var(--color-agua-deep)]">
          {tr.tag}
        </span>
        <h1 className="text-3xl sm:text-4xl font-bold text-[var(--color-ink)] mt-1" style={{ fontFamily: "var(--font-display)" }}>
          {tr.title}
        </h1>
        <p className="text-sm sm:text-base text-[var(--color-ink-soft)] mt-2 max-w-xl">{tr.lede}</p>
      </header>

      <div className="flex gap-1 border-b border-stone-200 mb-4">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-semibold -mb-px border-b-2 transition-colors cursor-pointer ${
              tab === t
                ? "border-[var(--color-agua-deep)] text-[var(--color-agua-deep)]"
                : "border-transparent text-stone-500 hover:text-stone-800"
            }`}
          >
            {tr.tabs[t]}
          </button>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-3">
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
          placeholder={tr.search}
          className="flex-1 px-4 py-2.5 rounded-xl border border-stone-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-agua-soft)] focus:border-[var(--color-agua)]"
        />
      </div>
      <p className="text-xs text-stone-500 mb-4">{tr.count(filtered.length)}</p>

      {all === null ? (
        <div className="py-16 text-center text-sm text-stone-500">{tr.loading}</div>
      ) : pageItems.length === 0 ? (
        <div className="rounded-xl bg-stone-50 border border-stone-200 px-6 py-10 text-center text-sm text-stone-600">
          {tr.empty}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {pageItems.map((a) => (
            <AmenityRow
              key={`${a.type}-${a.id}`}
              amenity={a}
              lang={lang}
              open={openId === a.id}
              onToggle={() => setOpenId(openId === a.id ? null : a.id)}
            />
          ))}
        </ul>
      )}

      {totalPages > 1 && (
        <nav className="mt-6 flex items-center justify-between gap-3" aria-label="Pagination">
          <button
            type="button"
            onClick={() => goTo(safePage - 1)}
            disabled={safePage === 0}
            className="px-3 py-1.5 rounded-full border border-stone-200 bg-white text-sm text-stone-700 hover:bg-stone-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            ← {tr.prev}
          </button>
          <span className="text-xs text-stone-500">{tr.pageInfo(safePage + 1, totalPages)}</span>
          <button
            type="button"
            onClick={() => goTo(safePage + 1)}
            disabled={safePage >= totalPages - 1}
            className="px-3 py-1.5 rounded-full border border-stone-200 bg-white text-sm text-stone-700 hover:bg-stone-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            {tr.next} →
          </button>
        </nav>
      )}
    </div>
  );
}

const DOT: Record<EntityType, string> = {
  fuente: "#3b82f6",
  urinario: "#f97316",
  ducha: "#0ea5e9",
};

function AmenityRow({
  amenity,
  lang,
  open,
  onToggle,
}: {
  amenity: Amenity;
  lang: Lang;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <li className="rounded-xl border border-stone-200 bg-white overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-stone-50 transition-colors cursor-pointer"
        aria-expanded={open}
      >
        <span className="shrink-0 w-2.5 h-2.5 rounded-full" style={{ background: DOT[amenity.type] }} />
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-semibold text-stone-800 truncate">{amenity.address}</span>
          {amenity.extra && <span className="block text-xs text-stone-500 truncate">{amenity.extra}</span>}
        </span>
        <span className={`shrink-0 text-stone-400 transition-transform ${open ? "rotate-90" : ""}`}>›</span>
      </button>
      {open && <FeedbackPanel amenity={amenity} lang={lang} />}
    </li>
  );
}

interface PanelCopy {
  comments: string;
  noComments: string;
  good: string;
  bad: string;
  placeholder: string;
  submit: string;
  thanks: string;
  rateLimit: string;
  error: string;
  loading: string;
  selectFirst: string;
}

const PANEL: Record<Lang, PanelCopy> = {
  es: {
    comments: "Comentarios recientes",
    noComments: "Aún no hay comentarios.",
    good: "👍 Está bien",
    bad: "👎 Mal estado",
    placeholder: "Comentario opcional (140 caracteres)…",
    submit: "Comentar",
    thanks: "¡Gracias por tu comentario!",
    rateLimit: "Demasiados comentarios. Inténtalo en una hora.",
    error: "Error enviando comentario",
    loading: "Cargando…",
    selectFirst: "Elige 👍 o 👎 antes de enviar",
  },
  va: {
    comments: "Comentaris recents",
    noComments: "Encara no hi ha comentaris.",
    good: "👍 Està bé",
    bad: "👎 Mal estat",
    placeholder: "Comentari opcional (140 caràcters)…",
    submit: "Comentar",
    thanks: "Gràcies pel teu comentari!",
    rateLimit: "Massa comentaris. Torna-ho a provar en una hora.",
    error: "Error enviant el comentari",
    loading: "Carregant…",
    selectFirst: "Tria 👍 o 👎 abans d’enviar",
  },
  en: {
    comments: "Recent comments",
    noComments: "No comments yet.",
    good: "👍 Looks good",
    bad: "👎 Bad state",
    placeholder: "Optional comment (140 chars)…",
    submit: "Submit",
    thanks: "Thanks for your comment!",
    rateLimit: "Too many comments. Try again in an hour.",
    error: "Error submitting comment",
    loading: "Loading…",
    selectFirst: "Pick 👍 or 👎 before submitting",
  },
};

function FeedbackPanel({ amenity, lang }: { amenity: Amenity; lang: Lang }) {
  const tr = PANEL[lang];
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [sentiment, setSentiment] = useState<Sentiment | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ msg: string; ok: boolean } | null>(null);

  async function load() {
    try {
      const summary = await fetchComments(amenity.type, amenity.id);
      setComments(summary.comments);
    } catch {
      setComments([]);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function send() {
    setFlash(null);
    if (!sentiment) {
      setFlash({ msg: tr.selectFirst, ok: false });
      return;
    }
    setBusy(true);
    const result = await submitComment(amenity.type, amenity.id, sentiment, text, {
      name: [amenity.title, amenity.address].filter(Boolean).join(" · "),
      lat: amenity.lat,
      lng: amenity.lng,
    });
    if ("error" in result) {
      setFlash({ msg: result.error === "rate_limited" ? tr.rateLimit : tr.error, ok: false });
      setBusy(false);
      return;
    }
    setFlash({ msg: tr.thanks, ok: true });
    setText("");
    setSentiment(null);
    await load();
    setTimeout(() => setBusy(false), 1500);
  }

  return (
    <div className="px-4 pb-4 pt-1 border-t border-stone-100 bg-stone-50/50">
      <div className="text-[11px] font-bold uppercase tracking-wider text-stone-500 mb-2 mt-3">
        {tr.comments}
      </div>
      {comments === null ? (
        <p className="text-xs text-stone-400 italic">{tr.loading}</p>
      ) : comments.length === 0 ? (
        <p className="text-xs text-stone-400 italic">{tr.noComments}</p>
      ) : (
        <ul className="flex flex-col gap-1.5 max-h-44 overflow-y-auto mb-2">
          {comments.map((c, i) => (
            <li
              key={i}
              className={`rounded-lg px-3 py-1.5 border-l-2 ${
                c.sentiment === "good"
                  ? "bg-[var(--color-sombra-soft)] border-[var(--color-sombra-deep)]"
                  : "bg-[#fbe7dd] border-[#b8431b]"
              }`}
            >
              <div className="flex items-center gap-1.5 text-[11px] text-stone-500">
                <span>{c.sentiment === "good" ? "👍" : "👎"}</span>
                <span>{formatRelativeTime(c.ts, lang)}</span>
              </div>
              {c.text && <div className="text-sm text-stone-800 mt-0.5">{c.text}</div>}
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-2 gap-2 mt-3">
        <button
          type="button"
          onClick={() => setSentiment(sentiment === "good" ? null : "good")}
          aria-pressed={sentiment === "good"}
          className={`py-2 rounded-lg border-[1.5px] text-sm font-semibold cursor-pointer transition-colors ${
            sentiment === "good"
              ? "bg-[var(--color-sombra-soft)] border-[var(--color-sombra-deep)] text-[var(--color-sombra-deep)]"
              : "bg-white border-[var(--color-sombra-deep)] text-[var(--color-sombra-deep)] hover:bg-[var(--color-sombra-soft)]"
          }`}
        >
          {tr.good}
        </button>
        <button
          type="button"
          onClick={() => setSentiment(sentiment === "bad" ? null : "bad")}
          aria-pressed={sentiment === "bad"}
          className={`py-2 rounded-lg border-[1.5px] text-sm font-semibold cursor-pointer transition-colors ${
            sentiment === "bad"
              ? "bg-[#fbe7dd] border-[#b8431b] text-[#b8431b]"
              : "bg-white border-[#b8431b] text-[#b8431b] hover:bg-[#fbe7dd]"
          }`}
        >
          {tr.bad}
        </button>
      </div>
      <textarea
        value={text}
        maxLength={140}
        rows={2}
        onChange={(e) => setText(e.target.value)}
        placeholder={tr.placeholder}
        className="w-full mt-2 px-3 py-2 rounded-lg border border-stone-200 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-[var(--color-agua-soft)] focus:border-[var(--color-agua)]"
      />
      <button
        type="button"
        onClick={send}
        disabled={busy}
        className="w-full mt-2 py-2 rounded-lg bg-[var(--color-agua-deep)] text-white text-sm font-semibold cursor-pointer hover:bg-[#1742b8] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {tr.submit}
      </button>
      {flash && (
        <p className={`text-xs text-center mt-2 ${flash.ok ? "text-[var(--color-sombra-deep)]" : "text-[#b8431b]"}`}>
          {flash.msg}
        </p>
      )}
    </div>
  );
}
