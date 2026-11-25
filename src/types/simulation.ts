import type { Json } from '../services/agronomyData.ts'

export interface GeoCoordinate {
  lat: number
  lng: number
}

export type PlantStressState =
  | 'saludable'
  | 'estrés_leve'
  | 'estrés_moderado'
  | 'estrés_crítico'
  | 'pérdida_irreversible'

export type PlantStressHistoryEvent =
  | 'initial'
  | 'degradation'
  | 'sentinel_scan'
  | 'irrigation_treatment'
  | 'fumigation_treatment'
  | 'irreversible_loss'

export interface PlantStressHistoryEntry {
  tick: number
  timestamp: string
  waterStressPercent: number
  pestStressPercent: number
  state: PlantStressState
  ndvi: number
  tempC: number
  event: PlantStressHistoryEvent
}

export interface SimulatedPlantNode {
  id: string
  x: number
  z: number
  lat: number
  lng: number
  stage: 1 | 2 | 3
  waterStressPercent: number
  pestStressPercent: number
  state: PlantStressState
  health: number
  ndvi: number
  temp: number
  status: string
  irreversible: boolean
  stressedTicks: number
  history: PlantStressHistoryEntry[]
}

export interface StressCenter {
  id: string
  x: number
  z: number
  lat: number
  lng: number
  intensity: number
  radius: number
  type: 'DROUGHT' | 'OVERHYDRATION' | 'PEST'
}

export interface ParcelGeometryMetadata {
  fieldId: string | null
  fieldName: string
  geojson: Json
  vertices: GeoCoordinate[][]
  vertexCount: number
  areaSquareMeters: number
  areaHectares: number
  perimeterMeters: number
  centroid: GeoCoordinate
  widthMeters: number
  depthMeters: number
}

export type DroneMissionType = 'WATER' | 'FUMIGATE' | 'INSPECT_STRESS'

export interface DroneRouteWaypoint {
  order: number
  id: string
  type: 'base_takeoff' | 'target' | 'base_return'
  x: number
  z: number
  lat: number
  lng: number
  altitudeMeters: number
  severityState?: PlantStressState
  waterStressPercent?: number
  pestStressPercent?: number
  priorityScore: number
  coveredPlantIds: string[]
  distanceFromPreviousMeters: number
  cumulativeDistanceMeters: number
}

export interface DroneFlightPlanMetrics {
  algorithm: 'priority-nn-2opt-tsp'
  missionType: DroneMissionType
  takeoffBase: GeoCoordinate & { x: number; z: number }
  waypoints: DroneRouteWaypoint[]
  orderedCoordinates: GeoCoordinate[]
  targetedPlantCount: number
  skippedHealthyPlantCount: number
  totalDistanceMeters: number
  baselineFullSweepDistanceMeters: number
  distanceSavedMeters: number
  estimatedFlightTimeSeconds: number
  baselineFullSweepTimeSeconds: number
  estimatedBatteryPercent: number
  baselineBatteryPercent: number
  batterySavingsPercent: number
  fuelSavingsPercent: number
}

export interface SimulationPlantReportEntry {
  id: string
  lat: number
  lng: number
  x: number
  z: number
  stage: 1 | 2 | 3
  state: PlantStressState
  waterStressPercent: number
  pestStressPercent: number
  health: number
  ndvi: number
  tempC: number
  irreversible: boolean
  stressedTicks: number
  history: PlantStressHistoryEntry[]
}

export interface SimulationReport {
  generatedAt: string
  tick: number
  parcel: ParcelGeometryMetadata
  summary: {
    totalPlants: number
    avgWaterStressPercent: number
    avgHealthPercent: number
    avgNdvi: number
    avgTempC: number
    countsByState: Record<PlantStressState, number>
  }
  plants: SimulationPlantReportEntry[]
  droneFlight: DroneFlightPlanMetrics
}

export interface SimulationStressTimePoint {
  tick: number
  timestamp: string
  avgWaterStressPercent: number
  maxWaterStressPercent: number
  avgNdvi: number
  avgTempC: number
  healthyCount: number
  affectedCount: number
  criticalOrIrreversibleCount: number
}

export interface ReactiveCostBreakdown {
  currency: 'MXN'
  totalAreaHectares: number
  affectedAreaHectares: number
  affectedAreaSquareMeters: number
  affectedPlantCount: number
  recoverableAffectedCount: number
  criticalPlantCount: number
  irreversiblePlantCount: number
  emergencyIrrigationCost: number
  fertilizersBiostimulantsCost: number
  droneApplicationCost: number
  fieldLaborCost: number
  reactiveTreatmentTotalCost: number
  projectedYieldLossPercent: number
  projectedYieldLossCost: number
  totalReactiveImpactCost: number
  droneFuelSavingsAmount: number
}

export type PreventiveRecommendationCategory =
  | 'riego_zonificado'
  | 'monitoreo_centinelas'
  | 'aplicacion_foliar'
  | 'auditoria_hidraulica'

export interface PreventiveRecommendation {
  id: string
  title: string
  category: PreventiveRecommendationCategory
  priority: 'alta' | 'media' | 'baja'
  triggerReason: string
  targetAreaHectares: number
  implementationCost: number
  avoidedCorrectiveCost: number
  avoidedYieldLoss: number
  projectedNetSavings: number
  roiPercent: number
  actionSteps: string[]
}

export interface SimulationEconomicAnalysis {
  currency: 'MXN'
  cropReferenceValuePerHectare: number
  reactive: ReactiveCostBreakdown
  preventiveRecommendations: PreventiveRecommendation[]
  preventiveTotalCost: number
  totalProjectedGrossAvoidedCost: number
  totalProjectedNetSavings: number
  overallRoiPercent: number
  summaryNote: string
}

export interface ExportedDashboardSimulation {
  id: string
  title: string
  exportedAt: string
  source: 'supabase' | 'local'
  fieldId: string | null
  report: SimulationReport
  stressTimeline: SimulationStressTimePoint[]
  economics: SimulationEconomicAnalysis
}

