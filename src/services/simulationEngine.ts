import {
  generatePlantGridInsidePolygon,
  type FieldPoint,
  type ProjectedField,
} from './fieldGeometry.ts'
import type {
  DroneFlightPlanMetrics,
  ParcelGeometryMetadata,
  PlantStressHistoryEntry,
  PlantStressHistoryEvent,
  PlantStressState,
  SimulatedPlantNode,
  SimulationReport,
  StressCenter,
} from '../types/simulation.ts'

export const STRESS_STATE_LABELS: Record<PlantStressState, string> = {
  saludable: 'Saludable',
  estrés_leve: 'Estrés Leve',
  estrés_moderado: 'Estrés Moderado',
  estrés_crítico: 'Estrés Crítico',
  pérdida_irreversible: 'Pérdida Irreversible',
}

const MAX_HISTORY_ENTRIES = 40

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

export const classifyPlantStressState = (
  waterStressPercent: number,
  irreversible = false
): PlantStressState => {
  if (irreversible || waterStressPercent >= 92) return 'pérdida_irreversible'
  if (waterStressPercent >= 68) return 'estrés_crítico'
  if (waterStressPercent >= 42) return 'estrés_moderado'
  if (waterStressPercent >= 18) return 'estrés_leve'
  return 'saludable'
}

export const syncPlantDerivedMetrics = (plant: SimulatedPlantNode): SimulatedPlantNode => {
  const clampedWater = Number(clamp(plant.waterStressPercent, 0, 100).toFixed(1))
  const clampedPest = Number(clamp(plant.pestStressPercent, 0, 100).toFixed(1))
  const nextState = classifyPlantStressState(clampedWater, plant.irreversible)
  const isIrreversible = plant.irreversible || nextState === 'pérdida_irreversible'

  plant.irreversible = isIrreversible
  plant.waterStressPercent = isIrreversible ? Math.max(92, clampedWater) : clampedWater
  plant.pestStressPercent = clampedPest
  plant.state = nextState
  plant.status = STRESS_STATE_LABELS[nextState]

  if (isIrreversible) {
    plant.health = 0.05
    plant.ndvi = 0.11
    plant.temp = Number((37.5 + (plant.waterStressPercent - 92) * 0.25).toFixed(1))
  } else {
    const waterRatio = plant.waterStressPercent / 100
    const pestRatio = plant.pestStressPercent / 100
    const combinedLoad = waterRatio * 0.82 + pestRatio * 0.48
    plant.health = Number(clamp(1 - combinedLoad * 0.92, 0.08, 1).toFixed(3))
    plant.ndvi = Number(clamp(0.86 - waterRatio * 0.56 - pestRatio * 0.34, 0.12, 0.9).toFixed(2))
    plant.temp = Number((24.2 + waterRatio * 14.5 + pestRatio * 2.8).toFixed(1))
  }

  return plant
}

const pushHistoryEntry = (
  plant: SimulatedPlantNode,
  tick: number,
  timestamp: string,
  event: PlantStressHistoryEvent
) => {
  const entry: PlantStressHistoryEntry = {
    tick,
    timestamp,
    waterStressPercent: Number(plant.waterStressPercent.toFixed(1)),
    pestStressPercent: Number(plant.pestStressPercent.toFixed(1)),
    state: plant.state,
    ndvi: Number(plant.ndvi.toFixed(2)),
    tempC: Number(plant.temp.toFixed(1)),
    event,
  }

  plant.history.push(entry)
  if (plant.history.length > MAX_HISTORY_ENTRIES) {
    plant.history = [plant.history[0], ...plant.history.slice(-(MAX_HISTORY_ENTRIES - 1))]
  }
}

export const seedStressCentersInsideField = (
  field: ProjectedField,
  plants: ReadonlyArray<{ x: number; z: number; lat: number; lng: number }>,
  options?: {
    count?: number
    random?: () => number
  }
): StressCenter[] => {
  const random = options?.random ?? Math.random
  const minDim = Math.max(8, Math.min(field.widthMeters, field.depthMeters))
  const desiredCount = options?.count ?? (Math.floor(random() * 2) + 3)

  if (plants.length === 0) {
    return [
      {
        id: 'SEC-1',
        x: Number(field.centroidLocal.x.toFixed(3)),
        z: Number(field.centroidLocal.z.toFixed(3)),
        lat: field.centroid.lat,
        lng: field.centroid.lng,
        intensity: 0.72,
        radius: clamp(minDim * 0.18, 4, 36),
        type: 'DROUGHT',
      },
    ]
  }

  const minSeparation = minDim * 0.24
  const selectedAnchors: Array<{ x: number; z: number; lat: number; lng: number }> = []
  let guard = 0
  while (selectedAnchors.length < desiredCount && guard < 120) {
    guard++
    const candidate = plants[Math.floor(random() * plants.length)]
    const farEnough = selectedAnchors.every(
      existing => Math.hypot(existing.x - candidate.x, existing.z - candidate.z) >= minSeparation
    )
    if (farEnough || guard > 80) {
      if (!selectedAnchors.some(existing => existing.x === candidate.x && existing.z === candidate.z)) {
        selectedAnchors.push(candidate)
      }
    }
  }

  return selectedAnchors.map((anchor, index) => {
    const type: StressCenter['type'] =
      index === 0 ? 'DROUGHT' : index === 1 ? 'PEST' : random() > 0.35 ? 'DROUGHT' : 'PEST'
    return {
      id: `SEC-${index + 1}`,
      x: anchor.x,
      z: anchor.z,
      lat: anchor.lat,
      lng: anchor.lng,
      intensity: Number((0.62 + random() * 0.26).toFixed(2)),
      radius: Number(clamp(minDim * (0.14 + random() * 0.08), 4.5, 42).toFixed(2)),
      type,
    }
  })
}

export const createInitialSimulatedPlants = (
  field: ProjectedField,
  stressCenters: ReadonlyArray<StressCenter>,
  options?: {
    targetCount?: number
    maxPlants?: number
    random?: () => number
    timestamp?: string
  }
): SimulatedPlantNode[] => {
  const random = options?.random ?? Math.random
  const timestamp = options?.timestamp ?? new Date().toISOString()
  const slots = generatePlantGridInsidePolygon(field, {
    targetCount: options?.targetCount ?? 320,
    maxPlants: options?.maxPlants ?? 600,
    random,
  })

  return slots.map(slot => {
    let droughtEffect = 0
    let pestEffect = 0

    for (const center of stressCenters) {
      const dist = Math.hypot(slot.x - center.x, slot.z - center.z)
      if (dist < center.radius) {
        const effect = center.intensity * (1 - dist / center.radius)
        if (center.type === 'DROUGHT' || center.type === 'OVERHYDRATION') {
          droughtEffect = Math.max(droughtEffect, effect)
        }
        if (center.type === 'PEST') {
          pestEffect = Math.max(pestEffect, effect)
        }
      }
    }

    const baseWaterStress = 5 + random() * 6
    const initialWaterStress =
      droughtEffect > 0
        ? clamp(18 + droughtEffect * 48 + random() * 6, 18, 74)
        : baseWaterStress
    const initialPestStress =
      pestEffect > 0 ? clamp(22 + pestEffect * 52 + random() * 6, 18, 78) : random() * 5

    const node: SimulatedPlantNode = {
      id: slot.id,
      x: slot.x,
      z: slot.z,
      lat: slot.lat,
      lng: slot.lng,
      stage: slot.stage,
      waterStressPercent: initialWaterStress,
      pestStressPercent: initialPestStress,
      state: 'saludable',
      health: 1,
      ndvi: 0.85,
      temp: 24.5,
      status: 'Saludable',
      irreversible: false,
      stressedTicks: initialWaterStress >= 18 ? 1 : 0,
      history: [],
    }

    syncPlantDerivedMetrics(node)
    pushHistoryEntry(node, 0, timestamp, 'initial')
    return node
  })
}

export const advanceSimulationTick = (
  plants: SimulatedPlantNode[],
  stressCenters: ReadonlyArray<StressCenter>,
  nextTick: number,
  options?: {
    timestamp?: string
    event?: PlantStressHistoryEvent
  }
): {
  plants: SimulatedPlantNode[]
  newlyCriticalIds: string[]
  newlyIrreversibleIds: string[]
} => {
  const timestamp = options?.timestamp ?? new Date().toISOString()
  const baseEvent = options?.event ?? 'degradation'
  const newlyCriticalIds: string[] = []
  const newlyIrreversibleIds: string[] = []

  for (const plant of plants) {
    const prevState = plant.state

    if (plant.irreversible) {
      plant.waterStressPercent = clamp(plant.waterStressPercent + 1.5, 92, 100)
      syncPlantDerivedMetrics(plant)
      pushHistoryEntry(plant, nextTick, timestamp, 'irreversible_loss')
      continue
    }

    let droughtInfluence = 0
    let droughtBoundaryProximity = 0
    let pestInfluence = 0

    for (const center of stressCenters) {
      const dist = Math.hypot(plant.x - center.x, plant.z - center.z)
      if (center.type === 'DROUGHT' || center.type === 'OVERHYDRATION') {
        if (dist < center.radius) {
          droughtInfluence = Math.max(droughtInfluence, center.intensity * (1 - dist / center.radius))
        } else if (dist < center.radius * 1.18) {
          droughtBoundaryProximity = Math.max(
            droughtBoundaryProximity,
            1 - (dist - center.radius) / (center.radius * 0.18)
          )
        }
      } else if (center.type === 'PEST' && dist < center.radius) {
        pestInfluence = Math.max(pestInfluence, center.intensity * (1 - dist / center.radius))
      }
    }

    if (plant.waterStressPercent >= 18 || droughtInfluence > 0) {
      const stageAcceleration =
        plant.waterStressPercent >= 68 ? 2.4 : plant.waterStressPercent >= 42 ? 1.4 : 0.6
      const delta = 3.6 + droughtInfluence * 5.2 + stageAcceleration
      plant.waterStressPercent = clamp(plant.waterStressPercent + delta, 0, 100)
      plant.stressedTicks += 1
    } else if (droughtBoundaryProximity > 0) {
      const borderDelta = 2.2 + droughtBoundaryProximity * 1.6
      plant.waterStressPercent = clamp(plant.waterStressPercent + borderDelta, 0, 100)
      if (plant.waterStressPercent >= 18) {
        plant.stressedTicks += 1
      }
    }

    if (pestInfluence > 0 || plant.pestStressPercent >= 18) {
      const pestDelta = 3.2 + pestInfluence * 4.5
      plant.pestStressPercent = clamp(plant.pestStressPercent + pestDelta, 0, 100)
      plant.waterStressPercent = clamp(plant.waterStressPercent + 1.4, 0, 100)
    }

    syncPlantDerivedMetrics(plant)

    if (prevState !== 'estrés_crítico' && plant.state === 'estrés_crítico') {
      newlyCriticalIds.push(plant.id)
    }
    if (prevState !== 'pérdida_irreversible' && plant.state === 'pérdida_irreversible') {
      newlyIrreversibleIds.push(plant.id)
    }

  const entryEvent: PlantStressHistoryEvent =
      plant.state === 'pérdida_irreversible' ? 'irreversible_loss' : baseEvent
    pushHistoryEntry(plant, nextTick, timestamp, entryEvent)
  }

  return {
    plants,
    newlyCriticalIds,
    newlyIrreversibleIds,
  }
}

/**
 * Al activar o ejecutar Centinelas, introduce focos emergentes sobre plantas que
 * inicialmente estaban sanas para simular anomalías nuevas y forzar el recálculo de ruta.
 */
export const introduceEmergentAffections = (
  field: ProjectedField,
  plants: SimulatedPlantNode[],
  stressCenters: StressCenter[],
  tick: number,
  options?: {
    maxCenters?: number
    maxNewPlants?: number
    random?: () => number
    timestamp?: string
  }
): {
  newlyAffectedPlantIds: string[]
  addedCenter: StressCenter | null
} => {
  const random = options?.random ?? Math.random
  const timestamp = options?.timestamp ?? new Date().toISOString()
  const maxCenters = options?.maxCenters ?? 8
  const maxNewPlants = options?.maxNewPlants ?? 8

  const healthyCandidates = plants.filter(
    p => p.state === 'saludable' && p.pestStressPercent < 18 && !p.irreversible
  )
  if (healthyCandidates.length === 0) {
    return { newlyAffectedPlantIds: [], addedCenter: null }
  }

  const outsideExisting = healthyCandidates.filter(p =>
    stressCenters.every(center => Math.hypot(p.x - center.x, p.z - center.z) >= center.radius * 1.15)
  )
  const anchorPool = outsideExisting.length > 0 ? outsideExisting : healthyCandidates
  const anchor = anchorPool[Math.floor(random() * anchorPool.length)]

  const minDim = Math.max(8, Math.min(field.widthMeters, field.depthMeters))
  const radius = Number(clamp(minDim * (0.12 + random() * 0.08), 4, 28).toFixed(2))
  const focusType: StressCenter['type'] = stressCenters.length % 2 === 0 ? 'DROUGHT' : 'PEST'

  let addedCenter: StressCenter | null = null
  if (stressCenters.length < maxCenters) {
    addedCenter = {
      id: `SEC-${stressCenters.length + 1}`,
      x: anchor.x,
      z: anchor.z,
      lat: anchor.lat,
      lng: anchor.lng,
      intensity: Number((0.65 + random() * 0.2).toFixed(2)),
      radius,
      type: focusType,
    }
    stressCenters.push(addedCenter)
  }

  const effectiveRadius = Math.max(radius, 3.5)
  const affectedBatch = healthyCandidates
    .map(plant => ({ plant, dist: Math.hypot(plant.x - anchor.x, plant.z - anchor.z) }))
    .filter(item => item.dist <= effectiveRadius || item.plant.id === anchor.id)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, Math.max(1, maxNewPlants))

  const newlyAffectedPlantIds: string[] = []
  for (const { plant } of affectedBatch) {
    if (focusType === 'DROUGHT') {
      plant.waterStressPercent = clamp(24 + random() * 18, 20, 48)
    } else {
      plant.pestStressPercent = clamp(26 + random() * 18, 22, 50)
      plant.waterStressPercent = clamp(Math.max(plant.waterStressPercent, 20) + random() * 8, 20, 38)
    }
    plant.stressedTicks = Math.max(1, plant.stressedTicks + 1)
    syncPlantDerivedMetrics(plant)

    const lastEntry = plant.history[plant.history.length - 1]
    if (lastEntry && lastEntry.tick === tick) {
      plant.history.pop()
    }
    pushHistoryEntry(plant, tick, timestamp, 'sentinel_scan')
    newlyAffectedPlantIds.push(plant.id)
  }

  return { newlyAffectedPlantIds, addedCenter }
}

export const applyTreatmentAtLocation = (
  plants: SimulatedPlantNode[],
  targetPoint: FieldPoint,
  radiusMeters: number,
  action: 'WATER' | 'FUMIGATE',
  tick: number,
  options?: {
    timestamp?: string
    targetPlantIds?: ReadonlyArray<string>
  }
): {
  recoveredCount: number
  irreversibleCount: number
  affectedIds: string[]
} => {
  const timestamp = options?.timestamp ?? new Date().toISOString()
  const targetIdSet = options?.targetPlantIds ? new Set(options.targetPlantIds) : null
  let recoveredCount = 0
  let irreversibleCount = 0
  const affectedIds: string[] = []

  for (const plant of plants) {
    const inRadius = Math.hypot(plant.x - targetPoint.x, plant.z - targetPoint.z) <= radiusMeters
    const inExplicitTargets = targetIdSet?.has(plant.id) ?? false
    if (!inRadius && !inExplicitTargets) continue

    affectedIds.push(plant.id)

    if (plant.irreversible) {
      irreversibleCount++
      syncPlantDerivedMetrics(plant)
      pushHistoryEntry(plant, tick, timestamp, 'irreversible_loss')
      continue
    }

    if (action === 'WATER') {
      plant.waterStressPercent = clamp(plant.waterStressPercent - 72, 6, 100)
      plant.stressedTicks = plant.waterStressPercent < 18 ? 0 : plant.stressedTicks
      syncPlantDerivedMetrics(plant)
      pushHistoryEntry(plant, tick, timestamp, 'irrigation_treatment')
      recoveredCount++
    } else {
      plant.pestStressPercent = clamp(plant.pestStressPercent - 76, 3, 100)
      plant.waterStressPercent = clamp(plant.waterStressPercent - 10, 6, 100)
      plant.stressedTicks = plant.waterStressPercent < 18 ? 0 : plant.stressedTicks
      syncPlantDerivedMetrics(plant)
      pushHistoryEntry(plant, tick, timestamp, 'fumigation_treatment')
      recoveredCount++
    }
  }

  return {
    recoveredCount,
    irreversibleCount,
    affectedIds,
  }
}

export const buildSimulationReport = (params: {
  tick: number
  parcel: ParcelGeometryMetadata
  plants: ReadonlyArray<SimulatedPlantNode>
  droneFlight: DroneFlightPlanMetrics
  generatedAt?: string
}): SimulationReport => {
  const generatedAt = params.generatedAt ?? new Date().toISOString()
  const countsByState: Record<PlantStressState, number> = {
    saludable: 0,
    estrés_leve: 0,
    estrés_moderado: 0,
    estrés_crítico: 0,
    pérdida_irreversible: 0,
  }

  let sumStress = 0
  let sumHealth = 0
  let sumNdvi = 0
  let sumTemp = 0

  const reportPlants = params.plants.map(plant => {
    countsByState[plant.state] += 1
    sumStress += plant.waterStressPercent
    sumHealth += plant.health
    sumNdvi += plant.ndvi
    sumTemp += plant.temp

    return {
      id: plant.id,
      lat: plant.lat,
      lng: plant.lng,
      x: plant.x,
      z: plant.z,
      stage: plant.stage,
      state: plant.state,
      waterStressPercent: Number(plant.waterStressPercent.toFixed(1)),
      pestStressPercent: Number(plant.pestStressPercent.toFixed(1)),
      health: Number(plant.health.toFixed(3)),
      ndvi: Number(plant.ndvi.toFixed(2)),
      tempC: Number(plant.temp.toFixed(1)),
      irreversible: plant.irreversible,
      stressedTicks: plant.stressedTicks,
      history: plant.history.map(entry => ({ ...entry })),
    }
  })

  const total = Math.max(1, params.plants.length)
  return {
    generatedAt,
    tick: params.tick,
    parcel: {
      ...params.parcel,
      vertices: params.parcel.vertices.map(ring => ring.map(v => ({ ...v }))),
    },
    summary: {
      totalPlants: params.plants.length,
      avgWaterStressPercent: Number((sumStress / total).toFixed(1)),
      avgHealthPercent: Number(((sumHealth / total) * 100).toFixed(1)),
      avgNdvi: Number((sumNdvi / total).toFixed(2)),
      avgTempC: Number((sumTemp / total).toFixed(1)),
      countsByState,
    },
    plants: reportPlants,
    droneFlight: {
      ...params.droneFlight,
      waypoints: params.droneFlight.waypoints.map(wp => ({
        ...wp,
        coveredPlantIds: [...wp.coveredPlantIds],
      })),
      orderedCoordinates: params.droneFlight.orderedCoordinates.map(coord => ({ ...coord })),
    },
  }
}
