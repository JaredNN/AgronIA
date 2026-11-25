export const GENERIC_PLANT_ANCHOR_PROMPT =
  'a real living plant, green leaf, crop foliage, stem, flower, cactus or potted plant'

export const NON_PLANT_PROMPTS: readonly string[] = [
  'a human person, human face, hand, skin, clothing or portrait with no plants',
  'an electronic device such as a smartphone, laptop, computer monitor, keyboard or mouse',
  'everyday household objects like a cup, mug, bottle, pen, book, glasses or bag',
  'indoor furniture like a wooden desk, table, chair, bed, shelf or sofa',
  'an empty room wall, ceiling, floor, door, window or plain background with no vegetation',
  'a dark, blurry or plain blank surface with no plants or leaves',
  'a pet animal such as a dog, cat, bird or toy figure',
  'a vehicle, car, bicycle, street, building or urban scene without plants',
  'cooked food, packaged snacks, plastic container, metal tool or box',
  'a printed document, text on paper, notebook, screen display or logo',
  'plastic, fabric, cloth, leather or artificial non-botanical material close-up',
  'a green non-plant object like green clothing, green wall, green plastic bottle, green toy or green book'
]

export const NON_PLANT_DETECTOR_LABELS: ReadonlySet<string> = new Set([
  'person',
  'cell phone',
  'laptop',
  'keyboard',
  'mouse',
  'cup',
  'bottle',
  'book',
  'chair',
  'couch',
  'dining table',
  'tv',
  'remote',
  'backpack',
  'handbag',
  'cat',
  'dog',
  'bird',
  'car',
  'truck',
  'bicycle',
  'motorcycle',
  'clock',
  'scissors',
  'toothbrush',
  'bowl',
  'spoon',
  'fork',
  'knife',
  'wine glass',
  'bed',
  'toilet',
  'refrigerator',
  'microwave',
  'oven',
  'toaster',
  'sink',
  'teddy bear',
  'sports ball',
  'suitcase',
  'tie',
  'umbrella',
  'shoe',
  'hat'
])

const NON_PLANT_LABEL_ES: Record<string, string> = {
  person: 'persona / rostro / mano',
  'cell phone': 'teléfono celular',
  laptop: 'computadora portátil',
  keyboard: 'teclado',
  mouse: 'ratón de computadora',
  cup: 'taza o vaso',
  bottle: 'botella',
  book: 'libro o cuaderno',
  chair: 'silla',
  couch: 'sofá',
  'dining table': 'mesa o escritorio',
  tv: 'pantalla o monitor',
  remote: 'control remoto',
  backpack: 'mochila',
  handbag: 'bolso',
  cat: 'gato',
  dog: 'perro',
  bird: 'ave',
  car: 'automóvil',
  truck: 'vehículo',
  bicycle: 'bicicleta',
  motorcycle: 'motocicleta',
  clock: 'reloj',
  bowl: 'tazón o recipiente',
  shoe: 'calzado',
  hat: 'gorra o sombrero'
}

export function translateNonPlantLabelEs(label?: string | null): string {
  if (!label) return 'objeto no vegetal'
  const key = label.trim().toLowerCase()
  return NON_PLANT_LABEL_ES[key] ?? label
}

/**
 * Estima la proporción de píxeles con firma foliar (verdor ExG o tejido clorótico/seco cálido).
 */
export function computeVegetationRatioFromRgba(rgba: Uint8ClampedArray): number {
  const pixelCount = Math.floor(rgba.length / 4)
  if (pixelCount <= 0) return 0

  let vegCount = 0
  for (let i = 0; i < pixelCount; i++) {
    const p = i * 4
    const r = rgba[p]
    const g = rgba[p + 1]
    const b = rgba[p + 2]

    const exg = 2 * g - r - b
    const isGreenLeaf = exg > 18 && g > r + 4 && g > b + 2 && g > 28
    const isChloroticLeaf = g > 55 && r > 55 && g >= b * 1.18 && r >= b * 1.15 && Math.abs(g - r) < 48 && exg > 4

    if (isGreenLeaf || isChloroticLeaf) {
      vegCount++
    }
  }

  return vegCount / pixelCount
}

export interface PlantPresenceInput {
  clipReady: boolean
  forceLens?: boolean
  maxPlantScore?: number
  maxNonPlantScore?: number
  totalPlantProb?: number
  totalNonPlantProb?: number
  hasAiPlantBox: boolean
  hasNonPlantDetectorBox: boolean
  nonPlantDetectorLabel?: string | null
  vegetationRatio: number
  onnxMaxProb: number
  onnxEntropy: number
}

export interface PlantPresenceDecision {
  isPlant: boolean
  reason: 'clip_non_plant' | 'detector_non_plant' | 'low_vegetation_offline' | 'plant_confirmed'
  detectedNonPlantLabel?: string
}

/**
 * Decide si la escena/recorte corresponde realmente a una planta o debe descartarse como objeto no vegetal.
 */
export function evaluatePlantPresence(input: PlantPresenceInput): PlantPresenceDecision {
  if (input.forceLens) {
    return { isPlant: true, reason: 'plant_confirmed' }
  }

  const label = input.nonPlantDetectorLabel ?? undefined

  if (input.clipReady) {
    const maxPlant = input.maxPlantScore ?? 0
    const maxNonPlant = input.maxNonPlantScore ?? 0
    const totalPlant = input.totalPlantProb ?? 0
    const totalNonPlant = input.totalNonPlantProb ?? 0

    // Comparación justa max-vs-max (sin sesgo por cantidad de prompts)
    if (maxNonPlant > maxPlant * 1.02 && !(input.hasAiPlantBox && totalPlant > 0.6)) {
      return {
        isPlant: false,
        reason: 'clip_non_plant',
        detectedNonPlantLabel: label
      }
    }

    if (totalNonPlant >= 0.45 && totalNonPlant > totalPlant) {
      return {
        isPlant: false,
        reason: 'clip_non_plant',
        detectedNonPlantLabel: label
      }
    }

    if (input.hasNonPlantDetectorBox && !input.hasAiPlantBox && totalNonPlant >= 0.25) {
      return {
        isPlant: false,
        reason: 'detector_non_plant',
        detectedNonPlantLabel: label
      }
    }

    return { isPlant: true, reason: 'plant_confirmed' }
  }

  // Fallback cuando CLIP todavía no ha cargado en navegador
  if (input.hasNonPlantDetectorBox && !input.hasAiPlantBox) {
    return {
      isPlant: false,
      reason: 'detector_non_plant',
      detectedNonPlantLabel: label
    }
  }

  if (
    !input.hasAiPlantBox &&
    (input.vegetationRatio < 0.035 ||
      (input.vegetationRatio < 0.08 && (input.onnxMaxProb < 0.8 || input.onnxEntropy > 0.34)))
  ) {
    return {
      isPlant: false,
      reason: 'low_vegetation_offline',
      detectedNonPlantLabel: label
    }
  }

  return { isPlant: true, reason: 'plant_confirmed' }
}
