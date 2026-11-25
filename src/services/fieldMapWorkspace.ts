export interface FieldMapElement {
  id: string
  name: string | null
  geometry_data: GeoJSON.Geometry
  properties: Record<string, unknown> | null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isGeometry = (value: unknown): value is GeoJSON.Geometry => {
  if (!isRecord(value) || typeof value.type !== 'string') return false
  if (value.type === 'GeometryCollection') {
    return Array.isArray(value.geometries) && value.geometries.every(isGeometry)
  }
  return [
    'Point',
    'MultiPoint',
    'LineString',
    'MultiLineString',
    'Polygon',
    'MultiPolygon',
  ].includes(value.type) && Array.isArray(value.coordinates)
}

const isFeature = (value: unknown): value is GeoJSON.Feature => {
  if (!isRecord(value) || value.type !== 'Feature' || !isGeometry(value.geometry)) return false
  return value.properties === null || value.properties === undefined || isRecord(value.properties)
}

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.keys(value).sort().map(key => [key, canonicalize(value[key])]),
  )
}

const geometryKey = (geometry: GeoJSON.Geometry) => JSON.stringify(canonicalize(geometry))

const roundCoordinates = (coords: unknown): unknown => {
  if (typeof coords === 'number') return Number(coords.toFixed(5))
  if (Array.isArray(coords)) return coords.map(roundCoordinates)
  return coords
}

export const isPolygonGeometry = (geometry: GeoJSON.Geometry | null | undefined): boolean =>
  geometry?.type === 'Polygon' || geometry?.type === 'MultiPolygon'

export const normalizedGeometryKey = (geometry: GeoJSON.Geometry): string => {
  if (geometry.type === 'GeometryCollection') {
    return JSON.stringify({
      type: geometry.type,
      geometries: geometry.geometries.map(item => JSON.parse(normalizedGeometryKey(item))),
    })
  }
  return JSON.stringify({
    type: geometry.type,
    coordinates: roundCoordinates(geometry.coordinates),
  })
}

const collectPolygonKeysFromGeometry = (geometry: GeoJSON.Geometry, target: Set<string>) => {
  if (geometry.type === 'Polygon') {
    target.add(normalizedGeometryKey(geometry))
    return
  }
  if (geometry.type === 'MultiPolygon') {
    target.add(normalizedGeometryKey(geometry))
    for (const rings of geometry.coordinates) {
      target.add(normalizedGeometryKey({ type: 'Polygon', coordinates: rings }))
    }
    return
  }
  if (geometry.type === 'GeometryCollection') {
    for (const item of geometry.geometries) collectPolygonKeysFromGeometry(item, target)
  }
}

export const collectFieldPolygonKeys = (geojsonList: unknown[]): Set<string> => {
  const keys = new Set<string>()
  for (const geojson of geojsonList) {
    for (const feature of readFieldMapFeatures(geojson)) {
      if (feature.geometry) collectPolygonKeysFromGeometry(feature.geometry, keys)
    }
  }
  return keys
}

export const isolateOwnParcelFeatures = (
  features: GeoJSON.Feature[],
  otherFieldGeojsons: unknown[],
): { features: GeoJSON.Feature[]; removedCount: number } => {
  const polygonCount = features.filter(feature => isPolygonGeometry(feature.geometry)).length
  if (polygonCount <= 1 || otherFieldGeojsons.length === 0) {
    return { features, removedCount: 0 }
  }

  const otherKeys = collectFieldPolygonKeys(otherFieldGeojsons)
  if (otherKeys.size === 0) {
    return { features, removedCount: 0 }
  }

  const filtered = features.filter(feature => {
    if (!feature.geometry || !isPolygonGeometry(feature.geometry)) return true
    return !otherKeys.has(normalizedGeometryKey(feature.geometry))
  })

  const remainingPolygons = filtered.filter(feature => isPolygonGeometry(feature.geometry)).length
  if (remainingPolygons === 0 || filtered.length === features.length) {
    return { features, removedCount: 0 }
  }

  return {
    features: filtered,
    removedCount: features.length - filtered.length,
  }
}

export const isolateOwnParcelGeoJson = (
  targetGeojson: unknown,
  otherFieldGeojsons: unknown[],
): { geojson: unknown; removedCount: number } => {
  const features = readFieldMapFeatures(targetGeojson)
  const { features: isolated, removedCount } = isolateOwnParcelFeatures(features, otherFieldGeojsons)
  if (removedCount === 0) {
    return { geojson: targetGeojson, removedCount: 0 }
  }
  return {
    geojson: {
      type: 'FeatureCollection',
      features: isolated,
    },
    removedCount,
  }
}

export const extractNewParcelFeaturesForSave = (
  currentFeatures: GeoJSON.Feature[],
  loadedFieldId: string,
  savedFields: Array<{ id: string; geojson_data: unknown }>,
): GeoJSON.Feature[] => {
  const stripElementIds = (list: GeoJSON.Feature[]) =>
    list.map(feature => {
      const props = { ...(feature.properties ?? {}) }
      delete props.map_element_id
      return {
        ...feature,
        properties: props,
      }
    })

  const polygonFeatures = currentFeatures.filter(feature => isPolygonGeometry(feature.geometry))
  if (polygonFeatures.length <= 1) {
    return stripElementIds(currentFeatures)
  }

  const savedPolygonKeys = collectFieldPolygonKeys(savedFields.map(field => field.geojson_data))
  const candidates = currentFeatures.filter(feature => {
    const hasLoadedElementId =
      Boolean(loadedFieldId) && typeof feature.properties?.map_element_id === 'string'
    if (hasLoadedElementId) return false
    if (feature.geometry && isPolygonGeometry(feature.geometry)) {
      return !savedPolygonKeys.has(normalizedGeometryKey(feature.geometry))
    }
    return true
  })

  const remainingPolygons = candidates.filter(feature => isPolygonGeometry(feature.geometry)).length
  return stripElementIds(remainingPolygons >= 1 ? candidates : currentFeatures)
}

export const readFieldMapFeatures = (value: unknown): GeoJSON.Feature[] => {
  if (isRecord(value) && value.type === 'FeatureCollection' && Array.isArray(value.features)) {
    return value.features.filter(isFeature)
  }
  if (isFeature(value)) return [value]
  if (isGeometry(value)) return [{ type: 'Feature', geometry: value, properties: {} }]
  return []
}

export const mergeFieldMapFeatures = (
  fieldGeoJson: unknown,
  elements: FieldMapElement[],
): GeoJSON.Feature[] => {
  const fieldFeatures = readFieldMapFeatures(fieldGeoJson)
  const matchedElementIds = new Set<string>()

  const featuresWithElementIds = fieldFeatures.map(feature => {
    if (!feature.geometry) return feature
    const featureElementId = feature.properties?.map_element_id
    const element = elements.find(candidate =>
      !matchedElementIds.has(candidate.id)
      && (
        candidate.id === featureElementId
        || geometryKey(candidate.geometry_data) === geometryKey(feature.geometry)
      ),
    )
    if (!element) return feature

    matchedElementIds.add(element.id)
    return {
      ...feature,
      properties: {
        ...(feature.properties ?? {}),
        ...(element.properties ?? {}),
        name: feature.properties?.name ?? element.name ?? 'Elemento guardado',
        map_element_id: element.id,
      },
    }
  })

  const remainingElements = elements
    .filter(element => !matchedElementIds.has(element.id))
    .map(element => ({
      type: 'Feature' as const,
      geometry: element.geometry_data,
      properties: {
        ...(element.properties ?? {}),
        name: element.name ?? 'Elemento guardado',
        map_element_id: element.id,
      },
    }))

  return [...featuresWithElementIds, ...remainingElements]
}
