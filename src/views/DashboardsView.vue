<script setup lang="ts">
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { BarChart, GaugeChart, LineChart, PieChart } from 'echarts/charts'
import {
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
} from 'echarts/components'
import VChart from 'vue-echarts'
import Card from '../components/ui/Card.vue'
import SimulationSatelliteMap from '../components/dashboard/SimulationSatelliteMap.vue'
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { RouterLink } from 'vue-router'
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  BatteryCharging,
  Bug,
  CheckCircle,
  DollarSign,
  Droplets,
  Info,
  MapPin,
  ShieldCheck,
  Sparkles,
  Thermometer,
  TrendingUp,
} from 'lucide-vue-next'
import {
  listFieldMetrics,
  listFields,
  listSimulations,
  type FieldMetricRecord,
  type FieldRecord,
} from '../services/agronomyData'
import { useParcelSimulationStore } from '../stores/parcelSimulation'

use([
  CanvasRenderer,
  LineChart,
  PieChart,
  BarChart,
  GaugeChart,
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  GridComponent,
])

const parcelSimStore = useParcelSimulationStore()

// ============================================================
// Reportes de Simulación Exportados (Mapa + Gráficas + Finanzas)
// ============================================================
const exportedSimulations = computed(() => parcelSimStore.exportedSimulations)
const selectedSimulationId = computed({
  get: () => parcelSimStore.selectedExportedSimulationId,
  set: (value: string) => parcelSimStore.selectExportedSimulation(value),
})
const activeSimulation = computed(() => parcelSimStore.selectedExportedSimulation)
const simulationLoadNote = ref('')

const formatCurrencyMxn = (value: number) =>
  new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    maximumFractionDigits: 0,
  }).format(value)

const formatDateTime = (iso: string) => {
  const dt = new Date(iso)
  if (Number.isNaN(dt.getTime())) return iso
  return dt.toLocaleString('es-MX', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const activeAffectedStats = computed(() => {
  const sim = activeSimulation.value
  if (!sim) return { affected: 0, pct: 0, criticalTotal: 0 }
  const total = Math.max(1, sim.report.summary.totalPlants)
  const counts = sim.report.summary.countsByState
  const criticalTotal =
    (counts['estrés_crítico'] ?? 0) + (counts['pérdida_irreversible'] ?? 0)
  const affected = total - (counts.saludable ?? 0)
  return {
    affected,
    pct: Number(((affected / total) * 100).toFixed(1)),
    criticalTotal,
  }
})

const baseChartTooltip = {
  confine: true,
  appendToBody: true,
  backgroundColor: 'rgba(15, 22, 17, 0.96)',
  borderColor: 'rgba(196, 218, 147, 0.28)',
  borderWidth: 1,
  padding: [8, 10],
  textStyle: { color: '#e8eddf', fontSize: 12 },
  extraCssText:
    'max-width: 240px; white-space: normal; word-break: break-word; box-shadow: 0 10px 28px rgba(0, 0, 0, 0.48); z-index: 9999999;',
}

const formatDroneEfficiencyTooltip = (params: unknown) => {
  const items = Array.isArray(params) ? params : [params]
  const first = items[0]
  const title =
    typeof first === 'object' && first !== null
      ? String(
          ('axisValueLabel' in first ? first.axisValueLabel : undefined) ??
            ('name' in first ? first.name : '') ??
            ''
        )
      : ''
  const unit = title.includes('(m)')
    ? ' m'
    : title.includes('(s)')
      ? ' s'
      : title.includes('(%)')
        ? '%'
        : ''

  const lines = items
    .map(item => {
      if (typeof item !== 'object' || item === null) return ''
      const marker = 'marker' in item && typeof item.marker === 'string' ? item.marker : ''
      const seriesName =
        'seriesName' in item && typeof item.seriesName === 'string' ? item.seriesName : ''
      const rawValue = 'value' in item ? Number(item.value) : Number.NaN
      const formattedValue = Number.isFinite(rawValue)
        ? `${rawValue.toLocaleString('es-MX', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}${unit}`
        : '—'
      return `<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;"><span>${marker}${seriesName}</span><strong>${formattedValue}</strong></div>`
    })
    .filter(Boolean)

  return `<div style="font-weight:700;margin-bottom:4px;">${title}</div>${lines.join('')}`
}

// Gráfica 1: Distribución porcentual de salud del cultivo (Donut)
const healthDistributionChartOptions = computed(() => {
  const sim = activeSimulation.value
  if (!sim) return {}
  const counts = sim.report.summary.countsByState
  const rawSlices = [
    { value: counts.saludable ?? 0, name: 'Saludable', color: '#22c55e' },
    { value: counts['estrés_leve'] ?? 0, name: 'Estrés leve', color: '#eab308' },
    { value: counts['estrés_moderado'] ?? 0, name: 'Estrés moderado', color: '#f97316' },
    { value: counts['estrés_crítico'] ?? 0, name: 'Estrés crítico', color: '#ef4444' },
    { value: counts['pérdida_irreversible'] ?? 0, name: 'Pérdida irreversible', color: '#7f1d1d' },
  ]
  return {
    tooltip: {
      ...baseChartTooltip,
      trigger: 'item',
      formatter: '{b}: <strong>{c}</strong> plantas ({d}%)',
    },
    legend: {
      bottom: 0,
      itemWidth: 10,
      itemHeight: 10,
      itemGap: 8,
      textStyle: { color: '#c4ccb8', fontSize: 10 },
    },
    series: [
      {
        name: 'Estado del cultivo',
        type: 'pie',
        radius: ['40%', '62%'],
        center: ['50%', '40%'],
        avoidLabelOverlap: true,
        itemStyle: {
          borderRadius: 6,
          borderColor: '#131914',
          borderWidth: 2,
        },
        label: {
          show: true,
          color: '#e8eddf',
          formatter: '{d}%',
          fontSize: 11,
          distanceToLabelLine: 4,
        },
        labelLine: {
          length: 8,
          length2: 8,
          smooth: 0.2,
        },
        labelLayout: {
          hideOverlap: true,
          moveOverlap: 'shiftY' as const,
        },
        data: rawSlices.map(slice => ({
          value: slice.value,
          name: slice.name,
          itemStyle: { color: slice.color },
          ...(slice.value === 0 ? { label: { show: false }, labelLine: { show: false } } : {}),
        })),
      },
    ],
  }
})

// Gráfica 2: Evolución temporal del estrés hídrico durante la simulación
const stressEvolutionChartOptions = computed(() => {
  const timeline = activeSimulation.value?.stressTimeline ?? []
  return {
    tooltip: {
      ...baseChartTooltip,
      trigger: 'axis',
    },
    legend: {
      data: ['Estrés promedio (%)', 'Estrés máximo (%)', 'Plantas afectadas'],
      bottom: 0,
      itemWidth: 10,
      itemHeight: 10,
      itemGap: 10,
      textStyle: { color: '#c4ccb8', fontSize: 10 },
    },
    grid: { left: 10, right: 10, top: 30, bottom: 52, containLabel: true },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: timeline.map(point => `Ciclo ${point.tick}`),
      axisLabel: { color: '#9aa48f', fontSize: 10 },
      axisLine: { lineStyle: { color: 'rgba(196, 218, 147, 0.2)' } },
    },
    yAxis: [
      {
        type: 'value',
        name: 'Estrés %',
        nameGap: 10,
        min: 0,
        max: 100,
        nameTextStyle: { color: '#9aa48f', fontSize: 10 },
        axisLabel: { color: '#9aa48f', fontSize: 10 },
        splitLine: { lineStyle: { color: 'rgba(196, 218, 147, 0.09)' } },
      },
      {
        type: 'value',
        name: 'Plantas',
        nameGap: 10,
        minInterval: 1,
        nameTextStyle: { color: '#9aa48f', fontSize: 10 },
        axisLabel: { color: '#9aa48f', fontSize: 10 },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: 'Estrés promedio (%)',
        type: 'line',
        smooth: true,
        data: timeline.map(p => p.avgWaterStressPercent),
        itemStyle: { color: '#f59e0b' },
        lineStyle: { width: 3, color: '#f59e0b' },
        areaStyle: { color: 'rgba(245, 158, 11, 0.16)' },
      },
      {
        name: 'Estrés máximo (%)',
        type: 'line',
        smooth: true,
        data: timeline.map(p => p.maxWaterStressPercent),
        itemStyle: { color: '#ef4444' },
        lineStyle: { width: 2, type: 'dashed', color: '#ef4444' },
      },
      {
        name: 'Plantas afectadas',
        type: 'line',
        yAxisIndex: 1,
        smooth: true,
        data: timeline.map(p => p.affectedCount),
        itemStyle: { color: '#38bdf8' },
        lineStyle: { width: 2.5, color: '#38bdf8' },
      },
    ],
  }
})

// Gráfica 3: Eficiencia del dron IA (TSP 2-opt vs. Barrido Completo)
const droneEfficiencyChartOptions = computed(() => {
  const flight = activeSimulation.value?.report.droneFlight
  if (!flight) return {}
  return {
    tooltip: {
      ...baseChartTooltip,
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: formatDroneEfficiencyTooltip,
    },
    legend: {
      data: ['Barrido completo', 'Ruta IA (TSP 2-opt)'],
      bottom: 0,
      itemWidth: 10,
      itemHeight: 10,
      itemGap: 10,
      textStyle: { color: '#c4ccb8', fontSize: 11 },
    },
    grid: { left: 8, right: 10, top: 18, bottom: 48, containLabel: true },
    xAxis: {
      type: 'category',
      data: ['Distancia (m)', 'Tiempo (s)', 'Batería (%)'],
      axisLabel: { color: '#aab39f', interval: 0, fontSize: 11, hideOverlap: false },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#9aa48f', fontSize: 10 },
      splitLine: { lineStyle: { color: 'rgba(196, 218, 147, 0.09)' } },
    },
    series: [
      {
        name: 'Barrido completo',
        type: 'bar',
        barMaxWidth: 32,
        data: [
          Number(flight.baselineFullSweepDistanceMeters.toFixed(1)),
          Number(flight.baselineFullSweepTimeSeconds.toFixed(1)),
          Number(flight.baselineBatteryPercent.toFixed(1)),
        ],
        itemStyle: { color: '#64748b', borderRadius: [6, 6, 0, 0] },
      },
      {
        name: 'Ruta IA (TSP 2-opt)',
        type: 'bar',
        barMaxWidth: 32,
        data: [
          Number(flight.totalDistanceMeters.toFixed(1)),
          Number(flight.estimatedFlightTimeSeconds.toFixed(1)),
          Number(flight.estimatedBatteryPercent.toFixed(1)),
        ],
        itemStyle: { color: '#38bdf8', borderRadius: [6, 6, 0, 0] },
      },
    ],
  }
})

// Gráfica 4: Comparativo Financiero (Impacto Reactivo vs Inversión Preventiva vs Ahorro Neto)
const financialComparisonChartOptions = computed(() => {
  const econ = activeSimulation.value?.economics
  if (!econ) return {}
  return {
    tooltip: {
      ...baseChartTooltip,
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      valueFormatter: (val: number) => formatCurrencyMxn(val),
    },
    grid: { left: 8, right: 10, top: 16, bottom: 8, containLabel: true },
    xAxis: {
      type: 'category',
      data: ['Tratamiento\nReactivo', 'Impacto\nTotal', 'Inversión\nPreventiva', 'Ahorro Neto\nProyectado'],
      axisLabel: { color: '#c4ccb8', fontSize: 10, lineHeight: 13, interval: 0 },
    },
    yAxis: {
      type: 'value',
      axisLabel: {
        color: '#9aa48f',
        fontSize: 10,
        formatter: (value: number) => `$${(value / 1000).toFixed(0)}k`,
      },
      splitLine: { lineStyle: { color: 'rgba(196, 218, 147, 0.09)' } },
    },
    series: [
      {
        name: 'Monto (MXN)',
        type: 'bar',
        barMaxWidth: 42,
        data: [
          {
            value: econ.reactive.reactiveTreatmentTotalCost,
            itemStyle: { color: '#f97316', borderRadius: [6, 6, 0, 0] },
          },
          {
            value: econ.reactive.totalReactiveImpactCost,
            itemStyle: { color: '#ef4444', borderRadius: [6, 6, 0, 0] },
          },
          {
            value: econ.preventiveTotalCost,
            itemStyle: { color: '#38bdf8', borderRadius: [6, 6, 0, 0] },
          },
          {
            value: Math.max(0, econ.totalProjectedNetSavings),
            itemStyle: { color: '#22c55e', borderRadius: [6, 6, 0, 0] },
          },
        ],
      },
    ],
  }
})

// ============================================================
// Estado de telemetría histórica (mediciones guardadas de Supabase)
// ============================================================
const fields = shallowRef<FieldRecord[]>([])
const selectedFieldId = ref('')
const metrics = shallowRef<FieldMetricRecord[]>([])
const dataError = ref('')
const hasSimulationMetrics = computed(() =>
  metrics.value.some(
    metric =>
      metric.raw_data !== null &&
      typeof metric.raw_data === 'object' &&
      !Array.isArray(metric.raw_data) &&
      metric.raw_data.source === 'simulation'
  )
)
const latestMetricWith = (value: (metric: FieldMetricRecord) => number | null) =>
  metrics.value.find(metric => value(metric) !== null)
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
const simHumidity = computed(() => latestMetricWith(metric => metric.soil_humidity)?.soil_humidity ?? null)
const simPestIndex = computed(() =>
  rawMetricValue(
    latestMetricWith(metric => rawMetricValue(metric, 'pest_index')),
    'pest_index'
  )
)
const simTemperature = computed(() => latestMetricWith(metric => metric.temperature)?.temperature ?? null)
const simNDVI = computed(() =>
  rawMetricValue(
    latestMetricWith(metric => rawMetricValue(metric, 'ndvi_avg')),
    'ndvi_avg'
  )
)
const simSustainability = computed(
  () => latestMetricWith(metric => metric.sustainability_index)?.sustainability_index ?? null
)
const loadMetrics = async () => {
  metrics.value = selectedFieldId.value ? await listFieldMetrics(selectedFieldId.value) : []
  dataError.value = ''
}

watch(selectedFieldId, () => {
  void loadMetrics().catch(error => {
    dataError.value = error instanceof Error ? error.message : 'No se pudieron cargar las mediciones.'
  })
})

watch(
  activeSimulation,
  sim => {
    if (sim?.fieldId && fields.value.some(field => field.id === sim.fieldId)) {
      selectedFieldId.value = sim.fieldId
    }
  },
  { immediate: true }
)

let telemetryInterval: ReturnType<typeof setInterval> | undefined
onMounted(async () => {
  const [fieldsRes, simsRes] = await Promise.allSettled([listFields(), listSimulations()])
  if (fieldsRes.status === 'fulfilled') {
    fields.value = fieldsRes.value
    parcelSimStore.setFields(fieldsRes.value)
    const activeSimField = activeSimulation.value?.fieldId
    if (activeSimField && fieldsRes.value.some(f => f.id === activeSimField)) {
      selectedFieldId.value = activeSimField
    } else {
      selectedFieldId.value = fieldsRes.value[0]?.id ?? ''
    }
  } else {
    dataError.value =
      fieldsRes.reason instanceof Error
        ? fieldsRes.reason.message
        : 'No se pudieron cargar los datos del campo.'
  }

  if (simsRes.status === 'fulfilled') {
    parcelSimStore.mergeSupabaseSimulations(simsRes.value)
  } else {
    simulationLoadNote.value =
      'Mostrando exportaciones guardadas en memoria local (sesión remota pendiente).'
  }

  telemetryInterval = setInterval(() => {
    void loadMetrics().catch(error => {
      dataError.value =
        error instanceof Error ? error.message : 'No se pudieron actualizar las mediciones.'
    })
  }, 10_000)
})

onBeforeUnmount(() => {
  if (telemetryInterval) clearInterval(telemetryInterval)
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

const chartRecords = computed(() => [...metrics.value].slice(0, 100).reverse())
const chartDates = computed(() =>
  chartRecords.value.map(metric =>
    new Date(metric.record_date).toLocaleString('es-MX', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  )
)

const climateChartOptions = computed(() => ({
  animationDuration: 900,
  animationDurationUpdate: 500,
  animationEasing: 'cubicOut' as const,
  tooltip: {
    ...baseChartTooltip,
    trigger: 'axis',
  },
  legend: { data: ['Humedad Suelo (%)', 'Temperatura (°C)'], bottom: 0, textStyle: { color: '#aab19f' } },
  grid: { left: '3%', right: '4%', bottom: '15%', containLabel: true },
  xAxis: {
    type: 'category',
    boundaryGap: false,
    data: chartDates.value,
    axisLine: { lineStyle: { color: 'rgba(196, 218, 147, 0.16)' } },
    axisTick: { show: false },
    axisLabel: { color: '#929b88' },
  },
  yAxis: {
    type: 'value',
    axisLine: { show: false },
    axisLabel: { color: '#929b88' },
    splitLine: { lineStyle: { color: 'rgba(196, 218, 147, 0.09)' } },
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
      areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: '#10B98140' }, { offset: 1, color: '#10B98105' }] } },
    },
    {
      name: 'Temperatura (°C)',
      type: 'line',
      smooth: true,
      data: chartRecords.value.map(metric => metric.temperature),
      symbolSize: 7,
      itemStyle: { color: '#e5a261' },
      lineStyle: { width: 3, color: '#e5a261' },
    },
  ],
}))

const sustainabilityChartOptions = computed(() => ({
  animationDuration: 900,
  animationDurationUpdate: 500,
  animationEasing: 'cubicOut' as const,
  tooltip: {
    ...baseChartTooltip,
    trigger: 'axis',
  },
  grid: { left: '3%', right: '4%', bottom: '15%', containLabel: true },
  xAxis: {
    type: 'category',
    data: chartDates.value,
    axisLine: { lineStyle: { color: 'rgba(196, 218, 147, 0.16)' } },
    axisTick: { show: false },
    axisLabel: { color: '#929b88' },
  },
  yAxis: {
    type: 'value',
    axisLine: { show: false },
    axisLabel: { color: '#929b88' },
    splitLine: { lineStyle: { color: 'rgba(196, 218, 147, 0.09)' } },
  },
  series: [
    {
      name: 'Índice de Sustentabilidad',
      type: 'line',
      smooth: true,
      data: chartRecords.value.map(metric => metric.sustainability_index),
      symbolSize: 7,
      itemStyle: { color: '#72d59f' },
      lineStyle: { width: 3, color: '#72d59f' },
    },
  ],
}))

const comparisonChartOptions = computed(() => ({
  animationDuration: 900,
  animationDurationUpdate: 500,
  animationEasing: 'cubicOut' as const,
  tooltip: {
    ...baseChartTooltip,
    trigger: 'axis',
  },
  grid: { left: '3%', right: '4%', bottom: '15%', containLabel: true },
  xAxis: {
    type: 'category',
    data: chartDates.value,
    axisLine: { lineStyle: { color: 'rgba(196, 218, 147, 0.16)' } },
    axisTick: { show: false },
    axisLabel: { color: '#929b88' },
  },
  yAxis: {
    type: 'value',
    axisLine: { show: false },
    axisLabel: { color: '#929b88' },
    splitLine: { lineStyle: { color: 'rgba(196, 218, 147, 0.09)' } },
  },
  series: [
    {
      name: 'Índice de plagas',
      type: 'line',
      smooth: true,
      data: chartRecords.value.map(metric => rawMetricValue(metric, 'pest_index')),
      symbolSize: 7,
      itemStyle: { color: '#e77f69' },
      lineStyle: { width: 3, color: '#e77f69' },
    },
  ],
}))

const ndviGaugeOptions = computed(() => ({
  series: [
    {
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
          color: [[0.33, '#EF4444'], [0.66, '#F97316'], [0.85, '#facc15'], [1, '#10B981']],
        },
      },
      pointer: {
        icon: 'path://M2090.36389,615.30999 L2090.36389,615.30999 C2091.48372,615.30999 2092.40383,616.23010 2092.40383,617.34993 L2092.40383,652.35000 C2092.40383,653.46983 2091.48372,654.38994 2090.36389,654.38994 L2090.36389,654.38994 C2089.24406,654.38994 2088.32395,653.46983 2088.32395,652.35000 L2088.32395,617.34993 C2088.32395,616.23010 2089.24406,615.30999 2090.36389,615.30999 Z',
        length: '75%',
        width: 6,
        offsetCenter: [0, '5%'],
      },
      detail: {
        valueAnimation: true,
        formatter: (v: number) => `NDVI\n${v.toFixed(2)}`,
        color: '#e8eddf',
        fontSize: 14,
        fontWeight: 'bold',
        offsetCenter: [0, '60%'],
      },
      data: [{ value: simNDVI.value ?? 0 }],
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { color: '#a0aa94', fontSize: 10, formatter: (v: number) => v.toFixed(1) },
    },
  ],
}))

const pestGaugeOptions = computed(() => ({
  series: [
    {
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
          color: [[0.3, '#10B981'], [0.6, '#facc15'], [0.85, '#F97316'], [1, '#EF4444']],
        },
      },
      pointer: {
        icon: 'path://M2090.36389,615.30999 L2090.36389,615.30999 C2091.48372,615.30999 2092.40383,616.23010 2092.40383,617.34993 L2092.40383,652.35000 C2092.40383,653.46983 2091.48372,654.38994 2090.36389,654.38994 L2090.36389,654.38994 C2089.24406,654.38994 2088.32395,653.46983 2088.32395,652.35000 L2088.32395,617.34993 C2088.32395,616.23010 2089.24406,615.30999 2090.36389,615.30999 Z',
        length: '75%',
        width: 6,
        offsetCenter: [0, '5%'],
      },
      detail: {
        valueAnimation: true,
        formatter: (v: number) => `Plagas\n${v.toFixed(0)}%`,
        color: '#e8eddf',
        fontSize: 14,
        fontWeight: 'bold',
        offsetCenter: [0, '60%'],
      },
      data: [{ value: simPestIndex.value ?? 0 }],
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { color: '#a0aa94', fontSize: 10 },
    },
  ],
}))
</script>

<template>
  <div class="dashboard-page space-y-6">
    <header class="dashboard-heading">
      <div>
        <span class="dashboard-eyebrow">INTELIGENCIA AGRÍCOLA · REPORTE EJECUTIVO</span>
        <h1>Dashboard del cliente</h1>
        <p>Visualización georreferenciada, evolución fitosanitaria y análisis económico preventivo.</p>
      </div>
      <div class="dashboard-heading-actions flex-wrap">
        <div v-if="exportedSimulations.length" class="flex items-center gap-2">
          <label class="sr-only" for="dashboard-simulation-select">Simulación exportada</label>
          <select
            id="dashboard-simulation-select"
            v-model="selectedSimulationId"
            class="max-w-[270px] rounded-lg border border-amber-400/30 bg-[#182019] px-3 py-2 text-xs font-semibold text-amber-200"
          >
            <option v-for="sim in exportedSimulations" :key="sim.id" :value="sim.id">
              {{ sim.title }} · {{ formatDateTime(sim.exportedAt) }}
            </option>
          </select>
        </div>
        <label class="sr-only" for="dashboard-field-select">Campo para consultar</label>
        <select id="dashboard-field-select" v-model="selectedFieldId" class="rounded-lg border border-white/10 bg-[#182019] px-3 py-2 text-sm text-white" :disabled="fields.length === 0">
          <option value="" disabled>Selecciona un campo</option>
          <option v-for="field in fields" :key="field.id" :value="field.id">{{ field.name }}</option>
        </select>
        <span class="dashboard-live"><span></span> Actualización cada 10 s</span>
        <RouterLink to="/simulacion" class="dashboard-simulation-link">
          Abrir simulador <ArrowRight :size="16" />
        </RouterLink>
      </div>
    </header>

    <p v-if="simulationLoadNote" class="text-xs text-amber-300/90">{{ simulationLoadNote }}</p>

    <!-- ================================================================ -->
    <!-- SECCIÓN PRINCIPAL: SIMULACIÓN EXPORTADA (MAPA + GRÁFICAS + ROI)  -->
    <!-- ================================================================ -->
    <section v-if="activeSimulation" class="space-y-6">
      <div class="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-400/20 bg-gradient-to-r from-emerald-950/50 via-[#161e17] to-[#1a2018] px-4 py-3 text-xs">
        <div class="flex flex-wrap items-center gap-2.5">
          <span class="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-500/15 px-2.5 py-1 font-bold text-emerald-300">
            <BarChart3 :size="14" />
            Simulación Exportada · Ciclo #{{ activeSimulation.report.tick }}
          </span>
          <strong class="text-sm text-white">{{ activeSimulation.report.parcel.fieldName }}</strong>
          <span class="text-gray-400">
            {{ formatDateTime(activeSimulation.exportedAt) }} · Origen:
            <strong class="text-amber-300">{{ activeSimulation.source === 'supabase' ? 'Supabase Cloud' : 'Caché Local' }}</strong>
          </span>
        </div>
        <div class="flex flex-wrap items-center gap-4 text-emerald-100/85">
          <span>Centroide: <strong class="font-mono">{{ activeSimulation.report.parcel.centroid.lat.toFixed(5) }}, {{ activeSimulation.report.parcel.centroid.lng.toFixed(5) }}</strong></span>
          <span>Vértices: <strong>{{ activeSimulation.report.parcel.vertexCount }}</strong></span>
          <span>Perímetro: <strong>{{ activeSimulation.report.parcel.perimeterMeters.toFixed(1) }} m</strong></span>
        </div>
      </div>

      <!-- KPIs Ejecutivos de la Simulación -->
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div class="dashboard-metric dashboard-metric-green">
          <div class="dashboard-metric-heading">
            <span class="dashboard-metric-icon"><MapPin :size="18" /></span>
            <span class="dashboard-metric-label">Superficie real de parcela</span>
          </div>
          <div class="dashboard-metric-value">
            {{ activeSimulation.report.parcel.areaHectares.toFixed(2) }}<span>ha</span>
          </div>
          <div class="dashboard-metric-note">
            {{ activeSimulation.report.parcel.areaSquareMeters.toLocaleString('es-MX') }} m² · {{ activeSimulation.report.summary.totalPlants }} plantas monitoreadas
          </div>
        </div>

        <div class="dashboard-metric dashboard-metric-orange">
          <div class="dashboard-metric-heading">
            <span class="dashboard-metric-icon"><AlertTriangle :size="18" /></span>
            <span class="dashboard-metric-label">Afectación y severidad</span>
          </div>
          <div class="dashboard-metric-value">
            {{ activeAffectedStats.pct }}<span>%</span>
          </div>
          <div class="dashboard-metric-note">
            {{ activeAffectedStats.affected }} afectadas · {{ activeAffectedStats.criticalTotal }} críticas/irrecup. · Estrés prom. {{ activeSimulation.report.summary.avgWaterStressPercent }}%
          </div>
        </div>

        <div class="dashboard-metric dashboard-metric-blue">
          <div class="dashboard-metric-heading">
            <span class="dashboard-metric-icon"><BatteryCharging :size="18" /></span>
            <span class="dashboard-metric-label">Ahorro batería dron IA</span>
          </div>
          <div class="dashboard-metric-value">
            {{ activeSimulation.report.droneFlight.batterySavingsPercent }}<span>%</span>
          </div>
          <div class="dashboard-metric-note">
            {{ activeSimulation.report.droneFlight.totalDistanceMeters.toFixed(0) }} m vs {{ activeSimulation.report.droneFlight.baselineFullSweepDistanceMeters.toFixed(0) }} m barrido · {{ Math.round(activeSimulation.report.droneFlight.estimatedFlightTimeSeconds) }} s
          </div>
        </div>

        <div class="dashboard-metric dashboard-metric-amber">
          <div class="dashboard-metric-heading">
            <span class="dashboard-metric-icon"><DollarSign :size="18" /></span>
            <span class="dashboard-metric-label">Ahorro neto preventivo</span>
          </div>
          <div class="dashboard-metric-value text-emerald-300">
            {{ formatCurrencyMxn(Math.max(0, activeSimulation.economics.totalProjectedNetSavings)) }}
          </div>
          <div class="dashboard-metric-note">
            Impacto reactivo: {{ formatCurrencyMxn(activeSimulation.economics.reactive.totalReactiveImpactCost) }} · ROI {{ activeSimulation.economics.overallRoiPercent }}%
          </div>
        </div>
      </div>

      <!-- Mapa Satelital Georreferenciado -->
      <Card class="dashboard-chart-card">
        <template #header>
          <div class="dashboard-chart-heading flex-wrap">
            <div>
              <span>CARTOGRAFÍA SATELITAL GEORREFERENCIADA</span>
              <h3>Polígono real, severidad por planta y trayectoria TSP 2-opt del dron</h3>
            </div>
            <span class="dashboard-chart-caption">Haz clic en cualquier punto o waypoint para ver detalle lat/lng</span>
          </div>
        </template>
        <SimulationSatelliteMap :report="activeSimulation.report" />
      </Card>

      <!-- Gráficas ejecutivas para comprensión rápida -->
      <div class="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card class="dashboard-chart-card">
          <template #header>
            <div class="dashboard-chart-heading">
              <div><span>DISTRIBUCIÓN DE SALUD</span><h3>Porcentaje por severidad</h3></div>
              <span class="dashboard-chart-value">{{ activeSimulation.report.summary.avgHealthPercent }}%</span>
            </div>
          </template>
          <div class="h-72 w-full">
            <v-chart class="chart" :option="healthDistributionChartOptions" autoresize />
          </div>
        </Card>

        <Card class="dashboard-chart-card">
          <template #header>
            <div class="dashboard-chart-heading">
              <div><span>EVOLUCIÓN TEMPORAL</span><h3>Estrés hídrico por ciclo</h3></div>
              <span class="dashboard-chart-value">{{ activeSimulation.stressTimeline.length }} ciclos</span>
            </div>
          </template>
          <div class="h-72 w-full">
            <v-chart class="chart" :option="stressEvolutionChartOptions" autoresize />
          </div>
        </Card>

        <Card class="dashboard-chart-card">
          <template #header>
            <div class="dashboard-chart-heading">
              <div><span>COBERTURA Y EFICIENCIA IA</span><h3>TSP 2-opt vs. Barrido total</h3></div>
              <span class="dashboard-chart-value text-sky-300">-{{ activeSimulation.report.droneFlight.batterySavingsPercent }}%</span>
            </div>
          </template>
          <div class="h-72 w-full">
            <v-chart class="chart" :option="droneEfficiencyChartOptions" autoresize />
          </div>
          <div class="mt-2 flex items-center justify-between border-t border-white/10 pt-2 text-[11px] text-gray-300">
            <span>Objetivos atendidos: <strong class="text-sky-300">{{ activeSimulation.report.droneFlight.targetedPlantCount }}</strong></span>
            <span>Sanas omitidas: <strong class="text-emerald-300">{{ activeSimulation.report.droneFlight.skippedHealthyPlantCount }}</strong></span>
          </div>
        </Card>
      </div>

      <!-- Análisis Económico Reactivo vs. Recomendaciones Preventivas -->
      <div class="grid grid-cols-1 gap-6 xl:grid-cols-12">
        <Card class="dashboard-chart-card xl:col-span-5">
          <template #header>
            <div class="dashboard-chart-heading">
              <div>
                <span>COSTO DEL TRATAMIENTO REACTIVO</span>
                <h3>Estimación financiera actual ({{ activeSimulation.economics.currency }})</h3>
              </div>
              <span class="dashboard-chart-value text-orange-300">
                {{ formatCurrencyMxn(activeSimulation.economics.reactive.totalReactiveImpactCost) }}
              </span>
            </div>
          </template>

          <div class="space-y-4">
            <p class="rounded-xl border border-amber-400/20 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-100">
              {{ activeSimulation.economics.summaryNote }}
            </p>

            <div class="space-y-2 text-xs">
              <div class="flex justify-between border-b border-white/10 pb-1.5">
                <span class="text-gray-400">Superficie afectada / recuperable</span>
                <strong>
                  {{ activeSimulation.economics.reactive.affectedAreaHectares.toFixed(3) }} ha ({{ activeSimulation.economics.reactive.affectedAreaSquareMeters.toLocaleString('es-MX') }} m²)
                </strong>
              </div>
              <div class="flex justify-between">
                <span class="text-gray-300">Riego de emergencia sectorizado</span>
                <strong>{{ formatCurrencyMxn(activeSimulation.economics.reactive.emergencyIrrigationCost) }}</strong>
              </div>
              <div class="flex justify-between">
                <span class="text-gray-300">Fertilizantes y bioestimulantes antiestrés</span>
                <strong>{{ formatCurrencyMxn(activeSimulation.economics.reactive.fertilizersBiostimulantsCost) }}</strong>
              </div>
              <div class="flex justify-between">
                <span class="text-gray-300">
                  Operación con dron IA
                  <small class="text-emerald-400">(ahorra {{ formatCurrencyMxn(activeSimulation.economics.reactive.droneFuelSavingsAmount) }})</small>
                </span>
                <strong>{{ formatCurrencyMxn(activeSimulation.economics.reactive.droneApplicationCost) }}</strong>
              </div>
              <div class="flex justify-between">
                <span class="text-gray-300">Mano de obra y cuadrilla de campo</span>
                <strong>{{ formatCurrencyMxn(activeSimulation.economics.reactive.fieldLaborCost) }}</strong>
              </div>
              <div class="flex justify-between border-t border-white/15 pt-2 font-bold text-orange-300">
                <span>Subtotal tratamiento reactivo</span>
                <span>{{ formatCurrencyMxn(activeSimulation.economics.reactive.reactiveTreatmentTotalCost) }}</span>
              </div>
              <div class="flex justify-between text-red-300">
                <span>Pérdida proyectada de rendimiento ({{ activeSimulation.economics.reactive.projectedYieldLossPercent }}%)</span>
                <strong>{{ formatCurrencyMxn(activeSimulation.economics.reactive.projectedYieldLossCost) }}</strong>
              </div>
              <div class="flex justify-between rounded-lg bg-red-500/15 px-3 py-2 font-bold text-red-200">
                <span>Impacto económico total sin prevención</span>
                <span>{{ formatCurrencyMxn(activeSimulation.economics.reactive.totalReactiveImpactCost) }}</span>
              </div>
            </div>

            <div class="h-56 w-full pt-2">
              <v-chart class="chart" :option="financialComparisonChartOptions" autoresize />
            </div>
          </div>
        </Card>

        <Card class="dashboard-chart-card xl:col-span-7">
          <template #header>
            <div class="dashboard-chart-heading flex-wrap">
              <div>
                <span>ESTRATEGIA PREVENTIVA CON IA</span>
                <h3>Recomendaciones accionables y ahorro neto proyectado</h3>
              </div>
              <span class="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-500/15 px-3 py-1 text-xs font-bold text-emerald-300">
                <ShieldCheck :size="14" />
                Inversión: {{ formatCurrencyMxn(activeSimulation.economics.preventiveTotalCost) }} → Ahorro neto: {{ formatCurrencyMxn(Math.max(0, activeSimulation.economics.totalProjectedNetSavings)) }}
              </span>
            </div>
          </template>

          <div class="space-y-3.5">
            <div
              v-for="rec in activeSimulation.economics.preventiveRecommendations"
              :key="rec.id"
              class="rounded-xl border border-emerald-400/15 bg-[#121913]/90 p-4 transition hover:border-amber-400/35"
            >
              <div class="flex flex-wrap items-start justify-between gap-2">
                <div class="space-y-1">
                  <div class="flex items-center gap-2">
                    <span
                      class="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                      :class="
                        rec.priority === 'alta'
                          ? 'bg-red-500/20 text-red-300 border border-red-400/30'
                          : rec.priority === 'media'
                            ? 'bg-amber-500/20 text-amber-300 border border-amber-400/30'
                            : 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/30'
                      "
                    >
                      Prioridad {{ rec.priority }}
                    </span>
                    <span class="text-[11px] text-gray-400">Área objetivo: {{ rec.targetAreaHectares.toFixed(2) }} ha</span>
                  </div>
                  <h4 class="text-sm font-bold text-white flex items-center gap-1.5">
                    <Sparkles :size="14" class="text-amber-300 shrink-0" />
                    {{ rec.title }}
                  </h4>
                </div>
                <span class="rounded-lg border border-emerald-400/25 bg-emerald-500/10 px-2.5 py-1 text-xs font-bold text-emerald-300">
                  ROI {{ rec.roiPercent }}%
                </span>
              </div>

              <p class="mt-2 text-xs text-gray-300 leading-relaxed">{{ rec.triggerReason }}</p>

              <ul class="mt-2.5 space-y-1 text-[11px] text-emerald-100/85">
                <li v-for="(step, idx) in rec.actionSteps" :key="idx" class="flex items-start gap-1.5">
                  <span class="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400"></span>
                  <span>{{ step }}</span>
                </li>
              </ul>

              <div class="mt-3 grid grid-cols-3 gap-2 border-t border-white/10 pt-2.5 text-xs">
                <div>
                  <span class="block text-[10px] text-gray-400">Costo implementación</span>
                  <strong class="text-sky-300">{{ formatCurrencyMxn(rec.implementationCost) }}</strong>
                </div>
                <div>
                  <span class="block text-[10px] text-gray-400">Costos/merma evitados</span>
                  <strong class="text-gray-200">{{ formatCurrencyMxn(rec.avoidedCorrectiveCost + rec.avoidedYieldLoss) }}</strong>
                </div>
                <div>
                  <span class="block text-[10px] text-gray-400">Ahorro neto proyectado</span>
                  <strong class="text-emerald-300">{{ formatCurrencyMxn(Math.max(0, rec.projectedNetSavings)) }}</strong>
                </div>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </section>

    <div
      v-else
      class="flex flex-col items-start justify-between gap-4 rounded-2xl border border-amber-400/25 bg-[#182019]/90 p-5 sm:flex-row sm:items-center"
    >
      <div class="space-y-1">
        <h2 class="text-base font-bold text-white">Aún no hay simulaciones exportadas al Dashboard</h2>
        <p class="text-xs text-gray-300">
          Ejecuta una simulación con tu polígono real en el Simulador 3D y pulsa <strong>Enviar al Dashboard</strong> para ver el mapa satelital georreferenciado, las gráficas y el análisis económico preventivo.
        </p>
      </div>
      <RouterLink to="/simulacion" class="dashboard-simulation-link shrink-0">
        Ir al simulador <ArrowRight :size="16" />
      </RouterLink>
    </div>

    <!-- ================================================================ -->
    <!-- SECCIÓN SECUNDARIA: HISTORIAL DE TELEMETRÍA Y MÉTRICAS DE CAMPO -->
    <!-- ================================================================ -->
    <div class="border-t border-white/10 pt-6 space-y-6">
      <div>
        <span class="dashboard-eyebrow">HISTORIAL DE MEDICIONES DE CAMPO</span>
        <h2 class="text-lg font-bold text-white mt-1">Telemetría registrada por parcela</h2>
      </div>

      <p v-if="dataError" role="alert" class="text-sm text-red-400">{{ dataError }}</p>
      <p v-else-if="!fields.length" class="text-sm text-gray-400">
        No hay campos registrados. <RouterLink to="/mapas" class="text-agron-green underline">Crea o guarda un campo desde el mapa.</RouterLink>
      </p>
      <p v-else-if="!metrics.length" class="text-sm text-gray-400">
        Este campo aún no tiene mediciones históricas en <code>field_metrics</code>.
      </p>

      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
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

        <div class="dashboard-metric dashboard-metric-amber">
          <div class="dashboard-metric-heading">
            <span class="dashboard-metric-icon"><Thermometer :size="18" /></span>
            <span class="dashboard-metric-label">Temperatura</span>
          </div>
          <div class="dashboard-metric-value">
            {{ simTemperature === null ? '—' : simTemperature.toFixed(1) }}<span v-if="simTemperature !== null">°C</span>
          </div>
          <div class="dashboard-metric-note">Promedio del campo</div>
        </div>

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

      <div class="dashboard-source">
        <span class="dashboard-source-icon"><Info :size="17" /></span>
        <div>
          <strong>Datos registrados del campo</strong>
          <p>Los indicadores inferiores provienen de las mediciones guardadas en <code>field_metrics</code>. NDVI y plagas se leen de los campos <code>ndvi_avg</code> y <code>pest_index</code> de <code>raw_data</code>.</p>
          <p v-if="hasSimulationMetrics" class="mt-1 text-amber-300">Este historial incluye registros generados desde el simulador 3D.</p>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card class="dashboard-chart-card">
          <template #header>
            <div class="dashboard-chart-heading">
              <div><span>VIGOR VEGETAL</span><h3>Índice NDVI</h3></div>
              <span class="dashboard-chart-value">{{ simNDVI === null ? '—' : simNDVI.toFixed(2) }}</span>
            </div>
          </template>
          <div class="h-64 w-full">
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
          <div class="h-64 w-full">
            <v-chart v-if="simPestIndex !== null" class="chart" :option="pestGaugeOptions" autoresize />
            <p v-else class="grid h-full place-items-center text-sm text-gray-400">Sin dato de plagas registrado.</p>
          </div>
        </Card>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card class="dashboard-chart-card lg:col-span-2">
          <template #header>
            <div class="dashboard-chart-heading">
              <div><span>HISTORIAL RECIENTE</span><h3>Clima y humedad del suelo</h3></div>
              <span class="dashboard-chart-caption">Hasta 100 registros</span>
            </div>
          </template>
          <div class="h-80 w-full">
            <v-chart class="chart" :option="climateChartOptions" autoresize />
          </div>
        </Card>

        <Card class="dashboard-chart-card">
          <template #header>
            <div class="dashboard-chart-heading">
              <div><span>ÍNDICE DE SUSTENTABILIDAD</span><h3>Historial registrado</h3></div>
              <span class="dashboard-chart-value">{{ simSustainability === null ? '—' : simSustainability.toFixed(2) }}</span>
            </div>
          </template>
          <div class="h-80 w-full">
            <v-chart class="chart" :option="sustainabilityChartOptions" autoresize />
          </div>
        </Card>

        <Card class="dashboard-chart-card">
          <template #header>
            <div class="dashboard-chart-heading">
              <div><span>MONITOREO FITOSANITARIO</span><h3>Historial del índice de plagas</h3></div>
            </div>
          </template>
          <div class="h-80 w-full">
            <v-chart class="chart" :option="comparisonChartOptions" autoresize />
          </div>
        </Card>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dashboard-page {
  min-width: 0;
  color: #e8eddf;
  animation: dashboard-arrive 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
}

.dashboard-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1.5rem;
  padding: 0.2rem 0 0.25rem;
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
  align-items: center;
  gap: 0.75rem;
}

.dashboard-live {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  color: #bdc5b1;
  font-size: 0.68rem;
  white-space: nowrap;
}

.dashboard-live > span {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #d5b75f;
  box-shadow: 0 0 12px rgba(213, 183, 95, 0.5);
  animation: dashboard-pulse 2s ease-in-out infinite;
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
  padding: 1.15rem;
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
  margin: 0.75rem 0 0.55rem;
  color: #f0f1e9;
  font-size: clamp(1.5rem, 2.5vw, 2.05rem);
  font-weight: 800;
  letter-spacing: -0.05em;
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
  gap: 0.8rem;
  padding: 1rem 1.1rem;
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
  padding: 1.1rem 1.3rem;
  border-color: rgba(196, 218, 147, 0.1);
}

:deep(.dashboard-chart-card .app-card-body) { padding: 1rem 1.15rem 1.2rem; }

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

@media (max-width: 760px) {
  .dashboard-heading { align-items: flex-start; flex-direction: column; gap: 1rem; }
  .dashboard-heading-actions { width: 100%; justify-content: space-between; }
}

@media (max-width: 480px) {
  .dashboard-heading-actions { align-items: flex-start; flex-direction: column; }
  .dashboard-metric { padding: 0.9rem; }
  .dashboard-metric-heading { gap: 0.48rem; }
  .dashboard-metric-icon { width: 30px; height: 30px; flex-basis: 30px; }
  .dashboard-metric-label { font-size: 0.66rem; }
  .dashboard-source { padding: 0.85rem; }
  :deep(.dashboard-chart-card .app-card-header) { padding: 0.95rem 1rem; }
  :deep(.dashboard-chart-card .app-card-body) { padding: 0.65rem 0.7rem 0.9rem; }
}

@media (prefers-reduced-motion: reduce) {
  .dashboard-page, .dashboard-metric, .dashboard-live > span { animation: none; }
  .dashboard-metric, .dashboard-simulation-link, :deep(.dashboard-chart-card.app-card) { transition: none; }
}
</style>
