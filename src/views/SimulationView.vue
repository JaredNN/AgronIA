<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount, shallowRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { BarChart3, Cpu, Download, EyeOff, FastForward, FileJson, LocateFixed, Maximize2, Minimize2, Move, Pause, Play, RotateCw, Route, Wind } from 'lucide-vue-next'
import DroneConnectionPanel from '../components/simulation/DroneConnectionPanel.vue'
import { useParcelSimulationStore } from '../stores/parcelSimulation'
import { calculateSimulationEconomics, extractStressTimeline } from '../services/simulationEconomics'
import {
  detectHardwareGpuModel,
  graphicsQuality,
  setGraphicsQuality,
  type GraphicsQualityPreset,
} from '../services/desktopRuntime'
import {
  createAlert,
  createSimulation,
  listFields,
  saveFieldMetric,
  type FieldRecord,
  type Json,
} from '../services/agronomyData'
import {
  computeHorizontalScanlineSegments,
  computeTakeoffBaseForField,
  DEFAULT_DEMO_PARCEL_GEOJSON,
  extractParcelMetadata,
  projectFieldGeometry,
  type FieldPoint,
  type ProjectedField,
} from '../services/fieldGeometry'
import {
  advanceSimulationTick,
  applyTreatmentAtLocation,
  buildSimulationReport,
  createInitialSimulatedPlants,
  introduceEmergentAffections,
  seedStressCentersInsideField,
  STRESS_STATE_LABELS,
} from '../services/simulationEngine'
import { buildFullFieldScanWaypoints, planOptimizedDroneRoute } from '../services/droneRoutePlanner'
import { buildAgriculturalSurroundings, computeValleyMetrics } from '../services/simulationEnvironment'
import type {
  DroneFlightPlanMetrics,
  DroneMissionType,
  DroneRouteWaypoint,
  ParcelGeometryMetadata,
  PlantStressHistoryEvent,
  SimulatedPlantNode,
  SimulationReport,
  StressCenter,
} from '../types/simulation'

const parcelSimStore = useParcelSimulationStore()
const route = useRoute()
const router = useRouter()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const containerRef = ref<HTMLDivElement | null>(null)
const fields = shallowRef<FieldRecord[]>([])
const selectedFieldGeometry = shallowRef<ProjectedField | null>(null)
const activeParcelMetadata = shallowRef<ParcelGeometryMetadata | null>(null)
const selectedFieldId = ref('')
const savingSnapshot = ref(false)
const exportingToDashboard = ref(false)
const simulationTick = ref(0)
const currentFlightPlan = shallowRef<DroneFlightPlanMetrics | null>(null)
const currentReport = shallowRef<SimulationReport | null>(null)
const liveDrone = ref<{
  connected: boolean
  hasHeartbeat: boolean
  armed: boolean | null
  latitude: number | null
  longitude: number | null
  altitude: number | null
  relativeAltitude: number | null
  groundSpeed: number | null
  heading: number | null
}>({
  connected: false,
  hasHeartbeat: false,
  armed: null,
  latitude: null,
  longitude: null,
  altitude: null,
  relativeAltitude: null,
  groundSpeed: null,
  heading: null,
})
const SPEED_OPTIONS = [1, 2, 4, 8] as const
type SimulationSpeedMultiplier = (typeof SPEED_OPTIONS)[number]

const currentMode = ref<'rgb' | 'ndvi' | 'thermal'>('rgb')
const droneState = ref<'IDLE' | 'SCANNING' | 'FLYING' | 'ACTION' | 'RETURNING' | 'CENTINELAS'>('IDLE')
const currentAction = ref<'NONE' | 'WATER' | 'FUMIGATE' | 'CENTINELAS'>('NONE')
const simulationPaused = ref(false)
const hasAnalyzedCrop = ref(false)
const simulationSpeed = ref<SimulationSpeedMultiplier>(1)
const showDroneRoute = ref(true)
const windEnabled = ref(true)
const cameraFollowEnabled = ref(true)
const cameraPanMode = ref(false)
const isFullscreen = ref(false)
const liveFps = ref(60)
const frameTimeMs = ref(16.6)
const gpuRendererName = ref(detectHardwareGpuModel())
let mainDirLight: THREE.DirectionalLight | null = null
let pointerDirty = true

// Datos de interacción (panel fijo de inspección en la columna izquierda)
const hoveredPlant = ref<SimulatedPlantNode | null>(null)
const lastInspectedPlant = ref<SimulatedPlantNode | null>(null)
const inspectedPlant = computed(() => hoveredPlant.value ?? lastInspectedPlant.value)
const hoveredSector = ref<StressCenter | null>(null)
const actionFeedback = ref('')

// Three.js variables
const scene = shallowRef<THREE.Scene | null>(null)
const renderer = shallowRef<THREE.WebGLRenderer | null>(null)
const camera = shallowRef<THREE.PerspectiveCamera | null>(null)
const controls = shallowRef<OrbitControls | null>(null)
const resizeObserver = shallowRef<ResizeObserver | null>(null)
const raycaster = shallowRef<THREE.Raycaster | null>(null)
const mouse = shallowRef<THREE.Vector2 | null>(null)
const animationId = ref<number>(0)

// Data arrays para InstancedMesh
let allPlants: SimulatedPlantNode[] = []
let leafToPlantMap: number[] = []; let tasselToPlantMap: number[] = []; let earToPlantMap: number[] = []

// Instanced Meshes & Grupos por parcela
let trunkMesh: THREE.InstancedMesh | null = null
let leafMesh: THREE.InstancedMesh | null = null
let tasselMesh: THREE.InstancedMesh | null = null
let earMesh: THREE.InstancedMesh | null = null
let hitboxMesh: THREE.InstancedMesh | null = null
let groundMesh: THREE.Mesh | null = null
let groundMaterial: THREE.MeshLambertMaterial
let parcelSurfaceMaterial: THREE.MeshLambertMaterial | null = null
let cropGroup: THREE.Group | null = null
let parcelSurfaceGroup: THREE.Group | null = null
let parcelOutlineGroup: THREE.Group | null = null
let furrowsGroup: THREE.Group | null = null
let routeVisualGroup: THREE.Group | null = null
let surroundingsGroup: THREE.Group | null = null
let leafWindUniform: { value: number } | null = null
let leafWindStrengthUniform: { value: number } | null = null
let sectorFalloffTexture: THREE.CanvasTexture | null = null
let simulationTime = 0
let tickAccumulatorSec = 0

// Dron y Analisis
let stressCenters: StressCenter[] = []
let droneGroup: THREE.Group
let droneGroupReady = false
let liveDroneGroup: THREE.Group | null = null
let liveDroneTrail: THREE.Line | null = null
let liveDronePath: FieldPoint[] = []
let fallbackGpsOrigin: { latitude: number; longitude: number } | null = null
let pendingDroneSnapshot: typeof liveDrone.value | null = null
let lastDroneMetricSavedAt = 0
let propellers: THREE.Mesh[] = []
let sectorMarkers: THREE.Mesh[] = []
const discoveredCenterIds = new Set<string>()
let particleSystem: THREE.Points
let particleGeo: THREE.BufferGeometry
let activeWaypoints: DroneRouteWaypoint[] = []
let activeMissionPlan: DroneFlightPlanMetrics | null = null
let activeTargetIndex = 0
let missionRecoveredCount = 0
let missionIrreversibleCount = 0

let dronePath: THREE.Vector3[] = []
let currentPathIndex = 0
let feedbackTimeout: ReturnType<typeof setTimeout> | undefined

// Enjambre de Centinelas
let centinelaGroup: THREE.Group | null = null
let centinelaPropellers: THREE.Mesh[] = []

const DRONE_BASE = new THREE.Vector3(-15, 0.5, 15)
let FLIGHT_HEIGHT = 8
let currentDroneSpeedMetersPerSec = 16
const droneStepTemp = new THREE.Vector3()
const PARTICLE_COUNT = 500
const particlePositions = new Float32Array(PARTICLE_COUNT * 3)
const particleVelocities = new Float32Array(PARTICLE_COUNT * 3)

const modes = [
  { id: 'rgb', name: 'RGB', color: 'bg-green-500' },
  { id: 'ndvi', name: 'Multiespectral', color: 'bg-red-500' },
  { id: 'thermal', name: 'Térmico', color: 'bg-orange-500' }
] as const

// Telemetría en tiempo real derivada de la simulación
const telemetry = ref({
  avgHealth: 0,
  avgWaterStress: 0,
  avgHumidity: 0,
  avgPestIndex: 0,
  avgNDVI: 0,
  avgTemp: 0,
  plantCount: 0,
  stressZones: 0,
  healthyCount: 0,
  mildCount: 0,
  moderateCount: 0,
  criticalCount: 0,
  irreversibleCount: 0,
})

const fieldDimensionsLabel = computed(() => {
  const field = selectedFieldGeometry.value
  if (!field) return ''
  return `${field.widthMeters.toFixed(1)} m × ${field.depthMeters.toFixed(1)} m · ${field.areaHectares.toFixed(2)} ha · ${field.vertexCount} vértices`
})

const cropPrecautions = computed<string[]>(() => {
  if (!hasAnalyzedCrop.value) return []
  const items: string[] = []
  const affectedCount =
    telemetry.value.mildCount +
    telemetry.value.moderateCount +
    telemetry.value.criticalCount +
    telemetry.value.irreversibleCount
  const recoverableDrought = allPlants.filter(p => p.waterStressPercent >= 18 && !p.irreversible).length
  const recoverablePest = allPlants.filter(p => p.pestStressPercent >= 18 && !p.irreversible).length

  if (telemetry.value.criticalCount > 0) {
    items.push(
      `Priorizar ${telemetry.value.criticalCount} planta(s) críticas antes de que pasen a pérdida irreversible.`
    )
  }
  if (recoverableDrought > 0) {
    items.push(
      `Aplicar "Regar" sobre ${recoverableDrought} planta(s) con estrés hídrico siguiendo la ruta TSP optimizada.`
    )
  }
  if (recoverablePest > 0) {
    items.push(
      `Ejecutar "Fumigar" focalizado en ${recoverablePest} planta(s) con indicios de plaga.`
    )
  }
  if (telemetry.value.irreversibleCount > 0) {
    items.push(
      `Aislar ${telemetry.value.irreversibleCount} planta(s) irreversibles para no desperdiciar agua ni insumos.`
    )
  }
  if (items.length === 0 && affectedCount === 0) {
    items.push('Cultivo estable. Mantén Centinelas activos para detectar anomalías tempranas.')
  }
  return items
})

const activeFieldGeojsonAndName = (): { geojson: Json; name: string; fieldId: string | null } => {
  const field = fields.value.find(item => item.id === selectedFieldId.value)
  if (field?.geojson_data && projectFieldGeometry(field.geojson_data)) {
    return { geojson: field.geojson_data, name: field.name, fieldId: field.id }
  }
  const fallbackStoreMeta = parcelSimStore.activeParcelGeometry
  if (fallbackStoreMeta && projectFieldGeometry(fallbackStoreMeta.geojson)) {
    return {
      geojson: fallbackStoreMeta.geojson,
      name: fallbackStoreMeta.fieldName,
      fieldId: fallbackStoreMeta.fieldId,
    }
  }
  return {
    geojson: DEFAULT_DEMO_PARCEL_GEOJSON,
    name: 'Parcela Demostrativa AgronIA',
    fieldId: field?.id ?? null,
  }
}

const disposeGroupChildren = (group: THREE.Group) => {
  for (const child of [...group.children]) {
    group.remove(child)
    if (child instanceof THREE.Group) {
      disposeGroupChildren(child)
    } else if (
      child instanceof THREE.Mesh ||
      child instanceof THREE.Line ||
      child instanceof THREE.LineSegments ||
      child instanceof THREE.InstancedMesh
    ) {
      child.geometry.dispose()
      const materials = Array.isArray(child.material) ? child.material : [child.material]
      materials.forEach(material => material.dispose())
    }
  }
}

const applySceneFog = (projected: ProjectedField | null) => {
  if (!scene.value) return
  if (graphicsQuality.value === 'performance') {
    scene.value.fog = null
    return
  }
  if (projected) {
    const valley = computeValleyMetrics(projected)
    scene.value.fog = new THREE.Fog(
      0xa8cad9,
      valley.innerMountainRadius * 0.85,
      valley.outerMountainRadius * 1.48
    )
  } else {
    scene.value.fog = new THREE.Fog(0xa8cad9, 130, 520)
  }
}

const moveDroneToward = (
  current: THREE.Vector3,
  target: THREE.Vector3,
  speedMetersPerSec: number,
  stepSec: number
): number => {
  const distance = current.distanceTo(target)
  if (distance <= 1e-5) {
    current.copy(target)
    return 0
  }
  const maxStep = speedMetersPerSec * stepSec
  if (maxStep >= distance) {
    current.copy(target)
    return 0
  }
  droneStepTemp.subVectors(target, current)
  current.addScaledVector(droneStepTemp, maxStep / distance)
  return distance - maxStep
}

const clearLiveDroneTrail = () => {
  if (!liveDroneTrail) return
  scene.value?.remove(liveDroneTrail)
  liveDroneTrail.geometry.dispose()
  const materials = Array.isArray(liveDroneTrail.material) ? liveDroneTrail.material : [liveDroneTrail.material]
  materials.forEach(material => material.dispose())
  liveDroneTrail = null
}

const frameCameraOnField = () => {
  if (!camera.value || !controls.value) return

  const geometry = selectedFieldGeometry.value
  controls.value.target.set(0, 0, 0)
  if (!geometry) {
    camera.value.position.set(0, 29, 42)
    controls.value.minDistance = 3
    controls.value.maxDistance = 240
    camera.value.far = 2400
    camera.value.updateProjectionMatrix()
  } else {
    const valley = computeValleyMetrics(geometry)
    const fieldRadius = valley.fieldRadius
    const aspect = Math.max(camera.value.aspect, 0.01)
    const halfVerticalFov = THREE.MathUtils.degToRad(camera.value.fov / 2)
    const halfFitFov = Math.atan(Math.tan(halfVerticalFov) * Math.min(aspect, 1))
    const distance = fieldRadius / Math.sin(halfFitFov) * 1.2
    camera.value.position.set(0, distance * 0.58, distance * 0.82)
    controls.value.minDistance = 3
    controls.value.maxDistance = Math.max(160, distance * 2.2, valley.innerMountainRadius * 0.92)
    camera.value.far = Math.max(2400, valley.outerMountainRadius * 3.5)
    camera.value.updateProjectionMatrix()
  }
  controls.value.update()
}

const createParcelPolygonMesh = (projected: ProjectedField): THREE.Mesh[] => {
  const meshes: THREE.Mesh[] = []
  const texture = createSoilTexture()
  texture.anisotropy = renderer.value?.capabilities.getMaxAnisotropy() || 8
  if (parcelSurfaceMaterial) parcelSurfaceMaterial.dispose()
  parcelSurfaceMaterial = new THREE.MeshLambertMaterial({
    color: currentMode.value === 'rgb' ? 0xebd0b0 : currentMode.value === 'ndvi' ? 0x1e40af : 0x450a0a,
    map: texture,
    side: THREE.DoubleSide,
  })

  for (const polygon of projected.polygons) {
    const [exterior, ...holes] = polygon.rings
    if (!exterior || exterior.length < 3) continue

    const outerPts = exterior.map(p => new THREE.Vector2(p.x, -p.z))
    if (THREE.ShapeUtils.isClockWise(outerPts)) {
      outerPts.reverse()
    }
    const shape = new THREE.Shape(outerPts)

    for (const hole of holes) {
      if (hole.length < 3) continue
      const holePts = hole.map(p => new THREE.Vector2(p.x, -p.z))
      if (!THREE.ShapeUtils.isClockWise(holePts)) {
        holePts.reverse()
      }
      shape.holes.push(new THREE.Path(holePts))
    }

    const shapeGeo = new THREE.ShapeGeometry(shape, 1)
    const uvAttr = shapeGeo.attributes.uv
    const posAttr = shapeGeo.attributes.position
    for (let i = 0; i < posAttr.count; i++) {
      uvAttr.setXY(i, posAttr.getX(i) / 14, -posAttr.getY(i) / 14)
    }
    uvAttr.needsUpdate = true
    shapeGeo.rotateX(-Math.PI / 2)

    const mesh = new THREE.Mesh(shapeGeo, parcelSurfaceMaterial)
    mesh.position.y = 0.02
    mesh.receiveShadow = true
    meshes.push(mesh)
  }

  return meshes
}

const renderOptimizedRoute3D = (plan: DroneFlightPlanMetrics) => {
  if (!routeVisualGroup) return
  disposeGroupChildren(routeVisualGroup)
  routeVisualGroup.visible = showDroneRoute.value

  const targetWaypoints = plan.waypoints.filter(wp => wp.type === 'target')
  if (targetWaypoints.length === 0) return

  const routeColor =
    plan.missionType === 'FUMIGATE'
      ? 0x34d399
      : plan.missionType === 'WATER'
        ? 0x38bdf8
        : 0xfacc15

  const pathPoints = plan.waypoints.map(wp =>
    new THREE.Vector3(
      wp.x,
      wp.type === 'target' ? wp.altitudeMeters + 0.35 : 0.7,
      wp.z
    )
  )
  const routeLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(pathPoints),
    new THREE.LineBasicMaterial({ color: routeColor, transparent: true, opacity: 0.92 })
  )
  routeLine.renderOrder = 4
  routeVisualGroup.add(routeLine)

  const markerScale = Math.max(0.7, Math.min(2.6, Math.max(selectedFieldGeometry.value?.widthMeters ?? 40, selectedFieldGeometry.value?.depthMeters ?? 40) / 55))
  const pinMat = new THREE.LineBasicMaterial({ color: routeColor, transparent: true, opacity: 0.55 })

  targetWaypoints.forEach(wp => {
    const severityColor =
      wp.severityState === 'estrés_crítico' || wp.severityState === 'pérdida_irreversible'
        ? 0xef4444
        : wp.severityState === 'estrés_moderado'
          ? 0xf97316
          : 0xeab308

    const ringGeo = new THREE.RingGeometry(0.65 * markerScale, 1.05 * markerScale, 20)
    ringGeo.rotateX(-Math.PI / 2)
    const ring = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({ color: severityColor, side: THREE.DoubleSide, transparent: true, opacity: 0.88 })
    )
    ring.position.set(wp.x, 0.14, wp.z)
    routeVisualGroup?.add(ring)

    const dropGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(wp.x, 0.15, wp.z),
      new THREE.Vector3(wp.x, wp.altitudeMeters + 0.35, wp.z),
    ])
    routeVisualGroup?.add(new THREE.Line(dropGeo, pinMat.clone()))
  })
}

const refreshRouteAndReport = (missionType: DroneMissionType = 'INSPECT_STRESS', redrawRoute = true) => {
  const projected = selectedFieldGeometry.value
  const meta = activeParcelMetadata.value
  if (!projected || !meta) return

  const plan = planOptimizedDroneRoute({
    field: projected,
    basePoint: { x: DRONE_BASE.x, z: DRONE_BASE.z },
    plants: allPlants,
    missionType,
    altitudeMeters: FLIGHT_HEIGHT,
  })
  currentFlightPlan.value = plan
  if (redrawRoute) {
    renderOptimizedRoute3D(plan)
  }

  const report = buildSimulationReport({
    tick: simulationTick.value,
    parcel: meta,
    plants: allPlants,
    droneFlight: plan,
  })
  currentReport.value = report
  parcelSimStore.setSimulationReport(report)
}

const rebuildParcelScene = (regenerateCenters = true) => {
  const { geojson, name, fieldId } = activeFieldGeojsonAndName()
  const projected = projectFieldGeometry(geojson)
  if (!projected) return

  // Reinicia al estado inicial limpio sin trazar ruta hasta que se analice el cultivo
  hasAnalyzedCrop.value = false
  droneState.value = 'IDLE'
  currentAction.value = 'NONE'
  simulationPaused.value = false
  simulationTick.value = 0
  tickAccumulatorSec = 0
  dronePath = []
  currentPathIndex = 0
  activeWaypoints = []
  activeMissionPlan = null
  discoveredCenterIds.clear()
  currentFlightPlan.value = null
  currentReport.value = null
  if (particleSystem) particleSystem.visible = false

  const meta = extractParcelMetadata(geojson, fieldId, name)
  selectedFieldGeometry.value = projected
  activeParcelMetadata.value = meta
  parcelSimStore.setActiveParcelGeometry(meta)

  const baseInfo = computeTakeoffBaseForField(projected)
  DRONE_BASE.set(baseInfo.x, 0.5, baseInfo.z)
  const valley = computeValleyMetrics(projected)
  const maxDim = valley.maxDim
  const minDim = Math.max(10, Math.min(projected.widthMeters, projected.depthMeters))
  FLIGHT_HEIGHT = Math.max(7, Math.min(26, maxDim * 0.14))
  currentDroneSpeedMetersPerSec = Math.max(10, Math.min(42, maxDim * 0.18))

  if (droneGroupReady) {
    droneGroup.position.copy(DRONE_BASE)
    droneGroup.rotation.set(0, 0, 0)
    const droneScale = Math.max(0.95, Math.min(3.8, maxDim / 52))
    droneGroup.scale.set(droneScale, droneScale, droneScale)
  }

  if (mainDirLight) {
    const shadowHalf = Math.max(55, maxDim * 0.92)
    mainDirLight.shadow.camera.left = -shadowHalf
    mainDirLight.shadow.camera.right = shadowHalf
    mainDirLight.shadow.camera.top = shadowHalf
    mainDirLight.shadow.camera.bottom = -shadowHalf
    mainDirLight.shadow.camera.updateProjectionMatrix()
  }

  applySceneFog(projected)

  if (groundMesh) {
    groundMesh.geometry.dispose()
    groundMesh.geometry = new THREE.PlaneGeometry(valley.groundSize, valley.groundSize)
    if (groundMaterial.map) {
      const tileRepeat = Math.max(14, Math.round(valley.groundSize / 20))
      groundMaterial.map.repeat.set(tileRepeat, tileRepeat)
    }
  }

  if (surroundingsGroup) {
    disposeGroupChildren(surroundingsGroup)
    const builtSurroundings = buildAgriculturalSurroundings(projected, {
      x: DRONE_BASE.x,
      z: DRONE_BASE.z,
    })
    surroundingsGroup.add(builtSurroundings.group)
  }

  if (!scene.value || !cropGroup || !parcelOutlineGroup || !parcelSurfaceGroup || !furrowsGroup) return

  disposeGroupChildren(parcelSurfaceGroup)
  disposeGroupChildren(parcelOutlineGroup)
  disposeGroupChildren(furrowsGroup)
  disposeGroupChildren(cropGroup)
  if (routeVisualGroup) disposeGroupChildren(routeVisualGroup)
  clearSectorMarkers()

  // 1. Superficie poligonal exacta a escala 1:1
  const polyMeshes = createParcelPolygonMesh(projected)
  polyMeshes.forEach(mesh => parcelSurfaceGroup?.add(mesh))

  // 2. Contorno exacto, vértices y plataforma de despegue del dron
  for (const polygon of projected.polygons) {
    polygon.rings.forEach((ring, ringIndex) => {
      const points = ring.map(point => new THREE.Vector3(point.x, 0.09, point.z))
      const line = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({
          color: ringIndex === 0 ? 0xf2cf68 : 0xd7e6bd,
          linewidth: 2,
          transparent: true,
          opacity: 0.96,
        }),
      )
      line.renderOrder = 2
      parcelOutlineGroup?.add(line)

      if (ringIndex === 0) {
        const cornerScale = Math.max(0.35, Math.min(2.2, maxDim / 70))
        const cornerGeo = new THREE.CylinderGeometry(cornerScale, cornerScale, 0.25, 10)
        const cornerMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 })
        ring.forEach(pt => {
          const post = new THREE.Mesh(cornerGeo.clone(), cornerMat.clone())
          post.position.set(pt.x, 0.14, pt.z)
          parcelOutlineGroup?.add(post)
        })
      }
    })
  }

  // Plataforma de despegue / base del dron
  const padScale = Math.max(1.4, Math.min(5, maxDim / 35))
  const padRing = new THREE.Mesh(
    new THREE.RingGeometry(padScale * 0.72, padScale, 24).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide })
  )
  padRing.position.set(DRONE_BASE.x, 0.04, DRONE_BASE.z)
  parcelOutlineGroup.add(padRing)

  // 3. Surcos agrícolas recortados estrictamente dentro de los límites del polígono real
  const furrowPositions: number[] = []
  const furrowSpacing = Math.max(2.0, Math.min(18, projected.depthMeters / 24))
  for (
    let z = projected.bounds.minZ + furrowSpacing * 0.45;
    z <= projected.bounds.maxZ - furrowSpacing * 0.2;
    z += furrowSpacing
  ) {
    const segments = computeHorizontalScanlineSegments(z, projected)
    for (const [segStart, segEnd] of segments) {
      furrowPositions.push(segStart, 0.045, z, segEnd, 0.045, z)
    }
  }
  const furrowGeometry = new THREE.BufferGeometry()
  furrowGeometry.setAttribute('position', new THREE.Float32BufferAttribute(furrowPositions, 3))
  furrowsGroup.add(
    new THREE.LineSegments(
      furrowGeometry,
      new THREE.LineBasicMaterial({ color: 0xc39a64, transparent: true, opacity: 0.24 })
    )
  )

  // 4. Plantas distribuidas exclusivamente dentro del polígono real + estrés inicial
  const initialSlots = createInitialSimulatedPlants(projected, [])
  if (regenerateCenters || stressCenters.length === 0) {
    stressCenters = seedStressCentersInsideField(projected, initialSlots)
  }
  allPlants = createInitialSimulatedPlants(projected, stressCenters, {
    targetCount: Math.max(180, Math.min(360, Math.round(projected.areaHectares * 140 + 180))),
  })
  simulationTick.value = 0
  tickAccumulatorSec = 0

  leafToPlantMap = []
  tasselToPlantMap = []
  earToPlantMap = []
  let leafCount = 0
  let tasselCount = 0
  let earCount = 0

  for (const plant of allPlants) {
    leafCount += plant.stage === 1 ? 5 : plant.stage === 2 ? 10 : 14
    if (plant.stage === 3) {
      tasselCount++
      earCount += 2
    } else if (plant.stage === 2) {
      earCount += 1
    }
  }

  const spacingEst = Math.max(1.2, Math.sqrt(projected.areaSquareMeters / Math.max(1, allPlants.length)))
  const plantScale = Math.max(0.68, Math.min(3.2, spacingEst / 3.2))

  const leafMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    side: THREE.DoubleSide,
    roughness: 0.84,
    metalness: 0,
  })
  leafWindUniform = { value: simulationTime }
  leafWindStrengthUniform = { value: windEnabled.value ? 1 : 0 }
  leafMaterial.onBeforeCompile = shader => {
    shader.uniforms.uWindTime = leafWindUniform!
    shader.uniforms.uWindStrength = leafWindStrengthUniform!
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWindTime;\nuniform float uWindStrength;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float leafWindWeight = smoothstep(0.05, 2.4, position.y);
        float leafWindPhase = uWindTime * 1.35 + position.y * 1.7 + instanceMatrix[3][0] * 0.24 + instanceMatrix[3][2] * 0.18;
        transformed.x += sin(leafWindPhase) * 0.11 * leafWindWeight * uWindStrength;
        transformed.z += cos(leafWindPhase * 0.83) * 0.055 * leafWindWeight * uWindStrength;`
      )
  }
  leafMaterial.customProgramCacheKey = () => 'agronia-leaf-wind-v1'

  leafMesh = new THREE.InstancedMesh(createLeafGeometry(), leafMaterial, Math.max(1, leafCount))
  const trunkGeo = new THREE.CylinderGeometry(0.04, 0.08, 1, 8)
  trunkGeo.translate(0, 0.5, 0)
  trunkMesh = new THREE.InstancedMesh(
    trunkGeo,
    new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0 }),
    Math.max(1, allPlants.length)
  )

  const tasselGeo = createTasselGeometry()
  tasselGeo.translate(0, -0.1, 0)
  tasselMesh =
    tasselCount > 0
      ? new THREE.InstancedMesh(
          tasselGeo,
          new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0 }),
          tasselCount
        )
      : null

  const earGeo = new THREE.CapsuleGeometry(0.12, 0.4, 4, 8)
  earGeo.rotateZ(Math.PI / 8)
  earGeo.translate(0.15, 0.2, 0)
  earMesh =
    earCount > 0
      ? new THREE.InstancedMesh(
          earGeo,
          new THREE.MeshStandardMaterial({ roughness: 0.88, metalness: 0 }),
          earCount
        )
      : null

  const hitboxGeo = new THREE.CylinderGeometry(0.65 * plantScale, 0.65 * plantScale, 3.6 * plantScale, 8)
  hitboxGeo.translate(0, 1.8 * plantScale, 0)
  hitboxMesh = new THREE.InstancedMesh(
    hitboxGeo,
    new THREE.MeshBasicMaterial({ visible: false }),
    Math.max(1, allPlants.length)
  )

  const dummy = new THREE.Object3D()
  let cL = 0
  let cT = 0
  let cE = 0

  allPlants.forEach((plant, pIdx) => {
    const stageScaleY = (plant.stage === 1 ? 0.8 : plant.stage === 2 ? 1.8 : 2.8) * plantScale
    dummy.position.set(plant.x, 0, plant.z)
    dummy.rotation.set(0, Math.random() * Math.PI, 0)
    dummy.scale.set(plantScale, stageScaleY, plantScale)
    dummy.updateMatrix()
    trunkMesh!.setMatrixAt(pIdx, dummy.matrix)

    dummy.scale.set(1, 1, 1)
    dummy.updateMatrix()
    hitboxMesh!.setMatrixAt(pIdx, dummy.matrix)

    const numLeaves = plant.stage === 1 ? 5 : plant.stage === 2 ? 10 : 14
    for (let k = 0; k < numLeaves; k++) {
      dummy.position.set(plant.x, (k / numLeaves) * stageScaleY * 0.9 + 0.1 * plantScale, plant.z)
      dummy.rotation.set(0, k * 137.5 * (Math.PI / 180), 0)
      const lScale = (plant.stage === 1 ? 0.6 : 1.0) * (1 - (k / numLeaves) * 0.4) * plantScale
      dummy.scale.set(lScale, lScale, lScale)
      dummy.rotateX(Math.PI / 4)
      dummy.translateZ(0.04 * plantScale)
      dummy.updateMatrix()
      leafMesh!.setMatrixAt(cL, dummy.matrix)
      leafToPlantMap.push(pIdx)
      cL++
    }

    if (earMesh && plant.stage >= 2) {
      for (let e = 0; e < (plant.stage === 3 ? 2 : 1); e++) {
        dummy.position.set(plant.x, stageScaleY * (0.4 + e * 0.2), plant.z)
        dummy.rotation.set(0, Math.random() * Math.PI * 2, 0)
        const eScale = (plant.stage === 3 ? 1.0 : 0.6) * plantScale
        dummy.scale.set(eScale, eScale, eScale)
        dummy.updateMatrix()
        earMesh.setMatrixAt(cE, dummy.matrix)
        earToPlantMap.push(pIdx)
        cE++
      }
    }

    if (tasselMesh && plant.stage === 3) {
      dummy.position.set(plant.x, stageScaleY, plant.z)
      dummy.rotation.set(0, Math.random() * Math.PI, 0)
      dummy.scale.set(plantScale, plantScale, plantScale)
      dummy.updateMatrix()
      tasselMesh.setMatrixAt(cT, dummy.matrix)
      tasselToPlantMap.push(pIdx)
      cT++
    }
  })

  trunkMesh.castShadow = true
  trunkMesh.receiveShadow = true
  leafMesh.castShadow = true
  cropGroup.add(trunkMesh, leafMesh, hitboxMesh)
  if (tasselMesh) {
    tasselMesh.castShadow = true
    cropGroup.add(tasselMesh)
  }
  if (earMesh) {
    earMesh.castShadow = true
    cropGroup.add(earMesh)
  }

  lastInspectedPlant.value = allPlants[0] ?? null
  hoveredPlant.value = null
  hoveredSector.value = null
  updateMaterials(currentMode.value)
  updateTelemetry()
  if (routeVisualGroup) disposeGroupChildren(routeVisualGroup)
  currentFlightPlan.value = null
  currentReport.value = null
  frameCameraOnField()

  if (centinelaGroup) {
    disposeGroupChildren(centinelaGroup)
    scene.value.remove(centinelaGroup)
    centinelaGroup = null
    centinelaPropellers = []
  }
  void minDim
}

const applySelectedField = () => {
  parcelSimStore.selectField(selectedFieldId.value)
  cameraFollowEnabled.value = true
  liveDronePath = []
  fallbackGpsOrigin = null
  clearLiveDroneTrail()
  if (droneState.value !== 'IDLE') {
    droneState.value = 'IDLE'
    currentAction.value = 'NONE'
    if (particleSystem) particleSystem.visible = false
  }
  rebuildParcelScene(true)
}

const updateLiveDrone = () => {
  const snapshot = pendingDroneSnapshot
  pendingDroneSnapshot = null
  if (snapshot) liveDrone.value = snapshot

  const state = liveDrone.value
  const hasPosition = state.connected
    && state.hasHeartbeat
    && state.latitude !== null
    && state.longitude !== null
  if (!liveDroneGroup) return
  liveDroneGroup.visible = hasPosition
  if (!hasPosition) {
    if (liveDronePath.length) {
      liveDronePath = []
      fallbackGpsOrigin = null
      clearLiveDroneTrail()
    }
    return
  }

  const latitude = state.latitude!
  const longitude = state.longitude!
  let point: FieldPoint
  if (selectedFieldGeometry.value) {
    point = selectedFieldGeometry.value.projectGps(latitude, longitude)
  } else {
    fallbackGpsOrigin ??= { latitude, longitude }
    point = {
      x: (longitude - fallbackGpsOrigin.longitude) * 111_320 * Math.cos(fallbackGpsOrigin.latitude * Math.PI / 180),
      z: -(latitude - fallbackGpsOrigin.latitude) * 110_540,
    }
  }

  const altitude = state.relativeAltitude
  liveDroneGroup.position.set(
    point.x,
    altitude === null ? (state.armed ? FLIGHT_HEIGHT : 0.6) : Math.max(0.6, altitude),
    point.z,
  )
  if (state.heading !== null) liveDroneGroup.rotation.y = state.heading * Math.PI / 180

  const previousPoint = liveDronePath[liveDronePath.length - 1]
  if (!previousPoint || Math.hypot(point.x - previousPoint.x, point.z - previousPoint.z) >= 0.75) {
    liveDronePath.push(point)
    if (liveDronePath.length > 1000) liveDronePath.shift()
    clearLiveDroneTrail()
    liveDroneTrail = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(
        liveDronePath.map(pathPoint => new THREE.Vector3(pathPoint.x, 0.18, pathPoint.z)),
      ),
      new THREE.LineBasicMaterial({ color: 0x55e6d0, transparent: true, opacity: 0.9 }),
    )
    liveDroneTrail.visible = showDroneRoute.value
    liveDroneTrail.renderOrder = 3
    scene.value?.add(liveDroneTrail)
  }

  const now = Date.now()
  if (selectedFieldId.value && now - lastDroneMetricSavedAt >= 5000) {
    lastDroneMetricSavedAt = now
    void saveFieldMetric({
      field_id: selectedFieldId.value,
      record_date: new Date(now).toISOString(),
      raw_data: {
        source: 'drone_telemetry',
        latitude,
        longitude,
        altitude_msl: state.altitude,
        relative_altitude_m: state.relativeAltitude,
        ground_speed_mps: state.groundSpeed,
        heading_degrees: state.heading,
        armed: state.armed,
      },
    }).catch(error => {
      setActionFeedback(error instanceof Error
        ? `Telemetría recibida, pero no se pudo guardar: ${error.message}`
        : 'Telemetría recibida, pero no se pudo guardar.')
    })
  }
}

const updateCameraFollow = () => {
  if (!cameraFollowEnabled.value || !controls.value || !camera.value) return
  const targetDrone = liveDroneGroup?.visible
    ? liveDroneGroup
    : droneState.value !== 'IDLE'
      ? droneGroup
      : null
  if (!targetDrone) return

  const nextTarget = new THREE.Vector3(
    targetDrone.position.x,
    Math.max(0, targetDrone.position.y * 0.65),
    targetDrone.position.z,
  )
  const delta = nextTarget.sub(controls.value.target).multiplyScalar(0.055)
  controls.value.target.add(delta)
  camera.value.position.add(delta)
}

const handleDroneTelemetry = (snapshot: {
  connected: boolean
  hasHeartbeat: boolean
  armed: boolean | null
  latitude: number | null
  longitude: number | null
  altitude: number | null
  relativeAltitude: number | null
  groundSpeed: number | null
  heading: number | null
}) => {
  pendingDroneSnapshot = {
    connected: snapshot.connected,
    hasHeartbeat: snapshot.hasHeartbeat,
    armed: snapshot.armed,
    latitude: snapshot.latitude,
    longitude: snapshot.longitude,
    altitude: snapshot.altitude,
    relativeAltitude: snapshot.relativeAltitude,
    groundSpeed: snapshot.groundSpeed,
    heading: snapshot.heading,
  }
}

const updateTelemetry = () => {
  if (!allPlants || allPlants.length === 0) return
  const count = allPlants.length
  let sumHealth = 0, sumNDVI = 0, sumTemp = 0, sumStress = 0, sumPest = 0
  let healthyCount = 0, mildCount = 0, moderateCount = 0, criticalCount = 0, irreversibleCount = 0

  for (const p of allPlants) {
    sumHealth += p.health
    sumNDVI += p.ndvi
    sumTemp += p.temp
    sumStress += p.waterStressPercent
    sumPest += p.pestStressPercent
    if (p.state === 'saludable') healthyCount++
    else if (p.state === 'estrés_leve') mildCount++
    else if (p.state === 'estrés_moderado') moderateCount++
    else if (p.state === 'estrés_crítico') criticalCount++
    else if (p.state === 'pérdida_irreversible') irreversibleCount++
  }

  const avgWaterStress = parseFloat((sumStress / count).toFixed(1))
  telemetry.value = {
    avgHealth: parseFloat(((sumHealth / count) * 100).toFixed(1)),
    avgWaterStress,
    avgHumidity: parseFloat(Math.max(8, Math.min(96, 94 - avgWaterStress * 0.78)).toFixed(1)),
    avgPestIndex: parseFloat((sumPest / count).toFixed(1)),
    avgNDVI: parseFloat((sumNDVI / count).toFixed(2)),
    avgTemp: parseFloat((sumTemp / count).toFixed(1)),
    plantCount: count,
    stressZones: stressCenters.length,
    healthyCount,
    mildCount,
    moderateCount,
    criticalCount,
    irreversibleCount,
  }
}

const createSoilTexture = () => {
  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) throw new Error('No se pudo crear la textura del terreno.')

  // Base cálida de tierra agrícola
  context.fillStyle = '#9c6b43'
  context.fillRect(0, 0, size, size)

  let seed = 82471
  const random = () => {
    seed = (seed * 16807) % 2147483647
    return (seed - 1) / 2147483646
  }

  // Manchas orgánicas y variación mineral del suelo
  for (let i = 0; i < 420; i++) {
    context.fillStyle = random() > 0.48
      ? 'rgba(122, 78, 44, 0.16)'
      : 'rgba(182, 134, 88, 0.14)'
    const rx = 8 + random() * 24
    const ry = 5 + random() * 14
    context.beginPath()
    context.ellipse(random() * size, random() * size, rx, ry, random() * Math.PI, 0, Math.PI * 2)
    context.fill()
  }

  // Grano fino y terrones naturales de tierra
  for (let i = 0; i < 9000; i++) {
    context.fillStyle = random() > 0.52
      ? 'rgba(54, 34, 18, 0.16)'
      : 'rgba(218, 179, 130, 0.14)'
    const diameter = 0.5 + random() * 2
    context.beginPath()
    context.ellipse(
      random() * size,
      random() * size,
      diameter * 1.8,
      diameter,
      random() * Math.PI,
      0,
      Math.PI * 2
    )
    context.fill()
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(12, 12)
  texture.anisotropy = 8
  return texture
}

const createSectorFalloffTexture = () => {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const context = canvas.getContext('2d')
  if (!context) throw new Error('No se pudo crear la textura de las zonas de estrés.')

  const gradient = context.createRadialGradient(64, 64, 5, 64, 64, 62)
  gradient.addColorStop(0, 'rgba(255, 255, 255, 0.72)')
  gradient.addColorStop(0.45, 'rgba(255, 255, 255, 0.42)')
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, 128, 128)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

// Funciones geométricas
const createLeafGeometry = () => {
  const geo = new THREE.PlaneGeometry(0.25, 2.5, 5, 12); geo.translate(0, 1.25, 0)
  const pos = geo.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i), t = y / 2.5
    const wScale = Math.sin((t + 0.05) * Math.PI * 0.9)
    pos.setXYZ(i, pos.getX(i) * wScale, y, -Math.pow(t, 2.2) * 1.5)
  }
  geo.computeVertexNormals(); return geo
}

const createTasselGeometry = () => {
  const numBranches = 7, segments = 4; const vertices = [], indices = []
  for(let b = 0; b < numBranches; b++) {
    const isCenter = b === 0, length = isCenter ? 0.8 : 0.6
    const angle = b * (Math.PI * 2 / (numBranches - 1)), spread = isCenter ? 0 : 0.5
    const baseIdx = (vertices.length / 3)
    for(let s = 0; s <= segments; s++) {
      const t = s / segments, wScale = 0.03 * (1 - t)
      const v0 = new THREE.Vector3(-wScale, t * length, 0), v1 = new THREE.Vector3(wScale, t * length, 0)
      if (!isCenter) {
        v0.z += Math.pow(t, 1.5) * spread; v1.z += Math.pow(t, 1.5) * spread
        v0.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle); v1.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle)
      }
      vertices.push(v0.x, v0.y, v0.z); vertices.push(v1.x, v1.y, v1.z)
      if (s < segments) {
         const i0 = baseIdx + s * 2, i1 = i0 + 1, i2 = i0 + 2, i3 = i0 + 3
         indices.push(i0, i1, i2, i1, i3, i2); indices.push(i0, i2, i1, i1, i2, i3)
      }
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  geo.setIndex(indices); geo.computeVertexNormals(); return geo
}

const lerpColor = (c1: THREE.Color, c2: THREE.Color, t: number) => new THREE.Color().lerpColors(c1, c2, t)

const getSectorColor = (type: string, intensity: number) => {
  const t = Math.max(0, Math.min(1, (intensity - 0.6) / 0.4))
  if (type === 'DROUGHT') {
    return new THREE.Color().lerpColors(new THREE.Color(0xfacc15), new THREE.Color(0xea580c), t).getHex()
  }
  if (type === 'OVERHYDRATION') {
    return new THREE.Color().lerpColors(new THREE.Color(0x38bdf8), new THREE.Color(0x1d4ed8), t).getHex()
  }
  return new THREE.Color().lerpColors(new THREE.Color(0xc084fc), new THREE.Color(0x7e22ce), t).getHex()
}

const getColorForPlant = (plant: SimulatedPlantNode, mode: 'rgb' | 'ndvi' | 'thermal') => {
  if (mode === 'rgb') {
    if (plant.state === 'pérdida_irreversible') return new THREE.Color(0x6b4c3b)
    if (plant.state === 'estrés_crítico') return new THREE.Color(0xd97706)
    if (plant.state === 'estrés_moderado') return new THREE.Color(0xca8a04)
    if (plant.state === 'estrés_leve') return new THREE.Color(0x84cc16)
    return new THREE.Color(0x15803d)
  }
  if (mode === 'ndvi') {
    if (plant.ndvi < 0.33) return lerpColor(new THREE.Color(0xdc2626), new THREE.Color(0xf97316), plant.ndvi / 0.33)
    if (plant.ndvi < 0.66) return lerpColor(new THREE.Color(0xf97316), new THREE.Color(0xfacc15), (plant.ndvi - 0.33) / 0.33)
    return lerpColor(new THREE.Color(0xfacc15), new THREE.Color(0x16a34a), (plant.ndvi - 0.66) / 0.34)
  }
  const heat = Math.max(0, Math.min(1, (plant.temp - 22) / 17))
  if (heat < 0.33) return lerpColor(new THREE.Color(0x1d4ed8), new THREE.Color(0x06b6d4), heat / 0.33)
  if (heat < 0.66) return lerpColor(new THREE.Color(0x06b6d4), new THREE.Color(0xfde047), (heat - 0.33) / 0.33)
  return lerpColor(new THREE.Color(0xfde047), new THREE.Color(0xef4444), (heat - 0.66) / 0.34)
}

const setActionFeedback = (message: string, autoClear = true) => {
  if (feedbackTimeout) clearTimeout(feedbackTimeout)
  actionFeedback.value = message
  if (autoClear) {
    feedbackTimeout = setTimeout(() => {
      actionFeedback.value = ''
      feedbackTimeout = undefined
    }, 6000)
  }
}

const clearSectorMarkers = () => {
  sectorMarkers.forEach(marker => {
    scene.value?.remove(marker)
    marker.geometry.dispose()
    const material = marker.material
    if (Array.isArray(material)) material.forEach(item => item.dispose())
    else material.dispose()
  })
  sectorMarkers = []
}

const addSingleSectorMarker = (center: StressCenter) => {
  const geo = new THREE.CircleGeometry(center.radius, 48)
  geo.rotateX(-Math.PI / 2)
  const mat = new THREE.MeshBasicMaterial({
    color: getSectorColor(center.type, center.intensity),
    map: sectorFalloffTexture,
    transparent: true,
    opacity: 0.72,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.set(center.x, 0.2, center.z)
  mesh.userData = center
  scene.value?.add(mesh)
  sectorMarkers.push(mesh)
}

const revealSectorMarkersOnScene = () => {
  clearSectorMarkers()
  stressCenters.forEach(addSingleSectorMarker)
}

const updateMaterials = (mode: 'rgb' | 'ndvi' | 'thermal') => {
  currentMode.value = mode
  const soilTint = mode === 'rgb' ? 0xebd0b0 : mode === 'ndvi' ? 0x1e40af : 0x450a0a
  if (groundMaterial) groundMaterial.color.setHex(mode === 'rgb' ? 0xd8b48c : soilTint)
  if (parcelSurfaceMaterial) parcelSurfaceMaterial.color.setHex(soilTint)
  if (!trunkMesh || !leafMesh) return

  for (let i = 0; i < allPlants.length; i++) {
    const plant = allPlants[i]
    trunkMesh.setColorAt(
      i,
      mode === 'rgb' && plant.state === 'saludable'
        ? new THREE.Color(0x65a30d)
        : getColorForPlant(plant, mode)
    )
  }
  trunkMesh.instanceColor!.needsUpdate = true

  for (let i = 0; i < leafToPlantMap.length; i++) {
    leafMesh.setColorAt(i, getColorForPlant(allPlants[leafToPlantMap[i]], mode))
  }
  leafMesh.instanceColor!.needsUpdate = true

  if (tasselMesh && tasselToPlantMap.length > 0) {
    for (let i = 0; i < tasselToPlantMap.length; i++) {
      const p = allPlants[tasselToPlantMap[i]]
      tasselMesh.setColorAt(
        i,
        mode === 'rgb' && !p.irreversible ? new THREE.Color(0xfef08a) : getColorForPlant(p, mode)
      )
    }
    tasselMesh.instanceColor!.needsUpdate = true
  }
  if (earMesh && earToPlantMap.length > 0) {
    for (let i = 0; i < earToPlantMap.length; i++) {
      const p = allPlants[earToPlantMap[i]]
      earMesh.setColorAt(
        i,
        mode === 'rgb' && !p.irreversible ? new THREE.Color(0xeab308) : getColorForPlant(p, mode)
      )
    }
    earMesh.instanceColor!.needsUpdate = true
  }
}

const createDrone = () => {
  const group = new THREE.Group()
  const bodyMat = new THREE.MeshLambertMaterial({ color: 0x333333 })
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.3, 0.8), bodyMat)
  body.castShadow = true; group.add(body)

  const armGeo = new THREE.CylinderGeometry(0.05, 0.05, 1.2, 8); armGeo.rotateZ(Math.PI / 2)
  const arm1 = new THREE.Mesh(armGeo, bodyMat); arm1.rotation.y = Math.PI / 4; group.add(arm1)
  const arm2 = new THREE.Mesh(armGeo, bodyMat); arm2.rotation.y = -Math.PI / 4; group.add(arm2)

  const propGeo = new THREE.BoxGeometry(0.6, 0.02, 0.05)
  const propMat = new THREE.MeshBasicMaterial({ color: 0xaaaaaa })
  
  const positions = [ { x: 0.6, z: 0.6 }, { x: -0.6, z: -0.6 }, { x: 0.6, z: -0.6 }, { x: -0.6, z: 0.6 } ]
  
  positions.forEach(pos => {
    const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.2), bodyMat)
    motor.position.set(pos.x, 0.2, pos.z); group.add(motor)
    
    const prop = new THREE.Mesh(propGeo, propMat)
    prop.position.set(pos.x, 0.3, pos.z)
    propellers.push(prop); group.add(prop)
  })

  return group
}

const createParticles = () => {
  particleGeo = new THREE.BufferGeometry()
  particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3))
  const pMaterial = new THREE.PointsMaterial({ color: 0x3b82f6, size: 0.3, transparent: true, opacity: 0.8 })
  particleSystem = new THREE.Points(particleGeo, pMaterial)
  particleSystem.visible = false
  scene.value?.add(particleSystem)
}

const refreshInspectedReferences = () => {
  if (!lastInspectedPlant.value && allPlants.length > 0) {
    lastInspectedPlant.value = allPlants[0]
  } else if (lastInspectedPlant.value) {
    const refreshed = allPlants.find(p => p.id === lastInspectedPlant.value?.id)
    if (refreshed) lastInspectedPlant.value = refreshed
  }
  if (hoveredPlant.value) {
    hoveredPlant.value = allPlants.find(p => p.id === hoveredPlant.value?.id) ?? null
  }
}

const runProgressiveTick = (eventType: PlantStressHistoryEvent = 'degradation', showBanner = true) => {
  if (allPlants.length === 0) return
  simulationTick.value += 1
  const { newlyCriticalIds, newlyIrreversibleIds } = advanceSimulationTick(
    allPlants,
    stressCenters,
    simulationTick.value,
    { event: eventType }
  )
  refreshInspectedReferences()
  updateMaterials(currentMode.value)
  updateTelemetry()
  refreshRouteAndReport('INSPECT_STRESS', hasAnalyzedCrop.value)

  if (showBanner && (newlyIrreversibleIds.length > 0 || newlyCriticalIds.length > 0)) {
    const parts: string[] = []
    if (newlyCriticalIds.length > 0) parts.push(`${newlyCriticalIds.length} planta(s) pasaron a estrés crítico`)
    if (newlyIrreversibleIds.length > 0) parts.push(`${newlyIrreversibleIds.length} con pérdida irreversible`)
    setActionFeedback(`Ciclo #${simulationTick.value}: ${parts.join(' · ')}.`)
  } else if (showBanner) {
    setActionFeedback(
      `Ciclo #${simulationTick.value} evaluado · Estrés promedio: ${telemetry.value.avgWaterStress}% · Ahorro IA batería: ${currentFlightPlan.value?.batterySavingsPercent ?? 0}%.`
    )
  }
}

const runSentinelCycle = (isInitialActivation = false) => {
  const projected = selectedFieldGeometry.value
  if (!projected || allPlants.length === 0) return

  simulationTick.value += 1
  advanceSimulationTick(allPlants, stressCenters, simulationTick.value, {
    event: 'sentinel_scan',
  })

  const emergent = introduceEmergentAffections(
    projected,
    allPlants,
    stressCenters,
    simulationTick.value,
    {
      maxCenters: 8,
      maxNewPlants: isInitialActivation ? 8 : 6,
    }
  )

  hasAnalyzedCrop.value = true
  refreshInspectedReferences()
  updateMaterials(currentMode.value)
  updateTelemetry()
  revealSectorMarkersOnScene()
  refreshRouteAndReport('INSPECT_STRESS', true)

  const wpCount = currentFlightPlan.value?.waypoints.filter(w => w.type === 'target').length ?? 0
  const savingsPct = currentFlightPlan.value?.batterySavingsPercent ?? 0
  if (emergent.newlyAffectedPlantIds.length > 0) {
    setActionFeedback(
      `Centinelas (Ciclo #${simulationTick.value}): ${emergent.newlyAffectedPlantIds.length} planta(s) previamente sanas presentan nuevas afectaciones · Ruta TSP actualizada (${wpCount} puntos, ahorro ${savingsPct}%).`
    )
  } else if (isInitialActivation) {
    setActionFeedback(
      `Centinelas activos (Ciclo #${simulationTick.value}): ruta TSP optimizada con ${wpCount} puntos (ahorro ${savingsPct}% batería).`
    )
  }
}

const buildSimulationResultsPayload = (
  reportPayload: SimulationReport | null,
  stressTimeline: ReturnType<typeof extractStressTimeline>,
  economics: ReturnType<typeof calculateSimulationEconomics> | null,
): Json => {
  const stressedPlants = allPlants.filter(plant => plant.state !== 'saludable').length
  const deadPlants = allPlants.filter(plant => plant.irreversible).length

  return {
    telemetry: {
      ...telemetry.value,
      stressedPlants,
      deadPlants,
    },
    plants: allPlants.map(plant => ({
      id: plant.id,
      gps: { latitude: plant.lat, longitude: plant.lng },
      health: Number((plant.health / 100).toFixed(3)),
      waterStress: Number((plant.waterStressPercent / 100).toFixed(3)),
      dead: plant.irreversible,
      status: STRESS_STATE_LABELS[plant.state],
    })) as unknown as Json,
    timeline: stressTimeline.map(point => ({
      elapsed: point.tick,
      health: Number(Math.max(0, Math.min(100, 100 - point.avgWaterStressPercent * 0.75)).toFixed(1)),
      humidity: Number(Math.max(0, Math.min(100, 100 - point.avgWaterStressPercent)).toFixed(1)),
      ndvi: Number((point.avgNdvi * 100).toFixed(1)),
    })) as unknown as Json,
    simulation_report: reportPayload as unknown as Json,
    stress_timeline: stressTimeline as unknown as Json,
    economics: economics as unknown as Json,
    stress_centers: stressCenters.map(center => ({ ...center })) as unknown as Json,
  }
}

const saveScenarioSnapshot = async (saveAlerts = false) => {
  if (savingSnapshot.value) return
  savingSnapshot.value = true
  const fieldId = selectedFieldId.value || null

  try {
    const reportPayload = currentReport.value ?? (
      selectedFieldGeometry.value && activeParcelMetadata.value
        ? buildSimulationReport({
            tick: simulationTick.value,
            parcel: activeParcelMetadata.value,
            plants: allPlants,
            droneFlight:
              currentFlightPlan.value ??
              planOptimizedDroneRoute({
                field: selectedFieldGeometry.value,
                basePoint: { x: DRONE_BASE.x, z: DRONE_BASE.z },
                plants: allPlants,
                missionType: 'INSPECT_STRESS',
              }),
          })
        : null
    )

    const stressTimeline = reportPayload ? extractStressTimeline(reportPayload) : []
    const economics = reportPayload ? calculateSimulationEconomics(reportPayload) : null

    const savedRow = await createSimulation({
      field_id: fieldId,
      scenario_title: `Simulación ${new Date().toLocaleString('es-MX')}`,
      input_parameters: {
        visualization_mode: currentMode.value,
        wind_enabled: windEnabled.value,
        field_id: fieldId,
        tick: simulationTick.value,
      },
      results: buildSimulationResultsPayload(reportPayload, stressTimeline, economics),
    })

    if (reportPayload && economics) {
      parcelSimStore.registerExportedSimulation({
        id: savedRow.id,
        title: savedRow.scenario_title,
        exportedAt: savedRow.created_at,
        source: 'supabase',
        fieldId,
        report: reportPayload,
        stressTimeline,
        economics,
      })
    }

    if (fieldId) {
      const writes: Promise<void>[] = [
        saveFieldMetric({
          field_id: fieldId,
          soil_humidity: telemetry.value.avgHumidity,
          temperature: telemetry.value.avgTemp,
          sustainability_index: telemetry.value.avgHealth / 100,
          raw_data: {
            source: 'simulation',
            tick: simulationTick.value,
            water_stress_avg: telemetry.value.avgWaterStress,
            ndvi_avg: telemetry.value.avgNDVI,
            pest_index: telemetry.value.avgPestIndex,
            plant_count: telemetry.value.plantCount,
            stress_zones: telemetry.value.stressZones,
            drone_battery_savings_pct: currentFlightPlan.value?.batterySavingsPercent ?? 0,
          },
        }),
      ]

      if (saveAlerts) {
        writes.push(...stressCenters.map(center => createAlert({
          field_id: fieldId,
          alert_type: center.type === 'DROUGHT' ? 'soil_humidity' : 'pest',
          severity: center.intensity >= 0.85 ? 'high' : center.intensity >= 0.7 ? 'medium' : 'low',
          message: center.type === 'DROUGHT'
            ? `Estrés hídrico detectado en ${center.id} (${center.lat.toFixed(5)}, ${center.lng.toFixed(5)}).`
            : `Posible plaga detectada en ${center.id} (${center.lat.toFixed(5)}, ${center.lng.toFixed(5)}).`,
        })))
      }

      await Promise.all(writes)
    }

    setActionFeedback(fieldId
      ? 'Reporte de simulación, métricas y alertas guardados en Supabase.'
      : 'Simulación guardada. Selecciona una parcela para asociar métricas y alertas.')
  } catch (error) {
    setActionFeedback(error instanceof Error
      ? `No se pudieron guardar todos los datos: ${error.message}`
      : 'No se pudieron guardar todos los datos.')
  } finally {
    savingSnapshot.value = false
  }
}

const handleAction = (action: 'ANALYZE' | 'WATER' | 'FUMIGATE' | 'CENTINELAS') => {
  if (action === 'CENTINELAS') {
    if (droneState.value === 'CENTINELAS') {
      droneState.value = 'IDLE'
      currentAction.value = 'NONE'
      if (centinelaGroup) centinelaGroup.visible = false
      setActionFeedback('Modo Centinelas detenido.')
      return
    }
    if (droneState.value !== 'IDLE') return
    droneState.value = 'CENTINELAS'
    currentAction.value = 'CENTINELAS'
    tickAccumulatorSec = 0

    const projected = selectedFieldGeometry.value
    const orbitRadius = projected
      ? Math.max(8, Math.min(projected.widthMeters, projected.depthMeters) * 0.36)
      : 15

    if (!centinelaGroup && scene.value) {
      centinelaGroup = new THREE.Group()
      for (let i = 0; i < 5; i++) {
        const drone = createDrone()
        drone.scale.set(0.55, 0.55, 0.55)
        const angle = (i / 5) * Math.PI * 2
        drone.position.set(
          Math.cos(angle) * orbitRadius,
          FLIGHT_HEIGHT,
          Math.sin(angle) * orbitRadius
        )
        centinelaGroup.add(drone)

        drone.children.forEach(c => {
          const mesh = c as THREE.Mesh
          if (mesh.isMesh && mesh.geometry instanceof THREE.BoxGeometry && mesh.scale.x === 1) {
            centinelaPropellers.push(mesh)
          }
        })
      }
      scene.value.add(centinelaGroup)
    }
    if (centinelaGroup) centinelaGroup.visible = true
    runSentinelCycle(true)
    return
  }

  if (action === 'ANALYZE') {
    if (droneState.value !== 'IDLE') return
    const projected = selectedFieldGeometry.value
    if (!projected) return

    // Limpiar cualquier trazado o marcador previo antes de iniciar el barrido completo del campo
    hasAnalyzedCrop.value = false
    currentFlightPlan.value = null
    if (routeVisualGroup) disposeGroupChildren(routeVisualGroup)
    clearSectorMarkers()
    discoveredCenterIds.clear()

    setActionFeedback('Recorriendo todo el campo dentro del polígono real para detectar plantas afectadas…', false)
    droneState.value = 'SCANNING'

    const fullSweep = buildFullFieldScanWaypoints(
      projected,
      { x: DRONE_BASE.x, z: DRONE_BASE.z },
      { passCount: 6 }
    )
    dronePath = fullSweep.map((pt, idx) =>
      idx === 0 || idx === fullSweep.length - 1
        ? DRONE_BASE.clone()
        : new THREE.Vector3(pt.x, FLIGHT_HEIGHT, pt.z)
    )

    currentPathIndex = 0
    return
  }

  if (droneState.value !== 'IDLE') return
  const projected = selectedFieldGeometry.value
  if (!projected) return

  const plan = planOptimizedDroneRoute({
    field: projected,
    basePoint: { x: DRONE_BASE.x, z: DRONE_BASE.z },
    plants: allPlants,
    missionType: action,
    altitudeMeters: FLIGHT_HEIGHT,
  })
  const targets = plan.waypoints.filter(wp => wp.type === 'target')

  if (targets.length === 0) {
    setActionFeedback(
      action === 'WATER'
        ? telemetry.value.irreversibleCount > 0
          ? `Sin plantas recuperables con estrés hídrico (${telemetry.value.irreversibleCount} con pérdida irreversible).`
          : 'No se encontraron plantas con estrés hídrico que requieran riego.'
        : 'No se encontraron plantas con indicios de plaga que requieran fumigación.'
    )
    return
  }

  activeMissionPlan = plan
  activeWaypoints = targets
  activeTargetIndex = 0
  missionRecoveredCount = 0
  missionIrreversibleCount = 0
  currentFlightPlan.value = plan
  renderOptimizedRoute3D(plan)

  setActionFeedback(
    `${action === 'WATER' ? 'Riego inteligente TSP' : 'Fumigación inteligente TSP'}: ${targets.length} objetivos críticos (${plan.totalDistanceMeters.toFixed(0)} m · ahorro ${plan.batterySavingsPercent}% batería).`,
    false
  )
  currentAction.value = action
  droneState.value = 'FLYING'

  const pMat = particleSystem.material as THREE.PointsMaterial
  if (action === 'WATER') {
    pMat.color.setHex(0x3b82f6); pMat.size = 0.35; pMat.opacity = 0.85
  } else {
    pMat.color.setHex(0xa7f3d0); pMat.size = 0.6; pMat.opacity = 0.45
  }
}

const resetCamera = () => {
  if (!camera.value || !controls.value) return
  cameraFollowEnabled.value = false
  frameCameraOnField()
}

const zoomCamera = (direction: 'in' | 'out') => {
  if (!controls.value) return
  if (direction === 'in') controls.value.dollyIn(1.2)
  else controls.value.dollyOut(1.2)
  controls.value.update()
}

const toggleCameraFollow = () => {
  cameraFollowEnabled.value = !cameraFollowEnabled.value
  setActionFeedback(cameraFollowEnabled.value
    ? 'Seguimiento de dron activado. La cámara seguirá su posición y altura.'
    : 'Seguimiento desactivado. Puedes explorar el campo libremente.')
}

const toggleCameraPanMode = () => {
  cameraPanMode.value = !cameraPanMode.value
  if (controls.value) {
    controls.value.mouseButtons.LEFT = cameraPanMode.value ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE
  }
  setActionFeedback(cameraPanMode.value
    ? 'Modo desplazar activado. Arrastra para recorrer el campo.'
    : 'Modo orbitar activado. Arrastra para girar la vista.')
}

const onFullscreenChange = () => {
  isFullscreen.value = document.fullscreenElement === containerRef.value
  onWindowResize()
}

const toggleFullscreen = async () => {
  const stage = containerRef.value
  if (!stage) return

  try {
    if (document.fullscreenElement === stage) {
      await document.exitFullscreen()
    } else {
      await stage.requestFullscreen()
    }
  } catch (error) {
    setActionFeedback(error instanceof Error
      ? `No se pudo cambiar a pantalla completa: ${error.message}`
      : 'No se pudo cambiar a pantalla completa.')
  }
}

const createNewScenario = async () => {
  if (savingSnapshot.value) return
  if (centinelaGroup) centinelaGroup.visible = false
  currentAction.value = 'NONE'
  droneState.value = 'IDLE'
  particleSystem.visible = false
  stressCenters = []
  rebuildParcelScene(true)
  setActionFeedback('Escenario reiniciado al estado inicial. Pulsa "Analizar cultivo" para recorrer el campo y trazar la ruta óptima.')
}

const toggleSimulation = () => {
  simulationPaused.value = !simulationPaused.value
  setActionFeedback(simulationPaused.value
    ? 'Simulación pausada. La cámara y la telemetría siguen disponibles.'
    : 'Simulación reanudada.')
}

const toggleWind = () => {
  windEnabled.value = !windEnabled.value
  setActionFeedback(windEnabled.value ? 'Viento suave activado.' : 'Viento desactivado.')
}

const setSimulationSpeed = (speed: SimulationSpeedMultiplier) => {
  simulationSpeed.value = speed
  setActionFeedback(
    speed === 1
      ? 'Velocidad normal de simulación (1x).'
      : `Tiempo y vuelo del dron acelerados a ${speed}x.`
  )
}

const cycleSimulationSpeed = () => {
  const currentIndex = SPEED_OPTIONS.indexOf(simulationSpeed.value)
  const nextSpeed = SPEED_OPTIONS[(currentIndex + 1) % SPEED_OPTIONS.length]
  setSimulationSpeed(nextSpeed)
}

const toggleDroneRouteVisibility = () => {
  showDroneRoute.value = !showDroneRoute.value
  if (routeVisualGroup) routeVisualGroup.visible = showDroneRoute.value
  if (liveDroneTrail) liveDroneTrail.visible = showDroneRoute.value
  setActionFeedback(
    showDroneRoute.value
      ? 'Trazado de ruta del dron visible.'
      : 'Trazado de ruta del dron oculto.'
  )
}

const exportCropData = () => {
  const rows = [
    ['ID de planta', 'Etapa', 'Estado', 'Estrés hídrico (%)', 'Estrés plaga (%)', 'Salud (%)', 'NDVI', 'Temperatura (°C)', 'Latitud', 'Longitud', 'Local X (m)', 'Local Z (m)'],
    ...allPlants.map(plant => [
      plant.id,
      plant.stage === 1 ? 'Brote' : plant.stage === 2 ? 'Desarrollo' : 'Madurez',
      plant.state,
      plant.waterStressPercent.toFixed(1),
      plant.pestStressPercent.toFixed(1),
      (plant.health * 100).toFixed(1),
      plant.ndvi.toFixed(2),
      plant.temp.toFixed(1),
      plant.lat.toFixed(7),
      plant.lng.toFixed(7),
      plant.x.toFixed(2),
      plant.z.toFixed(2),
    ]),
  ]
  const csv = rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n')
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `agronia-cultivo-${new Date().toISOString().slice(0, 10)}.csv`
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
  setActionFeedback(`CSV exportado: ${allPlants.length} plantas georreferenciadas (lat/lng) y sus métricas.`)
}

const downloadSimulationReport = () => {
  refreshRouteAndReport('INSPECT_STRESS', false)
  if (!currentReport.value) return
  const jsonText = JSON.stringify(currentReport.value, null, 2)
  const blob = new Blob([jsonText], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `agronia-simulation-report-tick-${simulationTick.value}.json`
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
  setActionFeedback(
    `SimulationReport JSON descargado (Ciclo #${simulationTick.value} · ${currentReport.value.plants.length} plantas · Ahorro IA ${currentReport.value.droneFlight.batterySavingsPercent}%).`
  )
}

const exportToDashboard = async () => {
  if (exportingToDashboard.value || allPlants.length === 0) return
  exportingToDashboard.value = true
  try {
    refreshRouteAndReport('INSPECT_STRESS', false)
    const report = currentReport.value
    if (!report) {
      setActionFeedback('No hay datos de simulación listos para exportar.')
      return
    }

    const stressTimeline = extractStressTimeline(report)
    const economics = calculateSimulationEconomics(report)
    const fieldId = selectedFieldId.value || report.parcel.fieldId || null
    const title = `${report.parcel.fieldName} · Ciclo #${report.tick}`

    let exportedEntry = {
      id: `local-${Date.now()}`,
      title,
      exportedAt: report.generatedAt,
      source: 'local' as 'supabase' | 'local',
      fieldId,
      report,
      stressTimeline,
      economics,
    }

    try {
      const savedRow = await createSimulation({
        field_id: fieldId,
        scenario_title: title,
        input_parameters: {
          visualization_mode: currentMode.value,
          wind_enabled: windEnabled.value,
          field_id: fieldId,
          tick: simulationTick.value,
          exported_to_dashboard: true,
        },
        results: buildSimulationResultsPayload(report, stressTimeline, economics),
      })

      if (fieldId) {
        await saveFieldMetric({
          field_id: fieldId,
          soil_humidity: telemetry.value.avgHumidity,
          temperature: telemetry.value.avgTemp,
          sustainability_index: telemetry.value.avgHealth / 100,
          raw_data: {
            source: 'simulation',
            tick: simulationTick.value,
            water_stress_avg: telemetry.value.avgWaterStress,
            ndvi_avg: telemetry.value.avgNDVI,
            pest_index: telemetry.value.avgPestIndex,
            plant_count: telemetry.value.plantCount,
            stress_zones: telemetry.value.stressZones,
            drone_battery_savings_pct: report.droneFlight.batterySavingsPercent,
          },
        }).catch(() => {})
      }

      exportedEntry = {
        ...exportedEntry,
        id: savedRow.id,
        exportedAt: savedRow.created_at,
        source: 'supabase',
      }
    } catch {
      // Mantiene exportación local en Pinia/localStorage si Supabase no está autenticado o falla
    }

    parcelSimStore.registerExportedSimulation(exportedEntry)
    await router.push('/dashboards')
  } finally {
    exportingToDashboard.value = false
  }
}

const initThree = () => {
  if (!canvasRef.value || !containerRef.value) return
  const width = canvasRef.value.clientWidth, height = canvasRef.value.clientHeight
  const isSmallScreen = window.matchMedia('(max-width: 767px)').matches
  const quality = graphicsQuality.value
  renderer.value = new THREE.WebGLRenderer({
    canvas: canvasRef.value,
    antialias: quality !== 'performance' && !isSmallScreen,
    powerPreference: 'high-performance',
    precision: 'highp',
  })
  gpuRendererName.value = detectHardwareGpuModel(renderer.value.getContext())
  const targetPixelRatio =
    quality === 'ultra'
      ? Math.min(window.devicePixelRatio, 2.5)
      : quality === 'balanced'
        ? Math.min(window.devicePixelRatio, 1.75)
        : 1.0
  renderer.value.setPixelRatio(isSmallScreen ? Math.min(window.devicePixelRatio, 1.5) : targetPixelRatio)
  renderer.value.setSize(width, height, false)
  renderer.value.shadowMap.enabled = quality !== 'performance' && !isSmallScreen
  renderer.value.shadowMap.type = quality === 'ultra' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap
  renderer.value.outputColorSpace = THREE.SRGBColorSpace
  renderer.value.toneMapping = THREE.ACESFilmicToneMapping
  renderer.value.toneMappingExposure = 1.14

  scene.value = new THREE.Scene()
  scene.value.background = new THREE.Color(0xa8cad9)
  applySceneFog(selectedFieldGeometry.value)

  camera.value = new THREE.PerspectiveCamera(60, width / height, 0.1, 2800)
  camera.value.position.set(0, 29, 42)
  controls.value = new OrbitControls(camera.value, renderer.value.domElement)
  controls.value.target.set(0, 0, 0)
  controls.value.enableDamping = true
  controls.value.dampingFactor = 0.075
  controls.value.enablePan = true
  controls.value.screenSpacePanning = true
  controls.value.mouseButtons.LEFT = THREE.MOUSE.ROTATE
  controls.value.minDistance = 3
  controls.value.maxDistance = 240
  controls.value.maxPolarAngle = Math.PI / 2.02
  controls.value.addEventListener('start', () => {
    cameraFollowEnabled.value = false
  })
  controls.value.addEventListener('change', () => {
    pointerDirty = true
  })

  scene.value.add(new THREE.HemisphereLight(0xf3f7ec, 0x5c432d, 1.52))
  const dirLight = new THREE.DirectionalLight(0xfff0d2, 2.15)
  dirLight.position.set(-35, 65, 25)
  dirLight.castShadow = quality !== 'performance'
  const shadowRes = quality === 'ultra' ? 4096 : quality === 'balanced' ? 2048 : 1024
  dirLight.shadow.mapSize.set(shadowRes, shadowRes)
  dirLight.shadow.camera.left = -45
  dirLight.shadow.camera.right = 45
  dirLight.shadow.camera.top = 45
  dirLight.shadow.camera.bottom = -45
  dirLight.shadow.bias = -0.0002
  mainDirLight = dirLight
  scene.value.add(dirLight)

  const soilTex = createSoilTexture()
  soilTex.anisotropy = renderer.value.capabilities.getMaxAnisotropy() || 16
  groundMaterial = new THREE.MeshLambertMaterial({ color: 0xd8b48c, map: soilTex })
  sectorFalloffTexture = createSectorFalloffTexture()
  const initialValley = selectedFieldGeometry.value
    ? computeValleyMetrics(selectedFieldGeometry.value)
    : null
  const groundSize = initialValley ? initialValley.groundSize : 900
  groundMesh = new THREE.Mesh(new THREE.PlaneGeometry(groundSize, groundSize), groundMaterial)
  groundMesh.rotation.x = -Math.PI / 2
  groundMesh.receiveShadow = true
  scene.value.add(groundMesh)

  parcelSurfaceGroup = new THREE.Group()
  furrowsGroup = new THREE.Group()
  cropGroup = new THREE.Group()
  parcelOutlineGroup = new THREE.Group()
  routeVisualGroup = new THREE.Group()
  routeVisualGroup.visible = showDroneRoute.value
  surroundingsGroup = new THREE.Group()
  scene.value.add(parcelSurfaceGroup, furrowsGroup, cropGroup, parcelOutlineGroup, routeVisualGroup, surroundingsGroup)

  // Dron y Particulas
  droneGroup = createDrone()
  droneGroupReady = true
  droneGroup.position.copy(DRONE_BASE)
  scene.value.add(droneGroup)
  liveDroneGroup = createDrone()
  liveDroneGroup.traverse(object => {
    if (object instanceof THREE.Mesh) {
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      materials.forEach(material => {
        if (material instanceof THREE.MeshLambertMaterial) material.color.setHex(0x20cfc0)
      })
    }
  })
  liveDroneGroup.visible = false
  scene.value.add(liveDroneGroup)
  createParticles()

  // Construye la geometría exacta del polígono real, los surcos recortados y las plantas 1:1
  rebuildParcelScene(true)
  raycaster.value = new THREE.Raycaster()
  mouse.value = new THREE.Vector2()

  let actionTimer = 0
  let lastFrameTimestamp = performance.now()
  let fpsFrameCounter = 0
  let fpsWindowStart = performance.now()
  let raycastTick = 0

  const animate = () => {
    animationId.value = requestAnimationFrame(animate)
    const now = performance.now()
    const deltaSec = Math.min(0.05, Math.max(0.001, (now - lastFrameTimestamp) / 1000))
    const dtScale = deltaSec * 60
    const speedMult = simulationSpeed.value
    const simDeltaSec = deltaSec * speedMult
    const simDtScale = dtScale * speedMult
    lastFrameTimestamp = now

    fpsFrameCounter++
    if (now - fpsWindowStart >= 500) {
      const elapsed = now - fpsWindowStart
      const currentFps = Math.round((fpsFrameCounter * 1000) / elapsed)
      liveFps.value = Math.max(1, Math.min(240, currentFps))
      frameTimeMs.value = Number((elapsed / fpsFrameCounter).toFixed(1))
      fpsFrameCounter = 0
      fpsWindowStart = now
    }

    controls.value?.update()
    updateLiveDrone()
    updateCameraFollow()
    if (simulationPaused.value) {
      if (renderer.value && scene.value && camera.value) renderer.value.render(scene.value, camera.value)
      return
    }
    simulationTime += simDeltaSec
    if (leafWindUniform) leafWindUniform.value = simulationTime
    if (leafWindStrengthUniform) leafWindStrengthUniform.value = windEnabled.value ? 1 : 0

    if (droneState.value === 'IDLE') {
      const hover = Math.sin(simulationTime * 1.8) * 0.08
      droneGroup.position.y = DRONE_BASE.y + hover
      droneGroup.rotation.z = Math.sin(simulationTime * 1.2) * 0.012
      propellers.forEach((propeller, index) => {
        propeller.rotation.y += (index % 2 === 0 ? 0.12 : -0.12) * dtScale
      })
    }

    // Raycaster optimizado: solo evalúa intersecciones cuando el cursor se mueve o durante barrido activo
    raycastTick++
    if (hitboxMesh && (pointerDirty || (droneState.value !== 'IDLE' && raycastTick % 12 === 0)) && raycaster.value && mouse.value && camera.value && scene.value) {
      pointerDirty = false
      raycaster.value.setFromCamera(mouse.value, camera.value)

      const plantHits = raycaster.value.intersectObject(hitboxMesh)
      const hitPlant = (plantHits.length > 0 && plantHits[0].instanceId !== undefined) ? allPlants[plantHits[0].instanceId] : null
      hoveredPlant.value = hitPlant
      if (hitPlant) {
        lastInspectedPlant.value = hitPlant
      }

      if (sectorMarkers.length > 0) {
        const sectorHits = raycaster.value.intersectObjects(sectorMarkers)
        hoveredSector.value = (sectorHits.length > 0) ? sectorHits[0].object.userData as StressCenter : null
      } else {
        hoveredSector.value = null
      }
    }

    // Drone Animation & Simulación Progresiva de Estrés Hídrico
    if (droneState.value === 'CENTINELAS') {
      const rotorSpinScale = dtScale * Math.min(3, speedMult)
      centinelaPropellers.forEach((p, i) => {
        p.rotation.y += (i % 2 === 0 ? 0.5 : -0.5) * rotorSpinScale
      })
      if (centinelaGroup) {
        centinelaGroup.rotation.y += 0.005 * simDtScale
      }

      tickAccumulatorSec += simDeltaSec
      if (tickAccumulatorSec >= 2.5) {
        tickAccumulatorSec = 0
        runSentinelCycle(false)
      }
    } else if (droneState.value !== 'IDLE') {
      const rotorSpinScale = dtScale * Math.min(3, speedMult)
      propellers.forEach((p, i) => {
        p.rotation.y += (i % 2 === 0 ? 0.5 : -0.5) * rotorSpinScale
      })
      const currentPos = droneGroup.position

      if (droneState.value === 'SCANNING') {
        const targetPos = dronePath[currentPathIndex]
        droneGroup.lookAt(targetPos.x, currentPos.y, targetPos.z)
        const remainingDist = moveDroneToward(
          currentPos,
          targetPos,
          currentDroneSpeedMetersPerSec * 1.25,
          simDeltaSec
        )

        // Detectar sectores dañados conforme el dron sobrevuela todo el polígono
        for (const center of stressCenters) {
          if (!discoveredCenterIds.has(center.id)) {
            const detectRange = Math.max(
              center.radius * 1.45,
              (selectedFieldGeometry.value?.widthMeters ?? 50) * 0.18
            )
            if (Math.hypot(currentPos.x - center.x, currentPos.z - center.z) <= detectRange) {
              discoveredCenterIds.add(center.id)
              addSingleSectorMarker(center)
            }
          }
        }

        if (remainingDist < 0.75) {
          currentPathIndex++
          if (currentPathIndex >= dronePath.length) {
            droneState.value = 'IDLE'
            droneGroup.rotation.set(0, 0, 0)
            hasAnalyzedCrop.value = true
            simulationTick.value += 1
            advanceSimulationTick(allPlants, stressCenters, simulationTick.value, {
              event: 'sentinel_scan',
            })
            refreshInspectedReferences()
            updateMaterials(currentMode.value)
            updateTelemetry()
            revealSectorMarkersOnScene()
            refreshRouteAndReport('INSPECT_STRESS', true)
            void saveScenarioSnapshot(true)

            const affectedTotal =
              telemetry.value.mildCount +
              telemetry.value.moderateCount +
              telemetry.value.criticalCount +
              telemetry.value.irreversibleCount
            const precautionLead = cropPrecautions.value[0] ?? 'Cultivo listo para seguimiento preventivo.'
            setActionFeedback(
              `Análisis completo (Ciclo #${simulationTick.value}): ${affectedTotal} planta(s) dañadas detectadas · Ruta TSP óptima: ${currentFlightPlan.value?.totalDistanceMeters ?? 0} m (ahorro ${currentFlightPlan.value?.batterySavingsPercent ?? 0}% batería). Precaución: ${precautionLead}`
            )
          }
        }
      } else {
        const targetPos = new THREE.Vector3()
        if (droneState.value === 'FLYING' || droneState.value === 'ACTION') {
          const wp = activeWaypoints[activeTargetIndex]
          targetPos.set(wp.x, FLIGHT_HEIGHT, wp.z)
        } else if (droneState.value === 'RETURNING') {
          targetPos.copy(DRONE_BASE)
        }

        if (droneState.value === 'FLYING') {
          droneGroup.lookAt(targetPos.x, currentPos.y, targetPos.z)
          const dist = moveDroneToward(currentPos, targetPos, currentDroneSpeedMetersPerSec, simDeltaSec)
          if (dist < 0.75) {
            droneState.value = 'ACTION'
            droneGroup.rotation.set(0, 0, 0)
            actionTimer = 0
            particleSystem.visible = true
            for (let i = 0; i < PARTICLE_COUNT; i++) {
              particlePositions[i * 3] = currentPos.x + (Math.random() - 0.5) * 4
              particlePositions[i * 3 + 1] = currentPos.y
              particlePositions[i * 3 + 2] = currentPos.z + (Math.random() - 0.5) * 4
              particleVelocities[i * 3 + 1] = -Math.random() * 0.25 - 0.1
            }
          }
        } else if (droneState.value === 'ACTION') {
          actionTimer += simDtScale
          const particleFallScale = dtScale * Math.min(3, speedMult)
          const spreadRadius = Math.max(
            3.5,
            Math.min(
              12,
              Math.min(selectedFieldGeometry.value?.widthMeters ?? 40, selectedFieldGeometry.value?.depthMeters ?? 40) * 0.08
            )
          )
          for (let i = 0; i < PARTICLE_COUNT; i++) {
            particlePositions[i * 3 + 1] += particleVelocities[i * 3 + 1] * particleFallScale
            if (particlePositions[i * 3 + 1] < 0) {
              particlePositions[i * 3] = currentPos.x + (Math.random() - 0.5) * spreadRadius
              particlePositions[i * 3 + 1] = currentPos.y - 0.5
              particlePositions[i * 3 + 2] = currentPos.z + (Math.random() - 0.5) * spreadRadius
            }
          }
          particleGeo.attributes.position.needsUpdate = true

          if (actionTimer >= 72) {
            particleSystem.visible = false

            const treatedWp = activeWaypoints[activeTargetIndex]
            const treatmentAction: 'WATER' | 'FUMIGATE' = currentAction.value === 'FUMIGATE' ? 'FUMIGATE' : 'WATER'
            const outcome = applyTreatmentAtLocation(
              allPlants,
              { x: treatedWp.x, z: treatedWp.z },
              spreadRadius,
              treatmentAction,
              simulationTick.value,
              { targetPlantIds: treatedWp.coveredPlantIds }
            )
            missionRecoveredCount += outcome.recoveredCount
            missionIrreversibleCount += outcome.irreversibleCount

            // Despejar centros de estrés tratados cuya población ya quedó bajo control
            stressCenters = stressCenters.filter(center => {
              const distToWp = Math.hypot(center.x - treatedWp.x, center.z - treatedWp.z)
              if (treatmentAction === 'WATER' && center.type === 'DROUGHT' && distToWp <= center.radius + spreadRadius) {
                return false
              }
              if (treatmentAction === 'FUMIGATE' && center.type === 'PEST' && distToWp <= center.radius + spreadRadius) {
                return false
              }
              return true
            })
            revealSectorMarkersOnScene()
            refreshInspectedReferences()
            updateMaterials(currentMode.value)
            updateTelemetry()
            refreshRouteAndReport(treatmentAction, false)

            activeTargetIndex++
            if (activeTargetIndex >= activeWaypoints.length) {
              droneState.value = 'RETURNING'
            } else {
              droneState.value = 'FLYING'
            }
          }
        } else if (droneState.value === 'RETURNING') {
          droneGroup.lookAt(targetPos.x, currentPos.y, targetPos.z)
          const dist = moveDroneToward(
            currentPos,
            targetPos,
            currentDroneSpeedMetersPerSec * 1.35,
            simDeltaSec
          )
          if (dist < 0.45) {
            droneState.value = 'IDLE'
            droneGroup.rotation.set(0, 0, 0)
            const completedAction = currentAction.value
            const executedPlan = activeMissionPlan
            currentAction.value = 'NONE'
            activeMissionPlan = null
            refreshRouteAndReport('INSPECT_STRESS', true)
            setActionFeedback(
              `${completedAction === 'WATER' ? 'Riego completado' : 'Fumigación completada'}: ${missionRecoveredCount} plantas recuperadas` +
                (missionIrreversibleCount > 0 ? `, ${missionIrreversibleCount} irrecuperables` : '') +
                (executedPlan ? ` · Ruta ${executedPlan.totalDistanceMeters} m (ahorro ${executedPlan.batterySavingsPercent}% batería).` : '.')
            )
          }
        }
      }
    }

    if (renderer.value && scene.value && camera.value) renderer.value.render(scene.value, camera.value)
  }
  animate()

  window.addEventListener('resize', onWindowResize)
  resizeObserver.value = new ResizeObserver(onWindowResize)
  resizeObserver.value.observe(canvasRef.value)
  resizeObserver.value.observe(containerRef.value)
  containerRef.value.addEventListener('pointermove', onMouseMove)
}

const onMouseMove = (event: PointerEvent) => {
  if (!canvasRef.value || !mouse.value) return
  const rect = canvasRef.value.getBoundingClientRect()
  mouse.value.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  mouse.value.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
  pointerDirty = true
}

const onGraphicsQualityChange = (preset: GraphicsQualityPreset) => {
  setGraphicsQuality(preset)
  if (!renderer.value || !scene.value) return
  const isSmallScreen = window.matchMedia('(max-width: 767px)').matches
  const targetPixelRatio =
    preset === 'ultra'
      ? Math.min(window.devicePixelRatio, 2.5)
      : preset === 'balanced'
        ? Math.min(window.devicePixelRatio, 1.75)
        : 1.0
  renderer.value.setPixelRatio(isSmallScreen ? Math.min(window.devicePixelRatio, 1.5) : targetPixelRatio)
  renderer.value.shadowMap.enabled = preset !== 'performance' && !isSmallScreen
  renderer.value.shadowMap.type = preset === 'ultra' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap
  renderer.value.shadowMap.needsUpdate = true
  applySceneFog(selectedFieldGeometry.value)
  if (mainDirLight) {
    mainDirLight.castShadow = preset !== 'performance'
    const shadowRes = preset === 'ultra' ? 4096 : preset === 'balanced' ? 2048 : 1024
    mainDirLight.shadow.mapSize.set(shadowRes, shadowRes)
    mainDirLight.shadow.map?.dispose()
    mainDirLight.shadow.map = null
  }
  onWindowResize()
  setActionFeedback(
    preset === 'ultra'
      ? `Motor Gráfico Ultra PC activado: Sombras 4K, Supersampling GPU (${targetPixelRatio.toFixed(2)}x) y Anisotropía 16x.`
      : preset === 'balanced'
        ? 'Motor Gráfico Equilibrado activado: Sombras 2K y consumo optimizado.'
        : 'Modo Máximo Rendimiento (FPS Desbloqueados) activado.'
  )
}

const onWindowResize = () => {
  if (!canvasRef.value || !camera.value || !renderer.value) return
  const width = canvasRef.value.clientWidth, height = canvasRef.value.clientHeight
  if (!width || !height) return
  camera.value.aspect = width / height
  camera.value.updateProjectionMatrix()
  const isSmallScreen = window.matchMedia('(max-width: 767px)').matches
  const preset = graphicsQuality.value
  const targetPixelRatio =
    preset === 'ultra'
      ? Math.min(window.devicePixelRatio, 2.5)
      : preset === 'balanced'
        ? Math.min(window.devicePixelRatio, 1.75)
        : 1.0
  renderer.value.shadowMap.enabled = preset !== 'performance' && !isSmallScreen
  renderer.value.setPixelRatio(isSmallScreen ? Math.min(window.devicePixelRatio, 1.5) : targetPixelRatio)
  renderer.value.setSize(width, height, false)
  pointerDirty = true
}

onMounted(async () => {
  document.addEventListener('fullscreenchange', onFullscreenChange)
  try {
    fields.value = await listFields()
    parcelSimStore.setFields(fields.value)

    const requestedFieldId = typeof route.query.fieldId === 'string' ? route.query.fieldId : ''
    const preferredId = requestedFieldId || parcelSimStore.activeFieldId
    const validPreferred = preferredId
      ? fields.value.find(item => item.id === preferredId && Boolean(projectFieldGeometry(item.geojson_data)))
      : null
    const firstValidField = fields.value.find(item => Boolean(projectFieldGeometry(item.geojson_data)))

    selectedFieldId.value = validPreferred?.id ?? firstValidField?.id ?? fields.value[0]?.id ?? ''
    if (selectedFieldId.value) {
      parcelSimStore.selectField(selectedFieldId.value)
    }

    const { geojson } = activeFieldGeojsonAndName()
    selectedFieldGeometry.value = projectFieldGeometry(geojson)
  } catch (error) {
    setActionFeedback(error instanceof Error
      ? `No se pudieron cargar los campos: ${error.message}`
      : 'No se pudieron cargar los campos.')
  }
  initThree()
})
onBeforeUnmount(() => {
  cancelAnimationFrame(animationId.value); window.removeEventListener('resize', onWindowResize)
  document.removeEventListener('fullscreenchange', onFullscreenChange)
  if (feedbackTimeout) clearTimeout(feedbackTimeout)
  resizeObserver.value?.disconnect()
  if (containerRef.value) containerRef.value.removeEventListener('pointermove', onMouseMove)
  controls.value?.dispose()
  if (surroundingsGroup) disposeGroupChildren(surroundingsGroup)
  groundMesh?.geometry.dispose()
  groundMaterial?.map?.dispose()
  parcelSurfaceMaterial?.dispose()
  sectorFalloffTexture?.dispose()
  renderer.value?.dispose()
})
</script>

<template>
  <div class="simulation-view flex flex-col relative">
    <!-- Header -->
    <div class="simulation-header px-6 py-4 bg-white border-b border-gray-200 flex justify-between items-center z-20 shadow-sm relative">
      <div>
        <div class="flex items-center gap-2.5 flex-wrap">
          <span class="simulation-eyebrow">LABORATORIO AGRÍCOLA · MOTOR GPU</span>
          <span
            class="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-950/60 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-300"
            :title="`Aceleración por hardware activa: ${gpuRendererName}`"
          >
            <Cpu :size="12" class="text-emerald-400" />
            <span>{{ liveFps }} FPS · {{ frameTimeMs }} ms</span>
            <span class="hidden xl:inline text-emerald-400/75">· {{ gpuRendererName.slice(0, 28) }}</span>
          </span>
        </div>
        <h1 class="text-2xl font-bold text-gray-900">Simulador de cultivos</h1>
        <p class="text-sm text-gray-500 mt-1">Explora el cultivo con aceleración GPU dedicada, analiza su vigor y ejecuta misiones con drones.</p>
      </div>
      
      <div class="simulation-header-actions">
        <select
          :value="graphicsQuality"
          class="simulation-field-select"
          aria-label="Calidad gráfica y aceleración de hardware"
          title="Nivel de optimización y calidad gráfica GPU"
          @change="onGraphicsQualityChange(($event.target as HTMLSelectElement).value as GraphicsQualityPreset)"
        >
          <option value="ultra">Gráficos: Ultra PC (4K · 16x)</option>
          <option value="balanced">Gráficos: Equilibrado (2K)</option>
          <option value="performance">Gráficos: Máx. FPS</option>
        </select>
        <select
          v-model="selectedFieldId"
          class="simulation-field-select"
          aria-label="Asociar simulación a un campo"
          @change="applySelectedField"
        >
          <option value="">Sin campo asociado</option>
          <option v-for="field in fields" :key="field.id" :value="field.id">{{ field.name }}</option>
        </select>
        <button
          class="simulation-toolbar-button"
          type="button"
          @click="toggleSimulation"
          :aria-label="simulationPaused ? 'Reanudar simulación' : 'Pausar simulación'"
          :title="simulationPaused ? 'Reanudar simulación' : 'Pausar simulación'"
        >
          <Play v-if="simulationPaused" :size="15" />
          <Pause v-else :size="15" />
          {{ simulationPaused ? 'Reanudar' : 'Pausar' }}
        </button>
        <div class="simulation-speed-group" role="group" aria-label="Velocidad de simulación">
          <span class="simulation-speed-label" title="Acelerar tiempo y vuelo del dron">
            <FastForward :size="14" />
          </span>
          <button
            v-for="speed in SPEED_OPTIONS"
            :key="speed"
            type="button"
            class="simulation-speed-btn"
            :aria-pressed="simulationSpeed === speed"
            :title="`Acelerar simulación a ${speed}x`"
            @click="setSimulationSpeed(speed)"
          >
            {{ speed }}x
          </button>
        </div>
        <button
          class="simulation-toolbar-button"
          type="button"
          @click="toggleWind"
          :aria-pressed="windEnabled"
          :title="windEnabled ? 'Desactivar viento' : 'Activar viento'"
        >
          <Wind :size="15" />
          {{ windEnabled ? 'Viento' : 'Sin viento' }}
        </button>
        <button
          class="simulation-toolbar-button"
          type="button"
          @click="toggleDroneRouteVisibility"
          :aria-pressed="showDroneRoute"
          :title="showDroneRoute ? 'Ocultar trazado de ruta del dron' : 'Mostrar trazado de ruta del dron'"
        >
          <Route v-if="showDroneRoute" :size="15" />
          <EyeOff v-else :size="15" />
          {{ showDroneRoute ? 'Ocultar ruta' : 'Mostrar ruta' }}
        </button>
        <button class="simulation-toolbar-button" type="button" @click="runProgressiveTick('degradation', true)" :disabled="simulationPaused || allPlants.length === 0" title="Avanzar un ciclo de simulación y estrés hídrico">
          <RotateCw :size="15" />
          +1 Ciclo (#{{ simulationTick }})
        </button>
        <button class="simulation-toolbar-button" type="button" @click="exportCropData" :disabled="allPlants.length === 0">
          <Download :size="15" />
          Exportar CSV
        </button>
        <button class="simulation-toolbar-button" type="button" @click="downloadSimulationReport" :disabled="!currentReport" title="Descargar SimulationReport JSON (GeoJSON + plantas + ruta IA)">
          <FileJson :size="15" />
          Reporte JSON
        </button>
        <button
          class="inline-flex min-h-[40px] items-center justify-center gap-2 rounded-[10px] border border-emerald-400/40 bg-emerald-500/20 px-3.5 text-xs font-bold text-emerald-200 transition hover:bg-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-45"
          type="button"
          :disabled="allPlants.length === 0 || exportingToDashboard"
          title="Exportar simulación completa (polígono real, severidad y análisis económico) al Dashboard del cliente"
          @click="exportToDashboard"
        >
          <BarChart3 :size="15" />
          {{ exportingToDashboard ? 'Exportando…' : 'Enviar al Dashboard' }}
        </button>
        <button class="simulation-new-scenario" type="button" @click="createNewScenario" :disabled="savingSnapshot" title="Reiniciar simulación al estado inicial sin trazado de ruta">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
            <path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.64 5.64l2.12 2.12m8.48 8.48 2.12 2.12m0-12.72-2.12 2.12m-8.48 8.48-2.12 2.12M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6" />
          </svg>
          {{ savingSnapshot ? 'Guardando…' : 'Nuevo escenario' }}
        </button>
        <div class="simulation-mode-switch flex p-1 rounded-lg gap-1" role="group" aria-label="Capas de visualización">
          <button
            v-for="mode in modes"
            :key="mode.id"
            @click="updateMaterials(mode.id)"
            class="flex items-center gap-2 px-4 py-2 rounded-md transition-all text-sm font-medium"
            :class="currentMode === mode.id ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'"
            :aria-pressed="currentMode === mode.id"
          >
            <span class="w-3 h-3 rounded-full" :class="mode.color"></span>
            {{ mode.name }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="actionFeedback" class="simulation-feedback" role="status" aria-live="polite">
      <span class="simulation-feedback-dot" :class="droneState === 'IDLE' ? 'is-idle' : ''"></span>
      <span>{{ actionFeedback }}</span>
      <button type="button" aria-label="Cerrar mensaje" @click="actionFeedback = ''">×</button>
    </div>
    
    <div ref="containerRef" class="simulation-stage flex-1 relative bg-gray-900 cursor-crosshair">
      <canvas ref="canvasRef" class="w-full h-full outline-none" role="img" aria-label="Vista tridimensional interactiva del cultivo. Usa el ratón o gestos para explorar."></canvas>
      <p class="simulation-touch-hint">
        <span class="desktop-camera-hint">Arrastra para orbitar · botón derecho para desplazar · rueda para zoom</span>
        <span class="mobile-camera-hint">Un dedo: orbitar · dos dedos: desplazar y zoom</span>
      </p>
      <div class="simulation-live-badge" :class="{ 'is-tracking': liveDrone.connected && liveDrone.hasHeartbeat }" role="status">
        <span></span>
        {{ liveDrone.connected && liveDrone.hasHeartbeat
          ? `Dron real · GPS${liveDrone.relativeAltitude === null ? (liveDrone.armed ? ' · altura estimada' : ' · altura sin dato') : ` · alt. relativa ${liveDrone.relativeAltitude.toFixed(1)} m`}`
          : 'Esperando telemetría real' }}
      </div>
      <div class="simulation-camera-tools" role="group" aria-label="Controles de cámara">
        <button
          type="button"
          @click="cycleSimulationSpeed"
          :aria-pressed="simulationSpeed > 1"
          :title="`Acelerar tiempo y vuelo del dron (actual ${simulationSpeed}x)`"
        >
          <FastForward />
          <span>{{ simulationSpeed }}x</span>
        </button>
        <button
          type="button"
          @click="toggleDroneRouteVisibility"
          :aria-pressed="showDroneRoute"
          :aria-label="showDroneRoute ? 'Ocultar trazado del dron' : 'Mostrar trazado del dron'"
          :title="showDroneRoute ? 'Ocultar trazado del dron' : 'Mostrar trazado del dron'"
        >
          <Route v-if="showDroneRoute" />
          <EyeOff v-else />
        </button>
        <button
          type="button"
          @click="toggleCameraPanMode"
          :aria-pressed="cameraPanMode"
          :aria-label="cameraPanMode ? 'Cambiar a modo orbitar' : 'Cambiar a modo desplazar'"
          :title="cameraPanMode ? 'Modo desplazar activo' : 'Activar modo desplazar'"
        >
          <Move />
        </button>
        <button
          type="button"
          @click="toggleCameraFollow"
          :aria-pressed="cameraFollowEnabled"
          :aria-label="cameraFollowEnabled ? 'Desactivar seguimiento del dron' : 'Seguir al dron'"
          :title="cameraFollowEnabled ? 'Desactivar seguimiento del dron' : 'Seguir al dron'"
        >
          <LocateFixed />
        </button>
        <button type="button" @click="zoomCamera('out')" aria-label="Alejar vista" title="Alejar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 4.5 4.5M7.8 10.8h6" stroke-linecap="round" /></svg>
        </button>
        <button type="button" @click="zoomCamera('in')" aria-label="Acercar vista" title="Acercar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 4.5 4.5M7.8 10.8h6m-3-3v6" stroke-linecap="round" /></svg>
        </button>
        <button type="button" @click="resetCamera" aria-label="Restablecer vista de cámara" title="Restablecer vista">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path d="M3 12a9 9 0 1 0 2.64-6.36L3 8m0-5v5h5" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" /></svg>
          <span>Restablecer</span>
        </button>
        <button
          type="button"
          @click="toggleFullscreen"
          :aria-label="isFullscreen ? 'Salir de pantalla completa' : 'Expandir simulador a pantalla completa'"
          :title="isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'"
        >
          <Minimize2 v-if="isFullscreen" />
          <Maximize2 v-else />
        </button>
      </div>


      <!-- Columna Izquierda Fija: Estado + Leyenda + Inspector Fijo de Planta -->
      <div class="simulation-hud-left">
        <div class="simulation-demo-badge" :aria-label="selectedFieldGeometry ? 'Geometría real del campo a escala métrica; cultivo visual demostrativo' : 'Entorno demostrativo'">
          <span class="simulation-demo-dot"></span>
          <span>{{ selectedFieldGeometry ? 'GEOMETRÍA REAL · ESCALA 1:1' : 'ENTORNO DEMOSTRATIVO · DATOS SIMULADOS' }}</span>
          <small v-if="selectedFieldGeometry">{{ fieldDimensionsLabel }} · cultivo visual demostrativo</small>

        </div>

        <!-- Leyendas -->
        <div v-if="currentMode === 'rgb'" class="simulation-panel simulation-legend p-3.5 text-white shadow-2xl w-64 transition-all">
          <h3 class="font-bold text-sm mb-2 border-b border-white/20 pb-1.5">Vista natural · RGB</h3>
          <p class="text-xs text-gray-300 mb-2.5">Representación visual del estado general de las plantas.</p>
          <div class="simulation-color-key">
            <span><i class="key-healthy"></i> Vigor alto</span>
            <span><i class="key-stressed"></i> Vigor bajo</span>
          </div>
        </div>

        <div v-if="currentMode === 'ndvi'" class="simulation-panel simulation-legend p-3.5 text-white shadow-2xl w-64 transition-all">
          <h3 class="font-bold text-sm mb-2 border-b border-white/20 pb-1.5">Índice de vegetación · NDVI</h3>
          <p class="text-xs text-gray-300 mb-2.5">Lectura visual del vigor vegetal en el cultivo.</p>
          <div class="space-y-2">
            <div class="flex items-center justify-between"><div class="flex items-center gap-2"><div class="w-5 h-3.5 bg-[#16a34a] rounded-sm"></div><span class="text-xs font-medium">Alto Vigor</span></div></div>
            <div class="flex items-center justify-between"><div class="flex items-center gap-2"><div class="w-5 h-3.5 bg-[#facc15] rounded-sm"></div><span class="text-xs font-medium">Moderado</span></div></div>
            <div class="flex items-center justify-between"><div class="flex items-center gap-2"><div class="w-5 h-3.5 bg-[#f97316] rounded-sm"></div><span class="text-xs font-medium">Bajo Vigor</span></div></div>
            <div class="flex items-center justify-between"><div class="flex items-center gap-2"><div class="w-5 h-3.5 bg-[#dc2626] rounded-sm"></div><span class="text-xs font-medium">Plaga Severa</span></div></div>
          </div>
        </div>

        <div v-if="currentMode === 'thermal'" class="simulation-panel simulation-legend p-3.5 text-white shadow-2xl w-64 transition-all">
          <h3 class="font-bold text-sm mb-2 border-b border-white/20 pb-1.5">Térmico (Sequía)</h3>
          <p class="text-xs text-gray-300 mb-2.5">La falta de agua dispara la temperatura de la planta.</p>
          <div class="flex gap-3">
            <div class="w-3.5 rounded-full bg-gradient-to-b from-[#ef4444] via-[#fde047] to-[#1d4ed8] h-24"></div>
            <div class="flex flex-col justify-between py-0.5 flex-1">
              <div class="flex justify-between items-center"><span class="text-xs font-medium text-red-400">Crítico (>35°C)</span></div>
              <div class="flex justify-between items-center"><span class="text-xs font-medium text-yellow-400">Alerta (30°C)</span></div>
              <div class="flex justify-between items-center"><span class="text-xs font-medium text-blue-400">Óptimo (25°C)</span></div>
            </div>
          </div>
        </div>

        <!-- Campo Fijo de Inspección de Planta y Sector (debajo de Vista natural · RGB) -->
        <div
          v-if="inspectedPlant"
          class="simulation-panel simulation-inspector p-3.5 text-white shadow-2xl w-64 transition-all"
          aria-live="polite"
        >
          <div class="flex items-center justify-between gap-2 mb-2 pb-1.5 border-b border-white/15">
            <div class="flex items-center gap-2">
              <span
                class="w-2.5 h-2.5 rounded-full shrink-0"
                :class="inspectedPlant.health > 0.6 ? 'bg-green-400' : 'bg-red-400'"
              ></span>
              <h4 class="font-bold text-white text-sm">Planta {{ inspectedPlant.id }}</h4>
            </div>
            <span
              class="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
              :class="
                hoveredPlant
                  ? 'bg-emerald-400/20 text-emerald-300 border border-emerald-400/30'
                  : 'bg-white/10 text-gray-300'
              "
            >
              {{ hoveredPlant ? 'En cursor' : 'Fija' }}
            </span>
          </div>

          <div class="space-y-2 text-xs">
            <div class="flex justify-between items-center">
              <span class="text-gray-400">Etapa</span>
              <span class="font-semibold text-emerald-400">
                {{ inspectedPlant.stage === 1 ? 'Brote' : (inspectedPlant.stage === 2 ? 'Desarrollo' : 'Madurez') }}
              </span>
            </div>
            <div>
              <div class="flex justify-between mb-1">
                <span class="text-gray-400">Estrés hídrico</span>
                <span
                  class="font-bold"
                  :class="
                    inspectedPlant.waterStressPercent >= 68
                      ? 'text-red-400'
                      : inspectedPlant.waterStressPercent >= 42
                        ? 'text-orange-300'
                        : inspectedPlant.waterStressPercent >= 18
                          ? 'text-yellow-300'
                          : 'text-emerald-300'
                  "
                >
                  {{ inspectedPlant.waterStressPercent.toFixed(1) }}%
                </span>
              </div>
              <div class="w-full bg-white/10 h-1.5 rounded-full overflow-hidden">
                <div
                  class="h-full rounded-full transition-all duration-200"
                  :class="
                    inspectedPlant.waterStressPercent >= 68
                      ? 'bg-red-500'
                      : inspectedPlant.waterStressPercent >= 42
                        ? 'bg-orange-400'
                        : inspectedPlant.waterStressPercent >= 18
                          ? 'bg-yellow-400'
                          : 'bg-emerald-400'
                  "
                  :style="`width: ${Math.min(100, Math.max(2, inspectedPlant.waterStressPercent))}%`"
                ></div>
              </div>
            </div>
            <div>
              <div class="flex justify-between mb-1">
                <span class="text-gray-400">NDVI</span>
                <span class="font-bold text-white">{{ inspectedPlant.ndvi.toFixed(2) }}</span>
              </div>
              <div class="w-full bg-white/10 h-1.5 rounded-full overflow-hidden">
                <div
                  class="h-full bg-green-400 rounded-full transition-all duration-200"
                  :style="`width: ${Math.min(100, Math.max(0, inspectedPlant.ndvi * 100))}%`"
                ></div>
              </div>
            </div>
            <div class="flex justify-between items-center">
              <span class="text-gray-400">Temperatura</span>
              <span
                class="font-bold"
                :class="inspectedPlant.temp > 30 ? 'text-red-400' : 'text-sky-400'"
              >
                {{ inspectedPlant.temp.toFixed(1) }} °C
              </span>
            </div>
            <div class="flex justify-between items-center">
              <span class="text-gray-400">GPS</span>
              <span class="font-mono text-[10px] text-emerald-200">
                {{ inspectedPlant.lat.toFixed(5) }}, {{ inspectedPlant.lng.toFixed(5) }}
              </span>
            </div>
            <div class="flex justify-between items-center pt-1 border-t border-white/10">
              <span class="text-gray-400">Estado ({{ inspectedPlant.history.length }} reg.)</span>
              <span
                class="font-bold"
                :class="inspectedPlant.irreversible ? 'text-red-400' : inspectedPlant.waterStressPercent >= 42 ? 'text-amber-300' : 'text-emerald-300'"
              >
                {{ STRESS_STATE_LABELS[inspectedPlant.state] }}
              </span>
            </div>
          </div>

          <template v-if="hoveredSector">
            <div class="my-2.5 border-t border-dashed border-white/20"></div>
            <div class="flex items-center gap-2 mb-1.5">
              <div
                class="w-2.5 h-2.5 rounded-full animate-pulse"
                :class="hoveredSector.type === 'DROUGHT' ? 'bg-orange-400' : 'bg-purple-400'"
              ></div>
              <h5 class="font-bold text-xs text-white">
                {{ hoveredSector.type === 'DROUGHT' ? 'Sector de Sequía' : 'Sector de Plaga' }}
              </h5>
              <span
                class="ml-auto text-xs font-bold"
                :class="hoveredSector.type === 'DROUGHT' ? 'text-orange-400' : 'text-purple-300'"
              >
                {{ (hoveredSector.intensity * 100).toFixed(0) }}%
              </span>
            </div>
            <div class="rounded-lg bg-white/5 px-2.5 py-1.5 border border-white/10 text-[11px]">
              <span class="text-gray-400 block">Recomendación Autónoma:</span>
              <strong :class="hoveredSector.type === 'DROUGHT' ? 'text-sky-300' : 'text-emerald-300'">
                {{ hoveredSector.type === 'DROUGHT' ? 'Requiere Irrigación' : 'Requiere Fumigación' }}
              </strong>
            </div>
          </template>
        </div>

        <!-- Leyenda de Sectores -->
        <div v-if="droneState !== 'IDLE' || sectorMarkers.length > 0" class="simulation-panel simulation-severity p-3.5 text-white shadow-2xl w-64 transition-all">
          <h3 class="font-bold text-xs mb-2 border-b border-white/20 pb-1.5">Severidad de Sectores</h3>
          <div class="space-y-2.5 text-xs">
            <div>
              <span class="block mb-1 text-gray-300 font-medium">Sequía (Requiere Riego)</span>
              <div class="h-1.5 w-full bg-gradient-to-r from-[#facc15] to-[#ea580c] rounded-full"></div>
            </div>
            <div>
              <span class="block mb-1 text-gray-300 font-medium">Plaga (Requiere Fumigación)</span>
              <div class="h-1.5 w-full bg-gradient-to-r from-[#c084fc] to-[#7e22ce] rounded-full"></div>
            </div>
          </div>
        </div>
      </div>
      <!-- Columna Derecha Fija: Centro de Misión + Estado del Cultivo (sin superposición) -->
      <div class="simulation-hud-right">
        <!-- Menú de Dron / Análisis -->
        <div class="simulation-panel simulation-controls p-3.5 text-white shadow-2xl w-64 transition-all">
          <div class="simulation-panel-heading">
            <span class="simulation-panel-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="m5 10 7-4 7 4v4l-7 4-7-4v-4Zm2 1 5 3 5-3M12 6v8m-7-1-3 2m17-2 3 2" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6" />
              </svg>
            </span>
            <span class="simulation-panel-title"><strong>Centro de misión</strong><small>Operaciones autónomas</small></span>
            <span class="simulation-status" :class="droneState === 'IDLE' ? 'status-ready' : 'status-active'">
              <span></span>
              {{ droneState === 'IDLE' ? 'Disponible' : (droneState === 'SCANNING' ? 'Escaneando' : (droneState === 'CENTINELAS' ? 'Centinelas' : 'En misión')) }}
            </span>
          </div>
          
          <p class="simulation-control-hint">
            {{ simulationPaused ? 'Simulación pausada.' : 'Selecciona una operación para el dron.' }}
          </p>
          <div class="simulation-actions">
            <button @click="handleAction('ANALYZE')" :disabled="droneState !== 'IDLE' || simulationPaused" class="simulation-action simulation-action-wide simulation-action-primary w-full disabled:cursor-not-allowed p-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
              Analizar cultivo
            </button>
            
            <button @click="handleAction('CENTINELAS')" :disabled="simulationPaused || (droneState !== 'IDLE' && droneState !== 'CENTINELAS')" class="simulation-action simulation-action-wide simulation-action-sentinel w-full disabled:cursor-not-allowed p-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
              {{ droneState === 'CENTINELAS' ? 'Detener Centinelas' : 'Activar Centinelas' }}
            </button>
            
            <div class="simulation-action-row">
              <button @click="handleAction('WATER')" :disabled="droneState !== 'IDLE' || simulationPaused" class="simulation-action simulation-action-water disabled:cursor-not-allowed p-2 rounded-lg text-sm font-medium flex items-center justify-center gap-1.5">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1M4.22 4.22l.71.71m14.14 14.14l.71.71M1 12h1m20 0h1M4.22 19.78l.71-.71M18.07 5.93l.71-.71M12 6a6 6 0 100 12 6 6 0 000-12z"/></svg>
                Regar
              </button>
              <button @click="handleAction('FUMIGATE')" :disabled="droneState !== 'IDLE' || simulationPaused" class="simulation-action simulation-action-fumigate disabled:cursor-not-allowed p-2 rounded-lg text-sm font-medium flex items-center justify-center gap-1.5">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/></svg>
                Fumigar
              </button>
            </div>
          </div>

          <div v-if="hasAnalyzedCrop && cropPrecautions.length" class="mt-3 border-t border-white/10 pt-2.5 space-y-1.5">
            <span class="block text-[10px] font-bold uppercase tracking-wider text-amber-300">
              Precauciones recomendadas
            </span>
            <ul class="space-y-1 text-[11px] leading-snug text-emerald-100/90">
              <li v-for="(item, idx) in cropPrecautions" :key="idx" class="flex items-start gap-1.5">
                <span class="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400"></span>
                <span>{{ item }}</span>
              </li>
            </ul>
          </div>
        </div>

        <!-- Panel de Telemetría en Tiempo Real -->
        <div class="simulation-panel simulation-telemetry p-3.5 text-white shadow-2xl w-64">
          <h3 class="font-bold text-sm mb-2 border-b border-white/20 pb-1.5 flex items-center justify-between gap-2">
            <span class="flex items-center gap-2">
              <span class="w-2 h-2 rounded-full bg-agron-green animate-pulse"></span>
              Estado del cultivo
            </span>
            <span class="text-[10px] rounded bg-white/10 px-1.5 py-0.5 text-amber-300">Ciclo #{{ simulationTick }}</span>
          </h3>
          <div class="space-y-2 text-xs">
            <div class="flex justify-between items-center">
              <span class="text-gray-400">Plantas en polígono</span>
              <span class="font-bold text-white">{{ telemetry.plantCount }}</span>
            </div>
            <div class="flex justify-between items-center">
              <span class="text-gray-400">Estrés hídrico prom.</span>
              <span class="font-bold" :class="telemetry.avgWaterStress >= 42 ? 'text-orange-400' : telemetry.avgWaterStress >= 18 ? 'text-yellow-300' : 'text-emerald-300'">
                {{ telemetry.avgWaterStress }}%
              </span>
            </div>
            <div class="grid grid-cols-3 gap-1 text-[10px] text-center">
              <div class="rounded bg-emerald-500/15 py-1 text-emerald-300">Sanas: {{ telemetry.healthyCount }}</div>
              <div class="rounded bg-amber-500/15 py-1 text-amber-300">Estrés: {{ telemetry.mildCount + telemetry.moderateCount }}</div>
              <div class="rounded bg-red-500/15 py-1 text-red-300">Crít/Irr: {{ telemetry.criticalCount + telemetry.irreversibleCount }}</div>
            </div>
            <div>
              <div class="flex justify-between mb-1">
                <span class="text-gray-400">Salud promedio</span>
                <span class="font-bold" :class="telemetry.avgHealth > 60 ? 'text-green-400' : telemetry.avgHealth > 40 ? 'text-yellow-400' : 'text-red-400'">{{ telemetry.avgHealth }}%</span>
              </div>
              <div class="w-full bg-white/10 rounded-full h-1">
                <div class="h-1 rounded-full transition-all duration-500" :class="telemetry.avgHealth > 60 ? 'bg-green-400' : telemetry.avgHealth > 40 ? 'bg-yellow-400' : 'bg-red-400'" :style="`width: ${telemetry.avgHealth}%`"></div>
              </div>
            </div>
            <div>
              <div class="flex justify-between mb-1">
                <span class="text-gray-400">Humedad suelo</span>
                <span class="font-bold text-blue-400">{{ telemetry.avgHumidity }}%</span>
              </div>
              <div class="w-full bg-white/10 rounded-full h-1">
                <div class="h-1 rounded-full bg-blue-400 transition-all duration-500" :style="`width: ${telemetry.avgHumidity}%`"></div>
              </div>
            </div>
            <div class="flex justify-between items-center">
              <span class="text-gray-400">NDVI / Temp.</span>
              <span class="font-bold text-emerald-300">{{ telemetry.avgNDVI }} · {{ telemetry.avgTemp }} °C</span>
            </div>
            <div v-if="hasAnalyzedCrop && currentFlightPlan" class="mt-2 border-t border-white/15 pt-2 space-y-1 text-[11px]">
              <div class="flex justify-between items-center font-semibold text-cyan-300">
                <span>Ruta IA (TSP 2-opt)</span>
                <span>{{ currentFlightPlan.waypoints.filter(w => w.type === 'target').length }} puntos</span>
              </div>
              <div class="flex justify-between text-gray-300">
                <span>Objetivos / Omitidas:</span>
                <strong>{{ currentFlightPlan.targetedPlantCount }} / {{ currentFlightPlan.skippedHealthyPlantCount }}</strong>
              </div>
              <div class="flex justify-between text-gray-300">
                <span>Dist. vs barrido:</span>
                <strong>{{ currentFlightPlan.totalDistanceMeters.toFixed(0) }} m / {{ currentFlightPlan.baselineFullSweepDistanceMeters.toFixed(0) }} m</strong>
              </div>
              <div class="flex justify-between text-gray-300">
                <span>Tiempo est.:</span>
                <strong>{{ Math.round(currentFlightPlan.estimatedFlightTimeSeconds) }} s</strong>
              </div>
              <div class="flex justify-between text-emerald-300 font-bold">
                <span>Ahorro batería/comb.:</span>
                <span>-{{ currentFlightPlan.batterySavingsPercent }}%</span>
              </div>
            </div>
            <p v-else class="mt-2 border-t border-white/10 pt-2 text-[11px] leading-snug text-gray-400">
              Pulsa <strong class="text-amber-200">Analizar cultivo</strong> para recorrer el campo y trazar la ruta óptima sobre plantas afectadas.
            </p>
          </div>
        </div>
      </div>
    </div>

    <DroneConnectionPanel @telemetry="handleDroneTelemetry" />
  </div>
</template>

<style scoped>
      .simulation-view {
        min-width: 0;
        min-height: calc(100vh - 3rem);
        min-height: calc(100dvh - 3rem);
        gap: 0.85rem;
        animation: simulation-enter 0.45s cubic-bezier(0.16, 1, 0.3, 1) both;
      }

      .simulation-header {
        flex-wrap: wrap;
        gap: 1rem;
        border: 1px solid rgba(196, 218, 147, 0.12);
        border-radius: 16px;
        background:
          radial-gradient(ellipse at 0 0, rgba(120, 150, 76, 0.12), transparent 42%),
          rgba(28, 32, 21, 0.9);
        box-shadow: 0 14px 36px rgba(0, 0, 0, 0.16), inset 0 1px rgba(255, 255, 255, 0.035);
      }

      .simulation-header h1 {
        margin-top: 3px;
        font-size: clamp(1.4rem, 2.5vw, 1.9rem);
        line-height: 1.2;
        letter-spacing: -0.05em;
      }

      .simulation-eyebrow {
        color: #d2b65d;
        font-size: 0.62rem;
        font-weight: 800;
        letter-spacing: 0.15em;
      }

      .simulation-header p { color: #929d86; }

      .simulation-header-actions {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 0.65rem;
        flex-wrap: wrap;
      }

      .simulation-field-select {
        min-height: 40px;
        max-width: 180px;
        padding: 0 10px;
        border: 1px solid rgba(196, 218, 147, 0.17);
        border-radius: 10px;
        color: #cbd4c2;
        background: #19211b;
        font-size: 0.72rem;
      }

      .simulation-toolbar-button {
        display: inline-flex;
        min-height: 40px;
        align-items: center;
        justify-content: center;
        gap: 7px;
        padding: 0 11px;
        border: 1px solid rgba(196, 218, 147, 0.17);
        border-radius: 10px;
        color: #cbd4c2;
        background: rgba(255, 255, 255, 0.035);
        font-size: 0.72rem;
        font-weight: 650;
        transition: color 0.2s ease, background 0.2s ease, border-color 0.2s ease, transform 0.2s ease;
      }

      .simulation-toolbar-button:hover:not(:disabled),
      .simulation-toolbar-button[aria-pressed="true"] {
        border-color: rgba(196, 218, 147, 0.34);
        color: #f0efdf;
        background: rgba(196, 218, 147, 0.1);
      }

      .simulation-toolbar-button:hover:not(:disabled) { transform: translateY(-1px); }
      .simulation-toolbar-button:disabled { cursor: not-allowed; opacity: 0.45; }
      .simulation-toolbar-button:focus-visible,
      .simulation-speed-btn:focus-visible {
        outline: 2px solid #f2d474;
        outline-offset: 2px;
      }

      .simulation-speed-group {
        display: inline-flex;
        min-height: 40px;
        align-items: center;
        gap: 3px;
        padding: 3px 5px;
        border: 1px solid rgba(196, 218, 147, 0.17);
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.035);
      }

      .simulation-speed-label {
        display: inline-flex;
        align-items: center;
        padding: 0 4px;
        color: #d2b65d;
      }

      .simulation-speed-btn {
        min-height: 30px;
        padding: 0 8px;
        border-radius: 7px;
        color: #aeb7a4;
        font-size: 0.71rem;
        font-weight: 700;
        transition: color 0.18s ease, background 0.18s ease;
      }

      .simulation-speed-btn:hover {
        color: #f3f5ea;
        background: rgba(255, 255, 255, 0.08);
      }

      .simulation-speed-btn[aria-pressed="true"] {
        color: #1f1907;
        background: linear-gradient(135deg, #f6d977, #dfb53d);
        box-shadow: 0 4px 12px rgba(214, 172, 58, 0.24);
      }

      .simulation-new-scenario {
        display: inline-flex;
        min-height: 40px;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 0 13px;
        border: 1px solid rgba(211, 189, 103, 0.28);
        border-radius: 10px;
        color: #ead796;
        background: rgba(211, 189, 103, 0.08);
        font-size: 0.75rem;
        font-weight: 700;
        transition: background 0.2s ease, border-color 0.2s ease, transform 0.2s ease;
      }

      .simulation-new-scenario:hover:not(:disabled) {
        transform: translateY(-1px);
        border-color: rgba(238, 203, 113, 0.55);
        background: rgba(211, 189, 103, 0.15);
      }

      .simulation-new-scenario:disabled { cursor: not-allowed; opacity: 0.45; }
      .simulation-new-scenario svg { width: 16px; height: 16px; }

      .simulation-mode-switch {
        flex: 0 0 auto;
        border: 1px solid rgba(196, 218, 147, 0.12);
        background: rgba(7, 11, 8, 0.45);
      }

      .simulation-mode-switch button {
        color: #aab29e;
        transition: color 0.2s ease, background 0.2s ease, transform 0.2s ease;
      }

      .simulation-mode-switch button:hover { color: #eff2e7; }

      .simulation-mode-switch button[aria-pressed="true"] {
        color: #211a08;
        background: linear-gradient(135deg, #f6d977, #dfb53d);
        box-shadow: 0 5px 14px rgba(214, 172, 58, 0.18);
      }

      .simulation-mode-switch button[aria-pressed="true"] span {
        box-shadow: 0 0 0 2px rgba(20, 26, 16, 0.22);
      }

      .simulation-feedback {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 14px;
        border: 1px solid rgba(196, 218, 147, 0.15);
        border-radius: 12px;
        color: #e4e9dc;
        background: rgba(28, 32, 21, 0.86);
        font-size: 0.82rem;
        animation: panel-enter 0.25s ease both;
      }

      .simulation-feedback-dot,
      .simulation-demo-dot {
        flex: 0 0 auto;
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: #efb953;
        box-shadow: 0 0 12px rgba(239, 185, 83, 0.4);
      }

      .simulation-feedback-dot.is-idle {
        background: #96bf61;
        box-shadow: 0 0 12px rgba(150, 191, 97, 0.42);
      }

      .simulation-feedback button {
        margin-left: auto;
        color: #929d86;
        font-size: 1.2rem;
      }

      .simulation-stage {
        height: clamp(600px, 75vh, 860px);
        height: clamp(600px, 75dvh, 860px);
        flex: 0 0 auto;
        overflow: hidden;
        border: 1px solid rgba(196, 218, 147, 0.14);
        border-radius: 18px;
        background:
          radial-gradient(ellipse at 50% 5%, rgba(206, 210, 172, 0.25), transparent 42%),
          linear-gradient(145deg, #1b2921, #101713);
        box-shadow: 0 22px 52px rgba(0, 0, 0, 0.23), inset 0 1px rgba(255, 255, 255, 0.035);
        isolation: isolate;
      }

      .simulation-stage > canvas {
        display: block;
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        touch-action: none;
        cursor: grab;
      }

      .simulation-stage > canvas:active { cursor: grabbing; }

      .simulation-hud-left {
        position: absolute;
        z-index: 10;
        top: 0.9rem;
        left: 0.9rem;
        bottom: 3.3rem;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 0.55rem;
        width: min(15.5rem, calc(50% - 1.25rem));
        overflow-y: auto;
        overflow-x: hidden;
        pointer-events: none;
        scrollbar-width: thin;
      }

      .simulation-hud-right {
        position: absolute;
        z-index: 10;
        top: 0.9rem;
        right: 0.9rem;
        bottom: 0.9rem;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        justify-content: flex-start;
        gap: 0.55rem;
        width: min(15.5rem, calc(50% - 1.25rem));
        overflow-y: auto;
        overflow-x: hidden;
        pointer-events: none;
        scrollbar-width: thin;
      }

      .simulation-hud-left > *,
      .simulation-hud-right > * {
        box-sizing: border-box;
        width: 100%;
        max-width: 100%;
        pointer-events: auto;
        flex-shrink: 0;

      }

      .simulation-touch-hint {
        position: absolute;
        z-index: 3;
        bottom: 0.85rem;
        left: 0.9rem;
        display: block;
        margin: 0;
        padding: 6px 10px;
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 9px;
        color: #e4ecdf;
        background: rgba(13, 20, 16, 0.76);
        backdrop-filter: blur(10px);
        font-size: 0.62rem;
        pointer-events: none;
      }
      .mobile-camera-hint { display: none; }

      .simulation-demo-badge {
        position: relative;
        z-index: 2;

        top: 1rem;
        left: 50%;

        width: fit-content;
        max-width: 100%;

        display: grid;
        grid-template-columns: 6px auto;
        align-items: center;
        column-gap: 8px;
        row-gap: 2px;
        padding: 6px 10px;
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 14px;
        color: #eff1e9;
        background: rgba(13, 20, 16, 0.78);
        backdrop-filter: blur(12px);
        font-size: 0.56rem;
        font-weight: 750;
        letter-spacing: 0.08em;
        transform: translateX(-50%);

        letter-spacing: 0.06em;

        pointer-events: none;
      }

      .simulation-demo-dot {
        width: 6px;
        height: 6px;
        background: #efb953;
        animation: status-pulse 2s ease-in-out infinite;
      }

      .simulation-demo-badge small {
        grid-column: 2;
        color: #c5d0ba;
        font-size: 0.55rem;
        font-weight: 550;
        letter-spacing: 0.02em;
      }

      .simulation-live-badge {
        position: absolute;
        z-index: 3;
        top: 1rem;
        right: 18rem;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        max-width: calc(100% - 20rem);
        padding: 8px 11px;
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 999px;
        color: #d3ddce;
        background: rgba(13, 20, 16, 0.78);
        font-size: 0.62rem;
        pointer-events: none;
      }

      .simulation-live-badge > span {
        width: 7px;
        height: 7px;
        flex: 0 0 auto;
        border-radius: 50%;
        background: #899187;
      }

      .simulation-live-badge.is-tracking > span {
        background: #55e6d0;
        box-shadow: 0 0 12px rgba(85, 230, 208, 0.7);
        animation: status-pulse 1.5s ease-in-out infinite;
      }

      .simulation-camera-tools {
        position: absolute;
        z-index: 5;
        bottom: 1rem;
        left: 50%;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 5px;
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 12px;
        color: #edf1e6;
        background: rgba(13, 20, 16, 0.82);
        backdrop-filter: blur(12px);
        transform: translateX(-50%);
        box-shadow: 0 8px 25px rgba(0, 0, 0, 0.2);
      }

      .simulation-camera-tools button {
        display: inline-flex;
        min-width: 36px;
        min-height: 36px;
        align-items: center;
        justify-content: center;
        gap: 7px;
        padding: 0 9px;
        border: 1px solid transparent;
        border-radius: 8px;
        color: #e7ecdf;
        font-size: 0.69rem;
        font-weight: 650;
        transition: background 0.2s ease, border-color 0.2s ease, transform 0.2s ease;
      }

      .simulation-camera-tools button:hover {
        transform: translateY(-1px);
        border-color: rgba(238, 203, 113, 0.42);
        background: rgba(29, 39, 29, 0.92);
      }

      .simulation-camera-tools svg { width: 16px; height: 16px; }
      .simulation-camera-tools button[aria-pressed="true"] {
        border-color: rgba(85, 230, 208, 0.45);
        color: #8af0dd;
        background: rgba(38, 161, 140, 0.18);
      }

      .simulation-stage:fullscreen {
        width: 100vw;
        height: 100vh;
        height: 100dvh;
        min-height: 100vh;
        min-height: 100dvh;
        max-height: 100dvh;
        flex: none;
        padding: 0;
        border: 0;
        border-radius: 0;
        background: #9fc6d7;
      }

      .simulation-stage:fullscreen > canvas {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        border: 0;
        border-radius: 0;
      }

      .simulation-stage:fullscreen > .simulation-legend {
        position: absolute;
        inset: 1rem auto auto 1rem;
        width: min(270px, calc(100vw - 2rem));
      }

      .simulation-stage:fullscreen > .simulation-hud-left {
        top: 1rem;
        left: 1rem;
        bottom: 3.6rem;
        max-height: calc(100dvh - 4.8rem);
      }

      .simulation-stage:fullscreen > .simulation-hud-right {
        top: 1rem;
        right: 1rem;
        bottom: 1rem;

        max-height: calc(100dvh - 2rem);
      }

      .simulation-stage:fullscreen > .simulation-severity {
        position: absolute;
        inset: auto auto 4.5rem 1rem;
        width: min(270px, calc(100vw - 2rem));
        max-height: calc(100dvh - 7rem);
        overflow: auto;
      }

      .simulation-stage:fullscreen > .simulation-camera-tools {
        top: auto;
        right: auto;
        bottom: 1rem;
        left: 50%;
        transform: translateX(-50%);
      }

      .simulation-stage:fullscreen > .simulation-touch-hint {
        top: auto;
        bottom: 1.1rem;
        left: 1rem;
      }

      .simulation-panel {
        border: 1px solid rgba(196, 218, 147, 0.18);
        border-radius: 16px;
        background:
          linear-gradient(145deg, rgba(24, 31, 23, 0.92), rgba(12, 18, 14, 0.9));
        box-shadow: 0 18px 42px rgba(0, 0, 0, 0.32), inset 0 1px rgba(255, 255, 255, 0.06);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        animation: panel-enter 0.35s cubic-bezier(0.16, 1, 0.3, 1) both;
      }

      .simulation-panel-heading {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 10px;
        margin-bottom: 12px;
        padding-bottom: 12px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.11);
      }

      .simulation-panel-icon {
        display: grid;
        flex: 0 0 auto;
        width: 36px;
        height: 36px;
        place-items: center;
        border: 1px solid rgba(196, 218, 147, 0.16);
        border-radius: 11px;
        color: #e6c961;
        background: rgba(196, 218, 147, 0.08);
      }

      .simulation-panel-icon svg { width: 19px; height: 19px; }
      .simulation-panel-title { min-width: 0; flex: 1 1 5rem; }
      .simulation-panel-title strong,
      .simulation-panel-title small { display: block; }
      .simulation-panel-title strong { color: #f1f2eb; font-size: 0.86rem; }
      .simulation-panel-title small { margin-top: 2px; color: #929d86; font-size: 0.66rem; }

      .simulation-status {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin-left: auto;
        padding: 5px 8px;
        border: 1px solid rgba(196, 218, 147, 0.12);
        border-radius: 999px;
        font-size: 0.61rem;
        font-weight: 700;
        white-space: nowrap;
      }

      .simulation-status > span {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: currentColor;
      }

      .status-ready { color: #b8d986; background: rgba(116, 153, 70, 0.13); }
      .status-active { color: #f2cd71; background: rgba(203, 150, 56, 0.13); }
      .status-active > span { animation: status-pulse 1.2s ease-in-out infinite; }
      .simulation-control-hint { margin: 0 0 11px; color: #909b86; font-size: 0.69rem; }

      .simulation-controls button {
        min-height: 42px;
        transition: filter 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease;
      }

      .simulation-controls button:hover:not(:disabled) {
        transform: translateY(-1px);
        filter: brightness(1.09);
      }

      .simulation-controls button:disabled { opacity: 0.48; }
      .simulation-controls { box-sizing: border-box; min-width: 0; }
      .simulation-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.55rem; }
      .simulation-action-wide { grid-column: 1 / -1; }
      .simulation-action-row { display: grid; grid-column: 1 / -1; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.55rem; }
      .simulation-actions .simulation-action { width: 100%; min-width: 0; padding-inline: 0.45rem; line-height: 1.25; white-space: normal; }
      .simulation-actions .simulation-action svg { flex: 0 0 auto; }

      .simulation-action {
        color: #f2f2e9;
        border: 1px solid rgba(255, 255, 255, 0.12);
        transition: filter 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
      }

      .simulation-action-primary { background: linear-gradient(135deg, #b99d4e, #907a3c); }
      .simulation-action-sentinel { background: linear-gradient(135deg, #63518a, #453661); }
      .simulation-action-water { background: linear-gradient(135deg, #386e83, #285164); }
      .simulation-action-fumigate { background: linear-gradient(135deg, #467a5b, #31583f); }
      .simulation-action:disabled { filter: saturate(0.45); }

      .simulation-controls .simulation-action:disabled { opacity: 0.46; }

      .simulation-controls .simulation-action:not(:disabled):hover {
        box-shadow: 0 5px 16px rgba(0, 0, 0, 0.22);
      }

      .simulation-controls button:focus-visible,
      .simulation-camera-tools button:focus-visible,
      .simulation-new-scenario:focus-visible,
      .simulation-mode-switch button:focus-visible {
        outline: 2px solid #f2d474;
        outline-offset: 2px;
      }

      .simulation-tooltip {
        max-width: calc(100vw - 24px);
        border-color: rgba(196, 218, 147, 0.18);
        background: #1c2015;
        color: #f5f1df;
      }

      .simulation-color-key { display: grid; gap: 9px; color: #d6ddce; font-size: 0.72rem; }
      .simulation-color-key span { display: inline-flex; align-items: center; gap: 9px; }
      .simulation-color-key i { width: 12px; height: 12px; border-radius: 4px; }
      .simulation-color-key .key-healthy { background: #15803d; }
      .simulation-color-key .key-stressed { background: #84cc16; }

      @keyframes simulation-enter {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
      }

      @keyframes panel-enter {
        from { opacity: 0; transform: translateY(6px); }
        to { opacity: 1; transform: translateY(0); }
      }

      @keyframes status-pulse {
        0%, 100% { opacity: 0.65; box-shadow: 0 0 0 0 rgba(239, 185, 83, 0.25); }
        50% { opacity: 1; box-shadow: 0 0 0 5px rgba(239, 185, 83, 0); }
      }

      @media (min-width: 768px) and (max-width: 1023px) {
        .simulation-stage { min-height: clamp(580px, 72dvh, 760px); }
        .simulation-hud-left,
        .simulation-hud-right { width: 220px; }
        .simulation-panel { width: 220px; padding: 0.8rem; }
        .simulation-panel-heading { gap: 7px; }
        .simulation-status { gap: 4px; padding-inline: 6px; font-size: 0.56rem; }
        .simulation-legend,
        .simulation-inspector,
        .simulation-telemetry,
        .simulation-severity { max-width: 220px; }
      }

      @media (max-width: 767px) {
        .simulation-view {
          min-height: 0;
          gap: 0.75rem;
          overflow: visible;
          padding-bottom: max(0.75rem, env(safe-area-inset-bottom));
        }

        .simulation-header {
          align-items: stretch;
          padding: 1rem;
          border-radius: 14px;
        }

        .simulation-header > div:first-child { min-width: 0; }
        .simulation-header p { font-size: 0.8rem; }
        .simulation-header-actions { width: 100%; align-items: stretch; }
        .simulation-header-actions > button { flex: 1 1 calc(50% - 0.65rem); }
        .simulation-header-actions > .simulation-new-scenario { flex: 1; }
        .simulation-toolbar-button { padding-inline: 8px; }
        .simulation-mode-switch {
          width: 100%;
          justify-content: space-between;
          flex-wrap: wrap;
        }
        .simulation-mode-switch button {
          flex: 1 1 auto;
          justify-content: center;
          padding-inline: 0.65rem;
          font-size: 0.75rem;
        }

        .simulation-stage {
          display: flex;
          flex: none;
          flex-direction: column;
          gap: 0.6rem;
          height: auto;
          min-height: 0;
          padding-top: clamp(260px, 44vh, 390px);
          padding-top: clamp(260px, 44dvh, 390px);
          overflow: visible;
          border: 0;
          border-radius: 14px;
          background: transparent;
          box-shadow: none;
        }

        .simulation-stage > canvas {
          position: absolute;
          inset: 0 0 auto;
          width: 100%;
          height: clamp(260px, 44vh, 390px);
          height: clamp(260px, 44dvh, 390px);
          border: 1px solid rgba(196, 218, 147, 0.18);
          border-radius: 14px;
        }

        .simulation-touch-hint {
          position: absolute;
          top: calc(clamp(260px, 44vh, 390px) - 2.65rem);
          top: calc(clamp(260px, 44dvh, 390px) - 2.65rem);
          left: 50%;
          z-index: 3;
          max-width: calc(100% - 1rem);
          margin: 0;
          padding: 6px 9px;
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 8px;
          color: #dce4d5;
          background: rgba(13, 20, 16, 0.72);
          backdrop-filter: blur(10px);
          font-size: 0.62rem;
          white-space: nowrap;
          transform: translateX(-50%);
          pointer-events: none;
        }
        .desktop-camera-hint { display: none; }
        .mobile-camera-hint { display: inline; }

        .simulation-hud-left,
        .simulation-hud-right {
          display: contents;
        }

        .simulation-stage .simulation-panel {

          position: relative;
          inset: auto;
          z-index: 1;
          width: 100%;
          max-width: 100%;
          margin: 0;
        }

        .simulation-demo-badge {
          position: absolute;
          top: 0.75rem;
          left: 0.75rem;
          padding: 7px 9px;
          font-size: 0.52rem;
          transform: none;
        }

        .simulation-live-badge {
          top: 3.2rem;
          right: auto;
          left: 0.75rem;
          max-width: calc(100% - 1.5rem);
          padding: 7px 9px;
          font-size: 0.57rem;
        }

        .simulation-camera-tools {
          top: 0.65rem;
          bottom: auto;
          left: auto;
          right: 0.65rem;
          transform: none;
        }

        .simulation-camera-tools button { min-width: 42px; min-height: 42px; }
        .simulation-camera-tools button span { display: none; }
        .simulation-stage:fullscreen {
          display: block;
          height: 100vh;
          height: 100dvh;
          min-height: 100vh;
          min-height: 100dvh;
          max-height: 100dvh;
          padding: 0;
          overflow: hidden;
          border: 0;
          border-radius: 0;
          background: #9fc6d7;
          box-shadow: none;
        }
        .simulation-stage:fullscreen > canvas {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          border: 0;
          border-radius: 0;
        }

        .simulation-stage:fullscreen .simulation-panel {
          position: absolute;

          inset: 1rem 1rem auto auto;
          width: min(340px, calc(100vw - 2rem));
          max-height: 64dvh;
          overflow: auto;
          padding-top: 0.85rem;
        }
        .simulation-stage:fullscreen > .simulation-legend {
          display: none;
        }
        .simulation-stage:fullscreen > .simulation-severity {
          display: none;
        }
        .simulation-stage:fullscreen > .simulation-camera-tools {
          position: absolute;
          top: auto;
          right: auto;
          bottom: 0.65rem;
          left: auto;
          transform: none;
          width: calc(50vw - 1rem);
          flex-wrap: wrap;
          justify-content: center;
        }
        .simulation-stage:fullscreen > .simulation-touch-hint {
          display: none;
        }
        .simulation-stage:fullscreen > .simulation-camera-tools {
          left: 0.5rem;
        }
        .simulation-panel { border-radius: 14px; }
        .simulation-panel-heading { flex-wrap: wrap; }
        .simulation-panel-icon { width: 34px; height: 34px; }
        .simulation-status { margin-left: auto; }
        .simulation-control-hint { font-size: 0.73rem; }
        .simulation-controls { order: 1; }
        .simulation-inspector { order: 2; }
        .simulation-legend { order: 3; }
        .simulation-severity { order: 4; }
        .simulation-telemetry { order: 5; }
        .simulation-controls button { min-height: 46px; font-size: 0.84rem; }
        .simulation-telemetry { margin-bottom: 0.25rem !important; }
      }

      @media (max-width: 420px) {
        .simulation-mode-switch { flex-wrap: nowrap; }
        .simulation-mode-switch button { gap: 0.35rem; padding-inline: 0.4rem; font-size: 0.68rem; }
        .simulation-new-scenario { min-height: 44px; }
        .simulation-controls { padding: 0.9rem; }
        .simulation-panel-heading { gap: 8px; }
        .simulation-status { padding-inline: 6px; font-size: 0.57rem; }
        .simulation-demo-badge { max-width: calc(100% - 8.5rem); font-size: 0.47rem; }
        .simulation-camera-tools { gap: 2px; }
        .simulation-camera-tools button { min-width: 40px; min-height: 42px; padding-inline: 7px; }
        .simulation-action-row { gap: 0.55rem; }
      }

      @media (prefers-reduced-motion: reduce) {
        .simulation-view, .simulation-panel, .simulation-feedback { animation: none; }
        .simulation-demo-dot, .status-active > span { animation: none; }
        .simulation-controls button, .simulation-camera-tools button,
        .simulation-new-scenario, .simulation-toolbar-button { transition: none; }
      }
</style>
