<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Flame, Map as MapIcon, Route, Satellite } from 'lucide-vue-next'
import type { PlantStressState, SimulationReport } from '../../types/simulation'

const props = defineProps<{
  report: SimulationReport
}>()

const mapContainer = ref<HTMLElement | null>(null)
const basemap = ref<'satellite' | 'streets'>('satellite')
const severityFilter = ref<'all' | 'affected' | PlantStressState>('all')
const showHeatmapGlow = ref(true)
const showDroneRoute = ref(true)

let map: L.Map | null = null
let satelliteLayer: L.TileLayer | null = null
let streetsLayer: L.TileLayer | null = null
let polygonGroup: L.LayerGroup | null = null
let heatmapGroup: L.LayerGroup | null = null
let plantMarkersGroup: L.LayerGroup | null = null
let droneRouteGroup: L.LayerGroup | null = null
let resizeObserver: ResizeObserver | null = null

const satelliteUrl =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const streetsUrl =
  'https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'

const STATE_COLORS: Record<PlantStressState, { fill: string; stroke: string; label: string }> = {
  saludable: { fill: '#22c55e', stroke: '#15803d', label: 'Saludable' },
  estrés_leve: { fill: '#eab308', stroke: '#a16207', label: 'Estrés leve' },
  estrés_moderado: { fill: '#f97316', stroke: '#c2410c', label: 'Estrés moderado' },
  estrés_crítico: { fill: '#ef4444', stroke: '#991b1b', label: 'Estrés crítico' },
  pérdida_irreversible: { fill: '#7f1d1d', stroke: '#fca5a5', label: 'Pérdida irreversible' },
}

const filteredPlants = computed(() => {
  if (severityFilter.value === 'all') return props.report.plants
  if (severityFilter.value === 'affected') {
    return props.report.plants.filter(plant => plant.state !== 'saludable')
  }
  return props.report.plants.filter(plant => plant.state === severityFilter.value)
})

const affectedCount = computed(
  () => props.report.plants.filter(plant => plant.state !== 'saludable').length
)

const setBasemap = (next: 'satellite' | 'streets') => {
  if (!map || basemap.value === next) return
  if (next === 'satellite') {
    streetsLayer?.remove()
    satelliteLayer?.addTo(map)
  } else {
    satelliteLayer?.remove()
    streetsLayer?.addTo(map)
  }
  basemap.value = next
}

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

const renderLayers = (refitBounds = false) => {
  if (!map || !polygonGroup || !heatmapGroup || !plantMarkersGroup || !droneRouteGroup) return

  polygonGroup.clearLayers()
  heatmapGroup.clearLayers()
  plantMarkersGroup.clearLayers()
  droneRouteGroup.clearLayers()

  // 1. Polígono GeoJSON real de la parcela
  const parcelLayer = L.geoJSON(props.report.parcel.geojson as unknown as GeoJSON.GeoJsonObject, {
    style: {
      color: '#facc15',
      weight: 2.5,
      opacity: 0.95,
      fillColor: '#22c55e',
      fillOpacity: 0.1,
    },
  })
  parcelLayer.addTo(polygonGroup)

  if (refitBounds) {
    map.invalidateSize({ animate: false })
    const bounds = parcelLayer.getBounds()
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [36, 36], maxZoom: 19, animate: false })
    } else {
      map.setView([props.report.parcel.centroid.lat, props.report.parcel.centroid.lng], 17)
    }
  }

  // 2. Mapa de calor + marcadores georreferenciados por severidad
  const spacingMeters = Math.max(
    1.8,
    Math.min(
      8,
      Math.sqrt(props.report.parcel.areaSquareMeters / Math.max(1, props.report.plants.length))
    )
  )

  for (const plant of filteredPlants.value) {
    const palette = STATE_COLORS[plant.state]
    const isHealthy = plant.state === 'saludable'

    if (showHeatmapGlow.value && !isHealthy) {
      const heatRadius =
        spacingMeters *
        (plant.state === 'pérdida_irreversible' || plant.state === 'estrés_crítico'
          ? 1.15
          : plant.state === 'estrés_moderado'
            ? 0.95
            : 0.78)
      const heatOpacity =
        plant.state === 'pérdida_irreversible'
          ? 0.42
          : plant.state === 'estrés_crítico'
            ? 0.36
            : plant.state === 'estrés_moderado'
              ? 0.28
              : 0.2

      L.circle([plant.lat, plant.lng], {
        radius: heatRadius,
        stroke: false,
        fillColor: palette.fill,
        fillOpacity: heatOpacity,
        interactive: false,
      }).addTo(heatmapGroup)
    }

    const markerRadius =
      plant.state === 'pérdida_irreversible'
        ? 7.5
        : plant.state === 'estrés_crítico'
          ? 7
          : plant.state === 'estrés_moderado'
            ? 6
            : plant.state === 'estrés_leve'
              ? 5.2
              : 3.5

    const initialStress = plant.history[0]?.waterStressPercent ?? plant.waterStressPercent
    const marker = L.circleMarker([plant.lat, plant.lng], {
      radius: markerRadius,
      color: palette.stroke,
      weight: isHealthy ? 1 : 1.8,
      fillColor: palette.fill,
      fillOpacity: isHealthy ? 0.72 : 0.92,
    })

    const popupHtml = `
      <div style="min-width:190px;font-family:Inter,system-ui,sans-serif;font-size:12px;line-height:1.45;color:#111827">
        <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #e5e7eb;padding-bottom:4px;margin-bottom:6px">
          <strong>Planta ${escapeHtml(plant.id)}</strong>
          <span style="padding:1px 6px;border-radius:999px;font-size:10px;font-weight:700;background:${palette.fill}22;color:${palette.stroke}">${escapeHtml(palette.label)}</span>
        </div>
        <div>Estrés hídrico: <strong>${plant.waterStressPercent.toFixed(1)}%</strong> <span style="color:#6b7280">(Inicio: ${initialStress.toFixed(1)}%)</span></div>
        <div>NDVI: <strong>${plant.ndvi.toFixed(2)}</strong> · Temp: <strong>${plant.tempC.toFixed(1)} °C</strong></div>
        <div>Historial: <strong>${plant.history.length}</strong> ciclos registrados</div>
        <div style="margin-top:4px;font-family:ui-monospace,monospace;font-size:10px;color:#4b5563">${plant.lat.toFixed(6)}, ${plant.lng.toFixed(6)}</div>
      </div>
    `
    const popupOptions: L.PopupOptions = {
      autoPan: true,
      autoPanPadding: L.point(28, 28),
      maxWidth: 250,
    }
    marker.bindPopup(popupHtml, popupOptions)
    marker.addTo(plantMarkersGroup)
  }

  // 3. Ruta optimizada del dron TSP 2-opt
  if (showDroneRoute.value && props.report.droneFlight.orderedCoordinates.length >= 2) {
    const coords = props.report.droneFlight.orderedCoordinates.map(
      c => [c.lat, c.lng] as [number, number]
    )

    L.polyline(coords, {
      color: '#38bdf8',
      weight: 2.8,
      opacity: 0.9,
      dashArray: '6 5',
    }).addTo(droneRouteGroup)

    const popupOptions: L.PopupOptions = {
      autoPan: true,
      autoPanPadding: L.point(28, 28),
      maxWidth: 250,
    }

    const base = props.report.droneFlight.takeoffBase
    L.circleMarker([base.lat, base.lng], {
      radius: 7,
      color: '#ffffff',
      weight: 2,
      fillColor: '#0284c7',
      fillOpacity: 1,
    })
      .bindPopup(
        `<strong>Base de Despegue Dron IA</strong><br/>Distancia optimizada: ${props.report.droneFlight.totalDistanceMeters} m<br/>Ahorro batería: ${props.report.droneFlight.batterySavingsPercent}%`,
        popupOptions
      )
      .addTo(droneRouteGroup)

    const targetWaypoints = props.report.droneFlight.waypoints.filter(wp => wp.type === 'target')
    for (const wp of targetWaypoints) {
      L.circleMarker([wp.lat, wp.lng], {
        radius: 4.5,
        color: '#e0f2fe',
        weight: 1.5,
        fillColor: '#0ea5e9',
        fillOpacity: 0.9,
      })
        .bindPopup(
          `<strong>Waypoint #${wp.order}</strong><br/>Objetivos cubiertos: ${wp.coveredPlantIds.length}<br/>Prioridad: ${wp.priorityScore}`,
          popupOptions
        )
        .addTo(droneRouteGroup)
    }
  }
}

onMounted(() => {
  if (!mapContainer.value) return

  map = L.map(mapContainer.value, {
    center: [props.report.parcel.centroid.lat, props.report.parcel.centroid.lng],
    zoom: 17,
    maxZoom: 20,
  })

  satelliteLayer = L.tileLayer(satelliteUrl, {
    maxZoom: 20,
    attribution: 'Imagery &copy; Esri',
  }).addTo(map)

  streetsLayer = L.tileLayer(streetsUrl, {
    maxZoom: 20,
    attribution: '&copy; OpenStreetMap &copy; CARTO',
  })

  L.control.scale({ position: 'bottomright', metric: true, imperial: false }).addTo(map)

  polygonGroup = L.layerGroup().addTo(map)
  heatmapGroup = L.layerGroup().addTo(map)
  plantMarkersGroup = L.layerGroup().addTo(map)
  droneRouteGroup = L.layerGroup().addTo(map)

  renderLayers(true)

  resizeObserver = new ResizeObserver(() => {
    map?.invalidateSize({ animate: false })
  })
  resizeObserver.observe(mapContainer.value)
})

watch(
  () => props.report,
  () => {
    renderLayers(true)
  }
)

watch([severityFilter, showHeatmapGlow, showDroneRoute], () => {
  renderLayers(false)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  if (map) {
    map.remove()
    map = null
  }
})
</script>

<template>
  <div class="sim-sat-shell">
    <div class="sim-sat-toolbar">
      <div class="sim-sat-filters" role="group" aria-label="Filtrar plantas por severidad">
        <button
          type="button"
          :aria-pressed="severityFilter === 'all'"
          @click="severityFilter = 'all'"
        >
          Todas ({{ report.plants.length }})
        </button>
        <button
          type="button"
          :aria-pressed="severityFilter === 'affected'"
          @click="severityFilter = 'affected'"
        >
          Afectadas ({{ affectedCount }})
        </button>
        <button
          type="button"
          :aria-pressed="severityFilter === 'estrés_crítico'"
          @click="severityFilter = 'estrés_crítico'"
        >
          Críticas ({{ report.summary.countsByState['estrés_crítico'] }})
        </button>
        <button
          type="button"
          :aria-pressed="severityFilter === 'pérdida_irreversible'"
          @click="severityFilter = 'pérdida_irreversible'"
        >
          Irrecuperables ({{ report.summary.countsByState['pérdida_irreversible'] }})
        </button>
      </div>

      <div class="sim-sat-toggles">
        <button
          type="button"
          :aria-pressed="showHeatmapGlow"
          @click="showHeatmapGlow = !showHeatmapGlow"
        >
          <Flame :size="14" /> Mapa de calor
        </button>
        <button
          type="button"
          :aria-pressed="showDroneRoute"
          @click="showDroneRoute = !showDroneRoute"
        >
          <Route :size="14" /> Ruta Dron IA
        </button>
        <div class="sim-sat-basemap" role="group" aria-label="Capa base del mapa">
          <button type="button" :aria-pressed="basemap === 'satellite'" @click="setBasemap('satellite')">
            <Satellite :size="14" /> Satélite
          </button>
          <button type="button" :aria-pressed="basemap === 'streets'" @click="setBasemap('streets')">
            <MapIcon :size="14" /> Calles
          </button>
        </div>
      </div>
    </div>

    <div class="sim-sat-map-wrap">
      <div ref="mapContainer" class="sim-sat-canvas"></div>
      <div class="sim-sat-legend" aria-label="Leyenda de severidad en mapa">
        <span><i style="background:#22c55e"></i> Saludable</span>
        <span><i style="background:#eab308"></i> Estrés leve</span>
        <span><i style="background:#f97316"></i> Moderado</span>
        <span><i style="background:#ef4444"></i> Crítico</span>
        <span><i style="background:#7f1d1d;border:1px solid #fca5a5"></i> Irreversible</span>
        <span><i style="background:#38bdf8"></i> Ruta TSP Dron</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sim-sat-shell {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.sim-sat-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.65rem;
}

.sim-sat-filters,
.sim-sat-toggles,
.sim-sat-basemap {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
}

.sim-sat-toolbar button {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.38rem 0.65rem;
  border: 1px solid rgba(196, 218, 147, 0.16);
  border-radius: 9px;
  background: rgba(15, 22, 17, 0.85);
  color: #cbd5c0;
  font-size: 0.72rem;
  font-weight: 650;
  cursor: pointer;
  transition: border-color 0.2s ease, background 0.2s ease, color 0.2s ease;
}

.sim-sat-toolbar button[aria-pressed='true'] {
  border-color: rgba(250, 204, 21, 0.45);
  background: rgba(250, 204, 21, 0.14);
  color: #fef08a;
}

.sim-sat-toolbar button:hover {
  border-color: rgba(196, 218, 147, 0.36);
  color: #ffffff;
}

.sim-sat-map-wrap {
  position: relative;
  height: clamp(340px, 46vh, 500px);
  border: 1px solid rgba(196, 218, 147, 0.16);
  border-radius: 14px;
  overflow: hidden;
}

.sim-sat-canvas {
  width: 100%;
  height: 100%;
  background: #141c15;
}

.sim-sat-legend {
  position: absolute;
  left: 0.75rem;
  bottom: 0.75rem;
  z-index: 450;
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  padding: 0.45rem 0.7rem;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 10px;
  background: rgba(13, 20, 16, 0.84);
  backdrop-filter: blur(10px);
  color: #e7ece0;
  font-size: 0.68rem;
  font-weight: 600;
  pointer-events: none;
}

.sim-sat-legend span {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

.sim-sat-legend i {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 999px;
}
</style>
