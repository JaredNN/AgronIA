import { supabase } from './supabase'
import { parseCropAnalysis, type CropAnalysisResult } from './cropAnalysisValidation'

export interface ParcelOwner {
  id: string
  email: string
  full_name: string | null
}

export interface ParcelRecord {
  id: string
  owner_id: string
  name: string
  hectares: number
  crop: string
  municipality: string
  status: 'pending' | 'approved' | 'rejected'
  created_at: string
  profiles: ParcelOwner | null
}

export interface ParcelInput {
  owner_id: string
  name: string
  hectares: number
  crop: string
  municipality: string
  status: 'pending' | 'approved'
}

export interface CropAnalysisHistoryRecord extends CropAnalysisResult {
  id: string
  crop: string
  source_image_name: string
  created_at: string
}

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json | undefined }

export interface CropRecord {
  id: string
  name: string
  scientific_name: string | null
  optimal_min_humidity: number | null
  optimal_max_humidity: number | null
  optimal_min_temp: number | null
  optimal_max_temp: number | null
  growth_cycle_days: number | null
  created_at: string
}

export interface FieldRecord {
  id: string
  user_id: string
  name: string
  description: string | null
  geojson_data: Json | null
  created_at: string
  updated_at: string
  crop_id: string | null
}

export interface FieldCropInput {
  field_id: string
  crop_id: string
  planting_date?: string | null
  estimated_harvest_date?: string | null
  actual_harvest_date?: string | null
  yield_tons?: number | null
  status?: string
}

export interface FieldMetricInput {
  field_id: string
  record_date?: string
  soil_humidity?: number | null
  temperature?: number | null
  sustainability_index?: number | null
  raw_data?: Json
}

export interface FieldMetricRecord {
  id: string
  field_id: string
  user_id: string
  record_date: string
  soil_humidity: number | null
  temperature: number | null
  sustainability_index: number | null
  raw_data: Json
  created_at: string
}

export interface TreatmentInput {
  field_id: string
  treatment_type: string
  product_name?: string | null
  dosage?: number | null
  unit_of_measure?: string | null
  application_date?: string
  notes?: string | null
}

export interface DeviceInput {
  field_id: string
  name: string
  device_type: string
  status?: string
  configuration?: Json
}

export interface SimulationInput {
  field_id?: string | null
  scenario_title: string
  input_parameters: Json
  results: Json
}

const requireSupabase = () => {
  if (!supabase) {
    throw new Error('Supabase no está configurado. Añade VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY a .env.local.')
  }
  return supabase
}

export const listCrops = async (): Promise<CropRecord[]> => {
  const { data, error } = await requireSupabase()
    .from('crops')
    .select('*')
    .order('name', { ascending: true })
  if (error) throw new Error(`No se pudieron cargar los cultivos: ${error.message}`)
  return data ?? []
}

export const createCrop = async (
  crop: Omit<CropRecord, 'id' | 'created_at'>,
): Promise<CropRecord> => {
  const { data, error } = await requireSupabase()
    .from('crops')
    .insert(crop)
    .select('*')
    .single()
  if (error) throw new Error(`No se pudo guardar el cultivo: ${error.message}`)
  return data
}

export const listFields = async (): Promise<FieldRecord[]> => {
  const { data, error } = await requireSupabase()
    .from('fields')
    .select('id,user_id,name,description,geojson_data,created_at,updated_at,crop_id')
    .order('created_at', { ascending: false })
  if (error) throw new Error(`No se pudieron cargar los campos: ${error.message}`)
  return data ?? []
}

export const createField = async (
  field: Pick<FieldRecord, 'name'> & Partial<Pick<FieldRecord, 'description' | 'geojson_data' | 'crop_id'>>,
): Promise<FieldRecord> => {
  const { data, error } = await requireSupabase()
    .from('fields')
    .insert(field)
    .select('id,user_id,name,description,geojson_data,created_at,updated_at,crop_id')
    .single()
  if (error) throw new Error(`No se pudo guardar el campo: ${error.message}`)
  return data
}

export const deleteField = async (id: string): Promise<void> => {
  const { data, error } = await requireSupabase()
    .from('fields')
    .delete()
    .eq('id', id)
    .select('id')
    .maybeSingle()
  if (error) throw new Error(`No se pudo eliminar el campo: ${error.message}`)
  if (!data) throw new Error('El campo no existe o no tienes permiso para eliminarlo.')
}

const isJsonRecord = (value: unknown): value is Record<string, Json | undefined> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const saveMapWorkspace = async (
  name: string,
  geojson: Json,
  userId: string,
): Promise<string> => {
  const fieldName = name.trim()
  const mapFeatures = isJsonRecord(geojson) ? geojson.features : undefined
  if (fieldName.length < 1 || fieldName.length > 120) {
    throw new Error('El nombre del mapa debe tener entre 1 y 120 caracteres.')
  }
  if (!userId) throw new Error('Inicia sesión para guardar el mapa.')
  if (
    !isJsonRecord(geojson)
    || geojson.type !== 'FeatureCollection'
    || !Array.isArray(mapFeatures)
    || mapFeatures.length < 1
    || mapFeatures.length > 500
  ) {
    throw new Error('El mapa debe contener entre 1 y 500 elementos GeoJSON.')
  }

  const client = requireSupabase()
  const { data: field, error: fieldError } = await client
    .from('fields')
    .insert({ user_id: userId, name: fieldName, geojson_data: geojson })
    .select('id')
    .single()
  if (fieldError) throw new Error('No se pudo guardar el campo: ' + fieldError.message)

  const features: Json[] = mapFeatures
  const elements = features.flatMap((feature, index) => {
    if (!isJsonRecord(feature) || !isJsonRecord(feature.geometry)) return []
    const properties = isJsonRecord(feature.properties) ? feature.properties : {}
    const featureName = properties.name
    return [{
      field_id: field.id,
      user_id: userId,
      element_type: typeof feature.geometry.type === 'string' ? feature.geometry.type : 'Geometry',
      name: typeof featureName === 'string' && featureName.trim()
        ? featureName.trim()
        : 'Elemento ' + (index + 1),
      geometry_data: feature.geometry,
      properties,
    }]
  })

  if (elements.length > 0) {
    const { error: elementsError } = await client.from('map_elements').insert(elements)
    if (elementsError) {
      const { data: deletedField, error: cleanupError } = await client
        .from('fields')
        .delete()
        .eq('id', field.id)
        .select('id')
        .maybeSingle()
      if (cleanupError || !deletedField) {
        throw new Error(
          'No se pudieron guardar los elementos del mapa: ' + elementsError.message + '. '
          + 'Tampoco se pudo eliminar el campo incompleto: '
          + (cleanupError?.message ?? 'no se encontró o faltan permisos.'),
        )
      }
      throw new Error('No se pudieron guardar los elementos del mapa: ' + elementsError.message)
    }
  }

  return field.id
}

export const updateFieldGeometry = async (fieldId: string, geojson: Json): Promise<void> => {
  const { data, error } = await requireSupabase()
    .from('fields')
    .update({ geojson_data: geojson })
    .eq('id', fieldId)
    .select('id')
    .maybeSingle()
  if (error) throw new Error(`No se pudo actualizar la geometría de la parcela: ${error.message}`)
  if (!data) throw new Error('La parcela no existe o no tienes permiso para actualizarla.')
}

export const createFieldCrop = async (fieldCrop: FieldCropInput): Promise<void> => {
  const { error } = await requireSupabase().from('field_crops').insert(fieldCrop)
  if (error) throw new Error(`No se pudo guardar el cultivo del campo: ${error.message}`)
}

export const listFieldCrops = async (fieldId: string) => {
  const { data, error } = await requireSupabase()
    .from('field_crops')
    .select('*,crops(id,name,scientific_name)')
    .eq('field_id', fieldId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`No se pudieron cargar los cultivos del campo: ${error.message}`)
  return data ?? []
}

export const listSatelliteImagery = async (fieldId: string) => {
  const { data, error } = await requireSupabase()
    .from('satellite_imagery')
    .select('*')
    .eq('field_id', fieldId)
    .order('capture_date', { ascending: false })
  if (error) throw new Error(`No se pudieron cargar las imágenes satelitales: ${error.message}`)
  return data ?? []
}

export const saveSatelliteImagery = async (imagery: {
  field_id: string
  capture_date: string
  tile_url: string
  ndvi_avg?: number | null
  cloud_coverage?: number | null
}): Promise<void> => {
  const { error } = await requireSupabase().from('satellite_imagery').insert(imagery)
  if (error) throw new Error(`No se pudo guardar la imagen satelital: ${error.message}`)
}

export const saveMapElement = async (element: {
  field_id: string
  element_type: string
  name: string
  geometry_data: Json
  properties?: Json
}): Promise<void> => {
  const { error } = await requireSupabase().from('map_elements').insert(element)
  if (error) throw new Error(`No se pudo guardar el elemento del mapa: ${error.message}`)
}

export const listMapElements = async (fieldId: string) => {
  const { data, error } = await requireSupabase()
    .from('map_elements')
    .select('*')
    .eq('field_id', fieldId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(`No se pudieron cargar los elementos del mapa: ${error.message}`)
  return data ?? []
}

export const deleteMapElement = async (id: string): Promise<void> => {
  const { data, error } = await requireSupabase()
    .from('map_elements')
    .delete()
    .eq('id', id)
    .select('id')
    .maybeSingle()
  if (error) throw new Error(`No se pudo eliminar el elemento del mapa: ${error.message}`)
  if (!data) throw new Error('El elemento no existe o no tienes permiso para eliminarlo.')
}

export const createTreatment = async (treatment: TreatmentInput): Promise<void> => {
  const { error } = await requireSupabase().from('treatments').insert(treatment)
  if (error) throw new Error(`No se pudo guardar el tratamiento: ${error.message}`)
}

export const listTreatments = async (fieldId: string) => {
  const { data, error } = await requireSupabase()
    .from('treatments')
    .select('*')
    .eq('field_id', fieldId)
    .order('application_date', { ascending: false })
  if (error) throw new Error(`No se pudieron cargar los tratamientos: ${error.message}`)
  return data ?? []
}

export const createDevice = async (device: DeviceInput): Promise<void> => {
  const { error } = await requireSupabase().from('devices').insert(device)
  if (error) throw new Error(`No se pudo guardar el dispositivo: ${error.message}`)
}

export const listDevices = async (fieldId: string) => {
  const { data, error } = await requireSupabase()
    .from('devices')
    .select('*')
    .eq('field_id', fieldId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`No se pudieron cargar los dispositivos: ${error.message}`)
  return data ?? []
}

export const updateDeviceStatus = async (id: string, status: string): Promise<void> => {
  const { data, error } = await requireSupabase()
    .from('devices')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id')
    .maybeSingle()
  if (error) throw new Error(`No se pudo actualizar el dispositivo: ${error.message}`)
  if (!data) throw new Error('El dispositivo no existe o no tienes permiso para modificarlo.')
}

export const saveFieldMetric = async (metric: FieldMetricInput): Promise<void> => {
  await saveFieldMetrics([metric])
}

export const saveFieldMetrics = async (metrics: FieldMetricInput[]): Promise<void> => {
  const client = requireSupabase()
  for (let offset = 0; offset < metrics.length; offset += 500) {
    const batch = metrics.slice(offset, offset + 500)
    const { error } = await client.from('field_metrics').insert(batch)
    if (error) {
      throw new Error(`No se pudieron guardar las mediciones ${offset + 1}-${offset + batch.length}: ${error.message}`)
    }
  }
}

export const listFieldMetrics = async (fieldId: string): Promise<FieldMetricRecord[]> => {
  const { data, error } = await requireSupabase()
    .from('field_metrics')
    .select('*')
    .eq('field_id', fieldId)
    .order('record_date', { ascending: false })
    .limit(100)
  if (error) throw new Error(`No se pudieron cargar las mediciones del campo: ${error.message}`)
  return data ?? []
}

export const createAlert = async (alert: {
  field_id: string
  alert_type: string
  severity: string
  message: string
}): Promise<void> => {
  const { error } = await requireSupabase().from('ai_alerts').insert(alert)
  if (error) throw new Error(`No se pudo guardar la alerta: ${error.message}`)
}

export const listAlerts = async (fieldId: string) => {
  const { data, error } = await requireSupabase()
    .from('ai_alerts')
    .select('*')
    .eq('field_id', fieldId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`No se pudieron cargar las alertas: ${error.message}`)
  return data ?? []
}

export const markAlertRead = async (id: string): Promise<void> => {
  const { data, error } = await requireSupabase()
    .from('ai_alerts')
    .update({ is_read: true })
    .eq('id', id)
    .select('id')
    .maybeSingle()
  if (error) throw new Error(`No se pudo marcar la alerta como leída: ${error.message}`)
  if (!data) throw new Error('La alerta no existe o no tienes permiso para modificarla.')
}

export const createSimulation = async (simulation: SimulationInput): Promise<void> => {
  const client = requireSupabase()
  const { data: { user }, error: authError } = await client.auth.getUser()
  if (authError) throw new Error(`No se pudo validar la sesión para guardar la simulación: ${authError.message}`)
  if (!user) throw new Error('Inicia sesión para guardar la simulación.')

  const { error } = await client.from('simulations').insert({
    ...simulation,
    user_id: user.id,
  })
  if (error) throw new Error(`No se pudo guardar la simulación: ${error.message}`)
}

export const listSimulations = async (fieldId?: string) => {
  let query = requireSupabase()
    .from('simulations')
    .select('id,user_id,field_id,scenario_title,input_parameters,results,created_at')
    .order('created_at', { ascending: false })
    .limit(100)
  if (fieldId) query = query.eq('field_id', fieldId)
  const { data, error } = await query
  if (error) throw new Error(`No se pudieron cargar las simulaciones: ${error.message}`)
  return data ?? []
}

export const listParcels = async (): Promise<ParcelRecord[]> => {
  const client = requireSupabase()
  const { data, error } = await client
    .from('parcels')
    .select('id,owner_id,name,hectares,crop,municipality,status,created_at,profiles!parcels_owner_id_fkey(id,email,full_name)')
    .order('created_at', { ascending: false })
  if (error) throw new Error(`No se pudieron cargar las parcelas: ${error.message}`)
  return (data ?? []) as unknown as ParcelRecord[]
}

export const listParcelOwners = async (): Promise<ParcelOwner[]> => {
  const client = requireSupabase()
  const { data, error } = await client
    .from('profiles')
    .select('id,email,full_name')
    .eq('role', 'cliente')
    .eq('active', true)
    .order('full_name', { ascending: true })
  if (error) throw new Error(`No se pudieron cargar los clientes: ${error.message}`)
  return (data ?? []) as ParcelOwner[]
}

export const createParcel = async (parcel: ParcelInput): Promise<ParcelRecord> => {
  const client = requireSupabase()
  const { data, error } = await client
    .from('parcels')
    .insert(parcel)
    .select('id,owner_id,name,hectares,crop,municipality,status,created_at,profiles!parcels_owner_id_fkey(id,email,full_name)')
    .single()
  if (error) throw new Error(`No se pudo guardar la parcela: ${error.message}`)
  return data as unknown as ParcelRecord
}

export const updateParcelStatus = async (
  id: string,
  status: ParcelRecord['status'],
): Promise<void> => {
  const { data, error } = await requireSupabase()
    .from('parcels')
    .update({ status })
    .eq('id', id)
    .select('id')
    .maybeSingle()
  if (error) throw new Error(`No se pudo actualizar el estado de la parcela: ${error.message}`)
  if (!data) throw new Error('La parcela no existe o no tienes permiso para modificarla.')
}

export const deleteParcel = async (id: string): Promise<void> => {
  const { data, error } = await requireSupabase()
    .from('parcels')
    .delete()
    .eq('id', id)
    .select('id')
    .maybeSingle()
  if (error) throw new Error(`No se pudo eliminar la parcela: ${error.message}`)
  if (!data) throw new Error('La parcela no existe o no tienes permiso para eliminarla.')
}

export const listCropAnalysisHistory = async (): Promise<CropAnalysisHistoryRecord[]> => {
  const { data, error } = await requireSupabase()
    .from('crop_analysis_results')
    .select('id,crop,source_image_name,summary,image_quality,detections,created_at')
    .order('created_at', { ascending: false })
    .limit(10)
  if (error) throw new Error(`No se pudo cargar el historial de análisis: ${error.message}`)
  return (data ?? []).map(row => ({
    id: row.id,
    crop: row.crop,
    source_image_name: row.source_image_name,
    created_at: row.created_at,
    ...parseCropAnalysis({
      summary: row.summary,
      imageQuality: row.image_quality,
      detections: row.detections,
    }),
  }))
}

export const saveCropAnalysis = async (
  crop: string,
  sourceImageName: string,
  result: CropAnalysisResult,
): Promise<CropAnalysisHistoryRecord> => {
  const { data, error } = await requireSupabase()
    .from('crop_analysis_results')
    .insert({
      crop,
      source_image_name: sourceImageName.slice(0, 180),
      summary: result.summary,
      image_quality: result.imageQuality,
      detections: result.detections,
    })
    .select('id,crop,source_image_name,summary,image_quality,detections,created_at')
    .single()
  if (error) throw new Error(`El análisis se completó, pero no se pudo guardar en el historial: ${error.message}`)
  return {
    id: data.id,
    crop: data.crop,
    source_image_name: data.source_image_name,
    created_at: data.created_at,
    ...parseCropAnalysis({
      summary: data.summary,
      imageQuality: data.image_quality,
      detections: data.detections,
    }),
  }
}
