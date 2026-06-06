// Builds an interactive MapLibre popup DOM node for a reportable amenity
// (fuente · urinario · ducha) with thumbs up/down + an optional 140-char note.
// Talks to /api/comment. Ported from the madroño-perruno EntityPopup pattern and
// adapted to València Refresca (trilingual es · va · en, brand colours).

import { fetchComments, submitComment, type Comment, type EntityType } from '../services/comments'
import { formatRelativeTime } from '../services/reportsTime'
import type { Lang } from '../i18n/strings'

const COLOR: Record<EntityType, string> = {
  fuente: '#3b82f6',
  urinario: '#f97316',
  ducha: '#0ea5e9',
}

interface Args {
  entityType: EntityType
  entityId: string
  title: string
  address: string
  extra: string
  lat: number
  lng: number
  lang: Lang
}

interface Copy {
  navigate: string
  google: string
  comments: string
  noComments: string
  good: string
  bad: string
  placeholder: string
  submit: string
  thanks: string
  rateLimit: string
  error: string
  loading: string
  selectFirst: string
}

const COPY: Record<Lang, Copy> = {
  es: {
    navigate: 'Cómo llegar',
    google: 'Ver en Google Maps',
    comments: 'Comentarios recientes',
    noComments: 'Aún no hay comentarios.',
    good: '👍 Está bien',
    bad: '👎 Mal estado',
    placeholder: 'Comentario opcional (140 caracteres)…',
    submit: 'Comentar',
    thanks: '¡Gracias por tu comentario!',
    rateLimit: 'Demasiados comentarios. Inténtalo en una hora.',
    error: 'Error enviando comentario',
    loading: 'Cargando…',
    selectFirst: 'Elige 👍 o 👎 antes de enviar',
  },
  va: {
    navigate: 'Com arribar',
    google: 'Veure en Google Maps',
    comments: 'Comentaris recents',
    noComments: 'Encara no hi ha comentaris.',
    good: '👍 Està bé',
    bad: '👎 Mal estat',
    placeholder: 'Comentari opcional (140 caràcters)…',
    submit: 'Comentar',
    thanks: 'Gràcies pel teu comentari!',
    rateLimit: 'Massa comentaris. Torna-ho a provar en una hora.',
    error: 'Error enviant el comentari',
    loading: 'Carregant…',
    selectFirst: 'Tria 👍 o 👎 abans d’enviar',
  },
  en: {
    navigate: 'Directions',
    google: 'View on Google Maps',
    comments: 'Recent comments',
    noComments: 'No comments yet.',
    good: '👍 Looks good',
    bad: '👎 Bad state',
    placeholder: 'Optional comment (140 chars)…',
    submit: 'Submit',
    thanks: 'Thanks for your comment!',
    rateLimit: 'Too many comments. Try again in an hour.',
    error: 'Error submitting comment',
    loading: 'Loading…',
    selectFirst: 'Pick 👍 or 👎 before submitting',
  },
}

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function buildFeedbackPopup(args: Args): HTMLDivElement {
  const tr = COPY[args.lang]
  const root = document.createElement('div')
  root.className = 'vr-popup vr-popup-entity'

  const navUrl = `https://www.google.com/maps/dir/?api=1&destination=${args.lat},${args.lng}&travelmode=walking`
  const placeQuery = encodeURIComponent(`${args.title} ${args.address}`)
  const placeUrl = `https://www.google.com/maps/search/?api=1&query=${placeQuery}`

  root.innerHTML = `
    <div class="vr-popup-bar" style="background:${COLOR[args.entityType]}"></div>
    <div class="vr-popup-body">
      <div class="vr-popup-title">${escape(args.title)}</div>
      ${args.address ? `<div class="vr-popup-row">${escape(args.address)}</div>` : ''}
      ${args.extra ? `<div class="vr-popup-row vr-popup-meta">${escape(args.extra)}</div>` : ''}
      <div class="vr-popup-actions">
        <a href="${navUrl}" target="_blank" rel="noopener" class="vr-popup-btn">${tr.navigate}</a>
        <a href="${placeUrl}" target="_blank" rel="noopener" class="vr-popup-link">${tr.google}</a>
      </div>
      <div class="vr-popup-reports">
        <div class="vr-popup-reports-title">${tr.comments}</div>
        <div class="vr-popup-comments-list" data-comments-list>${tr.loading}</div>
      </div>
      <div class="vr-popup-comment-form">
        <div class="vr-popup-vote">
          <button type="button" class="vr-vote-yes" data-sentiment="good" aria-pressed="false">${tr.good}</button>
          <button type="button" class="vr-vote-no" data-sentiment="bad" aria-pressed="false">${tr.bad}</button>
        </div>
        <textarea class="vr-popup-textarea" maxlength="140" placeholder="${escape(tr.placeholder)}" rows="2" data-text></textarea>
        <button type="button" class="vr-popup-submit" data-submit>${tr.submit}</button>
      </div>
      <div class="vr-popup-flash" data-flash></div>
    </div>
  `

  const list = root.querySelector<HTMLDivElement>('[data-comments-list]')!
  const flash = root.querySelector<HTMLDivElement>('[data-flash]')!
  const btnGood = root.querySelector<HTMLButtonElement>('[data-sentiment="good"]')!
  const btnBad = root.querySelector<HTMLButtonElement>('[data-sentiment="bad"]')!
  const textarea = root.querySelector<HTMLTextAreaElement>('[data-text]')!
  const submit = root.querySelector<HTMLButtonElement>('[data-submit]')!

  let chosen: 'good' | 'bad' | null = null
  function paint() {
    btnGood.setAttribute('aria-pressed', String(chosen === 'good'))
    btnBad.setAttribute('aria-pressed', String(chosen === 'bad'))
  }
  btnGood.addEventListener('click', () => {
    chosen = chosen === 'good' ? null : 'good'
    paint()
  })
  btnBad.addEventListener('click', () => {
    chosen = chosen === 'bad' ? null : 'bad'
    paint()
  })

  function renderList(comments: Comment[]) {
    if (comments.length === 0) {
      list.innerHTML = `<div class="vr-popup-empty">${tr.noComments}</div>`
      return
    }
    list.innerHTML = comments
      .map((c) => {
        const cls = c.sentiment === 'good' ? 'vr-r-yes' : 'vr-r-no'
        const icon = c.sentiment === 'good' ? '👍' : '👎'
        const text = c.text ? `<div class="vr-popup-comment-text">${escape(c.text)}</div>` : ''
        return `
          <div class="vr-popup-comment ${cls}">
            <div class="vr-popup-comment-head">
              <span class="vr-popup-comment-icon">${icon}</span>
              <span class="vr-popup-comment-rel">${formatRelativeTime(c.ts, args.lang)}</span>
            </div>
            ${text}
          </div>`
      })
      .join('')
  }

  async function load() {
    try {
      const summary = await fetchComments(args.entityType, args.entityId)
      renderList(summary.comments)
    } catch {
      list.innerHTML = `<div class="vr-popup-empty">${tr.noComments}</div>`
    }
  }

  function setDisabled(v: boolean) {
    submit.disabled = v
    btnGood.disabled = v
    btnBad.disabled = v
    textarea.disabled = v
  }

  async function send() {
    flash.textContent = ''
    flash.className = 'vr-popup-flash'
    if (!chosen) {
      flash.textContent = tr.selectFirst
      flash.className = 'vr-popup-flash error'
      return
    }
    setDisabled(true)
    const result = await submitComment(args.entityType, args.entityId, chosen, textarea.value, {
      name: [args.title, args.address].filter(Boolean).join(' · '),
      lat: args.lat,
      lng: args.lng,
    })
    if ('error' in result) {
      flash.textContent = result.error === 'rate_limited' ? tr.rateLimit : tr.error
      flash.className = 'vr-popup-flash error'
      setDisabled(false)
      return
    }
    flash.textContent = tr.thanks
    flash.className = 'vr-popup-flash ok'
    textarea.value = ''
    chosen = null
    paint()
    await load()
    setTimeout(() => setDisabled(false), 2000)
  }

  submit.addEventListener('click', send)
  queueMicrotask(load)

  return root
}
