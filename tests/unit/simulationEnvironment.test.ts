import assert from 'node:assert/strict'
import test from 'node:test'
import {
  computeTakeoffBaseForField,
  DEFAULT_DEMO_PARCEL_GEOJSON,
  isPointInProjectedField,
  projectFieldGeometry,
} from '../../src/services/fieldGeometry.ts'
import {
  buildAgriculturalSurroundings,
  computeSurroundingStructureAnchors,
  computeValleyMetrics,
} from '../../src/services/simulationEnvironment.ts'

test('places greenhouses, barn, water tank, and trees strictly outside concave parcel and takeoff base', () => {
  const field = projectFieldGeometry(DEFAULT_DEMO_PARCEL_GEOJSON)
  assert.ok(field)

  const base = computeTakeoffBaseForField(field)
  const placements = computeSurroundingStructureAnchors(field, { x: base.x, z: base.z })

  assert.ok(placements.some(p => p.kind === 'greenhouse'))
  assert.ok(placements.some(p => p.kind === 'barn'))
  assert.ok(placements.some(p => p.kind === 'water_tank'))
  assert.ok(placements.some(p => p.kind === 'tree_cluster'))

  for (const item of placements) {
    assert.equal(isPointInProjectedField({ x: item.x, z: item.z }, field), false)
    assert.ok(Math.hypot(item.x - base.x, item.z - base.z) >= item.footprintRadius + 4)
  }
})

test('builds complete 3D surroundings group with mountain ring scaling beyond larger parcels', () => {
  const largeParcel = projectFieldGeometry({
    type: 'Polygon',
    coordinates: [[
      [-107.396, 24.798],
      [-107.392, 24.798],
      [-107.392, 24.802],
      [-107.396, 24.802],
      [-107.396, 24.798],
    ]],
  })
  assert.ok(largeParcel)

  const base = computeTakeoffBaseForField(largeParcel)
  const valley = computeValleyMetrics(largeParcel)
  assert.ok(valley.innerMountainRadius > valley.fieldRadius)
  assert.ok(valley.outerMountainRadius > valley.innerMountainRadius)
  assert.ok(valley.groundSize > valley.outerMountainRadius * 2)

  const built = buildAgriculturalSurroundings(largeParcel, { x: base.x, z: base.z })
  assert.equal(built.group.name, 'agronia-surroundings')
  assert.ok(built.group.children.some(child => child.name === 'mountain-ring'))
  assert.ok(built.group.children.some(child => child.name === 'surrounding-greenhouse'))
})
