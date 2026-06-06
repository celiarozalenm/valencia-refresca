// Seed demo data so the "En directo" feed and the map popups aren't empty.
// Run AFTER Upstash is connected and env vars are available:
//   vercel env pull .env.local   (or export KV_REST_API_URL / KV_REST_API_TOKEN)
//   node --env-file=.env.local scripts/seed-demo.mjs
//
// Mirrors the exact storage format used by api/comment.ts + api/feed.ts so the
// live endpoints read the seeded entries.

import { Redis } from '@upstash/redis'

const redis = new Redis({
  url: process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL ?? '',
  token: process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN ?? '',
})

if (!redis.opts?.url && !process.env.KV_REST_API_URL && !process.env.UPSTASH_REDIS_REST_URL) {
  console.error('✗ Faltan las claves de Upstash (KV_REST_API_URL / KV_REST_API_TOKEN). Conecta Upstash y vuelve a probar.')
  process.exit(1)
}

const NS = 'vr:' // shared DB with madroño-perruno; keep valencia keys namespaced
const FEED_KEY = `${NS}feed:global`
const TITLES = { fuente: 'Fuente de agua', urinario: 'Urinario', ducha: 'Ducha de playa' }
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

// Real València amenities (type, id, address, lat, lng) + the demo comment.
const SEED = [
  { type: 'fuente',   id: '1016', address: 'CARRETERA EN CORTS, 86',              lat: 39.4458,  lng: -0.35845, sentiment: 'good', text: 'Sale fresquita, perfecta en agosto.',        agoMs: 12 * MIN },
  { type: 'fuente',   id: '1142', address: 'GRAN CANARIA (FRENTE Nº 33)',         lat: 39.48288, lng: -0.32915, sentiment: 'bad',  text: 'Lleva días sin dar agua.',                  agoMs: 2 * HOUR },
  { type: 'fuente',   id: '1017', address: 'CARRETERA EN CORTS FRENTE AL 58',     lat: 39.44775, lng: -0.35982, sentiment: 'good', text: 'Funciona y el caño está limpio.',           agoMs: 6 * HOUR },
  { type: 'fuente',   id: '1024', address: 'JESUS MORANTE BORRAS, 194',           lat: 39.44205, lng: -0.34391, sentiment: 'good', text: '',                                          agoMs: 20 * HOUR },
  { type: 'urinario', id: '2745', address: 'PL TETUAN',                            lat: 39.47341, lng: -0.36969, sentiment: 'good', text: 'Limpio esta mañana.',                       agoMs: 40 * MIN },
  { type: 'urinario', id: '2744', address: 'C/ FILIPINES (acera parque central)', lat: 39.45805, lng: -0.37681, sentiment: 'bad',  text: 'La puerta no cierra bien.',                 agoMs: 1 * DAY + 3 * HOUR },
  { type: 'urinario', id: '2746', address: 'C/ GUILLEM DE CASTRO - PL PORTAL NOU', lat: 39.48142, lng: -0.37976, sentiment: 'bad', text: 'Hacía falta limpieza.',                     agoMs: 2 * DAY },
  { type: 'ducha',    id: 'D036', address: 'DUCHA Nº36 - SIDI SALER IZQDA',       lat: 39.36748, lng: -0.31976, sentiment: 'good', text: 'Buena presión y el suelo no resbala.',      agoMs: 3 * HOUR },
  { type: 'ducha',    id: 'D038', address: 'DUCHA Nº38 - SIDI SALER IZQDA',       lat: 39.371,   lng: -0.32038, sentiment: 'bad',  text: 'No funciona desde el finde.',               agoMs: 1 * DAY + 8 * HOUR },
  { type: 'ducha',    id: 'D035', address: 'DUCHA Nº35 - SIDI SALER IZQDA',       lat: 39.36594, lng: -0.31837, sentiment: 'good', text: 'Perfecta tras la playa.',                   agoMs: 5 * HOUR },
]

const rand = () => Math.random().toString(36).slice(2, 8)
const ipHash = 'seeddemo00000000'

let added = 0
for (const s of SEED) {
  const ts = Date.now() - s.agoMs
  const r = rand()
  const commentMember = JSON.stringify({ sentiment: s.sentiment, text: s.text, ipHash, ts, rand: r })
  await redis.zadd(`${NS}comment:${s.type}:${s.id}`, { score: ts, member: commentMember })

  const feedMember = JSON.stringify({
    kind: 'comment',
    entityType: s.type,
    id: s.id,
    sentiment: s.sentiment,
    text: s.text,
    meta: { name: `${TITLES[s.type]} · ${s.address}`, lat: s.lat, lng: s.lng },
    ipHash,
    ts,
    rand: r,
  })
  await redis.zadd(FEED_KEY, { score: ts, member: feedMember })
  added++
}

const total = await redis.zcard(FEED_KEY)
console.log(`✓ Insertados ${added} comentarios de ejemplo. El feed tiene ahora ${total} entradas.`)
