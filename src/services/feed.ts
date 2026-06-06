// Client for the /api/feed Edge Function — returns the latest comments across
// every amenity (fuentes, urinarios, duchas), sorted by timestamp descending.

import type { EntityType } from './comments'

export interface FeedMeta {
  name?: string
  lat?: number
  lng?: number
  distrito?: string
}

export interface CommentFeedEntry {
  kind: 'comment'
  entityType: EntityType
  id: string
  sentiment: 'good' | 'bad'
  text: string
  meta?: FeedMeta
  ipHash: string
  ts: number
}

export type FeedEntry = CommentFeedEntry

export interface FeedResponse {
  entries: FeedEntry[]
  count: number
  total: number
  offset: number
  limit: number
}

export async function fetchFeed(limit = 30, offset = 0): Promise<FeedResponse> {
  const res = await fetch(
    `/api/feed?limit=${encodeURIComponent(limit)}&offset=${encodeURIComponent(offset)}`,
    { cache: 'no-store' },
  )
  if (!res.ok) throw new Error(`fetchFeed HTTP ${res.status}`)
  const json = (await res.json()) as Partial<FeedResponse> & { entries: FeedEntry[]; count: number }
  return {
    entries: json.entries,
    count: json.count,
    total: typeof json.total === 'number' ? json.total : json.count,
    offset: typeof json.offset === 'number' ? json.offset : offset,
    limit: typeof json.limit === 'number' ? json.limit : limit,
  }
}
