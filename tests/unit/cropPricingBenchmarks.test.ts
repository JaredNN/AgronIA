import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CROP_PRICING_LIST,
  SOFTWARE_RENTAL_PLANS,
  calculateParcelPriceEstimate,
  calculateSoftwareRentalRoi,
  recommendSoftwareRentalPlan,
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

test('recommendSoftwareRentalPlan selects plan thresholds by hectares', () => {
  assert.equal(recommendSoftwareRentalPlan(1.5), 'basico')
  assert.equal(recommendSoftwareRentalPlan(2.9), 'basico')
  assert.equal(recommendSoftwareRentalPlan(3), 'profesional')
  assert.equal(recommendSoftwareRentalPlan(5), 'profesional')
  assert.equal(recommendSoftwareRentalPlan(7), 'profesional')
  assert.equal(recommendSoftwareRentalPlan(7.5), 'empresarial')
  assert.equal(recommendSoftwareRentalPlan(25), 'empresarial')
})

test('calculateSoftwareRentalRoi computes overage pricing, net benefit after rental, and ROI', () => {
  const overageExport = calculateSoftwareRentalRoi({
    areaHectares: 10,
    planKey: 'profesional',
    grossAvoidedLossMxn: 22_000,
    preventiveImplementationCostMxn: 4_500,
    netPreventiveSavingsMxn: 17_500,
    droneSavingsMxn: 1_800,
    hasExportedSimulation: true,
  })

  // 7 ha incluidas en Plan Profesional ($2,950) + 3 ha extra * $260 = $3,730 MXN
  assert.equal(overageExport.plan.key, 'profesional')
  assert.equal(overageExport.extraHectares, 3)
  assert.equal(overageExport.extraHectaresCostMxn, 780)
  assert.equal(overageExport.rentalCostPerCycleMxn, SOFTWARE_RENTAL_PLANS.profesional.basePricePerCycleMxn + 780)
  assert.equal(overageExport.producerSavingsBeforeRentalMxn, 17_500)
  assert.equal(overageExport.netBenefitAfterRentalMxn, 17_500 - 3730)
  assert.equal(overageExport.paybackCovered, true)
  assert.ok(overageExport.roiMultiple > 4)
  assert.equal(overageExport.isBenchmarkEstimate, false)

  const benchmark5Ha = calculateSoftwareRentalRoi({
    areaHectares: 5,
    hasExportedSimulation: false,
    cropKeyOrName: 'maiz',
  })
  assert.equal(benchmark5Ha.recommendedPlanKey, 'profesional')
  assert.equal(benchmark5Ha.rentalCostPerCycleMxn, 2950)
  assert.equal(benchmark5Ha.isBenchmarkEstimate, true)
  assert.ok(benchmark5Ha.producerSavingsBeforeRentalMxn > benchmark5Ha.rentalCostPerCycleMxn)
  assert.ok(benchmark5Ha.netBenefitAfterRentalMxn > 0)
  assert.equal(benchmark5Ha.paybackCovered, true)
})
