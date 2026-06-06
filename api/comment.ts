// Vercel Edge Function: handles GET (read latest comments for an amenity) and
// POST (submit a comment). Used for fuentes, urinarios and duchas — citizens
// flag whether a public amenity is working / in good state.
//
// Storage: Upstash Redis. The env vars KV_REST_API_URL + KV_REST_API_TOKEN are
// set automatically when the Upstash marketplace integration is added in the
// Vercel project's "Storage" tab (the SDK also accepts UPSTASH_REDIS_REST_*).
//
// Data model per amenity:
//   - sorted set "comment:<entityType>:<entityId>"
//     score = unix-ms timestamp
//     value = JSON.stringify({ sentiment, text, ipHash, ts, rand })
//   - global feed sorted set "feed:global" (for the "Últimos reportes" view)
//   - rate limit "rlc:<ipHash>" (counter expiring in 1 hour)

import { Redis } from '@upstash/redis'

export const config = { runtime: 'edge' }

const redis = new Redis({
  url: process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL ?? '',
  token: process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN ?? '',
})

const MAX_COMMENTS_PER_ENTITY = 30
const COMMENTS_RETURNED = 8
const COMMENT_TTL_SECONDS = 60 * 60 * 24 * 60 // 60 days
const RATE_LIMIT_PER_HOUR = 12
const MAX_TEXT_LENGTH = 140
const ALLOWED_TYPES = new Set(['fuente', 'urinario', 'ducha'])
// Key prefix: this app shares its Upstash database with madroño-perruno, so
// every key is namespaced under "vr:" to keep the two datasets fully separate.
const NS = 'vr:'
const FEED_KEY = `${NS}feed:global`
const FEED_MAX_ENTRIES = 200
const FEED_TTL_SECONDS = 60 * 60 * 24 * 60 // 60 days
const ALLOWED_ORIGINS = [
  'https://valencia-refresca.vercel.app',
  'http://localhost:4321',
  'http://localhost:4322',
]

function corsHeaders(origin: string | null) {
  const allow = origin && ALLOWED_ORIGINS.some((o) => origin.startsWith(o)) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  }
}

async function hashIp(ip: string): Promise<string> {
  const data = new TextEncoder().encode(ip + ':valencia-refresca-salt-2026')
  const buf = await crypto.subtle.digest('SHA-256', data)
  const arr = Array.from(new Uint8Array(buf))
  return arr.map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
}

interface CommentEntry {
  sentiment: 'good' | 'bad'
  text: string
  ipHash: string
  ts: number
}

function sanitiseText(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_LENGTH)
}

function parseEntry(raw: string): CommentEntry | null {
  try {
    const obj = JSON.parse(raw) as Partial<CommentEntry>
    if (obj.sentiment !== 'good' && obj.sentiment !== 'bad') return null
    return {
      sentiment: obj.sentiment,
      text: typeof obj.text === 'string' ? obj.text : '',
      ipHash: typeof obj.ipHash === 'string' ? obj.ipHash : '',
      ts: typeof obj.ts === 'number' ? obj.ts : 0,
    }
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

  const url = new URL(req.url)

  if (req.method === 'GET') {
    const entityType = url.searchParams.get('type') ?? ''
    const entityId = url.searchParams.get('id') ?? ''
    if (!ALLOWED_TYPES.has(entityType) || !entityId) {
      return new Response(JSON.stringify({ error: 'invalid params' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }
    const key = `${NS}comment:${entityType}:${entityId}`
    const raw = await redis.zrange<string[]>(key, 0, COMMENTS_RETURNED - 1, { rev: true })
    const comments: CommentEntry[] = []
    for (const r of raw) {
      const e = parseEntry(String(r))
      if (e) comments.push(e)
    }
    return new Response(
      JSON.stringify({
        entityType,
        entityId,
        comments,
        count: comments.length,
      }),
      {
        status: 200,
        headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      },
    )
  }

  if (req.method === 'POST') {
    let body: {
      type?: string
      id?: string
      sentiment?: string
      text?: string
      meta?: { name?: string; lat?: number; lng?: number; distrito?: string }
    }
    try {
      body = (await req.json()) as typeof body
    } catch {
      return new Response(JSON.stringify({ error: 'invalid json' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const entityType = String(body.type ?? '')
    const entityId = String(body.id ?? '').slice(0, 60)
    const sentiment = body.sentiment === 'good' || body.sentiment === 'bad' ? body.sentiment : null
    const text = sanitiseText(typeof body.text === 'string' ? body.text : '')
    const meta = body.meta && typeof body.meta === 'object' ? body.meta : undefined
    const safeMeta =
      meta
        ? {
            name: typeof meta.name === 'string' ? meta.name.slice(0, 80) : undefined,
            lat: typeof meta.lat === 'number' && isFinite(meta.lat) ? meta.lat : undefined,
            lng: typeof meta.lng === 'number' && isFinite(meta.lng) ? meta.lng : undefined,
            distrito: typeof meta.distrito === 'string' ? meta.distrito.slice(0, 60) : undefined,
          }
        : undefined

    if (!ALLOWED_TYPES.has(entityType) || !entityId || !/^[a-zA-Z0-9_\-]+$/.test(entityId) || !sentiment) {
      return new Response(JSON.stringify({ error: 'invalid params' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const ip =
      req.headers.get('x-real-ip') ||
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      'unknown'
    const ipHash = await hashIp(ip)

    const rlKey = `${NS}rlc:${ipHash}`
    const count = await redis.incr(rlKey)
    if (count === 1) await redis.expire(rlKey, 3600)
    if (count > RATE_LIMIT_PER_HOUR) {
      return new Response(JSON.stringify({ error: 'rate_limited' }), {
        status: 429,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const ts = Date.now()
    const rand = Math.random().toString(36).slice(2, 8)
    const entry: CommentEntry & { rand: string } = { sentiment, text, ipHash, ts, rand }
    const key = `${NS}comment:${entityType}:${entityId}`
    await redis.zadd(key, { score: ts, member: JSON.stringify(entry) })
    const total = await redis.zcard(key)
    if (total > MAX_COMMENTS_PER_ENTITY) {
      await redis.zremrangebyrank(key, 0, total - MAX_COMMENTS_PER_ENTITY - 1)
    }
    await redis.expire(key, COMMENT_TTL_SECONDS)

    // Also push to global feed for the "Últimos reportes" view.
    try {
      const feedEntry = JSON.stringify({
        kind: 'comment',
        entityType,
        id: entityId,
        sentiment,
        text,
        meta: safeMeta,
        ipHash,
        ts,
        rand,
      })
      await redis.zadd(FEED_KEY, { score: ts, member: feedEntry })
      const feedTotal = await redis.zcard(FEED_KEY)
      if (feedTotal > FEED_MAX_ENTRIES) {
        await redis.zremrangebyrank(FEED_KEY, 0, feedTotal - FEED_MAX_ENTRIES - 1)
      }
      await redis.expire(FEED_KEY, FEED_TTL_SECONDS)
    } catch {
      // Feed write failures are non-fatal — the per-amenity record is the source of truth.
    }

    return new Response(
      JSON.stringify({ ok: true, ts, sentiment, text }),
      {
        status: 200,
        headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      },
    )
  }

  return new Response('Method not allowed', { status: 405, headers: cors })
}
