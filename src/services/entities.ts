// Loads the three reportable amenity layers (fuentes, urinarios, duchas) from
// the public GeoJSON snapshots and normalises them into a single shape that the
// Participar listing and the map feedback popup both share.
//
// The `id` here is the stable identifier sent to /api/comment, so it MUST match
// the id the map popup uses for the same amenity (see Map.tsx).

import type { EntityType } from './comments'

export interface Amenity {
  type: EntityType
  id: string
  title: string
  address: string
  extra: string
  lat: number
  lng: number
}

const SOURCES: Record<EntityType, string> = {
  fuente: '/data/fonts-daigua-publica-fuentes-de-agua-publica.geojson',
  urinario: '/data/urinaris-urinarios.geojson',
  ducha: '/data/dutxes-platja-duchas-playa.geojson',
}

interface GeoFeature {
  geometry?: { coordinates?: [number, number] }
  properties?: Record<string, unknown>
}

const str = (v: unknown): string => (v == null ? '' : String(v))

function normalise(type: EntityType, f: GeoFeature, index: number): Amenity | null {
  const coords = f.geometry?.coordinates
  if (!coords || coords.length < 2) return null
  const [lng, lat] = coords
  const p = f.properties ?? {}

  if (type === 'fuente') {
    const id = str(p.codigo) || `o${str(p.objectid) || index}`
    return {
      type,
      id,
      title: 'Fuente de agua',
      address: str(p.calle) || 'Sin dirección',
      extra: p.codigo ? `Código ${str(p.codigo)}` : '',
      lat,
      lng,
    }
  }

  if (type === 'urinario') {
    const id = str(p.objectid) || `i${index}`
    const nor = Number(p.cabina_nor ?? 0)
    const min = Number(p.cabina_min ?? 0)
    return {
      type,
      id,
      title: 'Urinario',
      address: str(p.direccion) || 'Sin dirección',
      extra: `${nor} cabina(s) · ${min} movilidad reducida`,
      lat,
      lng,
    }
  }

  // ducha
  const id = str(p.codigo) || `o${str(p.objectid) || index}`
  return {
    type,
    id,
    title: 'Ducha de playa',
    address: str(p.calle) || 'Sin dirección',
    extra: p.codigo ? `Código ${str(p.codigo)}` : '',
    lat,
    lng,
  }
}

const cache: Partial<Record<EntityType, Amenity[]>> = {}

export async function loadAmenities(type: EntityType): Promise<Amenity[]> {
  if (cache[type]) return cache[type]!
  const res = await fetch(SOURCES[type], { cache: 'force-cache' })
  if (!res.ok) throw new Error(`loadAmenities ${type} HTTP ${res.status}`)
  const data = (await res.json()) as { features?: GeoFeature[] }
  const list = (data.features ?? [])
    .map((f, i) => normalise(type, f, i))
    .filter((a): a is Amenity => a !== null)
  cache[type] = list
  return list
}
