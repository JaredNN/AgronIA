import assert from 'node:assert/strict'
import test from 'node:test'
import { buildPlantMaskFromRgba } from '../../src/services/multispectralPlantEngine.ts'

function makeSolidRgba(w: number, h: number, r: number, g: number, b: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    const p = i * 4
    data[p] = r
    data[p + 1] = g
    data[p + 2] = b
    data[p + 3] = 255
  }
  return data
}

function paintRectRgba(
  data: Uint8ClampedArray,
  w: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  r: number,
  g: number,
  b: number
) {
  for (let y = y1; y < y2; y++) {
    for (let x = x1; x < x2; x++) {
      const p = (y * w + x) * 4
      data[p] = r
      data[p + 1] = g
      data[p + 2] = b
      data[p + 3] = 255
    }
  }
}

test('buildPlantMaskFromRgba confines mask and presets strictly inside detected plantRegions', () => {
  const w = 80
  const h = 60
  const rgba = makeSolidRgba(w, h, 210, 196, 178) // pared beige de fondo

  // Falsa mancha verde fuera de la región seleccionada (ej. esquina inferior izquierda)
  paintRectRgba(rgba, w, 4, 38, 22, 54, 42, 148, 48)
  // Planta real detectada dentro de la región derecha (x: 0.6..0.9, y: 0.1..0.5 -> px 48..72, 6..30)
  paintRectRgba(rgba, w, 50, 8, 70, 28, 46, 155, 52)

  const res = buildPlantMaskFromRgba(rgba, w, h, {
    sensitivity: 0.55,
    detectionMode: 'auto_vegetation',
    plantRegions: [{ x: 0.6, y: 0.1, width: 0.3, height: 0.4 }]
  })

  assert.ok(res.plantPixelCount > 50, 'should mask foliage inside the selected plant box')
  // Ningún píxel fuera de x=[48..72], y=[6..30] puede quedar marcado
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const insideBox = x >= 48 && x < 72 && y >= 6 && y < 30
      if (!insideBox) {
        assert.equal(res.mask[y * w + x], 0, `unexpected masked pixel outside region at (${x},${y})`)
      }
    }
  }
})

test('buildPlantMaskFromRgba returns zero masked pixels when suppressPlantMask is true (NO_PLANT)', () => {
  const w = 60
  const h = 40
  const rgba = makeSolidRgba(w, h, 46, 155, 52)

  const res = buildPlantMaskFromRgba(rgba, w, h, {
    sensitivity: 0.55,
    detectionMode: 'auto_vegetation',
    suppressPlantMask: true
  })

  assert.equal(res.plantPixelCount, 0)
  assert.equal(res.boxPixelCount, 0)
  assert.equal(res.mask.reduce((acc, v) => acc + v, 0), 0)
})

test('buildPlantMaskFromRgba rejects beige walls and human skin tones even without plantRegions', () => {
  const w = 80
  const h = 60
  const beigeWall = makeSolidRgba(w, h, 212, 195, 175)
  const wallRes = buildPlantMaskFromRgba(beigeWall, w, h, {
    sensitivity: 0.6,
    detectionMode: 'auto_vegetation'
  })
  assert.equal(wallRes.plantPixelCount, 0, 'beige wall should not be masked as chlorotic foliage')

  const skinTone = makeSolidRgba(w, h, 198, 154, 126)
  const skinRes = buildPlantMaskFromRgba(skinTone, w, h, {
    sensitivity: 0.6,
    detectionMode: 'auto_vegetation'
  })
  assert.equal(skinRes.plantPixelCount, 0, 'human skin should not be masked as plant foliage')

  // Hoja verde real dominante + pequeño ruido aislado en esquina opuesta
  const scene = makeSolidRgba(w, h, 212, 195, 175)
  paintRectRgba(scene, w, 25, 15, 55, 45, 45, 152, 50)
  paintRectRgba(scene, w, 2, 2, 6, 6, 45, 152, 50) // componente menor < 25% que debe limpiarse
  const plantRes = buildPlantMaskFromRgba(scene, w, h, {
    sensitivity: 0.55,
    detectionMode: 'auto_vegetation'
  })
  assert.ok(plantRes.plantPixelCount > 400)
  assert.equal(plantRes.mask[3 * w + 3], 0, 'isolated background noise component should be cleared')
})
