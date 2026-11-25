import type { Json } from './agronomyData.ts'
import type { GeoCoordinate, ParcelGeometryMetadata } from '../types/simulation.ts'

export interface FieldPoint {
  x: number
  z: number
}

export interface ProjectedFieldPolygon {
  rings: FieldPoint[][]
}

export interface ProjectedField {
  polygons: ProjectedFieldPolygon[]
  widthMeters: number
  depthMeters: number
  areaSquareMeters: number
  areaHectares: number
  perimeterMeters: number
  bounds: {
    minX: number
    maxX: number
    minZ: number
    maxZ: number
  }
  centroidLocal: FieldPoint
  centroid: GeoCoordinate
  vertices: GeoCoordinate[][]
  vertexCount: number
  projectGps(latitude: number, longitude: number): FieldPoint
  unprojectPoint(x: number, z: number): GeoCoordinate
  unprojectGps(point: FieldPoint): { latitude: number; longitude: number }
  contains(point: FieldPoint): boolean
}

export interface GeneratedPlantSlot {
  id: string
  x: number
  z: number
  lat: number
  lng: number
  stage: 1 | 2 | 3
}

/** Polígono irregular realista por defecto (forma en L en Culiacán) cuando el usuario aún no selecciona un campo guardado. */
export const DEFAULT_DEMO_PARCEL_GEOJSON: Json = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {
        name: 'Parcela Demostrativa AgronIA (Polígono Real)',
      },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-107.39455, 24.79985],
            [-107.39335, 24.79985],
            [-107.39335, 24.79942],
            [-107.39382, 24.79942],
            [-107.39382, 24.79895],
            [-107.39455, 24.79895],
            [-107.39455, 24.79985],
          ],
        ],
      },
    },
  ],
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const readCoordinate = (value: unknown): [number, number] | null => {
  if (!Array.isArray(value) || value.length < 2) return null
  const [longitude, latitude] = value
  if (
    typeof longitude !== 'number' ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180 ||
    typeof latitude !== 'number' ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90
  ) {
    return null
  }
  return [longitude, latitude]
}

const readRing = (value: unknown): [number, number][] => {
  if (!Array.isArray(value)) return []
  return value.map(readCoordinate).filter((point): point is [number, number] => point !== null)
}

const readRings = (value: unknown): [number, number][][] => {
  if (!Array.isArray(value)) return []
  return value.map(readRing).filter(ring => ring.length >= 3)
}

const readPolygons = (value: unknown): [number, number][][][] => {
  if (!isRecord(value)) return []

  if (value.type === 'FeatureCollection' && Array.isArray(value.features)) {
    return value.features.flatMap(feature => readPolygons(feature))
  }
  if (value.type === 'Feature') return readPolygons(value.geometry)
  if (value.type === 'GeometryCollection' && Array.isArray(value.geometries)) {
    return value.geometries.flatMap(geometry => readPolygons(geometry))
  }
  if (value.type === 'Polygon') {
    const rings = readRings(value.coordinates)
    return rings.length ? [rings] : []
  }
  if (value.type === 'MultiPolygon' && Array.isArray(value.coordinates)) {
    return value.coordinates.map(readRings).filter(rings => rings.length > 0)
  }
  return []
}

export const stripClosingVertex = <T>(
  ring: T[],
  isEqual: (a: T, b: T) => boolean
): T[] => {
  if (ring.length > 1 && isEqual(ring[0], ring[ring.length - 1])) {
    return ring.slice(0, -1)
  }
  return ring.slice()
}

const signedTwiceArea = (ring: FieldPoint[]): number => {
  let twiceArea = 0
  for (let index = 0; index < ring.length; index++) {
    const current = ring[index]
    const next = ring[(index + 1) % ring.length]
    twiceArea += current.x * next.z - next.x * current.z
  }
  return twiceArea
}

const ringArea = (ring: FieldPoint[]): number => Math.abs(signedTwiceArea(ring)) / 2

const ringCentroid = (ring: FieldPoint[]): { area: number; centroid: FieldPoint } => {
  const cleanRing = stripClosingVertex(ring, (a, b) => a.x === b.x && a.z === b.z)
  if (cleanRing.length < 3) {
    return { area: 0, centroid: { x: 0, z: 0 } }
  }
  const twice = signedTwiceArea(cleanRing)
  const area = Math.abs(twice) / 2
  if (Math.abs(twice) < 1e-9) {
    const avgX = cleanRing.reduce((s, p) => s + p.x, 0) / cleanRing.length
    const avgZ = cleanRing.reduce((s, p) => s + p.z, 0) / cleanRing.length
    return { area: 0, centroid: { x: avgX, z: avgZ } }
  }

  let cx = 0
  let cz = 0
  for (let i = 0; i < cleanRing.length; i++) {
    const a = cleanRing[i]
    const b = cleanRing[(i + 1) % cleanRing.length]
    const cross = a.x * b.z - b.x * a.z
    cx += (a.x + b.x) * cross
    cz += (a.z + b.z) * cross
  }

  const denom = 3 * twice
  return {
    area,
    centroid: {
      x: cx / denom,
      z: cz / denom,
    },
  }
}

const ringPerimeter = (ring: FieldPoint[]): number => {
  const clean = stripClosingVertex(ring, (a, b) => a.x === b.x && a.z === b.z)
  if (clean.length < 2) return 0
  let total = 0
  for (let i = 0; i < clean.length; i++) {
    const a = clean[i]
    const b = clean[(i + 1) % clean.length]
    total += Math.hypot(b.x - a.x, b.z - a.z)
  }
  return total
}

const pointToSegmentDistanceSq = (p: FieldPoint, a: FieldPoint, b: FieldPoint): number => {
  const dx = b.x - a.x
  const dz = b.z - a.z
  const lenSq = dx * dx + dz * dz
  if (lenSq <= 1e-12) {
    return (p.x - a.x) ** 2 + (p.z - a.z) ** 2
  }
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / lenSq))
  const projX = a.x + t * dx
  const projZ = a.z + t * dz
  return (p.x - projX) ** 2 + (p.z - projZ) ** 2
}

export const isPointInRing = (point: FieldPoint, ring: FieldPoint[]): boolean => {
  const clean = stripClosingVertex(ring, (a, b) => a.x === b.x && a.z === b.z)
  if (clean.length < 3) return false

  for (let i = 0; i < clean.length; i++) {
    const a = clean[i]
    const b = clean[(i + 1) % clean.length]
    if (pointToSegmentDistanceSq(point, a, b) <= 1e-10) {
      return true
    }
  }

  let inside = false
  for (let i = 0, j = clean.length - 1; i < clean.length; j = i++) {
    const xi = clean[i].x
    const zi = clean[i].z
    const xj = clean[j].x
    const zj = clean[j].z

    const intersects =
      (zi > point.z) !== (zj > point.z) &&
      point.x < ((xj - xi) * (point.z - zi)) / (zj - zi + 0.0) + xi
    if (intersects) inside = !inside
  }
  return inside
}

export const isPointInProjectedField = (point: FieldPoint, field: ProjectedField): boolean => {
  for (const polygon of field.polygons) {
    const [exterior, ...holes] = polygon.rings
    if (!exterior || !isPointInRing(point, exterior)) continue
    let inHole = false
    for (const hole of holes) {
      if (isPointInRing(point, hole)) {
        inHole = true
        break
      }
    }
    if (!inHole) return true
  }
  return false
}

const ringScanlineIntervals = (ring: FieldPoint[], z: number): Array<[number, number]> => {
  const clean = stripClosingVertex(ring, (a, b) => a.x === b.x && a.z === b.z)
  if (clean.length < 3) return []

  const xs: number[] = []
  for (let i = 0; i < clean.length; i++) {
    const a = clean[i]
    const b = clean[(i + 1) % clean.length]
    if ((a.z <= z && b.z > z) || (b.z <= z && a.z > z)) {
      const t = (z - a.z) / (b.z - a.z)
      xs.push(a.x + t * (b.x - a.x))
    }
  }

  xs.sort((u, v) => u - v)
  const intervals: Array<[number, number]> = []
  for (let i = 0; i + 1 < xs.length; i += 2) {
    if (xs[i + 1] - xs[i] > 1e-4) {
      intervals.push([xs[i], xs[i + 1]])
    }
  }
  return intervals
}

const subtractIntervalList = (
  baseIntervals: Array<[number, number]>,
  holes: Array<[number, number]>
): Array<[number, number]> => {
  let current = baseIntervals
  for (const [hs, he] of holes) {
    const next: Array<[number, number]> = []
    for (const [s, e] of current) {
      if (he <= s || hs >= e) {
        next.push([s, e])
      } else {
        if (hs > s + 1e-4) next.push([s, hs])
        if (he < e - 1e-4) next.push([he, e])
      }
    }
    current = next
  }
  return current
}

export const computeHorizontalScanlineSegments = (
  z: number,
  field: ProjectedField
): Array<[number, number]> => {
  const allSegments: Array<[number, number]> = []

  for (const polygon of field.polygons) {
    const [exterior, ...holes] = polygon.rings
    if (!exterior) continue
    let intervals = ringScanlineIntervals(exterior, z)
    for (const hole of holes) {
      intervals = subtractIntervalList(intervals, ringScanlineIntervals(hole, z))
    }
    allSegments.push(...intervals)
  }

  if (allSegments.length <= 1) return allSegments
  allSegments.sort((a, b) => a[0] - b[0])

  const merged: Array<[number, number]> = [allSegments[0]]
  for (let i = 1; i < allSegments.length; i++) {
    const prev = merged[merged.length - 1]
    const curr = allSegments[i]
    if (curr[0] <= prev[1] + 1e-4) {
      prev[1] = Math.max(prev[1], curr[1])
    } else {
      merged.push(curr)
    }
  }
  return merged
}

export const projectFieldGeometry = (geojson: Json | null): ProjectedField | null => {
  const sourcePolygons = readPolygons(geojson)
  const coordinates = sourcePolygons.flat(2)
  if (coordinates.length < 3) return null

  const minLongitude = Math.min(...coordinates.map(([longitude]) => longitude))
  const maxLongitude = Math.max(...coordinates.map(([longitude]) => longitude))
  const minLatitude = Math.min(...coordinates.map(([, latitude]) => latitude))
  const maxLatitude = Math.max(...coordinates.map(([, latitude]) => latitude))
  const originLongitude = (minLongitude + maxLongitude) / 2
  const originLatitude = (minLatitude + maxLatitude) / 2
  const longitudeScale = 111_320 * Math.cos((originLatitude * Math.PI) / 180)
  if (!Number.isFinite(longitudeScale) || Math.abs(longitudeScale) < 1e-6) return null

  const projectRaw = (latitude: number, longitude: number): FieldPoint => ({
    x: (longitude - originLongitude) * longitudeScale,
    z: -(latitude - originLatitude) * 110_540,
  })

  const polygons = sourcePolygons.map(rings => ({
    rings: rings.map(ring => ring.map(([longitude, latitude]) => projectRaw(latitude, longitude))),
  }))
  const allPoints = polygons.flatMap(polygon => polygon.rings.flat())
  const minX = Math.min(...allPoints.map(point => point.x))
  const maxX = Math.max(...allPoints.map(point => point.x))
  const minZ = Math.min(...allPoints.map(point => point.z))
  const maxZ = Math.max(...allPoints.map(point => point.z))
  if (maxX <= minX || maxZ <= minZ) return null

  const centerX = (minX + maxX) / 2
  const centerZ = (minZ + maxZ) / 2

  const centeredPolygons: ProjectedFieldPolygon[] = polygons.map(polygon => ({
    rings: polygon.rings.map(ring =>
      stripClosingVertex(
        ring.map(point => ({
          x: point.x - centerX,
          z: point.z - centerZ,
        })),
        (a, b) => Math.hypot(a.x - b.x, a.z - b.z) < 1e-7
      )
    ),
  }))

  let areaSquareMeters = 0
  let weightedCx = 0
  let weightedCz = 0
  let perimeterMeters = 0

  for (const polygon of centeredPolygons) {
    const [exterior, ...holes] = polygon.rings
    if (!exterior || exterior.length < 3) continue
    const extInfo = ringCentroid(exterior)
    let netArea = extInfo.area
    let netCxWeight = extInfo.area * extInfo.centroid.x
    let netCzWeight = extInfo.area * extInfo.centroid.z

    perimeterMeters += ringPerimeter(exterior)
    for (const hole of holes) {
      const holeInfo = ringCentroid(hole)
      netArea -= holeInfo.area
      netCxWeight -= holeInfo.area * holeInfo.centroid.x
      netCzWeight -= holeInfo.area * holeInfo.centroid.z
      perimeterMeters += ringPerimeter(hole)
    }

    const clampedArea = Math.max(0, netArea)
    areaSquareMeters += clampedArea
    if (clampedArea > 0) {
      weightedCx += netCxWeight
      weightedCz += netCzWeight
    }
  }

  if (areaSquareMeters <= 0) return null

  // Verifica también área con la lógica tradicional de ringArea
  const verifiedArea = centeredPolygons.reduce((total, polygon) => {
    const [exterior, ...holes] = polygon.rings
    return (
      total + Math.max(0, ringArea(exterior) - holes.reduce((sum, ring) => sum + ringArea(ring), 0))
    )
  }, 0)
  if (verifiedArea <= 0) return null

  const centroidLocal: FieldPoint = {
    x: weightedCx / areaSquareMeters,
    z: weightedCz / areaSquareMeters,
  }

  const unprojectPoint = (x: number, z: number): GeoCoordinate => {
    const rawX = x + centerX
    const rawZ = z + centerZ
    return {
      lat: Number((originLatitude - rawZ / 110_540).toFixed(7)),
      lng: Number((originLongitude + rawX / longitudeScale).toFixed(7)),
    }
  }

  const vertices: GeoCoordinate[][] = sourcePolygons.map(rings => {
    const exterior = rings[0] ?? []
    const clean = stripClosingVertex(
      exterior,
      (a, b) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9
    )
    return clean.map(([lng, lat]) => ({
      lat: Number(lat.toFixed(7)),
      lng: Number(lng.toFixed(7)),
    }))
  })

  const vertexCount = vertices.reduce((sum, ring) => sum + ring.length, 0)

  return {
    polygons: centeredPolygons,
    widthMeters: maxX - minX,
    depthMeters: maxZ - minZ,
    areaSquareMeters,
    areaHectares: areaSquareMeters / 10_000,
    perimeterMeters,
    bounds: {
      minX: minX - centerX,
      maxX: maxX - centerX,
      minZ: minZ - centerZ,
      maxZ: maxZ - centerZ,
    },
    centroidLocal,
    centroid: unprojectPoint(centroidLocal.x, centroidLocal.z),
    vertices,
    vertexCount,
    projectGps: (latitude, longitude) => {
      const point = projectRaw(latitude, longitude)
      return { x: point.x - centerX, z: point.z - centerZ }
    },
    unprojectPoint,
    unprojectGps: point => ({
      latitude: originLatitude - (point.z + centerZ) / 110_540,
      longitude: originLongitude + (point.x + centerX) / longitudeScale,
    }),
    contains: point => centeredPolygons.some(polygon => {
      const [exterior, ...holes] = polygon.rings
      return isPointInRing(point, exterior) && !holes.some(ring => isPointInRing(point, ring))
    }),
  }
}

export const computeTakeoffBaseForField = (field: ProjectedField): FieldPoint & GeoCoordinate => {
  const minDim = Math.min(field.widthMeters, field.depthMeters)
  const margin = Math.max(3, Math.min(12, minDim * 0.09))

  const allVertices = field.polygons.flatMap(p => p.rings[0] ?? [])
  const southWestVertex = allVertices.reduce<FieldPoint | null>((best, curr) => {
    if (!best) return curr
    const currScore = curr.z - curr.x * 0.45
    const bestScore = best.z - best.x * 0.45
    return currScore > bestScore ? curr : best
  }, null)

  const candidates: FieldPoint[] = []
  if (southWestVertex) {
    candidates.push({
      x: southWestVertex.x - margin * 0.5,
      z: southWestVertex.z + margin,
    })
  }
  candidates.push({
    x: field.centroidLocal.x - field.widthMeters * 0.25,
    z: field.bounds.maxZ + margin,
  })
  candidates.push({
    x: field.bounds.minX - margin,
    z: field.bounds.maxZ + margin,
  })

  const chosen =
    candidates.find(candidate => !isPointInProjectedField(candidate, field)) ??
    candidates[candidates.length - 1]
  const geo = field.unprojectPoint(chosen.x, chosen.z)
  return {
    x: Number(chosen.x.toFixed(3)),
    z: Number(chosen.z.toFixed(3)),
    lat: geo.lat,
    lng: geo.lng,
  }
}

export const generatePlantGridInsidePolygon = (
  field: ProjectedField,
  options?: {
    targetCount?: number
    maxPlants?: number
    minSpacingMeters?: number
    jitterRatio?: number
    random?: () => number
  }
): GeneratedPlantSlot[] => {
  const targetCount = options?.targetCount ?? 320
  const maxPlants = options?.maxPlants ?? 600
  const minSpacingMeters = options?.minSpacingMeters ?? 0.85
  const jitterRatio = options?.jitterRatio ?? 0.2
  const random = options?.random ?? Math.random

  let spacing = Math.max(minSpacingMeters, Math.sqrt(field.areaSquareMeters / Math.max(16, targetCount)))
  const slots: GeneratedPlantSlot[] = []

  for (let attempt = 0; attempt < 3; attempt++) {
    slots.length = 0
    const colSpacing = spacing * 0.96
    const rowSpacing = spacing * 1.04
    const startX = field.bounds.minX + colSpacing * 0.45
    const startZ = field.bounds.minZ + rowSpacing * 0.45

    let rowIdx = 0
    for (let z = startZ; z <= field.bounds.maxZ - rowSpacing * 0.25; z += rowSpacing) {
      let colIdx = 0
      for (let x = startX; x <= field.bounds.maxX - colSpacing * 0.25; x += colSpacing) {
        const jx = (random() * 2 - 1) * colSpacing * jitterRatio
        const jz = (random() * 2 - 1) * rowSpacing * jitterRatio
        const jittered: FieldPoint = { x: x + jx, z: z + jz }
        const gridCenter: FieldPoint = { x, z }

        const accepted = isPointInProjectedField(jittered, field)
          ? jittered
          : isPointInProjectedField(gridCenter, field)
            ? gridCenter
            : null

        if (accepted) {
          const geo = field.unprojectPoint(accepted.x, accepted.z)
          const r = random()
          const stage: 1 | 2 | 3 = r > 0.58 ? 3 : r > 0.26 ? 2 : 1
          slots.push({
            id: `P-${rowIdx}-${colIdx}`,
            x: Number(accepted.x.toFixed(3)),
            z: Number(accepted.z.toFixed(3)),
            lat: geo.lat,
            lng: geo.lng,
            stage,
          })
          if (slots.length >= maxPlants) {
            return slots
          }
        }
        colIdx++
      }
      rowIdx++
    }

    if (slots.length >= 16) {
      return slots
    }
    spacing = Math.max(0.35, spacing * 0.5)
  }

  // Último respaldo para polígonos muy estrechos: muestrear directamente sobre los scanlines internos
  if (slots.length === 0) {
    const scanSteps = 14
    const dz = field.depthMeters / (scanSteps + 1)
    let idx = 0
    for (let s = 1; s <= scanSteps; s++) {
      const z = field.bounds.minZ + dz * s
      const segments = computeHorizontalScanlineSegments(z, field)
      for (const [segStart, segEnd] of segments) {
        const segLen = segEnd - segStart
        const count = Math.max(1, Math.min(8, Math.floor(segLen / Math.max(0.5, spacing))))
        for (let k = 1; k <= count; k++) {
          const px = segStart + (segLen * k) / (count + 1)
          const pt = { x: px, z }
          if (isPointInProjectedField(pt, field)) {
            const geo = field.unprojectPoint(px, z)
            slots.push({
              id: `P-S-${idx++}`,
              x: Number(px.toFixed(3)),
              z: Number(z.toFixed(3)),
              lat: geo.lat,
              lng: geo.lng,
              stage: 2,
            })
          }
        }
      }
    }
  }

  return slots
}

export const extractParcelMetadata = (
  geojson: Json | null,
  fieldId: string | null = null,
  fieldName = 'Parcela'
): ParcelGeometryMetadata | null => {
  if (!geojson) return null
  const projected = projectFieldGeometry(geojson)
  if (!projected) return null

  return {
    fieldId,
    fieldName,
    geojson,
    vertices: projected.vertices,
    vertexCount: projected.vertexCount,
    areaSquareMeters: Number(projected.areaSquareMeters.toFixed(2)),
    areaHectares: Number(projected.areaHectares.toFixed(4)),
    perimeterMeters: Number(projected.perimeterMeters.toFixed(2)),
    centroid: projected.centroid,
    widthMeters: Number(projected.widthMeters.toFixed(2)),
    depthMeters: Number(projected.depthMeters.toFixed(2)),
  }
}

export const enrichGeoJsonWithParcelMetadata = (
  geojson: Json,
  fieldName = 'Parcela'
): Json => {
  if (!isRecord(geojson) || geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) {
    return geojson
  }

  const meta = extractParcelMetadata(geojson, null, fieldName)
  const enrichedFeatures = geojson.features.map(feature => {
    if (!isRecord(feature)) return feature
    const geom = feature.geometry
    const isPoly =
      isRecord(geom) && (geom.type === 'Polygon' || geom.type === 'MultiPolygon')
    if (!isPoly) return feature

    const featureProjected = projectFieldGeometry(feature as Json)
    const props = isRecord(feature.properties) ? { ...feature.properties } : {}
    if (featureProjected || meta) {
      const activeMeta = featureProjected
        ? {
            area_m2: Number(featureProjected.areaSquareMeters.toFixed(2)),
            area_hectares: Number(featureProjected.areaHectares.toFixed(4)),
            perimeter_m: Number(featureProjected.perimeterMeters.toFixed(2)),
            centroid: featureProjected.centroid,
            vertex_count: featureProjected.vertexCount,
            vertices: featureProjected.vertices,
          }
        : null
      props.agronia_parcel_meta = {
        field_name: fieldName,
        ...(activeMeta ?? {}),
      } as unknown as Json
    }

    return {
      ...feature,
      properties: props,
    }
  })

  return {
    type: 'FeatureCollection',
    features: enrichedFeatures,
  }
}
