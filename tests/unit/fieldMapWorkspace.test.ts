import assert from 'node:assert/strict'
import test from 'node:test'
import {
  extractNewParcelFeaturesForSave,
  isolateOwnParcelGeoJson,
  mergeFieldMapFeatures,
  readFieldMapFeatures,
} from '../../src/services/fieldMapWorkspace.ts'

const polygon = {
  type: 'Polygon' as const,
  coordinates: [[[-107.4, 24.7], [-107.3, 24.7], [-107.3, 24.8], [-107.4, 24.8], [-107.4, 24.7]]],
}

test('reads saved parcel geometry and merges its matching map element without duplicating it', () => {
  const field = {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: polygon, properties: { name: 'Lote norte' } }],
  }
  const elements = [{
    id: 'element-1',
    name: 'Lote norte',
    geometry_data: polygon,
    properties: { source: 'editor' },
  }]

  const features = mergeFieldMapFeatures(field, elements)

  assert.equal(features.length, 1)
  assert.equal(features[0].properties?.map_element_id, 'element-1')
  assert.equal(features[0].properties?.source, 'editor')
})

test('keeps additional elements in the selected workspace and accepts raw polygon GeoJSON', () => {
  const extraPoint = {
    id: 'element-2',
    name: 'Pozo',
    geometry_data: { type: 'Point' as const, coordinates: [-107.35, 24.75] },
    properties: null,
  }

  const features = mergeFieldMapFeatures(polygon, [extraPoint])

  assert.equal(readFieldMapFeatures(polygon).length, 1)
  assert.equal(features.length, 2)
  assert.equal(features[0].geometry?.type, 'Polygon')
  assert.equal(features[1].properties?.map_element_id, 'element-2')
})

test('isolateOwnParcelGeoJson removes stray polygon belonging to another parcel while keeping its own', () => {
  const navolatoPoly = {
    type: 'Polygon' as const,
    coordinates: [[[-107.69, 24.75], [-107.68, 24.75], [-107.68, 24.76], [-107.69, 24.76], [-107.69, 24.75]]],
  }
  const culiacanPoly = {
    type: 'Polygon' as const,
    coordinates: [[[-107.50, 24.77], [-107.49, 24.77], [-107.49, 24.78], [-107.50, 24.78], [-107.50, 24.77]]],
  }

  const contaminatedNavolato = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', geometry: culiacanPoly, properties: { name: 'Elemento 1' } },
      { type: 'Feature', geometry: navolatoPoly, properties: { name: 'Elemento 2' } },
    ],
  }

  const cleaned = isolateOwnParcelGeoJson(contaminatedNavolato, [
    { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: culiacanPoly, properties: { name: 'Culiacán' } }] },
  ])
  assert.equal(cleaned.removedCount, 1)
  const remaining = readFieldMapFeatures(cleaned.geojson)
  assert.equal(remaining.length, 1)
  assert.equal(remaining[0].properties?.name, 'Elemento 2')

  // Un polígono único nunca se elimina aunque otro registro comparta coordenadas similares
  const singleOnly = isolateOwnParcelGeoJson(
    { type: 'Feature', geometry: navolatoPoly, properties: {} },
    [navolatoPoly],
  )
  assert.equal(singleOnly.removedCount, 0)
})

test('extractNewParcelFeaturesForSave drops previously loaded parcel polygons when saving a new field', () => {
  const oldPoly = {
    type: 'Polygon' as const,
    coordinates: [[[-107.69, 24.75], [-107.68, 24.75], [-107.68, 24.76], [-107.69, 24.76], [-107.69, 24.75]]],
  }
  const newPoly = {
    type: 'Polygon' as const,
    coordinates: [[[-107.50, 24.77], [-107.49, 24.77], [-107.49, 24.78], [-107.50, 24.78], [-107.50, 24.77]]],
  }

  const extracted = extractNewParcelFeaturesForSave(
    [
      { type: 'Feature', geometry: oldPoly, properties: { name: 'Navolato', map_element_id: 'el-old' } },
      { type: 'Feature', geometry: newPoly, properties: { name: 'Nueva' } },
    ],
    'field-navolato',
    [{ id: 'field-navolato', geojson_data: { type: 'Feature', geometry: oldPoly, properties: {} } }],
  )

  assert.equal(extracted.length, 1)
  assert.equal(extracted[0].properties?.name, 'Nueva')
  assert.equal(extracted[0].properties?.map_element_id, undefined)
})
