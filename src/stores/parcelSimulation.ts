import { computed, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import type { FieldRecord, SimulationRecord } from '../services/agronomyData.ts'
import { extractParcelMetadata } from '../services/fieldGeometry.ts'
import { hydrateExportedSimulation } from '../services/simulationEconomics.ts'
import type {
  ExportedDashboardSimulation,
  ParcelGeometryMetadata,
  SimulationReport,
} from '../types/simulation.ts'

const EXPORTS_CACHE_KEY = 'agronia-exported-simulations-v1'
const MAX_CACHED_EXPORTS = 10

const loadCachedExports = (): ExportedDashboardSimulation[] => {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(EXPORTS_CACHE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as ExportedDashboardSimulation[]) : []
  } catch {
    return []
  }
}

const persistCachedExports = (items: ExportedDashboardSimulation[]) => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(EXPORTS_CACHE_KEY, JSON.stringify(items.slice(0, MAX_CACHED_EXPORTS)))
  } catch {
    // Ignorar límites de cuota de almacenamiento local
  }
}

export const useParcelSimulationStore = defineStore('parcelSimulation', () => {
  const fields = shallowRef<FieldRecord[]>([])
  const activeFieldId = ref('')
  const activeParcelGeometry = shallowRef<ParcelGeometryMetadata | null>(null)
  const latestSimulationReport = shallowRef<SimulationReport | null>(null)

  const initialExports = loadCachedExports()
  const exportedSimulations = shallowRef<ExportedDashboardSimulation[]>(initialExports)
  const selectedExportedSimulationId = ref(initialExports[0]?.id ?? '')

  const selectedExportedSimulation = computed<ExportedDashboardSimulation | null>(() => {
    if (exportedSimulations.value.length === 0) return null
    return (
      exportedSimulations.value.find(item => item.id === selectedExportedSimulationId.value) ??
      exportedSimulations.value[0]
    )
  })

  function setFields(nextFields: FieldRecord[]) {
    fields.value = nextFields
    if (activeFieldId.value) {
      const match = nextFields.find(item => item.id === activeFieldId.value)
      if (match) {
        activeParcelGeometry.value = extractParcelMetadata(match.geojson_data, match.id, match.name)
      }
    }
  }

  function upsertField(field: FieldRecord) {
    const idx = fields.value.findIndex(item => item.id === field.id)
    if (idx >= 0) {
      fields.value = [
        ...fields.value.slice(0, idx),
        field,
        ...fields.value.slice(idx + 1),
      ]
    } else {
      fields.value = [field, ...fields.value]
    }
    if (activeFieldId.value === field.id) {
      activeParcelGeometry.value = extractParcelMetadata(field.geojson_data, field.id, field.name)
    }
  }

  function selectField(fieldId: string) {
    activeFieldId.value = fieldId
    const match = fields.value.find(item => item.id === fieldId)
    activeParcelGeometry.value = match
      ? extractParcelMetadata(match.geojson_data, match.id, match.name)
      : null
  }

  function setActiveParcelGeometry(meta: ParcelGeometryMetadata | null) {
    activeParcelGeometry.value = meta
  }

  function setSimulationReport(report: SimulationReport | null) {
    latestSimulationReport.value = report
  }

  function registerExportedSimulation(entry: ExportedDashboardSimulation) {
    const deduped = exportedSimulations.value.filter(
      item =>
        item.id !== entry.id &&
        !(
          item.report.generatedAt === entry.report.generatedAt &&
          item.fieldId === entry.fieldId &&
          item.report.tick === entry.report.tick
        )
    )
    const nextList = [entry, ...deduped].slice(0, MAX_CACHED_EXPORTS)
    exportedSimulations.value = nextList
    selectedExportedSimulationId.value = entry.id
    latestSimulationReport.value = entry.report
    activeParcelGeometry.value = entry.report.parcel
    if (entry.fieldId) {
      activeFieldId.value = entry.fieldId
    }
    persistCachedExports(nextList)
  }

  function mergeSupabaseSimulations(records: SimulationRecord[]) {
    const hydrated = records
      .map(hydrateExportedSimulation)
      .filter((item): item is ExportedDashboardSimulation => item !== null)

    if (hydrated.length === 0) return

    const existingLocalOnly = exportedSimulations.value.filter(localItem => {
      if (localItem.source === 'supabase') return false
      return !hydrated.some(
        remoteItem =>
          remoteItem.id === localItem.id ||
          (remoteItem.report.generatedAt === localItem.report.generatedAt &&
            remoteItem.fieldId === localItem.fieldId &&
            remoteItem.report.tick === localItem.report.tick)
      )
    })

    const combined = [...hydrated, ...existingLocalOnly]
      .sort((a, b) => new Date(b.exportedAt).getTime() - new Date(a.exportedAt).getTime())
      .slice(0, MAX_CACHED_EXPORTS)

    exportedSimulations.value = combined
    if (
      !selectedExportedSimulationId.value ||
      !combined.some(item => item.id === selectedExportedSimulationId.value)
    ) {
      selectedExportedSimulationId.value = combined[0]?.id ?? ''
    }
    persistCachedExports(combined)
  }

  function selectExportedSimulation(id: string) {
    selectedExportedSimulationId.value = id
  }

  return {
    fields,
    activeFieldId,
    activeParcelGeometry,
    latestSimulationReport,
    exportedSimulations,
    selectedExportedSimulationId,
    selectedExportedSimulation,
    setFields,
    upsertField,
    selectField,
    setActiveParcelGeometry,
    setSimulationReport,
    registerExportedSimulation,
    mergeSupabaseSimulations,
    selectExportedSimulation,
  }
})
