import assert from 'node:assert/strict'
import test from 'node:test'
import {
  computeTakeoffBaseForField,
  DEFAULT_DEMO_PARCEL_GEOJSON,
  projectFieldGeometry,
} from '../../src/services/fieldGeometry.ts'
import {
  createInitialSimulatedPlants,
  syncPlantDerivedMetrics,
} from '../../src/services/simulationEngine.ts'
import { planOptimizedDroneRoute } from '../../src/services/droneRoutePlanner.ts'

test('plans an optimized 2-opt TSP route starting/ending at base, skipping healthy plants, and saving battery', () => {
  const field = projectFieldGeometry(DEFAULT_DEMO_PARCEL_GEOJSON)
  assert.ok(field)

  const base = computeTakeoffBaseForField(field)
  const plants = createInitialSimulatedPlants(field, [], { targetCount: 180 })

  // Asegurar todas saludables primero
  for (const p of plants) {
    p.waterStressPercent = 8
    p.pestStressPercent = 2
    p.irreversible = false
    syncPlantDerivedMetrics(p)
  }

  // Introducir solo 3 focos distantes bien definidos (estrés crítico, moderado y leve)
  const targetA = plants[Math.floor(plants.length * 0.15)]
  const targetB = plants[Math.floor(plants.length * 0.5)]
  const targetC = plants[Math.floor(plants.length * 0.85)]

  targetA.waterStressPercent = 78 // crítico
  targetB.waterStressPercent = 48 // moderado
  targetC.waterStressPercent = 24 // leve
  syncPlantDerivedMetrics(targetA)
  syncPlantDerivedMetrics(targetB)
  syncPlantDerivedMetrics(targetC)

  const plan = planOptimizedDroneRoute({
    field,
    basePoint: { x: base.x, z: base.z },
    plants,
    missionType: 'WATER',
  })

  assert.equal(plan.algorithm, 'priority-nn-2opt-tsp')
  assert.equal(plan.targetedPlantCount, 3)
  assert.equal(plan.skippedHealthyPlantCount, plants.length - 3)

  assert.equal(plan.waypoints[0].type, 'base_takeoff')
  assert.equal(plan.waypoints[plan.waypoints.length - 1].type, 'base_return')

  const targetWaypoints = plan.waypoints.filter(wp => wp.type === 'target')
  assert.equal(targetWaypoints.length, 3)

  // Verificar que todas las plantas cubiertas sean exclusivamente las estresadas
  const visitedIds = new Set(targetWaypoints.flatMap(wp => wp.coveredPlantIds))
  assert.deepEqual(visitedIds, new Set([targetA.id, targetB.id, targetC.id]))

  // Verificar ahorro efectivo frente a barrido completo de toda la parcela
  assert.ok(plan.totalDistanceMeters < plan.baselineFullSweepDistanceMeters)
  assert.ok(plan.distanceSavedMeters > 0)
  assert.ok(plan.estimatedFlightTimeSeconds < plan.baselineFullSweepTimeSeconds)
  assert.ok(plan.batterySavingsPercent > 30)
  assert.equal(plan.batterySavingsPercent, plan.fuelSavingsPercent)
})

test('returns zero-flight mission when all plants in polygon are healthy', () => {
  const field = projectFieldGeometry(DEFAULT_DEMO_PARCEL_GEOJSON)
  assert.ok(field)
  const base = computeTakeoffBaseForField(field)
  const plants = createInitialSimulatedPlants(field, [], { targetCount: 90 })

  for (const p of plants) {
    p.waterStressPercent = 6
    p.pestStressPercent = 1
    p.irreversible = false
    syncPlantDerivedMetrics(p)
  }

  const plan = planOptimizedDroneRoute({
    field,
    basePoint: { x: base.x, z: base.z },
    plants,
    missionType: 'WATER',
  })

  assert.equal(plan.targetedPlantCount, 0)
  assert.equal(plan.skippedHealthyPlantCount, plants.length)
  assert.equal(plan.totalDistanceMeters, 0)
  assert.equal(plan.estimatedBatteryPercent, 0)
  assert.equal(plan.batterySavingsPercent, 100)
})
