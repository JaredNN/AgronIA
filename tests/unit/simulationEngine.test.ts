import assert from 'node:assert/strict'
import test from 'node:test'
import {
  computeTakeoffBaseForField,
  DEFAULT_DEMO_PARCEL_GEOJSON,
  extractParcelMetadata,
  projectFieldGeometry,
} from '../../src/services/fieldGeometry.ts'
import {
  advanceSimulationTick,
  applyTreatmentAtLocation,
  buildSimulationReport,
  classifyPlantStressState,
  createInitialSimulatedPlants,
  seedStressCentersInsideField,
} from '../../src/services/simulationEngine.ts'
import { planOptimizedDroneRoute } from '../../src/services/droneRoutePlanner.ts'

test('classifies the 5 plant water stress states accurately', () => {
  assert.equal(classifyPlantStressState(0), 'saludable')
  assert.equal(classifyPlantStressState(17.9), 'saludable')
  assert.equal(classifyPlantStressState(18), 'estrés_leve')
  assert.equal(classifyPlantStressState(41.9), 'estrés_leve')
  assert.equal(classifyPlantStressState(42), 'estrés_moderado')
  assert.equal(classifyPlantStressState(68), 'estrés_crítico')
  assert.equal(classifyPlantStressState(92), 'pérdida_irreversible')
  assert.equal(classifyPlantStressState(10, true), 'pérdida_irreversible')
})

test('progressively degrades water stress across ticks and allows recovery unless irreversible', () => {
  const field = projectFieldGeometry(DEFAULT_DEMO_PARCEL_GEOJSON)
  assert.ok(field)

  const initialSlots = createInitialSimulatedPlants(field, [], { targetCount: 80 })
  const centers = seedStressCentersInsideField(field, initialSlots, { count: 2 })
  const plants = createInitialSimulatedPlants(field, centers, { targetCount: 80 })

  const stressedBefore = plants.filter(p => p.waterStressPercent >= 18)
  assert.ok(stressedBefore.length > 0, 'Debe existir al menos una planta con estrés hídrico inicial')
  const sampleRecoverable = stressedBefore[0]
  const sampleLost = stressedBefore[stressedBefore.length - 1]
  const initialStressVal = sampleRecoverable.waterStressPercent

  // Avanzar ticks hasta llevar sampleLost a pérdida irreversible
  for (let t = 1; t <= 16; t++) {
    advanceSimulationTick(plants, centers, t)
    if (t === 2) {
      assert.ok(
        sampleRecoverable.waterStressPercent > initialStressVal,
        'La severidad de estrés hídrico debe aumentar gradualmente ciclo tras ciclo'
      )
      // Si sampleRecoverable cayó por debajo de 92, aplicar riego ahora en su ubicación antes de volverse irreversible
      if (!sampleRecoverable.irreversible) {
        const res = applyTreatmentAtLocation(
          plants,
          { x: sampleRecoverable.x, z: sampleRecoverable.z },
          1.2,
          'WATER',
          t,
          { targetPlantIds: [sampleRecoverable.id] }
        )
        assert.ok(res.recoveredCount >= 1)
        assert.equal(sampleRecoverable.state, 'saludable')
      }
    }
  }

  assert.equal(sampleLost.state, 'pérdida_irreversible')
  assert.equal(sampleLost.irreversible, true)

  // Intentar regar una planta en pérdida irreversible no debe recuperarla
  const lateTreatment = applyTreatmentAtLocation(
    plants,
    { x: sampleLost.x, z: sampleLost.z },
    1.2,
    'WATER',
    17,
    { targetPlantIds: [sampleLost.id] }
  )
  assert.equal(lateTreatment.irreversibleCount, 1)
  assert.equal(sampleLost.state, 'pérdida_irreversible')
  assert.ok(sampleLost.history.length >= 17)
})

test('buildSimulationReport returns complete typed parcel GeoJSON, lat/lng plants with history, and drone metrics', () => {
  const field = projectFieldGeometry(DEFAULT_DEMO_PARCEL_GEOJSON)
  assert.ok(field)
  const parcel = extractParcelMetadata(DEFAULT_DEMO_PARCEL_GEOJSON, 'demo-1', 'Parcela Test')
  assert.ok(parcel)
  const base = computeTakeoffBaseForField(field)

  const slots = createInitialSimulatedPlants(field, [], { targetCount: 100 })
  const centers = seedStressCentersInsideField(field, slots, { count: 2 })
  const plants = createInitialSimulatedPlants(field, centers, { targetCount: 100 })
  advanceSimulationTick(plants, centers, 1)

  const flight = planOptimizedDroneRoute({
    field,
    basePoint: { x: base.x, z: base.z },
    plants,
    missionType: 'INSPECT_STRESS',
  })

  const report = buildSimulationReport({
    tick: 1,
    parcel,
    plants,
    droneFlight: flight,
  })

  assert.equal(report.tick, 1)
  assert.equal(report.parcel.fieldId, 'demo-1')
  assert.equal(report.plants.length, plants.length)
  assert.ok(report.plants.every(p => Number.isFinite(p.lat) && Number.isFinite(p.lng) && p.history.length === 2))
  assert.equal(report.droneFlight.algorithm, 'priority-nn-2opt-tsp')
  assert.equal(report.droneFlight.orderedCoordinates.length, report.droneFlight.waypoints.length)
})
