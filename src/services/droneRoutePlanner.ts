import {
  computeHorizontalScanlineSegments,
  type FieldPoint,
  type ProjectedField,
} from './fieldGeometry.ts'
import type {
  DroneFlightPlanMetrics,
  DroneMissionType,
  DroneRouteWaypoint,
  PlantStressState,
  SimulatedPlantNode,
} from '../types/simulation.ts'

interface RouteTargetCluster {
  id: string
  x: number
  z: number
  lat: number
  lng: number
  severityState: PlantStressState
  waterStressPercent: number
  pestStressPercent: number
  priorityScore: number
  coveredPlantIds: string[]
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

const dist2d = (a: FieldPoint, b: FieldPoint): number => Math.hypot(b.x - a.x, b.z - a.z)

const computePriorityScore = (
  plant: SimulatedPlantNode,
  missionType: DroneMissionType
): number => {
  if (missionType === 'FUMIGATE') {
    return 1.5 + (plant.pestStressPercent / 100) * 3.0 + (plant.waterStressPercent / 100) * 0.4
  }
  switch (plant.state) {
    case 'estrés_crítico':
      return 4.0 + plant.waterStressPercent / 100
    case 'estrés_moderado':
      return 2.6 + plant.waterStressPercent / 100
    case 'estrés_leve':
      return 1.5 + plant.waterStressPercent / 100
    case 'pérdida_irreversible':
      return 1.15
    default:
      return 1.0 + plant.pestStressPercent / 100
  }
}

export const computeFullParcelSweepBaseline = (
  field: ProjectedField,
  basePoint: FieldPoint,
  options?: {
    swathWidthMeters?: number
    cruiseSpeedMps?: number
    turnPenaltySeconds?: number
    batteryCapacityWh?: number
    cruisePowerW?: number
  }
): {
  distanceMeters: number
  flightTimeSeconds: number
  batteryPercent: number
  passCount: number
} => {
  const minDim = Math.max(8, Math.min(field.widthMeters, field.depthMeters))
  const swath = options?.swathWidthMeters ?? clamp(minDim / 11, 3.8, 12)
  const cruiseSpeed = options?.cruiseSpeedMps ?? 7.5
  const turnPenalty = options?.turnPenaltySeconds ?? 2.2
  const batteryWh = options?.batteryCapacityWh ?? 95
  const cruisePowerW = options?.cruisePowerW ?? 340

  const zStart = field.bounds.minZ + swath * 0.45
  const zEnd = field.bounds.maxZ - swath * 0.25

  const pathPoints: FieldPoint[] = [basePoint]
  let leftToRight = true
  let passCount = 0

  for (let z = zStart; z <= zEnd + 1e-3; z += swath) {
    const segments = computeHorizontalScanlineSegments(z, field)
    if (segments.length === 0) continue
    passCount++
    const orderedSegments = leftToRight ? segments : [...segments].reverse()
    for (const [segStart, segEnd] of orderedSegments) {
      if (leftToRight) {
        pathPoints.push({ x: segStart, z }, { x: segEnd, z })
      } else {
        pathPoints.push({ x: segEnd, z }, { x: segStart, z })
      }
    }
    leftToRight = !leftToRight
  }

  // Fallback si la parcela es extremadamente pequeña comparada con swath
  if (passCount === 0) {
    pathPoints.push(
      { x: field.bounds.minX, z: field.centroidLocal.z },
      { x: field.bounds.maxX, z: field.centroidLocal.z }
    )
    passCount = 1
  }

  pathPoints.push(basePoint)

  let distanceMeters = 0
  for (let i = 1; i < pathPoints.length; i++) {
    distanceMeters += dist2d(pathPoints[i - 1], pathPoints[i])
  }

  const flightTimeSeconds = distanceMeters / cruiseSpeed + Math.max(0, passCount - 1) * turnPenalty
  const energyWh = (flightTimeSeconds / 3600) * cruisePowerW
  const batteryPercent = clamp((energyWh / batteryWh) * 100, 0.2, 100)

  return {
    distanceMeters: Number(distanceMeters.toFixed(2)),
    flightTimeSeconds: Number(flightTimeSeconds.toFixed(1)),
    batteryPercent: Number(batteryPercent.toFixed(2)),
    passCount,
  }
}

const selectTargetPlantsForMission = (
  plants: ReadonlyArray<SimulatedPlantNode>,
  missionType: DroneMissionType
): SimulatedPlantNode[] => {
  if (missionType === 'WATER') {
    return plants.filter(p => p.waterStressPercent >= 18 && !p.irreversible)
  }
  if (missionType === 'FUMIGATE') {
    return plants.filter(p => p.pestStressPercent >= 18 && !p.irreversible)
  }
  return plants.filter(p => p.state !== 'saludable' || p.pestStressPercent >= 18)
}

const clusterTargetPlants = (
  targets: ReadonlyArray<SimulatedPlantNode>,
  missionType: DroneMissionType,
  clusterRadius: number
): RouteTargetCluster[] => {
  if (targets.length === 0) return []

  const sortedBySeverity = [...targets].sort(
    (a, b) => computePriorityScore(b, missionType) - computePriorityScore(a, missionType)
  )

  // Si hay pocas plantas afectadas, visitarlas individualmente para precisión máxima
  if (sortedBySeverity.length <= 16 || clusterRadius <= 0.5) {
    return sortedBySeverity.map((plant, idx) => ({
      id: `WP-${idx + 1}-${plant.id}`,
      x: plant.x,
      z: plant.z,
      lat: plant.lat,
      lng: plant.lng,
      severityState: plant.state,
      waterStressPercent: plant.waterStressPercent,
      pestStressPercent: plant.pestStressPercent,
      priorityScore: Number(computePriorityScore(plant, missionType).toFixed(2)),
      coveredPlantIds: [plant.id],
    }))
  }

  const assigned = new Set<string>()
  const clusters: RouteTargetCluster[] = []

  for (const anchor of sortedBySeverity) {
    if (assigned.has(anchor.id)) continue
    assigned.add(anchor.id)

    const coveredIds = [anchor.id]
    let maxWater = anchor.waterStressPercent
    let maxPest = anchor.pestStressPercent
    let maxPriority = computePriorityScore(anchor, missionType)
    let worstState = anchor.state

    for (const candidate of sortedBySeverity) {
      if (assigned.has(candidate.id)) continue
      if (dist2d(anchor, candidate) <= clusterRadius) {
        assigned.add(candidate.id)
        coveredIds.push(candidate.id)
        maxWater = Math.max(maxWater, candidate.waterStressPercent)
        maxPest = Math.max(maxPest, candidate.pestStressPercent)
        const candPriority = computePriorityScore(candidate, missionType)
        if (candPriority > maxPriority) {
          maxPriority = candPriority
          worstState = candidate.state
        }
      }
    }

    clusters.push({
      id: `WP-${clusters.length + 1}-${anchor.id}`,
      x: anchor.x,
      z: anchor.z,
      lat: anchor.lat,
      lng: anchor.lng,
      severityState: worstState,
      waterStressPercent: Number(maxWater.toFixed(1)),
      pestStressPercent: Number(maxPest.toFixed(1)),
      priorityScore: Number(maxPriority.toFixed(2)),
      coveredPlantIds: coveredIds,
    })
  }

  return clusters
}

const evaluateTourCost = (
  order: ReadonlyArray<number>,
  nodes: ReadonlyArray<RouteTargetCluster>,
  basePoint: FieldPoint
): { euclideanDistance: number; weightedCost: number } => {
  if (order.length === 0) return { euclideanDistance: 0, weightedCost: 0 }

  let cumDist = 0
  let weightedPenalty = 0
  let prev: FieldPoint = basePoint

  for (const idx of order) {
    const node = nodes[idx]
    cumDist += dist2d(prev, node)
    weightedPenalty += cumDist * node.priorityScore
    prev = node
  }

  const returnDist = dist2d(prev, basePoint)
  const totalDist = cumDist + returnDist
  return {
    euclideanDistance: totalDist,
    weightedCost: totalDist + 0.08 * weightedPenalty,
  }
}

const optimizeOrderWithPriorityTwoOpt = (
  nodes: ReadonlyArray<RouteTargetCluster>,
  basePoint: FieldPoint
): number[] => {
  const n = nodes.length
  if (n <= 1) return n === 1 ? [0] : []

  // 1. Construcción voraz ponderada por distancia y prioridad de severidad (heurística A* / NN ponderada)
  const unvisited = new Set<number>(Array.from({ length: n }, (_, i) => i))
  const order: number[] = []
  let currentPos: FieldPoint = basePoint

  while (unvisited.size > 0) {
    let bestIdx = -1
    let bestScore = Infinity

    for (const candidateIdx of unvisited) {
      const node = nodes[candidateIdx]
      const d = dist2d(currentPos, node)
      const effectiveCost = d / (1 + 0.55 * node.priorityScore)
      if (effectiveCost < bestScore) {
        bestScore = effectiveCost
        bestIdx = candidateIdx
      }
    }

    if (bestIdx === -1) break
    unvisited.delete(bestIdx)
    order.push(bestIdx)
    currentPos = nodes[bestIdx]
  }

  if (n === 2) {
    const rev = [order[1], order[0]]
    return evaluateTourCost(rev, nodes, basePoint).weightedCost <
      evaluateTourCost(order, nodes, basePoint).weightedCost
      ? rev
      : order
  }

  // 2. Búsqueda local 2-opt para eliminar cruces y minimizar distancia + penalización por prioridad tardía
  let currentCost = evaluateTourCost(order, nodes, basePoint).weightedCost
  const reversedFull = [...order].reverse()
  const reversedCost = evaluateTourCost(reversedFull, nodes, basePoint).weightedCost
  let bestOrder = reversedCost < currentCost ? reversedFull : order
  if (reversedCost < currentCost) currentCost = reversedCost

  let improved = true
  let iteration = 0
  const maxIterations = 80

  while (improved && iteration < maxIterations) {
    improved = false
    iteration++

    for (let i = 0; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        const candidate = [
          ...bestOrder.slice(0, i),
          ...bestOrder.slice(i, j + 1).reverse(),
          ...bestOrder.slice(j + 1),
        ]
        const candidateCost = evaluateTourCost(candidate, nodes, basePoint).weightedCost
        if (candidateCost + 1e-6 < currentCost) {
          bestOrder = candidate
          currentCost = candidateCost
          improved = true
        }
      }
    }
  }

  return bestOrder
}

export const planOptimizedDroneRoute = (params: {
  field: ProjectedField
  basePoint: FieldPoint
  plants: ReadonlyArray<SimulatedPlantNode>
  missionType?: DroneMissionType
  swathWidthMeters?: number
  cruiseSpeedMps?: number
  serviceTimePerWaypointSec?: number
  altitudeMeters?: number
  batteryCapacityWh?: number
  cruisePowerW?: number
  hoverPowerW?: number
}): DroneFlightPlanMetrics => {
  const missionType = params.missionType ?? 'INSPECT_STRESS'
  const minDim = Math.max(8, Math.min(params.field.widthMeters, params.field.depthMeters))
  const swathWidth = params.swathWidthMeters ?? clamp(minDim / 11, 3.8, 12)
  const cruiseSpeed = params.cruiseSpeedMps ?? 7.5
  const serviceTime = params.serviceTimePerWaypointSec ?? 3.5
  const altitudeMeters = params.altitudeMeters ?? 8
  const batteryWh = params.batteryCapacityWh ?? 95
  const cruisePowerW = params.cruisePowerW ?? 340
  const hoverPowerW = params.hoverPowerW ?? 290

  const baseline = computeFullParcelSweepBaseline(params.field, params.basePoint, {
    swathWidthMeters: swathWidth,
    cruiseSpeedMps: cruiseSpeed,
    batteryCapacityWh: batteryWh,
    cruisePowerW,
  })

  const baseGeo = params.field.unprojectPoint(params.basePoint.x, params.basePoint.z)
  const takeoffBase = {
    x: Number(params.basePoint.x.toFixed(3)),
    z: Number(params.basePoint.z.toFixed(3)),
    lat: baseGeo.lat,
    lng: baseGeo.lng,
  }

  const targetPlants = selectTargetPlantsForMission(params.plants, missionType)
  const skippedHealthyPlantCount = Math.max(0, params.plants.length - targetPlants.length)

  if (targetPlants.length === 0) {
    const stationaryWaypoint: DroneRouteWaypoint = {
      order: 0,
      id: 'BASE-TAKEOFF',
      type: 'base_takeoff',
      x: takeoffBase.x,
      z: takeoffBase.z,
      lat: takeoffBase.lat,
      lng: takeoffBase.lng,
      altitudeMeters: 0.5,
      priorityScore: 0,
      coveredPlantIds: [],
      distanceFromPreviousMeters: 0,
      cumulativeDistanceMeters: 0,
    }

    return {
      algorithm: 'priority-nn-2opt-tsp',
      missionType,
      takeoffBase,
      waypoints: [stationaryWaypoint],
      orderedCoordinates: [{ lat: takeoffBase.lat, lng: takeoffBase.lng }],
      targetedPlantCount: 0,
      skippedHealthyPlantCount,
      totalDistanceMeters: 0,
      baselineFullSweepDistanceMeters: baseline.distanceMeters,
      distanceSavedMeters: baseline.distanceMeters,
      estimatedFlightTimeSeconds: 0,
      baselineFullSweepTimeSeconds: baseline.flightTimeSeconds,
      estimatedBatteryPercent: 0,
      baselineBatteryPercent: baseline.batteryPercent,
      batterySavingsPercent: 100,
      fuelSavingsPercent: 100,
    }
  }

  const clusters = clusterTargetPlants(targetPlants, missionType, swathWidth * 0.58)
  const optimizedOrder = optimizeOrderWithPriorityTwoOpt(clusters, params.basePoint)

  const waypoints: DroneRouteWaypoint[] = []
  let cumulativeDistance = 0
  let prevPoint: FieldPoint = takeoffBase

  waypoints.push({
    order: 0,
    id: 'BASE-TAKEOFF',
    type: 'base_takeoff',
    x: takeoffBase.x,
    z: takeoffBase.z,
    lat: takeoffBase.lat,
    lng: takeoffBase.lng,
    altitudeMeters: 0.5,
    priorityScore: 0,
    coveredPlantIds: [],
    distanceFromPreviousMeters: 0,
    cumulativeDistanceMeters: 0,
  })

  optimizedOrder.forEach((clusterIdx, stepIdx) => {
    const cluster = clusters[clusterIdx]
    const legDist = dist2d(prevPoint, cluster)
    cumulativeDistance += legDist
    prevPoint = cluster

    waypoints.push({
      order: stepIdx + 1,
      id: cluster.id,
      type: 'target',
      x: cluster.x,
      z: cluster.z,
      lat: cluster.lat,
      lng: cluster.lng,
      altitudeMeters,
      severityState: cluster.severityState,
      waterStressPercent: cluster.waterStressPercent,
      pestStressPercent: cluster.pestStressPercent,
      priorityScore: cluster.priorityScore,
      coveredPlantIds: cluster.coveredPlantIds,
      distanceFromPreviousMeters: Number(legDist.toFixed(2)),
      cumulativeDistanceMeters: Number(cumulativeDistance.toFixed(2)),
    })
  })

  const returnDist = dist2d(prevPoint, takeoffBase)
  cumulativeDistance += returnDist
  waypoints.push({
    order: waypoints.length,
    id: 'BASE-RETURN',
    type: 'base_return',
    x: takeoffBase.x,
    z: takeoffBase.z,
    lat: takeoffBase.lat,
    lng: takeoffBase.lng,
    altitudeMeters: 0.5,
    priorityScore: 0,
    coveredPlantIds: [],
    distanceFromPreviousMeters: Number(returnDist.toFixed(2)),
    cumulativeDistanceMeters: Number(cumulativeDistance.toFixed(2)),
  })

  const totalDistanceMeters = Number(cumulativeDistance.toFixed(2))
  const flightOnlyTimeSec = totalDistanceMeters / cruiseSpeed
  const hoverTotalTimeSec = clusters.length * serviceTime
  const estimatedFlightTimeSeconds = Number((flightOnlyTimeSec + hoverTotalTimeSec).toFixed(1))

  const energyUsedWh =
    (flightOnlyTimeSec / 3600) * cruisePowerW + (hoverTotalTimeSec / 3600) * hoverPowerW
  const estimatedBatteryPercent = Number(clamp((energyUsedWh / batteryWh) * 100, 0.1, 100).toFixed(2))

  const distanceSavedMeters = Number(
    Math.max(0, baseline.distanceMeters - totalDistanceMeters).toFixed(2)
  )
  const rawBatterySavings =
    baseline.batteryPercent > 0
      ? ((baseline.batteryPercent - estimatedBatteryPercent) / baseline.batteryPercent) * 100
      : 0
  const batterySavingsPercent = Number(clamp(rawBatterySavings, 0, 99.5).toFixed(1))

  return {
    algorithm: 'priority-nn-2opt-tsp',
    missionType,
    takeoffBase,
    waypoints,
    orderedCoordinates: waypoints.map(wp => ({ lat: wp.lat, lng: wp.lng })),
    targetedPlantCount: targetPlants.length,
    skippedHealthyPlantCount,
    totalDistanceMeters,
    baselineFullSweepDistanceMeters: baseline.distanceMeters,
    distanceSavedMeters,
    estimatedFlightTimeSeconds,
    baselineFullSweepTimeSeconds: baseline.flightTimeSeconds,
    estimatedBatteryPercent,
    baselineBatteryPercent: baseline.batteryPercent,
    batterySavingsPercent,
    fuelSavingsPercent: batterySavingsPercent,
  }
}
