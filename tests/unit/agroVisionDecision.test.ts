import assert from 'node:assert/strict'
import test from 'node:test'
import {
  computeVegetationRatioFromRgba,
  evaluatePlantPresence,
  NON_PLANT_DETECTOR_LABELS,
  NON_PLANT_PROMPTS
} from '../../src/services/agroVisionDecision.ts'

test('evaluatePlantPresence confirms real in-dataset and out-of-dataset plants with CLIP active', () => {
  assert.ok(NON_PLANT_PROMPTS.length >= 10)
  assert.ok(NON_PLANT_DETECTOR_LABELS.has('cell phone'))

  const trainedPlant = evaluatePlantPresence({
    clipReady: true,
    maxPlantScore: 0.42,
    maxNonPlantScore: 0.03,
    totalPlantProb: 0.91,
    totalNonPlantProb: 0.09,
    hasAiPlantBox: true,
    hasNonPlantDetectorBox: false,
    vegetationRatio: 0.38,
    onnxMaxProb: 0.98,
    onnxEntropy: 0.05
  })
  assert.equal(trainedPlant.isPlant, true)
  assert.equal(trainedPlant.reason, 'plant_confirmed')

  const externalPlant = evaluatePlantPresence({
    clipReady: true,
    maxPlantScore: 0.31,
    maxNonPlantScore: 0.07,
    totalPlantProb: 0.82,
    totalNonPlantProb: 0.18,
    hasAiPlantBox: false,
    hasNonPlantDetectorBox: false,
    vegetationRatio: 0.24,
    onnxMaxProb: 0.52,
    onnxEntropy: 0.48
  })
  assert.equal(externalPlant.isPlant, true)
  assert.equal(externalPlant.reason, 'plant_confirmed')
})

test('evaluatePlantPresence rejects non-plant objects even when ONNX emits high softmax confidence', () => {
  const phoneOrCup = evaluatePlantPresence({
    clipReady: true,
    maxPlantScore: 0.06,
    maxNonPlantScore: 0.34,
    totalPlantProb: 0.19,
    totalNonPlantProb: 0.81,
    hasAiPlantBox: false,
    hasNonPlantDetectorBox: false,
    vegetationRatio: 0.01,
    onnxMaxProb: 0.95,
    onnxEntropy: 0.09
  })
  assert.equal(phoneOrCup.isPlant, false)
  assert.equal(phoneOrCup.reason, 'clip_non_plant')

  const greenShirtOrBottle = evaluatePlantPresence({
    clipReady: true,
    maxPlantScore: 0.09,
    maxNonPlantScore: 0.28,
    totalPlantProb: 0.32,
    totalNonPlantProb: 0.68,
    hasAiPlantBox: false,
    hasNonPlantDetectorBox: false,
    vegetationRatio: 0.42,
    onnxMaxProb: 0.91,
    onnxEntropy: 0.15
  })
  assert.equal(greenShirtOrBottle.isPlant, false)
  assert.equal(greenShirtOrBottle.reason, 'clip_non_plant')

  const personHoldingPhone = evaluatePlantPresence({
    clipReady: true,
    maxPlantScore: 0.14,
    maxNonPlantScore: 0.12,
    totalPlantProb: 0.56,
    totalNonPlantProb: 0.44,
    hasAiPlantBox: false,
    hasNonPlantDetectorBox: true,
    nonPlantDetectorLabel: 'cell phone',
    vegetationRatio: 0.02,
    onnxMaxProb: 0.89,
    onnxEntropy: 0.18
  })
  assert.equal(personHoldingPhone.isPlant, false)
  assert.equal(personHoldingPhone.reason, 'detector_non_plant')
  assert.equal(personHoldingPhone.detectedNonPlantLabel, 'cell phone')
})

test('evaluatePlantPresence discriminates non-plants when CLIP is offline using vegetation ratio and detector', () => {
  const noVegWall = evaluatePlantPresence({
    clipReady: false,
    hasAiPlantBox: false,
    hasNonPlantDetectorBox: false,
    vegetationRatio: 0.01,
    onnxMaxProb: 0.92,
    onnxEntropy: 0.11
  })
  assert.equal(noVegWall.isPlant, false)
  assert.equal(noVegWall.reason, 'low_vegetation_offline')

  const detectorPerson = evaluatePlantPresence({
    clipReady: false,
    hasAiPlantBox: false,
    hasNonPlantDetectorBox: true,
    nonPlantDetectorLabel: 'person',
    vegetationRatio: 0.25,
    onnxMaxProb: 0.9,
    onnxEntropy: 0.12
  })
  assert.equal(detectorPerson.isPlant, false)
  assert.equal(detectorPerson.reason, 'detector_non_plant')

  const realLeafOffline = evaluatePlantPresence({
    clipReady: false,
    hasAiPlantBox: false,
    hasNonPlantDetectorBox: false,
    vegetationRatio: 0.32,
    onnxMaxProb: 0.94,
    onnxEntropy: 0.08
  })
  assert.equal(realLeafOffline.isPlant, true)
  assert.equal(realLeafOffline.reason, 'plant_confirmed')
})

test('computeVegetationRatioFromRgba distinguishes green foliage from gray/skin backgrounds', () => {
  // 4 píxeles: 2 hojas verdes (35,145,40) y 2 grises (130,130,130)
  const mixed = new Uint8ClampedArray([
    35, 145, 40, 255,
    40, 150, 38, 255,
    130, 130, 130, 255,
    160, 140, 135, 255
  ])
  assert.equal(computeVegetationRatioFromRgba(mixed), 0.5)

  const grayWall = new Uint8ClampedArray([
    180, 180, 180, 255,
    190, 188, 185, 255
  ])
  assert.equal(computeVegetationRatioFromRgba(grayWall), 0)
})
