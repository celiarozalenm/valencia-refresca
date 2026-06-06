// Shared helper for formatting timestamps as relative time strings (es · va · en).

import type { Lang } from '../i18n/strings'

export function formatRelativeTime(ts: number, lang: Lang = 'es'): string {
  // "ago"-style prefix/suffix per language: es "hace X", va "fa X", en "X ago".
  const ago = (n: number, unit: string) =>
    lang === 'en' ? `${n} ${unit} ago` : `${lang === 'es' ? 'hace' : 'fa'} ${n} ${unit}`

  const diff = Date.now() - ts
  const m = Math.round(diff / 60_000)
  if (m < 1) return lang === 'en' ? 'just now' : lang === 'va' ? 'ara' : 'ahora'
  if (m < 60) return ago(m, 'min')
  const h = Math.round(m / 60)
  if (h < 24) return ago(h, 'h')
  const d = Math.round(h / 24)
  if (d < 30) return ago(d, 'd')
  const intl = lang === 'en' ? 'en-US' : lang === 'va' ? 'ca-ES-valencia' : 'es-ES'
  return new Date(ts).toLocaleDateString(intl)
}
