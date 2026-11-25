import assert from 'node:assert/strict'
import test from 'node:test'
import {
  computeHorizontalScanlineSegments,
  computeTakeoffBaseForField,
  DEFAULT_DEMO_PARCEL_GEOJSON,
  extractParcelMetadata,
  generatePlantGridInsidePolygon,
  isPointInProjectedField,
  projectFieldGeometry,
} from '../../src/services/fieldGeometry.ts'

test('projects a GeoJSON parcel to meters and measures its bounding dimensions and area', () => {
  const field = projectFieldGeometry({
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [-107.3939, 24.7994],
          [-107.3929, 24.7994],
          [-107.3929, 24.8004],
          [-107.3939, 24.8004],
          [-107.3939, 24.7994],
        ]],
      },
    }],
  })

  assert.ok(field)
  assert.ok(field.widthMeters > 100 && field.widthMeters < 103)
  assert.ok(field.depthMeters > 110 && field.depthMeters < 112)
  assert.ok(field.areaHectares > 1.1 && field.areaHectares < 1.2)
  const center = field.projectGps(24.7999, -107.3934)
  assert.ok(Math.abs(center.x) < 1e-8)
  assert.ok(Math.abs(center.z) < 1e-8)
  const roundTrip = field.unprojectPoint(center.x, center.z)
  assert.ok(Math.abs(roundTrip.lat - 24.7999) < 1e-6)
  assert.ok(Math.abs(roundTrip.lng - (-107.3934)) < 1e-6)
  const gps = field.unprojectGps(center)
  assert.ok(Math.abs(gps.latitude - 24.7999) < 1e-8)
  assert.ok(Math.abs(gps.longitude + 107.3934) < 1e-8)
  assert.equal(field.contains(center), true)
  assert.equal(field.contains({ x: field.widthMeters, z: field.depthMeters }), false)
})

test('supports multipolygons and rejects invalid or non-polygon geometry', () => {
  const field = projectFieldGeometry({
    type: 'MultiPolygon',
    coordinates: [
      [[[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001], [0, 0]]],
      [[[0.002, 0], [0.003, 0], [0.003, 0.001], [0.002, 0.001], [0.002, 0]]],
    ],
  })

  assert.equal(field?.polygons.length, 2)
  assert.equal(projectFieldGeometry({ type: 'Point', coordinates: [0, 0] }), null)
  assert.equal(projectFieldGeometry(null), null)
})

test('places 100% of plants strictly inside concave L-shaped polygon and excludes cutout and holes', () => {
  const field = projectFieldGeometry(DEFAULT_DEMO_PARCEL_GEOJSON)
  assert.ok(field)
  assert.equal(field.vertexCount, 6)

  const plants = generatePlantGridInsidePolygon(field, { targetCount: 240 })
  assert.ok(plants.length >= 100)

  for (const plant of plants) {
    assert.equal(isPointInProjectedField({ x: plant.x, z: plant.z }, field), true)
    const reprojected = field.projectGps(plant.lat, plant.lng)
    assert.ok(Math.hypot(reprojected.x - plant.x, reprojected.z - plant.z) < 0.05)
  }

  // Esquina recortada sureste de la L debe quedar estrictamente fuera
  const emptyCorner = { x: field.bounds.maxX - 3, z: field.bounds.maxZ - 3 }
  assert.equal(isPointInProjectedField(emptyCorner, field), false)

  const base = computeTakeoffBaseForField(field)
  assert.equal(isPointInProjectedField({ x: base.x, z: base.z }, field), false)
})

test('handles polygon with interior hole in scanline clipping, plant generation, and metadata extraction', () => {
  const geoWithHole = {
    type: 'Feature',
    properties: { name: 'Parcela con reservorio central' },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [-107.395, 24.799],
          [-107.393, 24.799],
          [-107.393, 24.801],
          [-107.395, 24.801],
          [-107.395, 24.799],
        ],
        [
          [-107.3943, 24.7997],
          [-107.3937, 24.7997],
          [-107.3937, 24.8003],
          [-107.3943, 24.8003],
          [-107.3943, 24.7997],
        ],
      ],
    },
  } as const

  const field = projectFieldGeometry(geoWithHole)
  assert.ok(field)
  assert.equal(isPointInProjectedField({ x: 0, z: 0 }, field), false)

  const centerSegments = computeHorizontalScanlineSegments(0, field)
  assert.equal(centerSegments.length, 2)

  const plants = generatePlantGridInsidePolygon(field, { targetCount: 220 })
  assert.ok(plants.length >= 100)
  for (const p of plants) {
    assert.equal(isPointInProjectedField({ x: p.x, z: p.z }, field), true)
  }

  const meta = extractParcelMetadata(geoWithHole, 'field-1', 'Parcela Con Hueco')
  assert.ok(meta)
  assert.equal(meta.fieldId, 'field-1')
  assert.equal(meta.vertexCount, 4)
  assert.ok(meta.areaSquareMeters > 0)
  assert.ok(meta.perimeterMeters > 0)
})

test('excludes interior rings when determining whether a simulated plant is in a parcel', () => {
  const field = projectFieldGeometry({
    type: 'Polygon',
    coordinates: [
      [[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01], [0, 0]],
      [[0.004, 0.004], [0.006, 0.004], [0.006, 0.006], [0.004, 0.006], [0.004, 0.004]],
    ],
  })

  assert.ok(field)
  assert.equal(field.contains(field.projectGps(0.005, 0.005)), false)
  assert.equal(field.contains(field.projectGps(0.002, 0.002)), true)
})
