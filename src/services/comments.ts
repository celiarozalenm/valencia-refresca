// Client for the /api/comment Edge Function. Used for fuentes, urinarios and duchas.

export type EntityType = 'fuente' | 'urinario' | 'ducha'
export type Sentiment = 'good' | 'bad'

export interface Comment {
  sentiment: Sentiment
  text: string
  ipHash: string
  ts: number
}

export interface CommentsSummary {
  entityType: EntityType
  entityId: string
  comments: Comment[]
  count: number
}

export async function fetchComments(
  type: EntityType,
  id: string,
): Promise<CommentsSummary> {
  const res = await fetch(
    `/api/comment?type=${type}&id=${encodeURIComponent(id)}`,
    { cache: 'no-store' },
  )
  if (!res.ok) throw new Error(`fetchComments HTTP ${res.status}`)
  return (await res.json()) as CommentsSummary
}

export interface CommentMeta {
  name?: string
  lat?: number
  lng?: number
  distrito?: string
}

export async function submitComment(
  type: EntityType,
  id: string,
  sentiment: Sentiment,
  text: string,
  meta?: CommentMeta,
): Promise<{ ok: true; ts: number } | { error: string }> {
  const res = await fetch('/api/comment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, id, sentiment, text, meta }),
  })
  if (res.status === 429) return { error: 'rate_limited' }
  if (!res.ok) return { error: `HTTP ${res.status}` }
  return (await res.json()) as { ok: true; ts: number }
}
