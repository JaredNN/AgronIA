<script setup lang="ts">
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { LineChart, GaugeChart } from 'echarts/charts'
import {
  TitleComponent, TooltipComponent, LegendComponent, GridComponent
} from 'echarts/components'
import VChart from 'vue-echarts'
import Card from '../components/ui/Card.vue'
import { ref, computed, onMounted, onBeforeUnmount, shallowRef, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { ArrowRight, Droplets, Bug, Thermometer, TrendingUp, AlertTriangle, CheckCircle, Info, RefreshCw, Save } from 'lucide-vue-next'
import { listFieldMetrics, listFields, saveFieldMetric, type FieldMetricRecord, type FieldRecord } from '../services/agronomyData'
import { projectFieldGeometry } from '../services/fieldGeometry'

use([CanvasRenderer, LineChart, GaugeChart, TitleComponent, TooltipComponent, LegendComponent, GridComponent])

// ============================================================
// Estado de telemetría — mediciones guardadas para el campo seleccionado
// ============================================================
const fields = shallowRef<FieldRecord[]>([])
const selectedFieldId = ref('')
const selectedPeriod = ref<'7' | '30' | '90' | 'all'>('30')
const metrics = shallowRef<FieldMetricRecord[]>([])
const dataError = ref('')
const isLoadingFields = ref(true)
const isLoadingMetrics = ref(false)
const lastUpdated = ref<Date | null>(null)
const localDateTimeValue = (date = new Date()) => {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return localDate.toISOString().slice(0, 16)
}
const observationForm = ref({
  recordDate: localDateTimeValue(),
  growthStage: '',
  soilHumidity: '',
  temperature: '',
  ndvi: '',
  pestIndex: '',
  notes: '',
})
const isSavingObservation = ref(false)
const observationError = ref('')
const observationSuccess = ref('')
let metricsRequestId = 0
const selectedField = computed(() => fields.value.find(field => field.id === selectedFieldId.value) ?? null)
const selectedFieldGeometry = computed(() =>
  projectFieldGeometry(selectedField.value?.geojson_data ?? null),
)
const fieldDimensionsLabel = computed(() => {
  const geometry = selectedFieldGeometry.value
  if (!geometry) return 'Sin geometría disponible'
  return `${geometry.widthMeters.toFixed(1)} × ${geometry.depthMeters.toFixed(1)} m · ${geometry.areaHectares.toFixed(2)} ha`
})
const periodMetrics = computed(() => {
  if (selectedPeriod.value === 'all') return metrics.value
  const cutoff = Date.now() - Number(selectedPeriod.value) * 24 * 60 * 60 * 1000
  return metrics.value.filter(metric => {
    const recordTime = Date.parse(metric.record_date)
    return Number.isFinite(recordTime) && recordTime >= cutoff
  })
})
const hasSimulationMetrics = computed(() => periodMetrics.value.some(metric =>
  metric.raw_data !== null
  && typeof metric.raw_data === 'object'
  && !Array.isArray(metric.raw_data)
  && metric.raw_data.source === 'simulation',
))
const latestMetricWith = (value: (metric: FieldMetricRecord) => number | null) =>
  periodMetrics.value.find(metric => value(metric) !== null)
const rawMetricValue = (metric: FieldMetricRecord | undefined, key: string) => {
  const rawData = metric?.raw_data
  if (!rawData || typeof rawData !== 'object' || Array.isArray(rawData)) return null
  const value = rawData[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsedValue = Number(value)
    if (Number.isFinite(parsedValue)) return parsedValue
  }
  return null
}
const rawMetricText = (metric: FieldMetricRecord, key: string) => {
  const rawData = metric.raw_data
  if (!rawData || typeof rawData !== 'object' || Array.isArray(rawData)) return null
  const value = rawData[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}
const metricSourceLabel = (metric: FieldMetricRecord) => {
  switch (rawMetricText(metric, 'source')) {
    case 'manual_observation': return 'Observación manual'
    case 'simulation': return 'Simulación'
    case 'drone_telemetry': return 'Telemetría'
    default: return 'Importado / otro'
  }
}
const observationHistory = computed(() => periodMetrics.value.slice(0, 100))
const parseObservationNumber = (value: string | number, label: string, min: number, max: number) => {
  const normalizedValue = typeof value === 'string' ? value.trim() : String(value)
  if (!normalizedValue) return { value: null as number | null, error: null as string | null }
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    return { value: null, error: `${label} debe estar entre ${min} y ${max}.` }
  }
  return { value: parsed, error: null }
}
const simHumidity = computed(() => latestMetricWith(metric => metric.soil_humidity)?.soil_humidity ?? null)
const simPestIndex = computed(() => rawMetricValue(
  latestMetricWith(metric => rawMetricValue(metric, 'pest_index')),
  'pest_index',
))
const simTemperature = computed(() => latestMetricWith(metric => metric.temperature)?.temperature ?? null)
const simNDVI = computed(() => rawMetricValue(
  latestMetricWith(metric => rawMetricValue(metric, 'ndvi_avg')),
  'ndvi_avg',
))
const simSustainability = computed(() =>
  latestMetricWith(metric => metric.sustainability_index)?.sustainability_index ?? null,
)
const hasClimateData = computed(() => periodMetrics.value.some(metric =>
  metric.soil_humidity !== null || metric.temperature !== null,
))
const hasSustainabilityData = computed(() => periodMetrics.value.some(metric =>
  metric.sustainability_index !== null,
))
const hasPestData = computed(() => periodMetrics.value.some(metric =>
  rawMetricValue(metric, 'pest_index') !== null,
))
const loadMetrics = async () => {
  const fieldId = selectedFieldId.value
  const requestId = ++metricsRequestId
  if (!fieldId) {
    metrics.value = []
    isLoadingMetrics.value = false
    lastUpdated.value = null
    return
  }

  isLoadingMetrics.value = true
  try {
    const loadedMetrics = await listFieldMetrics(fieldId)
    if (requestId !== metricsRequestId) return
    metrics.value = loadedMetrics
    dataError.value = ''
    lastUpdated.value = new Date()
  } catch (error) {
    if (requestId === metricsRequestId) {
      dataError.value = error instanceof Error ? error.message : 'No se pudieron cargar las mediciones.'
    }
  } finally {
    if (requestId === metricsRequestId) isLoadingMetrics.value = false
  }
}

const loadFields = async (): Promise<boolean> => {
  isLoadingFields.value = true
  try {
    const availableFields = await listFields()
    fields.value = availableFields
    if (!availableFields.some(field => field.id === selectedFieldId.value)) {
      selectedFieldId.value = availableFields[0]?.id ?? ''
    }
    dataError.value = ''
    return true
  } catch (error) {
    dataError.value = error instanceof Error ? error.message : 'No se pudieron cargar los datos del campo.'
    return false
  } finally {
    isLoadingFields.value = false
  }
}

const refreshDashboard = async () => {
  const previousFieldId = selectedFieldId.value
  if (!await loadFields()) return
  if (previousFieldId === selectedFieldId.value) await loadMetrics()
}

const saveObservation = async () => {
  if (!selectedFieldId.value || isSavingObservation.value) return
  observationError.value = ''
  observationSuccess.value = ''

  const observationDate = new Date(observationForm.value.recordDate)
  if (!Number.isFinite(observationDate.getTime())) {
    observationError.value = 'Selecciona una fecha y hora válidas.'
    return
  }

  const values = {
    soilHumidity: parseObservationNumber(observationForm.value.soilHumidity, 'La humedad', 0, 100),
    temperature: parseObservationNumber(observationForm.value.temperature, 'La temperatura', -50, 80),
    ndvi: parseObservationNumber(observationForm.value.ndvi, 'El NDVI', -1, 1),
    pestIndex: parseObservationNumber(observationForm.value.pestIndex, 'El índice de plagas', 0, 100),
  }
  const invalidValue = Object.values(values).find(value => value.error)
  if (invalidValue?.error) {
    observationError.value = invalidValue.error
    return
  }

  const growthStage = observationForm.value.growthStage.trim()
  const notes = observationForm.value.notes.trim()
  const { soilHumidity, temperature, ndvi, pestIndex } = {
    soilHumidity: values.soilHumidity.value,
    temperature: values.temperature.value,
    ndvi: values.ndvi.value,
    pestIndex: values.pestIndex.value,
  }
  if (
    soilHumidity === null && temperature === null && ndvi === null && pestIndex === null
    && !growthStage && !notes
  ) {
    observationError.value = 'Agrega al menos una medición, una etapa del cultivo o una nota.'
    return
  }

  isSavingObservation.value = true
  try {
    await saveFieldMetric({
      field_id: selectedFieldId.value,
      record_date: observationDate.toISOString(),
      soil_humidity: soilHumidity,
      temperature,
      raw_data: {
        source: 'manual_observation',
        growth_stage: growthStage || null,
        notes: notes || null,
        ndvi_avg: ndvi,
        pest_index: pestIndex,
      },
    })
    observationSuccess.value = 'Observación guardada en el historial de este campo.'
    observationForm.value = {
      recordDate: localDateTimeValue(),
      growthStage: '',
      soilHumidity: '',
      temperature: '',
      ndvi: '',
      pestIndex: '',
      notes: '',
    }
    await loadMetrics()
  } catch (error) {
    observationError.value = error instanceof Error ? error.message : 'No se pudo guardar la observación.'
  } finally {
    isSavingObservation.value = false
  }
}

watch(selectedFieldId, () => {
  metrics.value = []
  lastUpdated.value = null
  void loadMetrics()
})

let telemetryInterval: ReturnType<typeof setInterval> | undefined
onMounted(async () => {
  await loadFields()
  telemetryInterval = setInterval(() => void loadMetrics(), 10_000)
})

onBeforeUnmount(() => {
  if (telemetryInterval) clearInterval(telemetryInterval)
  metricsRequestId++
})

const pestStatus = computed(() => {
  if (simPestIndex.value === null) return { label: 'Sin dato', color: 'text-gray-400', bg: 'bg-gray-50', icon: Info, border: 'border-gray-200' }
  if (simPestIndex.value > 30) return { label: 'Crítico', color: 'text-red-500', bg: 'bg-red-50', icon: AlertTriangle, border: 'border-red-200' }
  if (simPestIndex.value > 15) return { label: 'Alerta', color: 'text-orange-500', bg: 'bg-orange-50', icon: AlertTriangle, border: 'border-orange-200' }
  return { label: 'Normal', color: 'text-agron-green', bg: 'bg-green-50', icon: CheckCircle, border: 'border-green-200' }
})

const humidityStatus = computed(() => {
  if (simHumidity.value === null) return { label: 'Sin dato', color: 'text-gray-400' }
  if (simHumidity.value < 40) return { label: 'Bajo', color: 'text-red-500' }
  if (simHumidity.value < 55) return { label: 'Moderado', color: 'text-orange-500' }
  return { label: 'Óptimo', color: 'text-agron-green' }
})

const chartRecords = computed(() => [...periodMetrics.value].slice(0, 100).reverse())
const chartDates = computed(() => chartRecords.value.map(metric =>
  new Date(metric.record_date).toLocaleString('es-MX', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
))

// ============================================================
// Gráfico de clima a partir de mediciones guardadas
// ============================================================
const climateChartOptions = computed(() => ({
  animationDuration: 900,
  animationDurationUpdate: 500,
  animationEasing: 'cubicOut' as const,
  tooltip: {
    trigger: 'axis',
    backgroundColor: 'rgba(15, 22, 17, 0.96)',
    borderColor: 'rgba(196, 218, 147, 0.2)',
    textStyle: { color: '#e8eddf' }
  },
  legend: { data: ['Humedad Suelo (%)', 'Temperatura (°C)'], bottom: 0, textStyle: { color: '#aab19f' } },
  grid: { left: '3%', right: '4%', bottom: '15%', containLabel: true },
  xAxis: {
    type: 'category',
    boundaryGap: false,
    data: chartDates.value,
    axisLine: { lineStyle: { color: 'rgba(196, 218, 147, 0.16)' } },
    axisTick: { show: false },
    axisLabel: { color: '#929b88' }
  },
  yAxis: {
    type: 'value',
    axisLine: { show: false },
    axisLabel: { color: '#929b88' },
    splitLine: { lineStyle: { color: 'rgba(196, 218, 147, 0.09)' } }
  },
  series: [
    {
      name: 'Humedad Suelo (%)',
      type: 'line',
      smooth: true,
      data: chartRecords.value.map(metric => metric.soil_humidity),
      symbolSize: 7,
      itemStyle: { color: '#72d59f' },
      lineStyle: { width: 3, color: '#72d59f' },
      areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: '#10B98140' }, { offset: 1, color: '#10B98105' }] } }
    },
    {
      name: 'Temperatura (°C)',
      type: 'line',
      smooth: true,
      data: chartRecords.value.map(metric => metric.temperature),
      symbolSize: 7,
      itemStyle: { color: '#e5a261' },
      lineStyle: { width: 3, color: '#e5a261' }
    }
  ]
}))

// ============================================================
// Historial del índice de sustentabilidad
// ============================================================
const sustainabilityChartOptions = computed(() => ({
  animationDuration: 900,
  animationDurationUpdate: 500,
  animationEasing: 'cubicOut' as const,
  tooltip: {
    trigger: 'axis',
    backgroundColor: 'rgba(15, 22, 17, 0.96)',
    borderColor: 'rgba(196, 218, 147, 0.2)',
    textStyle: { color: '#e8eddf' }
  },
  grid: { left: '3%', right: '4%', bottom: '15%', containLabel: true },
  xAxis: {
    type: 'category',
    data: chartDates.value,
    axisLine: { lineStyle: { color: 'rgba(196, 218, 147, 0.16)' } },
    axisTick: { show: false },
    axisLabel: { color: '#929b88' }
  },
  yAxis: {
    type: 'value',
    axisLine: { show: false },
    axisLabel: { color: '#929b88' },
    splitLine: { lineStyle: { color: 'rgba(196, 218, 147, 0.09)' } }
  },
  series: [{
    name: 'Índice de Sustentabilidad',
    type: 'line',
    smooth: true,
    data: chartRecords.value.map(metric => metric.sustainability_index),
    symbolSize: 7,
    itemStyle: { color: '#72d59f' },
    lineStyle: { width: 3, color: '#72d59f' }
  }]
}))

// ============================================================
// Historial del índice de plagas
// ============================================================
const comparisonChartOptions = computed(() => ({
  animationDuration: 900,
  animationDurationUpdate: 500,
  animationEasing: 'cubicOut' as const,
  tooltip: {
    trigger: 'axis',
    backgroundColor: 'rgba(15, 22, 17, 0.96)',
    borderColor: 'rgba(196, 218, 147, 0.2)',
    textStyle: { color: '#e8eddf' }
  },
  grid: { left: '3%', right: '4%', bottom: '15%', containLabel: true },
  xAxis: {
    type: 'category',
    data: chartDates.value,
    axisLine: { lineStyle: { color: 'rgba(196, 218, 147, 0.16)' } },
    axisTick: { show: false },
    axisLabel: { color: '#929b88' }
  },
  yAxis: {
    type: 'value',
    axisLine: { show: false },
    axisLabel: { color: '#929b88' },
    splitLine: { lineStyle: { color: 'rgba(196, 218, 147, 0.09)' } }
  },
  series: [
    {
      name: 'Índice de plagas',
      type: 'line',
      smooth: true,
      data: chartRecords.value.map(metric => rawMetricValue(metric, 'pest_index')),
      symbolSize: 7,
      itemStyle: { color: '#e77f69' },
      lineStyle: { width: 3, color: '#e77f69' }
    }
  ]
}))

// ============================================================
// Gauge NDVI
// ============================================================
const ndviGaugeOptions = computed(() => ({
  series: [{
    type: 'gauge',
    startAngle: 200,
    endAngle: -20,
    min: 0,
    max: 1,
    splitNumber: 4,
    radius: '90%',
    axisLine: {
      lineStyle: {
        width: 16,
        color: [[0.33, '#EF4444'], [0.66, '#F97316'], [0.85, '#facc15'], [1, '#10B981']]
      }
    },
    pointer: { icon: 'path://M2090.36389,615.30999 L2090.36389,615.30999 C2091.48372,615.30999 2092.40383,616.23010 2092.40383,617.34993 L2092.40383,652.35000 C2092.40383,653.46983 2091.48372,654.38994 2090.36389,654.38994 L2090.36389,654.38994 C2089.24406,654.38994 2088.32395,653.46983 2088.32395,652.35000 L2088.32395,617.34993 C2088.32395,616.23010 2089.24406,615.30999 2090.36389,615.30999 Z', length: '75%', width: 6, offsetCenter: [0, '5%'] },
    detail: {
      valueAnimation: true,
      formatter: (v: number) => `NDVI\n${v.toFixed(2)}`,
      color: '#e8eddf',
      fontSize: 14,
      fontWeight: 'bold',
      offsetCenter: [0, '60%']
    },
    data: [{ value: simNDVI.value ?? 0 }],
    axisTick: { show: false },
    splitLine: { show: false },
    axisLabel: { color: '#a0aa94', fontSize: 10, formatter: (v: number) => v.toFixed(1) }
  }]
}))

// ============================================================
// Gauge Índice de Plagas
// ============================================================
const pestGaugeOptions = computed(() => ({
  series: [{
    type: 'gauge',
    startAngle: 200,
    endAngle: -20,
    min: 0,
    max: 100,
    splitNumber: 4,
    radius: '90%',
    axisLine: {
      lineStyle: {
        width: 16,
        color: [[0.3, '#10B981'], [0.6, '#facc15'], [0.85, '#F97316'], [1, '#EF4444']]
      }
    },
    pointer: { icon: 'path://M2090.36389,615.30999 L2090.36389,615.30999 C2091.48372,615.30999 2092.40383,616.23010 2092.40383,617.34993 L2092.40383,652.35000 C2092.40383,653.46983 2091.48372,654.38994 2090.36389,654.38994 L2090.36389,654.38994 C2089.24406,654.38994 2088.32395,653.46983 2088.32395,652.35000 L2088.32395,617.34993 C2088.32395,616.23010 2089.24406,615.30999 2090.36389,615.30999 Z', length: '75%', width: 6, offsetCenter: [0, '5%'] },
    detail: {
      valueAnimation: true,
      formatter: (v: number) => `Plagas\n${v.toFixed(0)}%`,
      color: '#e8eddf',
      fontSize: 14,
      fontWeight: 'bold',
      offsetCenter: [0, '60%']
    },
    data: [{ value: simPestIndex.value ?? 0 }],
    axisTick: { show: false },
    splitLine: { show: false },
    axisLabel: { color: '#a0aa94', fontSize: 10 }
  }]
}))
</script>

<template>
  <div class="dashboard-page space-y-4">
    <header class="dashboard-heading">
      <div>
        <span class="dashboard-eyebrow">INTELIGENCIA AGRÍCOLA</span>
        <h1>Analítica del cultivo</h1>
        <p>Indicadores obtenidos de las mediciones guardadas para cada campo.</p>
      </div>
      <div class="dashboard-heading-actions">
        <label class="sr-only" for="dashboard-field-select">Campo para consultar</label>
        <select id="dashboard-field-select" v-model="selectedFieldId" class="dashboard-select" :disabled="fields.length === 0">
          <option value="" disabled>Selecciona un campo</option>
          <option v-for="field in fields" :key="field.id" :value="field.id">{{ field.name }}</option>
        </select>
        <label class="sr-only" for="dashboard-period-select">Periodo de análisis</label>
        <select id="dashboard-period-select" v-model="selectedPeriod" class="dashboard-select">
          <option value="7">Últimos 7 días</option>
          <option value="30">Últimos 30 días</option>
          <option value="90">Últimos 90 días</option>
          <option value="all">Todos los disponibles (máx. 100)</option>
        </select>
        <button
          type="button"
          class="dashboard-refresh-button"
          :disabled="isLoadingFields || isLoadingMetrics"
          aria-label="Actualizar mediciones"
          title="Actualizar mediciones"
          @click="refreshDashboard"
        >
          <RefreshCw :size="16" :class="{ 'is-spinning': isLoadingMetrics || isLoadingFields }" />
          <span>{{ isLoadingFields ? 'Cargando campos' : isLoadingMetrics ? 'Actualizando' : 'Actualizar' }}</span>
        </button>
        <span class="dashboard-live" :class="{ 'is-loading': isLoadingMetrics }">
          <span></span>
          {{ isLoadingMetrics ? 'Consultando campo…' : lastUpdated ? `Actualizado ${lastUpdated.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}` : 'Sin actualización' }}
        </span>
        <RouterLink to="/simulacion" class="dashboard-simulation-link">
          Abrir simulador <ArrowRight :size="16" />
        </RouterLink>
      </div>
    </header>
    <p v-if="dataError" role="alert" class="dashboard-notice is-error">{{ dataError }}</p>
    <p v-else-if="isLoadingFields" class="dashboard-notice">Cargando campos y mediciones…</p>
    <p v-else-if="!fields.length" class="dashboard-notice">
      No hay campos registrados. <RouterLink to="/mapas" class="text-agron-green underline">Crea o guarda un campo desde el mapa.</RouterLink>
    </p>
    <p v-else-if="isLoadingMetrics && !metrics.length" class="dashboard-notice">Cargando mediciones del campo…</p>
    <p v-else-if="metrics.length && !periodMetrics.length" class="dashboard-notice">
        No hay mediciones en este periodo. Prueba con un rango más amplio.
    </p>
    <p v-else-if="!metrics.length" class="dashboard-notice">
      Este campo aún no tiene mediciones. Registra una observación aquí o guarda datos desde Simulación o Datos.
    </p>

    <section v-if="selectedField" class="dashboard-field-summary">
      <div>
        <span class="dashboard-eyebrow">CAMPO EN SEGUIMIENTO</span>
        <h2>{{ selectedField.name }}</h2>
        <p>Este campo se seleccionó desde los polígonos guardados en Mapas.</p>
      </div>
      <div class="dashboard-field-geometry">
        <span>Dimensiones del terreno</span>
        <strong>{{ fieldDimensionsLabel }}</strong>
      </div>
      <RouterLink to="/mapas" class="dashboard-map-link">Ver mapas <ArrowRight :size="15" /></RouterLink>
    </section>

    <section v-if="selectedField" class="dashboard-observation-card">
      <div class="dashboard-observation-heading">
        <div>
          <span class="dashboard-eyebrow">REGISTRO DE AVANCE</span>
          <h2>Nueva observación</h2>
          <p>Guarda mediciones reales y la etapa del cultivo para comparar su evolución con el tiempo.</p>
        </div>
      </div>
      <form class="dashboard-observation-form" @submit.prevent="saveObservation">
        <div class="dashboard-form-grid">
          <label class="dashboard-form-field">
            <span>Fecha y hora</span>
            <input v-model="observationForm.recordDate" type="datetime-local" required>
          </label>
          <label class="dashboard-form-field">
            <span>Etapa del cultivo</span>
            <input v-model="observationForm.growthStage" type="text" maxlength="80" placeholder="Ej. desarrollo vegetativo">
          </label>
          <label class="dashboard-form-field">
            <span>Humedad del suelo (%)</span>
            <input v-model="observationForm.soilHumidity" type="number" min="0" max="100" step="any" placeholder="0–100">
          </label>
          <label class="dashboard-form-field">
            <span>Temperatura (°C)</span>
            <input v-model="observationForm.temperature" type="number" min="-50" max="80" step="any" placeholder="°C">
          </label>
          <label class="dashboard-form-field">
            <span>NDVI</span>
            <input v-model="observationForm.ndvi" type="number" min="-1" max="1" step="any" placeholder="-1 a 1">
          </label>
          <label class="dashboard-form-field">
            <span>Índice de plagas (%)</span>
            <input v-model="observationForm.pestIndex" type="number" min="0" max="100" step="any" placeholder="0–100">
          </label>
          <label class="dashboard-form-field dashboard-form-field-wide">
            <span>Notas</span>
            <textarea v-model="observationForm.notes" rows="2" maxlength="1000" placeholder="Describe cambios, observaciones o acciones realizadas"></textarea>
          </label>
        </div>
        <div class="dashboard-observation-footer">
          <div>
            <p class="dashboard-form-hint">Captura solo los datos que hayas observado; los campos vacíos no se guardan como cero.</p>
            <p v-if="observationError" role="alert" class="dashboard-form-message is-error">{{ observationError }}</p>
            <p v-else-if="observationSuccess" role="status" class="dashboard-form-message is-success">{{ observationSuccess }}</p>
          </div>
          <button type="submit" class="dashboard-save-button" :disabled="isSavingObservation">
            <Save :size="16" />
            {{ isSavingObservation ? 'Guardando…' : 'Guardar observación' }}
          </button>
        </div>
      </form>
    </section>

    <!-- Tarjetas de parámetros clave -->
    <div v-if="selectedField" class="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <!-- Humedad del Suelo -->
      <div class="dashboard-metric dashboard-metric-blue">
        <div class="dashboard-metric-heading">
          <span class="dashboard-metric-icon"><Droplets :size="18" /></span>
          <span class="dashboard-metric-label">Humedad del suelo</span>
        </div>
        <div class="dashboard-metric-value">
          {{ simHumidity === null ? '—' : simHumidity.toFixed(1) }}<span v-if="simHumidity !== null">%</span>
        </div>
        <div class="dashboard-metric-foot">
          <div class="dashboard-meter">
            <div class="h-1.5 rounded-full bg-blue-400 transition-all duration-700" :style="{ width: `${simHumidity ?? 0}%` }"></div>
          </div>
          <span class="dashboard-status" :class="humidityStatus.color">{{ humidityStatus.label }}</span>
        </div>
      </div>

      <!-- Índice de Plagas -->
      <div class="dashboard-metric dashboard-metric-orange" :class="pestStatus.border">
        <div class="dashboard-metric-heading">
          <span class="dashboard-metric-icon"><Bug :size="18" /></span>
          <span class="dashboard-metric-label">Índice de plagas</span>
        </div>
        <div class="dashboard-metric-value" :class="pestStatus.color">
          {{ simPestIndex === null ? '—' : simPestIndex.toFixed(1) }}<span v-if="simPestIndex !== null">%</span>
        </div>
        <div class="dashboard-metric-foot">
          <div class="dashboard-meter">
            <div class="h-1.5 rounded-full transition-all duration-700"
              :class="simPestIndex === null ? 'bg-gray-500' : simPestIndex > 30 ? 'bg-red-500' : simPestIndex > 15 ? 'bg-orange-400' : 'bg-agron-green'"
              :style="{ width: `${simPestIndex ?? 0}%` }"></div>
          </div>
          <span class="dashboard-status" :class="pestStatus.color">{{ pestStatus.label }}</span>
        </div>
      </div>

      <!-- Temperatura -->
      <div class="dashboard-metric dashboard-metric-amber">
        <div class="dashboard-metric-heading">
          <span class="dashboard-metric-icon"><Thermometer :size="18" /></span>
          <span class="dashboard-metric-label">Temperatura</span>
        </div>
        <div class="dashboard-metric-value">
          {{ simTemperature === null ? '—' : simTemperature.toFixed(1) }}<span v-if="simTemperature !== null">°C</span>
        </div>
        <div class="dashboard-metric-note">Último registro del periodo</div>
      </div>

      <!-- NDVI -->
      <div class="dashboard-metric dashboard-metric-green">
        <div class="dashboard-metric-heading">
          <span class="dashboard-metric-icon"><TrendingUp :size="18" /></span>
          <span class="dashboard-metric-label">Índice NDVI</span>
        </div>
        <div class="dashboard-metric-value">
          {{ simNDVI === null ? '—' : simNDVI.toFixed(2) }}<span v-if="simNDVI !== null">/ 1.00</span>
        </div>
        <div class="dashboard-metric-note">Vigor de la vegetación</div>
      </div>
    </div>

    <!-- Aviso sobre el origen de los datos -->
    <div v-if="selectedField" class="dashboard-source">
      <span class="dashboard-source-icon"><Info :size="17" /></span>
      <div>
        <strong>Datos registrados del campo</strong>
        <p>Los indicadores y gráficos usan las mediciones guardadas. Las observaciones manuales, importaciones, telemetría y simulaciones se distinguen en el historial; NDVI y plagas se leen de <code>raw_data</code>.</p>
        <p v-if="hasSimulationMetrics" class="mt-1 text-amber-300">Este historial incluye registros del simulador 3D; no son mediciones de sensores ni deben usarse como observaciones reales.</p>
      </div>
    </div>

    <!-- Gauges NDVI + Plagas -->
    <div v-if="selectedField" class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card class="dashboard-chart-card">
        <template #header>
          <div class="dashboard-chart-heading">
            <div><span>VIGOR VEGETAL</span><h3>Índice NDVI</h3></div>
            <span class="dashboard-chart-value">{{ simNDVI === null ? '—' : simNDVI.toFixed(2) }}</span>
          </div>
        </template>
        <div class="dashboard-gauge-chart" :class="{ 'is-empty': simNDVI === null }">
          <v-chart v-if="simNDVI !== null" class="chart" :option="ndviGaugeOptions" autoresize />
          <p v-else class="grid h-full place-items-center text-sm text-gray-400">Sin dato NDVI registrado.</p>
        </div>
      </Card>
      <Card class="dashboard-chart-card">
        <template #header>
          <div class="dashboard-chart-heading">
            <div><span>MONITOREO FITOSANITARIO</span><h3>Índice de plagas</h3></div>
            <span class="dashboard-chart-value">{{ simPestIndex === null ? '—' : `${simPestIndex.toFixed(1)}%` }}</span>
          </div>
        </template>
        <div class="dashboard-gauge-chart" :class="{ 'is-empty': simPestIndex === null }">
          <v-chart v-if="simPestIndex !== null" class="chart" :option="pestGaugeOptions" autoresize />
          <p v-else class="grid h-full place-items-center text-sm text-gray-400">Sin dato de plagas registrado.</p>
        </div>
      </Card>
    </div>

    <!-- Gráficas históricas -->
    <div v-if="selectedField" class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card class="dashboard-chart-card lg:col-span-2">
        <template #header>
          <div class="dashboard-chart-heading">
            <div><span>HISTORIAL RECIENTE</span><h3>Clima y humedad del suelo</h3></div>
            <span class="dashboard-chart-caption">Hasta 100 registros</span>
          </div>
        </template>
        <div class="dashboard-history-chart" :class="{ 'is-empty': !hasClimateData }">
          <v-chart v-if="hasClimateData" class="chart" :option="climateChartOptions" autoresize />
          <p v-else class="dashboard-chart-empty">Sin datos de humedad o temperatura para este periodo.</p>
        </div>
      </Card>

      <Card class="dashboard-chart-card">
        <template #header>
          <div class="dashboard-chart-heading">
            <div><span>ÍNDICE DE SUSTENTABILIDAD</span><h3>Historial registrado</h3></div>
            <span class="dashboard-chart-value">{{ simSustainability === null ? '—' : simSustainability.toFixed(2) }}</span>
          </div>
        </template>
        <div class="dashboard-history-chart" :class="{ 'is-empty': !hasSustainabilityData }">
          <v-chart v-if="hasSustainabilityData" class="chart" :option="sustainabilityChartOptions" autoresize />
          <p v-else class="dashboard-chart-empty">Sin registros de sustentabilidad para este periodo.</p>
        </div>
      </Card>

      <Card class="dashboard-chart-card">
        <template #header>
          <div class="dashboard-chart-heading">
            <div><span>MONITOREO FITOSANITARIO</span><h3>Historial del índice de plagas</h3></div>
          </div>
        </template>
        <div class="dashboard-history-chart" :class="{ 'is-empty': !hasPestData }">
          <v-chart v-if="hasPestData" class="chart" :option="comparisonChartOptions" autoresize />
          <p v-else class="dashboard-chart-empty">Sin registros del índice de plagas para este periodo.</p>
        </div>
      </Card>
    </div>

    <Card v-if="selectedField" class="dashboard-chart-card">
      <template #header>
        <div class="dashboard-chart-heading">
          <div><span>BITÁCORA DEL CAMPO</span><h3>Historial de observaciones y mediciones</h3></div>
          <span class="dashboard-chart-caption">{{ observationHistory.length }} registros en este periodo</span>
        </div>
      </template>
      <div v-if="observationHistory.length" class="dashboard-history-wrap">
        <table class="dashboard-history-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Origen</th>
              <th>Etapa</th>
              <th>Humedad</th>
              <th>Temp.</th>
              <th>NDVI</th>
              <th>Plagas</th>
              <th>Notas</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="metric in observationHistory" :key="metric.id">
              <td>{{ new Date(metric.record_date).toLocaleString('es-MX') }}</td>
              <td><span class="dashboard-history-source">{{ metricSourceLabel(metric) }}</span></td>
              <td>{{ rawMetricText(metric, 'growth_stage') || '—' }}</td>
              <td>{{ metric.soil_humidity === null ? '—' : `${metric.soil_humidity.toFixed(1)}%` }}</td>
              <td>{{ metric.temperature === null ? '—' : `${metric.temperature.toFixed(1)} °C` }}</td>
              <td>{{ rawMetricValue(metric, 'ndvi_avg')?.toFixed(2) ?? '—' }}</td>
              <td>{{ rawMetricValue(metric, 'pest_index') === null ? '—' : `${rawMetricValue(metric, 'pest_index')?.toFixed(1)}%` }}</td>
              <td class="dashboard-history-notes">{{ rawMetricText(metric, 'notes') || '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="dashboard-chart-empty">No hay observaciones para este periodo. Usa el formulario de arriba para iniciar el seguimiento.</p>
    </Card>
  </div>
</template>

<style scoped>
.dashboard-page {
  min-width: 0;
  color: #e8eddf;
}

.dashboard-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1.5rem;
  padding: 16px 18px;
  border: 1px solid rgba(196, 218, 147, 0.14);
  border-radius: 18px;
  background:
    radial-gradient(ellipse at 2% 0%, rgba(120, 150, 76, 0.14), transparent 54%),
    linear-gradient(125deg, rgba(27, 35, 25, 0.96), rgba(17, 23, 18, 0.92));
  box-shadow: 0 16px 36px rgba(0, 0, 0, 0.14), inset 0 1px rgba(255, 255, 255, 0.035);
}

.dashboard-eyebrow,
.dashboard-chart-heading > div > span {
  color: #c1a95f;
  font-size: 0.58rem;
  font-weight: 800;
  letter-spacing: 0.15em;
}

.dashboard-heading h1 {
  margin-top: 0.4rem;
  color: #f0f1e9;
  font-size: clamp(1.7rem, 3vw, 2.35rem);
  font-weight: 760;
  letter-spacing: -0.055em;
}

.dashboard-heading p {
  margin-top: 0.35rem;
  color: #a2aa97;
  font-size: 0.88rem;
}

.dashboard-heading-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 0.6rem;
}

.dashboard-select {
  min-width: 150px;
  min-height: 40px;
  padding: 0 2rem 0 0.75rem;
  border: 1px solid rgba(196, 218, 147, 0.18);
  border-radius: 10px;
  color: #e8eddf;
  background: rgba(8, 14, 10, 0.72);
  font-size: 0.72rem;
}
.dashboard-select:focus-visible,
.dashboard-refresh-button:focus-visible {
  outline: 2px solid rgba(211, 189, 103, 0.65);
  outline-offset: 2px;
}
.dashboard-select option { color: #e8eddf; background: #182019; }

.dashboard-refresh-button {
  display: inline-flex;
  min-height: 40px;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0 0.8rem;
  border: 1px solid rgba(114, 213, 159, 0.2);
  border-radius: 10px;
  color: #bce7c8;
  background: rgba(33, 99, 61, 0.2);
  font-size: 0.71rem;
  font-weight: 700;
  transition: background 0.2s ease, border-color 0.2s ease, transform 0.2s ease;
}
.dashboard-refresh-button:hover:not(:disabled) {
  transform: translateY(-1px);
  border-color: rgba(114, 213, 159, 0.4);
  background: rgba(33, 99, 61, 0.34);
}
.dashboard-refresh-button:disabled { cursor: not-allowed; opacity: 0.55; }
.dashboard-refresh-button .is-spinning { animation: dashboard-spin 0.9s linear infinite; }

.dashboard-live {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  color: #bdc5b1;
  font-size: 0.64rem;
  white-space: nowrap;
}

.dashboard-live > span {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #72d59f;
  box-shadow: 0 0 12px rgba(114, 213, 159, 0.38);
}
.dashboard-live.is-loading > span {
  background: #d5b75f;
  box-shadow: 0 0 12px rgba(213, 183, 95, 0.5);
  animation: dashboard-pulse 1.2s ease-in-out infinite;
}

.dashboard-notice {
  padding: 0.85rem 1rem;
  border: 1px solid rgba(196, 218, 147, 0.14);
  border-radius: 12px;
  color: #b5c0aa;
  background: rgba(23, 31, 23, 0.76);
  font-size: 0.75rem;
  line-height: 1.55;
}
.dashboard-notice.is-error {
  border-color: rgba(248, 113, 113, 0.25);
  color: #fecaca;
  background: rgba(127, 29, 29, 0.18);
}

.dashboard-field-summary,
.dashboard-observation-card {
  border: 1px solid rgba(196, 218, 147, 0.13);
  border-radius: 15px;
  background: linear-gradient(145deg, rgba(26, 34, 25, 0.96), rgba(17, 23, 18, 0.96));
}

.dashboard-field-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.85rem 1.05rem;
}

.dashboard-field-summary h2,
.dashboard-observation-heading h2 {
  margin-top: 0.25rem;
  color: #edf1e8;
  font-size: 0.95rem;
  font-weight: 720;
}

.dashboard-field-summary p,
.dashboard-observation-heading p {
  margin-top: 0.25rem;
  color: #909b87;
  font-size: 0.7rem;
  line-height: 1.5;
}

.dashboard-field-geometry {
  display: grid;
  gap: 0.2rem;
  color: #929b88;
  font-size: 0.68rem;
}

.dashboard-field-geometry strong {
  color: #e6d28b;
  font-size: 0.78rem;
  font-variant-numeric: tabular-nums;
}

.dashboard-map-link {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  color: #bce7c8;
  font-size: 0.7rem;
  font-weight: 700;
  white-space: nowrap;
}

.dashboard-map-link:hover { color: #e6d28b; }

.dashboard-observation-card { padding: 0.95rem 1.1rem; }
.dashboard-observation-heading { margin-bottom: 0.75rem; }

.dashboard-form-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 0.85rem;
}

.dashboard-form-field {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.38rem;
  color: #aab19f;
  font-size: 0.68rem;
  font-weight: 600;
}

.dashboard-form-field-wide { grid-column: span 2; }

.dashboard-form-field input,
.dashboard-form-field textarea {
  width: 100%;
  min-height: 40px;
  padding: 0.6rem 0.7rem;
  border: 1px solid rgba(196, 218, 147, 0.17);
  border-radius: 9px;
  color: #e8eddf;
  background: rgba(8, 14, 10, 0.72);
  font: inherit;
  font-weight: 400;
}

.dashboard-form-field textarea {
  min-height: 76px;
  resize: vertical;
}

.dashboard-form-field input::placeholder,
.dashboard-form-field textarea::placeholder { color: #697365; }

.dashboard-form-field input:focus-visible,
.dashboard-form-field textarea:focus-visible {
  outline: 2px solid rgba(211, 189, 103, 0.65);
  outline-offset: 2px;
}

.dashboard-observation-footer {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1rem;
  margin-top: 1rem;
}

.dashboard-form-hint,
.dashboard-form-message { color: #89947f; font-size: 0.68rem; line-height: 1.5; }
.dashboard-form-message { margin-top: 0.3rem; }
.dashboard-form-message.is-error { color: #fecaca; }
.dashboard-form-message.is-success { color: #a7e6b9; }

.dashboard-save-button {
  display: inline-flex;
  min-height: 40px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0 0.9rem;
  border: 1px solid rgba(114, 213, 159, 0.25);
  border-radius: 10px;
  color: #d7f0dc;
  background: rgba(33, 99, 61, 0.28);
  font-size: 0.72rem;
  font-weight: 700;
  transition: background 0.2s ease, border-color 0.2s ease;
}

.dashboard-save-button:hover:not(:disabled) {
  border-color: rgba(114, 213, 159, 0.5);
  background: rgba(33, 99, 61, 0.46);
}
.dashboard-save-button:disabled { cursor: wait; opacity: 0.65; }
.dashboard-save-button:focus-visible { outline: 2px solid #72d59f; outline-offset: 2px; }

.dashboard-history-wrap { overflow-x: auto; }
.dashboard-history-table {
  width: 100%;
  border-collapse: collapse;
  color: #c5cdbb;
  font-size: 0.69rem;
  text-align: left;
}

.dashboard-history-table th,
.dashboard-history-table td {
  padding: 0.55rem 0.55rem;
  border-bottom: 1px solid rgba(196, 218, 147, 0.09);
  white-space: nowrap;
}

.dashboard-history-table th {
  color: #929b88;
  font-size: 0.62rem;
  font-weight: 650;
  text-transform: uppercase;
}

.dashboard-history-table tr:last-child td { border-bottom: 0; }
.dashboard-history-source { color: #bce7c8; }
.dashboard-history-notes { min-width: 160px; max-width: 280px; white-space: normal !important; }

.dashboard-chart-empty {
  display: grid;
  height: 100%;
  place-items: center;
  padding: 1rem;
  color: #89947f;
  font-size: 0.75rem;
  text-align: center;
}

.dashboard-simulation-link {
  display: inline-flex;
  min-height: 42px;
  align-items: center;
  justify-content: center;
  gap: 0.55rem;
  padding: 0.65rem 0.9rem;
  border: 1px solid rgba(211, 189, 103, 0.25);
  border-radius: 11px;
  color: #e7d99f;
  background: linear-gradient(145deg, rgba(211, 189, 103, 0.13), rgba(211, 189, 103, 0.055));
  font-size: 0.73rem;
  font-weight: 700;
  transition: transform 0.2s ease, border-color 0.2s ease, background 0.2s ease;
}

.dashboard-simulation-link:hover {
  transform: translateY(-2px);
  border-color: rgba(211, 189, 103, 0.48);
  background: rgba(211, 189, 103, 0.17);
}

.dashboard-metric {
  position: relative;
  min-width: 0;
  padding: 0.95rem;
  overflow: hidden;
  border: 1px solid rgba(196, 218, 147, 0.13);
  border-radius: 15px;
  background: linear-gradient(145deg, rgba(29, 36, 25, 0.96), rgba(18, 24, 18, 0.96));
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.15);
  transition: transform 0.23s ease, border-color 0.23s ease, box-shadow 0.23s ease;
  animation: dashboard-arrive 0.5s both;
}

.dashboard-metric:nth-child(2) { animation-delay: 0.05s; }
.dashboard-metric:nth-child(3) { animation-delay: 0.1s; }
.dashboard-metric:nth-child(4) { animation-delay: 0.15s; }

.dashboard-metric:hover {
  transform: translateY(-3px);
  border-color: rgba(211, 189, 103, 0.28);
  box-shadow: 0 18px 35px rgba(0, 0, 0, 0.22);
}

.dashboard-metric-blue { --metric-accent: #75b8ec; }
.dashboard-metric-orange { --metric-accent: #eba76f; }
.dashboard-metric-amber { --metric-accent: #e1c575; }
.dashboard-metric-green { --metric-accent: #8cc99a; }

.dashboard-metric-heading {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 0.65rem;
}

.dashboard-metric-icon {
  display: grid;
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--metric-accent) 24%, transparent);
  border-radius: 10px;
  color: var(--metric-accent);
  background: color-mix(in srgb, var(--metric-accent) 10%, transparent);
}

.dashboard-metric-label {
  overflow: hidden;
  color: #aab19f;
  font-size: 0.73rem;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dashboard-metric-value {
  margin: 0.6rem 0 0.45rem;
  color: #f0f1e9;
  font-size: clamp(1.7rem, 3vw, 2.2rem);
  font-weight: 800;
  letter-spacing: -0.06em;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}

.dashboard-metric-value > span {
  margin-left: 0.17rem;
  color: #929b88;
  font-size: 0.9rem;
  font-weight: 550;
  letter-spacing: -0.01em;
}

.dashboard-metric-foot {
  display: flex;
  align-items: center;
  gap: 0.55rem;
}

.dashboard-meter {
  height: 5px;
  min-width: 0;
  flex: 1;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(231, 237, 216, 0.08);
}

.dashboard-meter > div { height: 100%; }
.dashboard-status { flex: 0 0 auto; font-size: 0.64rem; font-weight: 700; }
.dashboard-metric-note { color: #89927f; font-size: 0.68rem; }

.dashboard-source {
  display: flex;
  align-items: flex-start;
  gap: 0.7rem;
  padding: 0.8rem 0.95rem;
  border: 1px solid rgba(117, 184, 236, 0.17);
  border-radius: 13px;
  background: linear-gradient(110deg, rgba(48, 91, 113, 0.15), rgba(30, 42, 37, 0.34));
}

.dashboard-source-icon {
  display: grid;
  width: 30px;
  height: 30px;
  flex: 0 0 30px;
  place-items: center;
  border: 1px solid rgba(117, 184, 236, 0.2);
  border-radius: 9px;
  color: #8cc7ed;
  background: rgba(117, 184, 236, 0.09);
}

.dashboard-source strong { color: #d6e9f3; font-size: 0.75rem; }
.dashboard-source p { margin-top: 0.22rem; color: #a3b2b4; font-size: 0.7rem; line-height: 1.55; }

:deep(.dashboard-chart-card.app-card) {
  min-width: 0;
  border: 1px solid rgba(196, 218, 147, 0.13);
  border-radius: 16px;
  background: linear-gradient(145deg, rgba(26, 34, 25, 0.98), rgba(17, 23, 18, 0.98));
  box-shadow: 0 14px 35px rgba(0, 0, 0, 0.18);
  transition: transform 0.25s ease, border-color 0.25s ease, box-shadow 0.25s ease;
}

:deep(.dashboard-chart-card.app-card:hover) {
  transform: translateY(-2px);
  border-color: rgba(211, 189, 103, 0.25);
  box-shadow: 0 19px 40px rgba(0, 0, 0, 0.24);
}

:deep(.dashboard-chart-card .app-card-header) {
  padding: 0.9rem 1.1rem;
  border-color: rgba(196, 218, 147, 0.1);
}

:deep(.dashboard-chart-card .app-card-body) { padding: 0.75rem 0.95rem 0.85rem; }

.dashboard-chart-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.dashboard-chart-heading > div > span { font-size: 0.53rem; }
.dashboard-chart-heading h3 { margin-top: 0.3rem; color: #e8eddf; font-size: 0.88rem; font-weight: 680; }
.dashboard-chart-value { color: #e6d28b; font-size: 1rem; font-weight: 800; font-variant-numeric: tabular-nums; }
.dashboard-chart-caption { color: #8f9986; font-size: 0.68rem; }

.dashboard-gauge-chart,
.dashboard-history-chart {
  width: 100%;
}

.dashboard-gauge-chart { height: 13rem; }
.dashboard-history-chart { height: 16rem; }
.dashboard-gauge-chart.is-empty,
.dashboard-history-chart.is-empty { height: 5.5rem; }

.chart {
  display: block;
  height: 100%;
  width: 100%;
}

@keyframes dashboard-arrive {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes dashboard-pulse {
  50% { opacity: 0.48; box-shadow: 0 0 4px rgba(213, 183, 95, 0.2); }
}
@keyframes dashboard-spin { to { transform: rotate(360deg); } }

@media (max-width: 760px) {
  .dashboard-heading { align-items: flex-start; flex-direction: column; gap: 1rem; padding: 17px; }
  .dashboard-heading-actions { width: 100%; justify-content: flex-start; }
  .dashboard-form-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .dashboard-history-chart { height: 14rem; }
}

@media (max-width: 480px) {
  .dashboard-heading-actions { align-items: flex-start; flex-direction: column; }
  .dashboard-select, .dashboard-refresh-button, .dashboard-simulation-link { width: 100%; }
  .dashboard-field-summary { align-items: flex-start; flex-direction: column; }
  .dashboard-form-grid { grid-template-columns: minmax(0, 1fr); }
  .dashboard-form-field-wide { grid-column: auto; }
  .dashboard-observation-footer { align-items: stretch; flex-direction: column; }
  .dashboard-save-button { width: 100%; }
  .dashboard-metric { padding: 0.9rem; }
  .dashboard-metric-heading { gap: 0.48rem; }
  .dashboard-metric-icon { width: 30px; height: 30px; flex-basis: 30px; }
  .dashboard-metric-label { font-size: 0.66rem; }
  .dashboard-source { padding: 0.85rem; }
  .dashboard-gauge-chart { height: 11rem; }
  .dashboard-history-chart { height: 13rem; }
  :deep(.dashboard-chart-card .app-card-header) { padding: 0.8rem 0.9rem; }
  :deep(.dashboard-chart-card .app-card-body) { padding: 0.55rem 0.65rem 0.7rem; }
}

@media (prefers-reduced-motion: reduce) {
  .dashboard-page, .dashboard-metric, .dashboard-live > span, .dashboard-refresh-button .is-spinning { animation: none; }
  .dashboard-metric, .dashboard-simulation-link, .dashboard-refresh-button, :deep(.dashboard-chart-card.app-card) { transition: none; }
}
</style>
