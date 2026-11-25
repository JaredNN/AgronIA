import type { Json } from './agronomyData.ts'
import { planOptimizedDroneRoute } from './droneRoutePlanner.ts'
import {
  computeTakeoffBaseForField,
  extractParcelMetadata,
  projectFieldGeometry,
} from './fieldGeometry.ts'
import { isolateOwnParcelGeoJson } from './fieldMapWorkspace.ts'
import { buildSimulationReport, STRESS_STATE_LABELS } from './simulationEngine.ts'
import type {
  ExportedDashboardSimulation,
  PreventiveRecommendation,
  ReactiveCostBreakdown,
  SimulatedPlantNode,
  SimulationEconomicAnalysis,
  SimulationReport,
  SimulationStressTimePoint,
} from '../types/simulation.ts'

const roundMoney = (value: number): number => Math.round(Math.max(0, value))
const roundTwo = (value: number): number => Number(value.toFixed(2))
const roundOne = (value: number): number => Number(value.toFixed(1))

export const extractStressTimeline = (report: SimulationReport): SimulationStressTimePoint[] => {
  const byTick = new Map<
    number,
    {
      timestamp: string
      stressSum: number
      maxStress: number
      ndviSum: number
      tempSum: number
      count: number
      healthyCount: number
      affectedCount: number
      criticalOrIrreversibleCount: number
    }
  >()

  for (const plant of report.plants) {
    if (!Array.isArray(plant.history)) continue
    for (const entry of plant.history) {
      const bucket = byTick.get(entry.tick) ?? {
        timestamp: entry.timestamp,
        stressSum: 0,
        maxStress: 0,
        ndviSum: 0,
        tempSum: 0,
        count: 0,
        healthyCount: 0,
        affectedCount: 0,
        criticalOrIrreversibleCount: 0,
      }
      bucket.stressSum += entry.waterStressPercent
      bucket.maxStress = Math.max(bucket.maxStress, entry.waterStressPercent)
      bucket.ndviSum += entry.ndvi
      bucket.tempSum += entry.tempC
      bucket.count += 1
      if (entry.state === 'saludable') {
        bucket.healthyCount += 1
      } else {
        bucket.affectedCount += 1
        if (entry.state === 'estrés_crítico' || entry.state === 'pérdida_irreversible') {
          bucket.criticalOrIrreversibleCount += 1
        }
      }
      if (entry.timestamp) bucket.timestamp = entry.timestamp
      byTick.set(entry.tick, bucket)
    }
  }

  if (byTick.size === 0) {
    const counts = report.summary.countsByState
    const healthy = counts.saludable ?? 0
    const critical = (counts['estrés_crítico'] ?? 0) + (counts['pérdida_irreversible'] ?? 0)
    const affected = Math.max(0, report.plants.length - healthy)
    const maxStress = report.plants.reduce(
      (max, plant) => Math.max(max, plant.waterStressPercent),
      0
    )

    return [
      {
        tick: report.tick,
        timestamp: report.generatedAt,
        avgWaterStressPercent: roundOne(report.summary.avgWaterStressPercent),
        maxWaterStressPercent: roundOne(maxStress),
        avgNdvi: roundTwo(report.summary.avgNdvi),
        avgTempC: roundOne(report.summary.avgTempC),
        healthyCount: healthy,
        affectedCount: affected,
        criticalOrIrreversibleCount: critical,
      },
    ]
  }

  return [...byTick.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([tick, bucket]) => {
      const n = Math.max(1, bucket.count)
      return {
        tick,
        timestamp: bucket.timestamp,
        avgWaterStressPercent: roundOne(bucket.stressSum / n),
        maxWaterStressPercent: roundOne(bucket.maxStress),
        avgNdvi: roundTwo(bucket.ndviSum / n),
        avgTempC: roundOne(bucket.tempSum / n),
        healthyCount: bucket.healthyCount,
        affectedCount: bucket.affectedCount,
        criticalOrIrreversibleCount: bucket.criticalOrIrreversibleCount,
      }
    })
}

export const calculateSimulationEconomics = (
  report: SimulationReport,
  options?: {
    cropValuePerHectareMxn?: number
  }
): SimulationEconomicAnalysis => {
  const cropReferenceValuePerHectare = options?.cropValuePerHectareMxn ?? 58_000
  const totalAreaHa = Math.max(0.01, report.parcel.areaHectares)
  const totalAreaM2 = Math.max(1, report.parcel.areaSquareMeters)
  const totalPlants = Math.max(1, report.summary.totalPlants || report.plants.length)
  const counts = report.summary.countsByState

  const mild = counts['estrés_leve'] ?? 0
  const moderate = counts['estrés_moderado'] ?? 0
  const critical = counts['estrés_crítico'] ?? 0
  const irreversible = counts['pérdida_irreversible'] ?? 0

  const affectedPlantCount = mild + moderate + critical + irreversible
  const recoverableAffectedCount = mild + moderate + critical
  const affectedRatio = affectedPlantCount / totalPlants
  const recoverableRatio = recoverableAffectedCount / totalPlants

  const affectedAreaHectares = Number((totalAreaHa * affectedRatio).toFixed(4))
  const affectedAreaSquareMeters = Number((totalAreaM2 * affectedRatio).toFixed(1))
  const recoverableAreaHa = totalAreaHa * recoverableRatio

  const batterySavingsRatio = Math.max(0, Math.min(1, report.droneFlight.batterySavingsPercent / 100))
  const estimatedBaselineFleetCost =
    report.droneFlight.baselineFullSweepDistanceMeters * 0.65 +
    (report.droneFlight.baselineBatteryPercent / 100) * 180
  const estimatedActualFlightCost =
    report.droneFlight.totalDistanceMeters * 0.65 +
    (report.droneFlight.estimatedBatteryPercent / 100) * 180
  const droneFuelSavingsAmount = roundMoney(
    Math.max(0, estimatedBaselineFleetCost - estimatedActualFlightCost)
  )

  let emergencyIrrigationCost = 0
  let fertilizersBiostimulantsCost = 0
  let droneApplicationCost = 0
  let fieldLaborCost = 0
  let projectedYieldLossPercent = 0
  let projectedYieldLossCost = 0

  if (affectedPlantCount > 0) {
    const severityFactor =
      recoverableAffectedCount > 0
        ? (mild * 1.0 + moderate * 1.45 + critical * 2.15) / recoverableAffectedCount
        : 1.0

    if (recoverableAffectedCount > 0) {
      emergencyIrrigationCost = roundMoney(450 + recoverableAreaHa * 2850 * severityFactor)
      fertilizersBiostimulantsCost = roundMoney(recoverableAreaHa * 3600 * severityFactor)
      droneApplicationCost = roundMoney(
        420 +
          recoverableAreaHa * 680 * (1 - batterySavingsRatio * 0.35) +
          report.droneFlight.totalDistanceMeters * 0.65
      )
    }

    fieldLaborCost = roundMoney(380 + affectedAreaHectares * 1450)
    projectedYieldLossPercent = roundOne(
      Math.min(
        100,
        ((mild * 0.04 + moderate * 0.15 + critical * 0.42 + irreversible * 1.0) / totalPlants) * 100
      )
    )
    projectedYieldLossCost = roundMoney(
      totalAreaHa * cropReferenceValuePerHectare * (projectedYieldLossPercent / 100)
    )
  }

  const reactiveTreatmentTotalCost =
    emergencyIrrigationCost + fertilizersBiostimulantsCost + droneApplicationCost + fieldLaborCost
  const totalReactiveImpactCost = reactiveTreatmentTotalCost + projectedYieldLossCost

  const reactive: ReactiveCostBreakdown = {
    currency: 'MXN',
    totalAreaHectares: Number(totalAreaHa.toFixed(4)),
    affectedAreaHectares,
    affectedAreaSquareMeters,
    affectedPlantCount,
    recoverableAffectedCount,
    criticalPlantCount: critical,
    irreversiblePlantCount: irreversible,
    emergencyIrrigationCost,
    fertilizersBiostimulantsCost,
    droneApplicationCost,
    fieldLaborCost,
    reactiveTreatmentTotalCost,
    projectedYieldLossPercent,
    projectedYieldLossCost,
    totalReactiveImpactCost,
    droneFuelSavingsAmount,
  }

  const preventiveRecommendations: PreventiveRecommendation[] = []

  if (affectedPlantCount === 0) {
    const simulatedRiskArea = Number((totalAreaHa * 0.18).toFixed(3))
    const benchmarkAvoidedOutbreakCost = roundMoney(
      totalAreaHa * cropReferenceValuePerHectare * 0.045 + simulatedRiskArea * 3400
    )

    const sentinelCost = roundMoney(Math.max(550, totalAreaHa * 460))
    const sentinelGross = roundMoney(benchmarkAvoidedOutbreakCost * 0.56)
    const sentinelNet = Math.round(sentinelGross - sentinelCost)

    const calibrationCost = roundMoney(Math.max(620, totalAreaHa * 520))
    const calibrationGross = roundMoney(benchmarkAvoidedOutbreakCost * 0.44)
    const calibrationNet = Math.round(calibrationGross - calibrationCost)

    preventiveRecommendations.push(
      {
        id: 'prev-centinelas-saludable',
        title: 'Monitoreo preventivo programado con Centinelas IA',
        category: 'monitoreo_centinelas',
        priority: 'media',
        triggerReason:
          'El 100% de la parcela está saludable; mantener vigilancia temprana evita que focos iniciales escalen sin detección.',
        targetAreaHectares: Number(totalAreaHa.toFixed(2)),
        implementationCost: sentinelCost,
        avoidedCorrectiveCost: roundMoney(sentinelGross * 0.38),
        avoidedYieldLoss: roundMoney(sentinelGross * 0.62),
        projectedNetSavings: sentinelNet,
        roiPercent: sentinelCost > 0 ? roundOne((sentinelNet / sentinelCost) * 100) : 0,
        actionSteps: [
          'Programar vuelos de inspección semanal sobre los vértices reales de la parcela.',
          'Activar alertas automáticas cuando cualquier planta supere 18% de estrés hídrico.',
        ],
      },
      {
        id: 'prev-riego-calibracion',
        title: 'Ajuste preventivo de lámina de riego y balance hídrico',
        category: 'riego_zonificado',
        priority: 'baja',
        triggerReason:
          'Calibrar sectores según evapotranspiración previene déficit hídrico en los bordes del polígono.',
        targetAreaHectares: Number(totalAreaHa.toFixed(2)),
        implementationCost: calibrationCost,
        avoidedCorrectiveCost: roundMoney(calibrationGross * 0.42),
        avoidedYieldLoss: roundMoney(calibrationGross * 0.58),
        projectedNetSavings: calibrationNet,
        roiPercent: calibrationCost > 0 ? roundOne((calibrationNet / calibrationCost) * 100) : 0,
        actionSteps: [
          'Uniformizar presiones por surco en zonas de mayor insolación.',
          'Registrar humedad base semanal en AgronIA.',
        ],
      }
    )
  } else {
    const escalationMultiplier =
      critical + irreversible > 0 ? 1.42 : moderate > 0 ? 1.24 : 1.12
    const avoidableYieldPool = Math.max(
      projectedYieldLossCost * 0.82,
      affectedAreaHectares * cropReferenceValuePerHectare * 0.16 * escalationMultiplier
    )

    // 1. Ajuste de riego por zonas críticas
    const riegoCost = roundMoney(Math.max(720, Math.max(0.12, affectedAreaHectares) * 1050))
    const riegoAvoidedCorrective = roundMoney(
      emergencyIrrigationCost * 0.7 + fieldLaborCost * 0.24
    )
    const riegoAvoidedYield = roundMoney(avoidableYieldPool * 0.38)
    const riegoNet = Math.round(riegoAvoidedCorrective + riegoAvoidedYield - riegoCost)

    preventiveRecommendations.push({
      id: 'prev-riego-zonificado',
      title: 'Ajuste de riego sectorizado en zonas de déficit hídrico',
      category: 'riego_zonificado',
      priority: critical > 0 || moderate > mild ? 'alta' : 'media',
      triggerReason: `Se detectaron ${affectedPlantCount} plantas afectadas (${(affectedRatio * 100).toFixed(1)}% del polígono; ${critical} críticas). Sectorizar el riego detiene el avance hacia daño irreversible.`,
      targetAreaHectares: Number(Math.max(0.05, affectedAreaHectares).toFixed(2)),
      implementationCost: riegoCost,
      avoidedCorrectiveCost: riegoAvoidedCorrective,
      avoidedYieldLoss: riegoAvoidedYield,
      projectedNetSavings: riegoNet,
      roiPercent: riegoCost > 0 ? roundOne((riegoNet / riegoCost) * 100) : 0,
      actionSteps: [
        'Aumentar frecuencia de pulsos de riego únicamente en los sectores georreferenciados con estrés >= 18%.',
        'Reducir sobrerriego en cuadrantes saludables para ahorrar agua y energía de bombeo.',
      ],
    })

    // 2. Monitoreo continuo con Centinelas IA
    const centinelaCost = roundMoney(Math.max(580, totalAreaHa * 490))
    const centinelaAvoidedCorrective = roundMoney(
      droneApplicationCost * 0.48 + fieldLaborCost * 0.34
    )
    const centinelaAvoidedYield = roundMoney(avoidableYieldPool * 0.3)
    const centinelaNet = Math.round(
      centinelaAvoidedCorrective + centinelaAvoidedYield - centinelaCost
    )

    preventiveRecommendations.push({
      id: 'prev-monitoreo-centinelas',
      title: 'Vigilancia continua con enjambre Centinelas IA',
      category: 'monitoreo_centinelas',
      priority: 'alta',
      triggerReason: `La ruta optimizada TSP 2-opt ya reduce el consumo en ${report.droneFlight.batterySavingsPercent}%; automatizar patrullajes tempranos evita riegos tardíos.`,
      targetAreaHectares: Number(totalAreaHa.toFixed(2)),
      implementationCost: centinelaCost,
      avoidedCorrectiveCost: centinelaAvoidedCorrective,
      avoidedYieldLoss: centinelaAvoidedYield,
      projectedNetSavings: centinelaNet,
      roiPercent: centinelaCost > 0 ? roundOne((centinelaNet / centinelaCost) * 100) : 0,
      actionSteps: [
        'Ejecutar barrido espectral NDVI y térmico cada 48–72 horas sobre los focos activos.',
        'Despachar vuelo de aspersión TSP 2-opt exclusivamente en puntos que superen el umbral leve.',
      ],
    })

    // 3. Aplicación foliar preventiva / bioestimulantes focalizada
    const foliarCost = roundMoney(
      Math.max(
        640,
        Math.max(0.1, recoverableAreaHa) * 1240 * (1 - batterySavingsRatio * 0.25)
      )
    )
    const foliarAvoidedCorrective = roundMoney(fertilizersBiostimulantsCost * 0.62)
    const foliarAvoidedYield = roundMoney(avoidableYieldPool * 0.2)
    const foliarNet = Math.round(foliarAvoidedCorrective + foliarAvoidedYield - foliarCost)

    preventiveRecommendations.push({
      id: 'prev-aplicacion-foliar',
      title: 'Aplicación foliar antiestrés vía ruta dron TSP 2-opt',
      category: 'aplicacion_foliar',
      priority: moderate + critical > 0 ? 'alta' : 'media',
      triggerReason: `Omitir ${report.droneFlight.skippedHealthyPlantCount} plantas sanas permite aplicar aminoácidos y osmoreguladores solo en las ${Math.max(1, recoverableAffectedCount)} plantas recuperables.`,
      targetAreaHectares: Number(Math.max(0.05, recoverableAreaHa).toFixed(2)),
      implementationCost: foliarCost,
      avoidedCorrectiveCost: foliarAvoidedCorrective,
      avoidedYieldLoss: foliarAvoidedYield,
      projectedNetSavings: foliarNet,
      roiPercent: foliarCost > 0 ? roundOne((foliarNet / foliarCost) * 100) : 0,
      actionSteps: [
        'Cargar mezcla foliar bioestimulante de precisión acorde al número de waypoints críticos.',
        'Verificar recuperación de NDVI en el ciclo siguiente.',
      ],
    })

    // 4. Auditoría hidráulica en puntos críticos cuando hay severidad elevada
    if (critical + irreversible > 0 || affectedRatio >= 0.12) {
      const auditCost = roundMoney(Math.max(520, Math.max(0.08, affectedAreaHectares) * 690))
      const auditAvoidedCorrective = roundMoney(
        emergencyIrrigationCost * 0.18 + fieldLaborCost * 0.24
      )
      const auditAvoidedYield = roundMoney(avoidableYieldPool * 0.12)
      const auditNet = Math.round(auditAvoidedCorrective + auditAvoidedYield - auditCost)

      preventiveRecommendations.push({
        id: 'prev-auditoria-hidraulica',
        title: 'Inspección hidráulica en focos críticos georreferenciados',
        category: 'auditoria_hidraulica',
        priority: 'alta',
        triggerReason: `Se registraron ${critical} plantas en estrés crítico y ${irreversible} en pérdida irreversible; revisar goteros/válvulas en esas coordenadas GPS evita recurrencia.`,
        targetAreaHectares: Number(Math.max(0.05, affectedAreaHectares).toFixed(2)),
        implementationCost: auditCost,
        avoidedCorrectiveCost: auditAvoidedCorrective,
        avoidedYieldLoss: auditAvoidedYield,
        projectedNetSavings: auditNet,
        roiPercent: auditCost > 0 ? roundOne((auditNet / auditCost) * 100) : 0,
        actionSteps: [
          'Usar las coordenadas lat/lng exportadas en el mapa satelital para revisar obstrucciones o fugas.',
          'Purgar líneas laterales y revalidar presión terminal.',
        ],
      })
    }
  }

  const preventiveTotalCost = preventiveRecommendations.reduce(
    (sum, item) => sum + item.implementationCost,
    0
  )
  const totalProjectedGrossAvoidedCost = preventiveRecommendations.reduce(
    (sum, item) => sum + item.avoidedCorrectiveCost + item.avoidedYieldLoss,
    0
  )
  const totalProjectedNetSavings = Math.round(totalProjectedGrossAvoidedCost - preventiveTotalCost)
  const overallRoiPercent =
    preventiveTotalCost > 0 ? roundOne((totalProjectedNetSavings / preventiveTotalCost) * 100) : 0

  const summaryNote =
    affectedPlantCount === 0
      ? 'Parcela 100% saludable: sin costo reactivo actual. El plan preventivo protege contra brotes futuros de estrés.'
      : `Tratar reactivamente ${affectedPlantCount} plantas (${affectedAreaHectares.toFixed(2)} ha) cuesta $${reactiveTreatmentTotalCost.toLocaleString('es-MX')} MXN más $${projectedYieldLossCost.toLocaleString('es-MX')} MXN en merma proyectada. Las acciones preventivas generan un ahorro neto estimado de $${Math.max(0, totalProjectedNetSavings).toLocaleString('es-MX')} MXN.`

  return {
    currency: 'MXN',
    cropReferenceValuePerHectare,
    reactive,
    preventiveRecommendations,
    preventiveTotalCost,
    totalProjectedGrossAvoidedCost,
    totalProjectedNetSavings,
    overallRoiPercent,
    summaryNote,
  }
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isValidSimulationReport = (value: unknown): value is SimulationReport => {
  if (!isPlainObject(value)) return false
  if (!isPlainObject(value.parcel) || !Array.isArray(value.plants)) return false
  if (!isPlainObject(value.summary) || !isPlainObject(value.droneFlight)) return false
  return typeof value.parcel.areaHectares === 'number' && typeof value.tick === 'number'
}

export const hydrateExportedSimulation = (row: {
  id: string
  field_id: string | null
  scenario_title: string
  results: Json
  created_at: string
}): ExportedDashboardSimulation | null => {
  if (!isPlainObject(row.results)) return null
  const rawReport = row.results.simulation_report
  if (!isValidSimulationReport(rawReport)) return null

  const rawTimeline = row.results.stress_timeline
  const stressTimeline =
    Array.isArray(rawTimeline) && rawTimeline.length > 0
      ? (rawTimeline as unknown as SimulationStressTimePoint[])
      : extractStressTimeline(rawReport)

  const rawEconomics = row.results.economics
  const economics =
    isPlainObject(rawEconomics) && isPlainObject(rawEconomics.reactive)
      ? (rawEconomics as unknown as SimulationEconomicAnalysis)
      : calculateSimulationEconomics(rawReport)

  return {
    id: row.id,
    title: row.scenario_title || `${rawReport.parcel.fieldName} · Ciclo #${rawReport.tick}`,
    exportedAt: row.created_at || rawReport.generatedAt,
    source: 'supabase',
    fieldId: row.field_id ?? rawReport.parcel.fieldId ?? null,
    report: rawReport,
    stressTimeline,
    economics,
  }
}

const normalizeFieldLabel = (value: string | null | undefined): string =>
  (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()

export const matchesSimulationField = (
  sim: ExportedDashboardSimulation,
  field: { id: string; name: string },
): boolean => {
  const simFieldId = sim.fieldId || sim.report.parcel.fieldId || null
  if (simFieldId) {
    return simFieldId === field.id
  }
  const simName = normalizeFieldLabel(sim.report.parcel.fieldName)
  const targetName = normalizeFieldLabel(field.name)
  return Boolean(simName && targetName && simName === targetName)
}

export const sanitizeExportedSimulationForField = (
  sim: ExportedDashboardSimulation,
  allFields: Array<{ id: string; name: string; geojson_data: Json | null }>,
): ExportedDashboardSimulation => {
  const targetFieldId = sim.fieldId ?? sim.report.parcel.fieldId
  const otherFieldGeojsons = allFields
    .filter(field => field.id !== targetFieldId && field.geojson_data)
    .map(field => field.geojson_data)

  if (otherFieldGeojsons.length === 0) return sim

  const { geojson: cleanGeojson, removedCount } = isolateOwnParcelGeoJson(
    sim.report.parcel.geojson,
    otherFieldGeojsons,
  )
  if (removedCount === 0) return sim

  const cleanProjected = projectFieldGeometry(cleanGeojson as Json)
  if (!cleanProjected) return sim

  const cleanParcel = extractParcelMetadata(
    cleanGeojson as Json,
    targetFieldId ?? null,
    sim.report.parcel.fieldName,
  )
  if (!cleanParcel) return sim

  const filteredPlants: SimulatedPlantNode[] = []
  for (const plant of sim.report.plants) {
    const pt = cleanProjected.projectGps(plant.lat, plant.lng)
    if (!cleanProjected.contains(pt)) continue
    filteredPlants.push({
      id: plant.id,
      x: Number(pt.x.toFixed(3)),
      z: Number(pt.z.toFixed(3)),
      lat: plant.lat,
      lng: plant.lng,
      stage: plant.stage,
      waterStressPercent: plant.waterStressPercent,
      pestStressPercent: plant.pestStressPercent,
      state: plant.state,
      health: plant.health,
      ndvi: plant.ndvi,
      temp: plant.tempC,
      status: STRESS_STATE_LABELS[plant.state],
      irreversible: plant.irreversible,
      stressedTicks: plant.stressedTicks,
      history: plant.history,
    })
  }

  const takeoffBase = computeTakeoffBaseForField(cleanProjected)
  const cleanFlight = planOptimizedDroneRoute({
    field: cleanProjected,
    basePoint: { x: takeoffBase.x, z: takeoffBase.z },
    plants: filteredPlants,
    missionType: sim.report.droneFlight.missionType,
  })
  const cleanReport = buildSimulationReport({
    tick: sim.report.tick,
    parcel: cleanParcel,
    plants: filteredPlants,
    droneFlight: cleanFlight,
    generatedAt: sim.report.generatedAt,
  })
  const cleanTimeline = extractStressTimeline(cleanReport)
  const cleanEconomics = calculateSimulationEconomics(cleanReport, {
    cropValuePerHectareMxn: sim.economics.cropReferenceValuePerHectare,
  })

  return {
    ...sim,
    report: cleanReport,
    stressTimeline: cleanTimeline,
    economics: cleanEconomics,
  }
}
