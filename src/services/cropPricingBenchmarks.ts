export type CropPricingKey =
  | 'maiz'
  | 'trigo'
  | 'tomate'
  | 'chile'
  | 'aguacate'
  | 'frijol'
  | 'sorgo'
  | 'fresa'
  | 'papa'
  | 'general'

export interface CropPricingBenchmark {
  key: CropPricingKey
  label: string
  aliases: string[]
  sourceLabel: string
  /** Costo total estimado de producción por ciclo en MXN/m² (1 ha = 10,000 m²). */
  productionTotalPerM2: number
  /** Costo de riego y bombeo/auxilios por ciclo en MXN/m². */
  irrigationPerM2: number
  /** Costo de fertilización y nutrición vegetal por ciclo en MXN/m². */
  fertilizationPerM2: number
  /** Costo de control fitosanitario (plagas, malezas y enfermedades) en MXN/m². */
  pestControlPerM2: number
  /** Tarifa de servicio/maquila con dron agrícola por pasada en MXN/m². */
  droneSprayPassPerM2: number
  /** Costo preventivo de monitoreo con Centinelas IA + telemetría por ciclo en MXN/m². */
  preventiveMonitoringPerM2: number
  /** Valor bruto esperado de cosecha (rendimiento × precio medio rural SIAP) en MXN/m². */
  harvestValuePerM2: number
  productionTotalPerHaMxn: number
  harvestValuePerHaMxn: number
}

export interface ParcelPriceEstimateInput {
  areaSquareMeters: number
  affectedRatio: number
  recoverableRatio?: number
  severityFactor?: number
  batterySavingsPercent?: number
  cropKeyOrName?: string | null
}

export interface ParcelPriceEstimate {
  currency: 'MXN'
  benchmark: CropPricingBenchmark
  areaSquareMeters: number
  areaHectares: number
  affectedAreaSquareMeters: number
  affectedAreaHectares: number
  affectedRatio: number
  cycleProductionTotalMxn: number
  cycleIrrigationMxn: number
  cycleFertilizationMxn: number
  cyclePestControlMxn: number
  droneSinglePassMxn: number
  droneThreePassesMxn: number
  expectedHarvestValueMxn: number
  correctiveTreatmentMxn: number
  correctiveIrrigationPartMxn: number
  correctiveInputsPartMxn: number
  correctiveDronePartMxn: number
  preventiveMonitoringMxn: number
  potentialYieldLossAvoidedMxn: number
  netPreventiveSavingsMxn: number
  droneRouteSavingsMxn: number
  costPerSquareMeterMxn: number
  correctiveCostPerAffectedM2Mxn: number
}

interface RawBenchmarkSpec {
  key: CropPricingKey
  label: string
  aliases: string[]
  sourceLabel: string
  productionTotalPerM2: number
  irrigationPerM2: number
  fertilizationPerM2: number
  pestControlPerM2: number
  droneSprayPassPerM2: number
  preventiveMonitoringPerM2: number
  harvestValuePerM2: number
}

const buildBenchmark = (spec: RawBenchmarkSpec): CropPricingBenchmark => ({
  ...spec,
  productionTotalPerHaMxn: Math.round(spec.productionTotalPerM2 * 10_000),
  harvestValuePerHaMxn: Math.round(spec.harvestValuePerM2 * 10_000),
})

export const CROP_PRICING_BENCHMARKS: Record<CropPricingKey, CropPricingBenchmark> = {
  maiz: buildBenchmark({
    key: 'maiz',
    label: 'Maíz grano (riego)',
    aliases: ['maiz', 'elote', 'corn', 'zeamays', 'milpa'],
    sourceLabel: 'FIRA Agrocostos México 2024–2025 (Bajío/Sinaloa) · SIAP-SADER · Maquila Dron MX',
    productionTotalPerM2: 4.75,
    irrigationPerM2: 0.38,
    fertilizationPerM2: 1.2,
    pestControlPerM2: 0.45,
    droneSprayPassPerM2: 0.045,
    preventiveMonitoringPerM2: 0.22,
    harvestValuePerM2: 6.5,
  }),
  trigo: buildBenchmark({
    key: 'trigo',
    label: 'Trigo grano (riego O-I)',
    aliases: ['trigo', 'wheat', 'cereal'],
    sourceLabel: 'FIRA Agrocostos México 2024–2025 (Sonora/Bajío) · SIAP-SADER · Maquila Dron MX',
    productionTotalPerM2: 3.35,
    irrigationPerM2: 0.5,
    fertilizationPerM2: 0.88,
    pestControlPerM2: 0.42,
    droneSprayPassPerM2: 0.04,
    preventiveMonitoringPerM2: 0.2,
    harvestValuePerM2: 4.8,
  }),
  tomate: buildBenchmark({
    key: 'tomate',
    label: 'Tomate rojo / Jitomate (riego tecnificado)',
    aliases: ['tomate', 'jitomate', 'tomato', 'saladette'],
    sourceLabel: 'FIRA Agrocostos Hortícola 2024–2025 · SIAP-SADER · Maquila Dron MX',
    productionTotalPerM2: 10.5,
    irrigationPerM2: 0.85,
    fertilizationPerM2: 2.4,
    pestControlPerM2: 1.65,
    droneSprayPassPerM2: 0.065,
    preventiveMonitoringPerM2: 0.38,
    harvestValuePerM2: 24.0,
  }),
  chile: buildBenchmark({
    key: 'chile',
    label: 'Chile verde / Jalapeño (riego)',
    aliases: ['chile', 'jalapeno', 'serrano', 'poblano', 'habanero', 'pimiento'],
    sourceLabel: 'FIRA Agrocostos Hortícola 2024–2025 · SIAP-SADER · Maquila Dron MX',
    productionTotalPerM2: 7.2,
    irrigationPerM2: 0.72,
    fertilizationPerM2: 1.75,
    pestControlPerM2: 1.35,
    droneSprayPassPerM2: 0.06,
    preventiveMonitoringPerM2: 0.32,
    harvestValuePerM2: 15.5,
  }),
  aguacate: buildBenchmark({
    key: 'aguacate',
    label: 'Aguacate Hass (huerta establecida)',
    aliases: ['aguacate', 'hass', 'palto', 'avocado'],
    sourceLabel: 'FIRA Agrocostos Perennes 2024–2025 (Michoacán/Jalisco) · SIAP-SADER',
    productionTotalPerM2: 5.8,
    irrigationPerM2: 0.65,
    fertilizationPerM2: 1.55,
    pestControlPerM2: 1.1,
    droneSprayPassPerM2: 0.075,
    preventiveMonitoringPerM2: 0.35,
    harvestValuePerM2: 19.5,
  }),
  frijol: buildBenchmark({
    key: 'frijol',
    label: 'Frijol (riego de auxilio)',
    aliases: ['frijol', 'bean', 'pinto', 'flor de mayo'],
    sourceLabel: 'FIRA Agrocostos Granos 2024–2025 · SIAP-SADER · Maquila Dron MX',
    productionTotalPerM2: 2.6,
    irrigationPerM2: 0.32,
    fertilizationPerM2: 0.58,
    pestControlPerM2: 0.36,
    droneSprayPassPerM2: 0.045,
    preventiveMonitoringPerM2: 0.18,
    harvestValuePerM2: 4.2,
  }),
  sorgo: buildBenchmark({
    key: 'sorgo',
    label: 'Sorgo grano (riego)',
    aliases: ['sorgo', 'sorghum'],
    sourceLabel: 'FIRA Agrocostos 2024–2025 (Tamaulipas/Bajío) · SIAP-SADER · Maquila Dron MX',
    productionTotalPerM2: 3.0,
    irrigationPerM2: 0.35,
    fertilizationPerM2: 0.78,
    pestControlPerM2: 0.38,
    droneSprayPassPerM2: 0.04,
    preventiveMonitoringPerM2: 0.18,
    harvestValuePerM2: 4.4,
  }),
  fresa: buildBenchmark({
    key: 'fresa',
    label: 'Fresa (macrotúnel / goteo)',
    aliases: ['fresa', 'berry', 'berries', 'frutilla', 'strawberry'],
    sourceLabel: 'FIRA Agrocostos Berries 2024–2025 (Michoacán/Guanajuato) · SIAP-SADER',
    productionTotalPerM2: 16.5,
    irrigationPerM2: 1.1,
    fertilizationPerM2: 3.2,
    pestControlPerM2: 2.1,
    droneSprayPassPerM2: 0.07,
    preventiveMonitoringPerM2: 0.45,
    harvestValuePerM2: 34.0,
  }),
  papa: buildBenchmark({
    key: 'papa',
    label: 'Papa (riego tecnificado)',
    aliases: ['papa', 'patata', 'potato'],
    sourceLabel: 'FIRA Agrocostos Tubérculos 2024–2025 · SIAP-SADER · Maquila Dron MX',
    productionTotalPerM2: 9.8,
    irrigationPerM2: 0.78,
    fertilizationPerM2: 2.1,
    pestControlPerM2: 1.45,
    droneSprayPassPerM2: 0.06,
    preventiveMonitoringPerM2: 0.32,
    harvestValuePerM2: 18.0,
  }),
  general: buildBenchmark({
    key: 'general',
    label: 'Cultivo agrícola mixto (promedio)',
    aliases: ['general', 'mixto', 'otro', 'hortaliza', 'grano'],
    sourceLabel: 'Referencia paramétrica FIRA / SIAP-SADER México 2024–2025 · Maquila Dron MX',
    productionTotalPerM2: 4.4,
    irrigationPerM2: 0.45,
    fertilizationPerM2: 1.1,
    pestControlPerM2: 0.55,
    droneSprayPassPerM2: 0.05,
    preventiveMonitoringPerM2: 0.24,
    harvestValuePerM2: 6.2,
  }),
}

export const CROP_PRICING_LIST: CropPricingBenchmark[] = [
  CROP_PRICING_BENCHMARKS.maiz,
  CROP_PRICING_BENCHMARKS.trigo,
  CROP_PRICING_BENCHMARKS.tomate,
  CROP_PRICING_BENCHMARKS.chile,
  CROP_PRICING_BENCHMARKS.aguacate,
  CROP_PRICING_BENCHMARKS.frijol,
  CROP_PRICING_BENCHMARKS.sorgo,
  CROP_PRICING_BENCHMARKS.fresa,
  CROP_PRICING_BENCHMARKS.papa,
  CROP_PRICING_BENCHMARKS.general,
]

const normalizeCropToken = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()

/**
 * Resuelve la referencia paramétrica en MXN/m² a partir de la clave o nombre del cultivo en BD.
 */
export const resolveCropPricingBenchmark = (
  cropNameOrKey?: string | null,
  fallbackKey: CropPricingKey = 'maiz',
): CropPricingBenchmark => {
  if (!cropNameOrKey) return CROP_PRICING_BENCHMARKS[fallbackKey]
  const normalized = normalizeCropToken(cropNameOrKey)
  if (!normalized) return CROP_PRICING_BENCHMARKS[fallbackKey]

  if (normalized in CROP_PRICING_BENCHMARKS) {
    return CROP_PRICING_BENCHMARKS[normalized as CropPricingKey]
  }

  for (const benchmark of CROP_PRICING_LIST) {
    if (
      normalized.includes(benchmark.key)
      || benchmark.aliases.some(alias => normalized.includes(alias))
    ) {
      return benchmark
    }
  }

  return CROP_PRICING_BENCHMARKS[fallbackKey]
}

const roundAmount = (value: number): number => Number(Math.max(0, value).toFixed(2))
const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

/**
 * Calcula los costos aproximados reales (MXN/m² y MXN totales) de acuerdo con la superficie real del polígono.
 */
export const calculateParcelPriceEstimate = (
  input: ParcelPriceEstimateInput,
): ParcelPriceEstimate => {
  const benchmark = resolveCropPricingBenchmark(input.cropKeyOrName, 'maiz')
  const areaSquareMeters = Math.max(1, Number.isFinite(input.areaSquareMeters) ? input.areaSquareMeters : 10_000)
  const areaHectares = areaSquareMeters / 10_000

  const affectedRatio = clamp(Number.isFinite(input.affectedRatio) ? input.affectedRatio : 0, 0, 1)
  const recoverableRatio = clamp(
    Number.isFinite(input.recoverableRatio) ? (input.recoverableRatio as number) : affectedRatio,
    0,
    affectedRatio,
  )
  const severityFactor = clamp(
    Number.isFinite(input.severityFactor) ? (input.severityFactor as number) : 1.0,
    0.8,
    2.2,
  )
  const batterySavingsPercent = clamp(
    Number.isFinite(input.batterySavingsPercent) ? (input.batterySavingsPercent as number) : 0,
    0,
    100,
  )

  const affectedAreaSquareMeters = Number((areaSquareMeters * affectedRatio).toFixed(1))
  const affectedAreaHectares = Number((affectedAreaSquareMeters / 10_000).toFixed(4))
  const recoverableAreaSquareMeters = areaSquareMeters * recoverableRatio

  const cycleProductionTotalMxn = roundAmount(areaSquareMeters * benchmark.productionTotalPerM2)
  const cycleIrrigationMxn = roundAmount(areaSquareMeters * benchmark.irrigationPerM2)
  const cycleFertilizationMxn = roundAmount(areaSquareMeters * benchmark.fertilizationPerM2)
  const cyclePestControlMxn = roundAmount(areaSquareMeters * benchmark.pestControlPerM2)
  const droneSinglePassMxn = roundAmount(areaSquareMeters * benchmark.droneSprayPassPerM2)
  const droneThreePassesMxn = roundAmount(droneSinglePassMxn * 3)
  const expectedHarvestValueMxn = roundAmount(areaSquareMeters * benchmark.harvestValuePerM2)

  let correctiveIrrigationPartMxn = 0
  let correctiveInputsPartMxn = 0
  let correctiveDronePartMxn = 0
  let correctiveTreatmentMxn = 0

  if (recoverableAreaSquareMeters > 0) {
    const tspFlightDiscount = 1 - (batterySavingsPercent / 100) * 0.35
    correctiveIrrigationPartMxn = roundAmount(
      recoverableAreaSquareMeters * (benchmark.irrigationPerM2 * 0.45) * severityFactor,
    )
    correctiveInputsPartMxn = roundAmount(
      recoverableAreaSquareMeters
      * (benchmark.fertilizationPerM2 * 0.25 + benchmark.pestControlPerM2 * 0.55)
      * severityFactor,
    )
    correctiveDronePartMxn = roundAmount(
      recoverableAreaSquareMeters * benchmark.droneSprayPassPerM2 * tspFlightDiscount,
    )
    correctiveTreatmentMxn = roundAmount(
      correctiveIrrigationPartMxn + correctiveInputsPartMxn + correctiveDronePartMxn,
    )
  }

  const preventiveMonitoringMxn = roundAmount(areaSquareMeters * benchmark.preventiveMonitoringPerM2)
  const avoidedShare = Math.min(0.45, 0.18 * severityFactor)
  const potentialYieldLossAvoidedMxn =
    affectedAreaSquareMeters > 0
      ? roundAmount(affectedAreaSquareMeters * benchmark.harvestValuePerM2 * avoidedShare)
      : 0
  const netPreventiveSavingsMxn = roundAmount(
    Math.max(0, potentialYieldLossAvoidedMxn - preventiveMonitoringMxn),
  )
  const droneRouteSavingsMxn = roundAmount(
    areaSquareMeters * benchmark.droneSprayPassPerM2 * (batterySavingsPercent / 100),
  )

  const correctiveCostPerAffectedM2Mxn =
    affectedAreaSquareMeters > 0
      ? Number((correctiveTreatmentMxn / affectedAreaSquareMeters).toFixed(2))
      : 0

  return {
    currency: 'MXN',
    benchmark,
    areaSquareMeters,
    areaHectares,
    affectedAreaSquareMeters,
    affectedAreaHectares,
    affectedRatio,
    cycleProductionTotalMxn,
    cycleIrrigationMxn,
    cycleFertilizationMxn,
    cyclePestControlMxn,
    droneSinglePassMxn,
    droneThreePassesMxn,
    expectedHarvestValueMxn,
    correctiveTreatmentMxn,
    correctiveIrrigationPartMxn,
    correctiveInputsPartMxn,
    correctiveDronePartMxn,
    preventiveMonitoringMxn,
    potentialYieldLossAvoidedMxn,
    netPreventiveSavingsMxn,
    droneRouteSavingsMxn,
    costPerSquareMeterMxn: benchmark.productionTotalPerM2,
    correctiveCostPerAffectedM2Mxn,
  }
}

export type SoftwareRentalPlanKey = 'basico' | 'profesional' | 'empresarial'

export interface SoftwareRentalPlan {
  key: SoftwareRentalPlanKey
  name: string
  audience: string
  hectareRangeLabel: string
  includedHectares: number
  basePricePerCycleMxn: number
  extraHectareRateMxn: number
  cycleMonthsLabel: string
  features: string[]
  recommendedBadge?: string
}

export type SuccessFeeRateOption = 0 | 10 | 12.5

export const SUCCESS_FEE_RATE_OPTIONS: ReadonlyArray<{
  ratePercent: SuccessFeeRateOption
  label: string
}> = [
  { ratePercent: 0, label: '0% (Solo cuota fija)' },
  { ratePercent: 10, label: '10% del ahorro (Recomendado)' },
  { ratePercent: 12.5, label: '12.5% del ahorro' },
]

export interface SoftwareRentalRoiInput {
  areaHectares: number
  areaSquareMeters?: number
  planKey?: SoftwareRentalPlanKey
  includeRetrofitting?: boolean
  successFeePercent?: number
  grossAvoidedLossMxn?: number
  preventiveImplementationCostMxn?: number
  netPreventiveSavingsMxn?: number
  droneSavingsMxn?: number
  reactiveImpactCostMxn?: number
  hasExportedSimulation?: boolean
  cropKeyOrName?: string | null
}

export interface SoftwareRentalRoiBreakdown {
  currency: 'MXN'
  plan: SoftwareRentalPlan
  recommendedPlanKey: SoftwareRentalPlanKey
  areaHectares: number
  areaSquareMeters: number
  extraHectares: number
  extraHectaresCostMxn: number
  rentalCostPerCycleMxn: number
  includeRetrofitting: boolean
  retrofittingCostMxn: number
  bundleDiscountMxn: number
  successFeePercent: number
  successFeeMxn: number
  totalCommercialInvestmentMxn: number
  rentalMonthlyEquivalentMxn: number
  rentalCostPerHectareMxn: number
  rentalCostPerSquareMeterMxn: number
  grossAvoidedLossMxn: number
  preventiveImplementationCostMxn: number
  droneSavingsMxn: number
  producerSavingsBeforeRentalMxn: number
  netBenefitAfterRentalMxn: number
  producerRetentionPercent: number
  roiMultiple: number
  roiPercentAfterRental: number
  paybackCovered: boolean
  rentalShareOfCycleProductionPercent: number
  isBenchmarkEstimate: boolean
}

export const AGRONIA_RETROFITTING_PRICING = {
  kitCostMxn: 9500,
  installationLaborMxn: 3500,
  techMarginMxn: 5500,
  retrofittingSalePriceMxn: 18_500,
  retrofittingContributionMarginMxn: 9000,
  starterBundlePriceMxn: 20_900,
  starterBundleDiscountMxn: 550,
  starterBundleVariableCostMxn: 9900,
  starterBundleContributionMarginMxn: 11_000,
} as const

export const SOFTWARE_RENTAL_PLANS: Record<SoftwareRentalPlanKey, SoftwareRentalPlan> = {
  basico: {
    key: 'basico',
    name: 'Plan Básico (Productor)',
    audience: 'Pequeño productor / parcela piloto',
    hectareRangeLabel: 'Hasta 3 ha',
    includedHectares: 3,
    basePricePerCycleMxn: 1490,
    extraHectareRateMxn: 320,
    cycleMonthsLabel: '4–6 meses',
    features: [
      'Diagnóstico IA (60 enfermedades + PlantLens)',
      'Gestión de parcelas y cultivos',
      'Simulador 3D y estimación real MXN/m²',
    ],
  },
  profesional: {
    key: 'profesional',
    name: 'Plan Profesional (Agrícola)',
    audience: 'Productor mediano / rancho tecnificado',
    hectareRangeLabel: '3 a 7 ha',
    includedHectares: 7,
    basePricePerCycleMxn: 2950,
    extraHectareRateMxn: 260,
    cycleMonthsLabel: '4–6 meses',
    recommendedBadge: 'Recomendado',
    features: [
      'Todo lo del Plan Básico + rutas TSP 2-opt',
      'Telemetría en vivo MAVLink / puente DJI',
      'Dashboards ejecutivos, historial y 5 usuarios',
    ],
  },
  empresarial: {
    key: 'empresarial',
    name: 'Plan Empresarial / Cooperativa',
    audience: 'Agroindustria, asociaciones o servicios con dron',
    hectareRangeLabel: '7 a 30 ha',
    includedHectares: 30,
    basePricePerCycleMxn: 7900,
    extraHectareRateMxn: 180,
    cycleMonthsLabel: '4–6 meses',
    features: [
      'Todo lo del Plan Profesional + usuarios ilimitados',
      'Soporte prioritario e integración multi-dron / IoT',
      'Reportes ejecutivos por lote y cliente',
    ],
  },
}

export const SOFTWARE_RENTAL_PLAN_LIST: SoftwareRentalPlan[] = [
  SOFTWARE_RENTAL_PLANS.basico,
  SOFTWARE_RENTAL_PLANS.profesional,
  SOFTWARE_RENTAL_PLANS.empresarial,
]

export const recommendSoftwareRentalPlan = (areaHectares: number): SoftwareRentalPlanKey => {
  const ha = Number.isFinite(areaHectares) ? Math.max(0, areaHectares) : 0
  if (ha < 3) return 'basico'
  if (ha <= 7) return 'profesional'
  return 'empresarial'
}

export const calculateSoftwareRentalRoi = (
  input: SoftwareRentalRoiInput,
): SoftwareRentalRoiBreakdown => {
  const areaHectares = Math.max(
    0.01,
    Number.isFinite(input.areaHectares) ? input.areaHectares : 10,
  )
  const areaSquareMeters = Math.max(
    1,
    Number.isFinite(input.areaSquareMeters) ? (input.areaSquareMeters as number) : areaHectares * 10_000,
  )
  const recommendedPlanKey = recommendSoftwareRentalPlan(areaHectares)
  const plan = SOFTWARE_RENTAL_PLANS[input.planKey ?? recommendedPlanKey]
  const benchmark = resolveCropPricingBenchmark(input.cropKeyOrName, 'maiz')

  const extraHectares = Math.max(0, Number((areaHectares - plan.includedHectares).toFixed(2)))
  const extraHectaresCostMxn = Math.round(extraHectares * plan.extraHectareRateMxn)
  const rentalCostPerCycleMxn = plan.basePricePerCycleMxn + extraHectaresCostMxn
  const includeRetrofitting = Boolean(input.includeRetrofitting)
  const retrofittingCostMxn = includeRetrofitting
    ? AGRONIA_RETROFITTING_PRICING.retrofittingSalePriceMxn
    : 0
  const bundleDiscountMxn =
    includeRetrofitting && plan.key === 'profesional' && extraHectares === 0
      ? AGRONIA_RETROFITTING_PRICING.starterBundleDiscountMxn
      : 0
  const rentalMonthlyEquivalentMxn = Math.round(rentalCostPerCycleMxn / 5)
  const rentalCostPerHectareMxn = Number((rentalCostPerCycleMxn / areaHectares).toFixed(2))
  const rentalCostPerSquareMeterMxn = Number((rentalCostPerCycleMxn / areaSquareMeters).toFixed(4))

  let grossAvoidedLossMxn = 0
  let preventiveImplementationCostMxn = 0
  let droneSavingsMxn = 0
  let producerSavingsBeforeRentalMxn = 0
  let isBenchmarkEstimate = false

  if (input.hasExportedSimulation) {
    grossAvoidedLossMxn = Math.max(0, Math.round(input.grossAvoidedLossMxn ?? 0))
    preventiveImplementationCostMxn = Math.max(0, Math.round(input.preventiveImplementationCostMxn ?? 0))
    droneSavingsMxn = Math.max(0, Math.round(input.droneSavingsMxn ?? 0))
    producerSavingsBeforeRentalMxn = Math.max(
      0,
      Math.round(
        input.netPreventiveSavingsMxn
          ?? Math.max(0, grossAvoidedLossMxn - preventiveImplementationCostMxn),
      ),
    )
  } else {
    isBenchmarkEstimate = true
    const avoidedHarvestLoss = areaSquareMeters * benchmark.harvestValuePerM2 * 0.03
    const inputOptimizationSavings =
      areaSquareMeters * (benchmark.irrigationPerM2 + benchmark.pestControlPerM2) * 0.12
    grossAvoidedLossMxn = Math.round(avoidedHarvestLoss + inputOptimizationSavings)
    preventiveImplementationCostMxn = Math.round(
      areaSquareMeters * benchmark.preventiveMonitoringPerM2,
    )
    droneSavingsMxn = Math.round(areaSquareMeters * benchmark.droneSprayPassPerM2 * 0.35)
    producerSavingsBeforeRentalMxn = Math.max(
      0,
      grossAvoidedLossMxn - preventiveImplementationCostMxn,
    )
  }

  const successFeePercent = Number.isFinite(input.successFeePercent)
    ? clamp(input.successFeePercent as number, 0, 30)
    : 0
  const successFeeMxn = Math.round(producerSavingsBeforeRentalMxn * (successFeePercent / 100))
  const totalCommercialInvestmentMxn = Math.max(
    0,
    rentalCostPerCycleMxn + successFeeMxn + retrofittingCostMxn - bundleDiscountMxn,
  )

  const cycleProductionCostMxn = areaSquareMeters * benchmark.productionTotalPerM2
  const rentalShareOfCycleProductionPercent =
    cycleProductionCostMxn > 0
      ? Number(((totalCommercialInvestmentMxn / cycleProductionCostMxn) * 100).toFixed(2))
      : 0

  const netBenefitAfterRentalMxn = Math.round(
    producerSavingsBeforeRentalMxn - totalCommercialInvestmentMxn,
  )
  const producerRetentionPercent =
    producerSavingsBeforeRentalMxn > 0
      ? Number(
          ((Math.max(0, netBenefitAfterRentalMxn) / producerSavingsBeforeRentalMxn) * 100).toFixed(1),
        )
      : 0
  const roiMultiple =
    totalCommercialInvestmentMxn > 0
      ? Number((producerSavingsBeforeRentalMxn / totalCommercialInvestmentMxn).toFixed(2))
      : 0
  const roiPercentAfterRental =
    totalCommercialInvestmentMxn > 0
      ? Number(((netBenefitAfterRentalMxn / totalCommercialInvestmentMxn) * 100).toFixed(1))
      : 0

  return {
    currency: 'MXN',
    plan,
    recommendedPlanKey,
    areaHectares,
    areaSquareMeters,
    extraHectares,
    extraHectaresCostMxn,
    rentalCostPerCycleMxn,
    includeRetrofitting,
    retrofittingCostMxn,
    bundleDiscountMxn,
    successFeePercent,
    successFeeMxn,
    totalCommercialInvestmentMxn,
    rentalMonthlyEquivalentMxn,
    rentalCostPerHectareMxn,
    rentalCostPerSquareMeterMxn,
    grossAvoidedLossMxn,
    preventiveImplementationCostMxn,
    droneSavingsMxn,
    producerSavingsBeforeRentalMxn,
    netBenefitAfterRentalMxn,
    producerRetentionPercent,
    roiMultiple,
    roiPercentAfterRental,
    paybackCovered: producerSavingsBeforeRentalMxn >= totalCommercialInvestmentMxn,
    rentalShareOfCycleProductionPercent,
    isBenchmarkEstimate,
  }
}
