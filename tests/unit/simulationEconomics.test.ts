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
  buildSimulationReport,
  createInitialSimulatedPlants,
  seedStressCentersInsideField,
  syncPlantDerivedMetrics,
} from '../../src/services/simulationEngine.ts'
import { planOptimizedDroneRoute } from '../../src/services/droneRoutePlanner.ts'
import {
  calculateSimulationEconomics,
  extractStressTimeline,
  hydrateExportedSimulation,
  matchesSimulationField,
  sanitizeExportedSimulationForField,
} from '../../src/services/simulationEconomics.ts'
import type { Json } from '../../src/services/agronomyData.ts'

test('extractStressTimeline aggregates plant history chronologically by tick', () => {
  const field = projectFieldGeometry(DEFAULT_DEMO_PARCEL_GEOJSON)
  assert.ok(field)
  const parcel = extractParcelMetadata(DEFAULT_DEMO_PARCEL_GEOJSON, 'f-1', 'Lote Norte')
  assert.ok(parcel)
  const base = computeTakeoffBaseForField(field)

  const slots = createInitialSimulatedPlants(field, [], { targetCount: 60 })
  const centers = seedStressCentersInsideField(field, slots, { count: 2 })
  const plants = createInitialSimulatedPlants(field, centers, { targetCount: 60 })
  advanceSimulationTick(plants, centers, 1)
  advanceSimulationTick(plants, centers, 2)

  const flight = planOptimizedDroneRoute({
    field,
    basePoint: { x: base.x, z: base.z },
    plants,
    missionType: 'INSPECT_STRESS',
  })

  const report = buildSimulationReport({
    tick: 2,
    parcel,
    plants,
    droneFlight: flight,
  })

  const timeline = extractStressTimeline(report)
  assert.equal(timeline.length, 3)
  assert.deepEqual(
    timeline.map(p => p.tick),
    [0, 1, 2]
  )
  assert.ok(timeline[2].avgWaterStressPercent > timeline[0].avgWaterStressPercent)
})

test('calculateSimulationEconomics returns zero reactive cost on 100% healthy parcels and scales costs with area and severity', () => {
  const field = projectFieldGeometry(DEFAULT_DEMO_PARCEL_GEOJSON)
  assert.ok(field)
  const parcel = extractParcelMetadata(DEFAULT_DEMO_PARCEL_GEOJSON, 'f-2', 'Parcela Sana vs Afectada')
  assert.ok(parcel)
  const base = computeTakeoffBaseForField(field)
  const plants = createInitialSimulatedPlants(field, [], { targetCount: 100 })

  for (const plant of plants) {
    plant.waterStressPercent = 5
    plant.pestStressPercent = 2
    plant.irreversible = false
    syncPlantDerivedMetrics(plant)
  }

  const healthyFlight = planOptimizedDroneRoute({
    field,
    basePoint: { x: base.x, z: base.z },
    plants,
    missionType: 'WATER',
  })
  const healthyReport = buildSimulationReport({
    tick: 0,
    parcel,
    plants,
    droneFlight: healthyFlight,
  })
  const healthyEcon = calculateSimulationEconomics(healthyReport)

  assert.equal(healthyEcon.reactive.affectedPlantCount, 0)
  assert.equal(healthyEcon.reactive.reactiveTreatmentTotalCost, 0)
  assert.equal(healthyEcon.reactive.totalReactiveImpactCost, 0)
  assert.ok(healthyEcon.preventiveRecommendations.length >= 2)

  // Ahora introducir afectación moderada/crítica en ~30% de la parcela
  const affectedSubset = Math.max(4, Math.floor(plants.length * 0.3))
  for (let i = 0; i < affectedSubset; i++) {
    plants[i].waterStressPercent = i % 2 === 0 ? 74 : 49
    syncPlantDerivedMetrics(plants[i])
  }

  const stressedFlight = planOptimizedDroneRoute({
    field,
    basePoint: { x: base.x, z: base.z },
    plants,
    missionType: 'WATER',
  })
  const stressedReport = buildSimulationReport({
    tick: 4,
    parcel,
    plants,
    droneFlight: stressedFlight,
  })
  const stressedEcon = calculateSimulationEconomics(stressedReport)

  assert.equal(stressedEcon.reactive.affectedPlantCount, affectedSubset)
  assert.ok(stressedEcon.reactive.emergencyIrrigationCost > 0)
  assert.ok(stressedEcon.reactive.fertilizersBiostimulantsCost > 0)
  assert.ok(stressedEcon.reactive.droneApplicationCost > 0)
  assert.ok(stressedEcon.reactive.fieldLaborCost > 0)
  assert.ok(stressedEcon.reactive.projectedYieldLossCost > 0)
  assert.ok(stressedEcon.reactive.totalReactiveImpactCost > stressedEcon.reactive.reactiveTreatmentTotalCost)
  assert.ok(stressedEcon.preventiveRecommendations.length >= 3)
  assert.ok(stressedEcon.totalProjectedNetSavings > 0)
  assert.ok(stressedEcon.overallRoiPercent > 0)

  // Al duplicar la superficie real, los costos correctivos proporcionales deben crecer
  const largerParcel = {
    ...parcel,
    areaHectares: parcel.areaHectares * 3,
    areaSquareMeters: parcel.areaSquareMeters * 3,
  }
  const largerReport = buildSimulationReport({
    tick: 4,
    parcel: largerParcel,
    plants,
    droneFlight: stressedFlight,
  })
  const largerEcon = calculateSimulationEconomics(largerReport)
  assert.ok(
    largerEcon.reactive.reactiveTreatmentTotalCost > stressedEcon.reactive.reactiveTreatmentTotalCost
  )
})

test('hydrateExportedSimulation validates Supabase rows and ignores legacy rows without simulation_report', () => {
  const field = projectFieldGeometry(DEFAULT_DEMO_PARCEL_GEOJSON)
  assert.ok(field)
  const parcel = extractParcelMetadata(DEFAULT_DEMO_PARCEL_GEOJSON, 'f-3', 'Lote Sur')
  assert.ok(parcel)
  const base = computeTakeoffBaseForField(field)
  const slots = createInitialSimulatedPlants(field, [], { targetCount: 40 })
  const centers = seedStressCentersInsideField(field, slots, { count: 2 })
  const plants = createInitialSimulatedPlants(field, centers, { targetCount: 40 })
  const flight = planOptimizedDroneRoute({
    field,
    basePoint: { x: base.x, z: base.z },
    plants,
  })
  const report = buildSimulationReport({ tick: 1, parcel, plants, droneFlight: flight })

  const hydrated = hydrateExportedSimulation({
    id: 'sim-uuid-123',
    field_id: 'f-3',
    scenario_title: 'Lote Sur · Ciclo #1',
    created_at: '2026-11-24T01:00:00Z',
    results: {
      simulation_report: report as unknown as Json,
    },
  })

  assert.ok(hydrated)
  assert.equal(hydrated.id, 'sim-uuid-123')
  assert.equal(hydrated.source, 'supabase')
  assert.equal(hydrated.stressTimeline.length, 1)
  assert.ok(hydrated.economics.preventiveRecommendations.length > 0)

  const legacyIgnored = hydrateExportedSimulation({
    id: 'legacy-1',
    field_id: null,
    scenario_title: 'Antigua',
    created_at: '2026-11-01T00:00:00Z',
    results: { telemetry: { avgHealth: 90 } } as unknown as Json,
  })
  assert.equal(legacyIgnored, null)
})

test('matchesSimulationField strictly isolates simulations per parcel and sanitize cleans merged polygons', () => {
  const polyA = {
    type: 'Polygon' as const,
    coordinates: [[[-107.695, 24.750], [-107.690, 24.750], [-107.690, 24.755], [-107.695, 24.755], [-107.695, 24.750]]],
  }
  const polyB = {
    type: 'Polygon' as const,
    coordinates: [[[-107.505, 24.770], [-107.500, 24.770], [-107.500, 24.775], [-107.505, 24.775], [-107.505, 24.770]]],
  }
  const mergedGeo = {
    type: 'FeatureCollection' as const,
    features: [
      { type: 'Feature' as const, geometry: polyA, properties: { name: 'Elemento 1' } },
      { type: 'Feature' as const, geometry: polyB, properties: { name: 'Elemento 2' } },
    ],
  }

  const mergedProj = projectFieldGeometry(mergedGeo)
  assert.ok(mergedProj)
  const parcelMeta = extractParcelMetadata(mergedGeo, 'field-a', 'navolato')
  assert.ok(parcelMeta)
  const plants = createInitialSimulatedPlants(mergedProj, [], { targetCount: 120 })
  plants.forEach((p, idx) => {
    if (idx % 5 === 0) {
      p.waterStressPercent = 65
      syncPlantDerivedMetrics(p)
    }
  })
  const base = computeTakeoffBaseForField(mergedProj)
  const flight = planOptimizedDroneRoute({ field: mergedProj, basePoint: { x: base.x, z: base.z }, plants })
  const report = buildSimulationReport({ tick: 2, parcel: parcelMeta, plants, droneFlight: flight })

  const simEntry = hydrateExportedSimulation({
    id: 'sim-a',
    field_id: 'field-a',
    scenario_title: 'navolato · Ciclo #2',
    created_at: '2026-11-25T10:18:00Z',
    results: { simulation_report: report as unknown as Json },
  })
  assert.ok(simEntry)

  assert.equal(matchesSimulationField(simEntry, { id: 'field-a', name: 'navolato' }), true)
  assert.equal(matchesSimulationField(simEntry, { id: 'field-b', name: 'otra parcela' }), false)

  const cleaned = sanitizeExportedSimulationForField(simEntry, [
    { id: 'field-a', name: 'navolato', geojson_data: mergedGeo as unknown as Json },
    { id: 'field-b', name: 'otra parcela', geojson_data: { type: 'Feature', geometry: polyB, properties: {} } as unknown as Json },
  ])

  assert.ok(cleaned.report.parcel.areaHectares < simEntry.report.parcel.areaHectares * 0.6)
  assert.ok(cleaned.report.plants.length < simEntry.report.plants.length)
  assert.ok(cleaned.report.droneFlight.totalDistanceMeters < simEntry.report.droneFlight.totalDistanceMeters * 0.2)
})
