// Vercel Edge Function: returns the latest entries from the global feed
// (fuente/urinario/ducha comments) sorted by timestamp desc.
// Used by the "Últimos reportes" view in the app.

import { Redis } from '@upstash/redis'

export const config = { runtime: 'edge' }

const redis = new Redis({
  url: process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL ?? '',
  token: process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN ?? '',
})

const FEED_KEY = 'feed:global'
const DEFAULT_LIMIT = 30
const MAX_LIMIT = 100
const ALLOWED_ORIGINS = [
  'https://valencia-refresca.vercel.app',
  'http://localhost:4321',
  'http://localhost:4322',
]

function corsHeaders(origin: string | null) {
  const allow = origin && ALLOWED_ORIGINS.some((o) => origin.startsWith(o)) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  }
}

type EntityType = 'fuente' | 'urinario' | 'ducha'

interface FeedMeta {
  name?: string
  lat?: number
  lng?: number
  distrito?: string
}

interface CommentFeedEntry {
  kind: 'comment'
  entityType: EntityType
  id: string
  sentiment: 'good' | 'bad'
  text: string
  meta?: FeedMeta
  ipHash: string
  ts: number
}

type FeedEntry = CommentFeedEntry

function parseEntry(raw: unknown): FeedEntry | null {
  try {
    // The Upstash Redis JS client auto-deserialises JSON values, so a member
    // stored as JSON.stringify(...) comes back already parsed as an object.
    // For older entries or odd cases we still accept a raw JSON string.
    let obj: Partial<FeedEntry> | null = null
    if (typeof raw === 'string') {
      obj = JSON.parse(raw) as Partial<FeedEntry>
    } else if (raw && typeof raw === 'object') {
      obj = raw as Partial<FeedEntry>
    }
    if (!obj || typeof obj !== 'object') return null
    if (
      obj.kind === 'comment' &&
      (obj.entityType === 'fuente' || obj.entityType === 'urinario' || obj.entityType === 'ducha')
    ) {
      const sentiment = obj.sentiment === 'good' || obj.sentiment === 'bad' ? obj.sentiment : 'good'
      return {
        kind: 'comment',
        entityType: obj.entityType,
        id: String(obj.id ?? ''),
        sentiment,
        text: typeof obj.text === 'string' ? obj.text : '',
        meta: obj.meta as FeedMeta | undefined,
        ipHash: typeof obj.ipHash === 'string' ? obj.ipHash : '',
        ts: typeof obj.ts === 'number' ? obj.ts : 0,
      }
    }
    return null
  } catch {
    return null
  }
}

export default async function handler(req: Request) {
  const origin = req.headers.get('origin')
  const cors = corsHeaders(origin)

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors })
  }

  if (req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405, headers: cors })
  }

  const url = new URL(req.url)
  const limitRaw = parseInt(url.searchParams.get('limit') ?? '', 10)
  const limit = Math.min(MAX_LIMIT, Math.max(1, isFinite(limitRaw) ? limitRaw : DEFAULT_LIMIT))
  const offsetRaw = parseInt(url.searchParams.get('offset') ?? '', 10)
  const offset = Math.max(0, isFinite(offsetRaw) ? offsetRaw : 0)

  const [raw, total] = await Promise.all([
    redis.zrange(FEED_KEY, offset, offset + limit - 1, { rev: true }) as Promise<unknown[]>,
    redis.zcard(FEED_KEY) as Promise<number>,
  ])
  const entries: FeedEntry[] = []
  for (const r of raw) {
    const e = parseEntry(r)
    if (e) entries.push(e)
  }

  return new Response(
    JSON.stringify({
      entries,
      count: entries.length,
      total,
      offset,
      limit,
    }),
    {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    },
  )
}
