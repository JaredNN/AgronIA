import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CROP_PRICING_LIST,
  calculateParcelPriceEstimate,
  resolveCropPricingBenchmark,
} from '../../src/services/cropPricingBenchmarks.ts'

test('resolveCropPricingBenchmark matches Spanish crop names with accents and falls back safely', () => {
  assert.equal(resolveCropPricingBenchmark('Maíz blanco').key, 'maiz')
  assert.equal(resolveCropPricingBenchmark('Jitomate saladette').key, 'tomate')
  assert.equal(resolveCropPricingBenchmark('Aguacate Hass').key, 'aguacate')
  assert.equal(resolveCropPricingBenchmark('Chile jalapeño').key, 'chile')
  assert.equal(resolveCropPricingBenchmark('Trigo cristalino').key, 'trigo')
  assert.equal(resolveCropPricingBenchmark('Fresa macrotúnel').key, 'fresa')
  assert.equal(resolveCropPricingBenchmark(null).key, 'maiz')
  assert.equal(resolveCropPricingBenchmark('Cultivo desconocido xyz').key, 'maiz')
})

test('all crop pricing benchmarks have consistent MXN/m² and MXN/ha equivalents', () => {
  assert.ok(CROP_PRICING_LIST.length >= 10)
  for (const benchmark of CROP_PRICING_LIST) {
    assert.ok(benchmark.productionTotalPerM2 > 0)
    assert.ok(benchmark.irrigationPerM2 > 0)
    assert.ok(benchmark.fertilizationPerM2 > 0)
    assert.ok(benchmark.pestControlPerM2 > 0)
    assert.ok(benchmark.droneSprayPassPerM2 > 0)
    assert.ok(benchmark.preventiveMonitoringPerM2 > 0)
    assert.ok(benchmark.harvestValuePerM2 > benchmark.productionTotalPerM2)
    assert.equal(
      benchmark.productionTotalPerHaMxn,
      Math.round(benchmark.productionTotalPerM2 * 10_000),
    )
    assert.equal(
      benchmark.harvestValuePerHaMxn,
      Math.round(benchmark.harvestValuePerM2 * 10_000),
    )
  }
})

test('calculateParcelPriceEstimate scales linearly with exact m² area and reflects TSP savings', () => {
  const smallHealthy = calculateParcelPriceEstimate({
    areaSquareMeters: 2500,
    affectedRatio: 0,
    cropKeyOrName: 'maiz',
  })
  const fullHealthy = calculateParcelPriceEstimate({
    areaSquareMeters: 10_000,
    affectedRatio: 0,
    cropKeyOrName: 'maiz',
  })

  assert.equal(smallHealthy.correctiveTreatmentMxn, 0)
  assert.equal(smallHealthy.potentialYieldLossAvoidedMxn, 0)
  assert.equal(fullHealthy.cycleProductionTotalMxn, smallHealthy.cycleProductionTotalMxn * 4)
  assert.equal(fullHealthy.expectedHarvestValueMxn, smallHealthy.expectedHarvestValueMxn * 4)
  assert.equal(fullHealthy.preventiveMonitoringMxn, smallHealthy.preventiveMonitoringMxn * 4)

  const noSavingsStressed = calculateParcelPriceEstimate({
    areaSquareMeters: 10_000,
    affectedRatio: 0.25,
    recoverableRatio: 0.25,
    severityFactor: 1.4,
    batterySavingsPercent: 0,
    cropKeyOrName: 'tomate',
  })
  const tspSavingsStressed = calculateParcelPriceEstimate({
    areaSquareMeters: 10_000,
    affectedRatio: 0.25,
    recoverableRatio: 0.25,
    severityFactor: 1.4,
    batterySavingsPercent: 60,
    cropKeyOrName: 'tomate',
  })

  assert.ok(noSavingsStressed.correctiveTreatmentMxn > 0)
  assert.ok(tspSavingsStressed.correctiveDronePartMxn < noSavingsStressed.correctiveDronePartMxn)
  assert.ok(tspSavingsStressed.droneRouteSavingsMxn > 0)
  assert.ok(tspSavingsStressed.potentialYieldLossAvoidedMxn > tspSavingsStressed.preventiveMonitoringMxn)
})
