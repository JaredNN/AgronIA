import * as THREE from 'three'
import { isPointInProjectedField, type FieldPoint, type ProjectedField } from './fieldGeometry.ts'

export interface SurroundingPlacement {
  kind: 'greenhouse' | 'barn' | 'water_tank' | 'tree_cluster'
  x: number
  z: number
  rotationY: number
  scale: number
  footprintRadius: number
}

export interface ValleyMetrics {
  maxDim: number
  fieldRadius: number
  innerMountainRadius: number
  outerMountainRadius: number
  groundSize: number
}

const STRUCTURE_OFFSET_DIRECTIONS: ReadonlyArray<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [0.707, 0.707],
  [-0.707, 0.707],
  [0.707, -0.707],
  [-0.707, -0.707],
]

export const computeValleyMetrics = (field: ProjectedField): ValleyMetrics => {
  const maxDim = Math.max(field.widthMeters, field.depthMeters)
  const fieldRadius = Math.hypot(field.widthMeters, field.depthMeters) / 2
  const innerMountainRadius = Math.max(150, fieldRadius * 2.35)
  const outerMountainRadius = innerMountainRadius + Math.max(190, fieldRadius * 2.2)
  const groundSize = outerMountainRadius * 2.25
  return {
    maxDim,
    fieldRadius,
    innerMountainRadius,
    outerMountainRadius,
    groundSize,
  }
}

const isCandidateClear = (
  x: number,
  z: number,
  footprintRadius: number,
  field: ProjectedField,
  takeoffBase: FieldPoint,
  accepted: SurroundingPlacement[]
): boolean => {
  if (isPointInProjectedField({ x, z }, field)) return false

  for (const [dx, dz] of STRUCTURE_OFFSET_DIRECTIONS) {
    if (
      isPointInProjectedField(
        { x: x + dx * footprintRadius, z: z + dz * footprintRadius },
        field
      )
    ) {
      return false
    }
  }

  if (Math.hypot(x - takeoffBase.x, z - takeoffBase.z) < Math.max(12, footprintRadius + 6)) {
    return false
  }

  for (const other of accepted) {
    if (Math.hypot(x - other.x, z - other.z) < footprintRadius + other.footprintRadius + 3) {
      return false
    }
  }

  return true
}

export const computeSurroundingStructureAnchors = (
  field: ProjectedField,
  takeoffBase: FieldPoint
): SurroundingPlacement[] => {
  const maxDim = Math.max(field.widthMeters, field.depthMeters)
  const scale = Math.max(0.9, Math.min(2.2, maxDim / 78))
  const margin = Math.max(12, maxDim * 0.16)
  const ghRadius = 7.8 * scale
  const ghStep = 14.5 * scale

  const proposals: Array<{
    kind: SurroundingPlacement['kind']
    x: number
    z: number
    dirX: number
    dirZ: number
    rotationY: number
    footprintRadius: number
  }> = [
    // Par noroeste de invernaderos
    {
      kind: 'greenhouse',
      x: field.bounds.minX - margin - ghRadius,
      z: field.bounds.minZ + field.depthMeters * 0.15,
      dirX: -1,
      dirZ: -0.25,
      rotationY: 0,
      footprintRadius: ghRadius,
    },
    {
      kind: 'greenhouse',
      x: field.bounds.minX - margin - ghRadius,
      z: field.bounds.minZ + field.depthMeters * 0.15 + ghStep,
      dirX: -1,
      dirZ: 0.25,
      rotationY: 0,
      footprintRadius: ghRadius,
    },
    // Par este de invernaderos
    {
      kind: 'greenhouse',
      x: field.bounds.maxX + margin + ghRadius,
      z: field.bounds.minZ + field.depthMeters * 0.28,
      dirX: 1,
      dirZ: -0.2,
      rotationY: Math.PI / 2,
      footprintRadius: ghRadius,
    },
    {
      kind: 'greenhouse',
      x: field.bounds.maxX + margin + ghRadius + ghStep,
      z: field.bounds.minZ + field.depthMeters * 0.28,
      dirX: 1,
      dirZ: 0.2,
      rotationY: Math.PI / 2,
      footprintRadius: ghRadius,
    },
    // Bodega agrícola y tanque de riego cercanos al grupo noroeste
    {
      kind: 'barn',
      x: field.bounds.minX - margin - ghRadius * 1.15,
      z: field.bounds.minZ - margin * 0.7,
      dirX: -0.8,
      dirZ: -0.6,
      rotationY: 0.18,
      footprintRadius: 6.5 * scale,
    },
    {
      kind: 'water_tank',
      x: field.bounds.minX - margin - ghRadius * 2.5,
      z: field.bounds.minZ - margin * 0.2,
      dirX: -1,
      dirZ: 0,
      rotationY: 0,
      footprintRadius: 4.5 * scale,
    },
    // Cortinas rompeviento de árboles alrededor de la finca
    {
      kind: 'tree_cluster',
      x: field.bounds.minX - margin * 1.35,
      z: field.bounds.maxZ + margin * 1.1,
      dirX: -0.7,
      dirZ: 0.7,
      rotationY: 0.4,
      footprintRadius: 6.0 * scale,
    },
    {
      kind: 'tree_cluster',
      x: field.bounds.maxX + margin * 1.3,
      z: field.bounds.maxZ + margin * 0.9,
      dirX: 0.7,
      dirZ: 0.7,
      rotationY: 1.9,
      footprintRadius: 6.0 * scale,
    },
    {
      kind: 'tree_cluster',
      x: field.centroidLocal.x,
      z: field.bounds.minZ - margin * 1.45,
      dirX: 0,
      dirZ: -1,
      rotationY: 2.7,
      footprintRadius: 6.0 * scale,
    },
    {
      kind: 'tree_cluster',
      x: field.bounds.maxX + margin * 1.85,
      z: field.bounds.minZ - margin * 0.75,
      dirX: 0.85,
      dirZ: -0.5,
      rotationY: 1.1,
      footprintRadius: 6.0 * scale,
    },
  ]

  const accepted: SurroundingPlacement[] = []
  for (const item of proposals) {
    const stepLen = Math.max(8, item.footprintRadius * 1.4)
    const dirNorm = Math.hypot(item.dirX, item.dirZ) || 1
    const nx = item.dirX / dirNorm
    const nz = item.dirZ / dirNorm

    for (let step = 0; step <= 6; step++) {
      const cx = item.x + nx * stepLen * step
      const cz = item.z + nz * stepLen * step
      if (isCandidateClear(cx, cz, item.footprintRadius, field, takeoffBase, accepted)) {
        accepted.push({
          kind: item.kind,
          x: Number(cx.toFixed(2)),
          z: Number(cz.toFixed(2)),
          rotationY: item.rotationY,
          scale,
          footprintRadius: item.footprintRadius,
        })
        break
      }
    }
  }

  return accepted
}

const buildGreenhouseMesh = (scale: number): THREE.Group => {
  const group = new THREE.Group()
  const length = 11 * scale
  const width = 5.4 * scale
  const radius = width / 2
  const curbHeight = 0.65 * scale

  const curbMat = new THREE.MeshStandardMaterial({ color: 0xc8c0b0, roughness: 0.92, metalness: 0.05 })
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x9aa6ad, roughness: 0.45, metalness: 0.6 })
  const coverMat = new THREE.MeshStandardMaterial({
    color: 0xe6f3ee,
    transparent: true,
    opacity: 0.64,
    roughness: 0.3,
    metalness: 0.05,
    side: THREE.DoubleSide,
  })
  const bedSoilMat = new THREE.MeshStandardMaterial({ color: 0x5c3e26, roughness: 0.96 })
  const indoorCropMat = new THREE.MeshStandardMaterial({ color: 0x3b8c47, roughness: 0.85 })

  const basePad = new THREE.Mesh(
    new THREE.BoxGeometry(length + 0.6 * scale, 0.14 * scale, width + 0.6 * scale),
    curbMat
  )
  basePad.position.y = 0.07 * scale
  basePad.receiveShadow = true
  group.add(basePad)

  // Muros bajos laterales
  const sideWallGeo = new THREE.BoxGeometry(length, curbHeight, 0.22 * scale)
  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(sideWallGeo, curbMat)
    wall.position.set(0, curbHeight / 2, side * (radius - 0.11 * scale))
    wall.castShadow = true
    wall.receiveShadow = true
    group.add(wall)
  }

  // Cama de cultivo interior visible bajo la cubierta translúcida
  for (const rowOffset of [-width * 0.22, width * 0.22]) {
    const bed = new THREE.Mesh(
      new THREE.BoxGeometry(length * 0.86, 0.22 * scale, width * 0.28),
      bedSoilMat
    )
    bed.position.set(0, 0.2 * scale, rowOffset)
    group.add(bed)

    const cropStrip = new THREE.Mesh(
      new THREE.BoxGeometry(length * 0.82, 0.48 * scale, width * 0.2),
      indoorCropMat
    )
    cropStrip.position.set(0, 0.52 * scale, rowOffset)
    group.add(cropStrip)
  }

  // Túnel translúcido arqueado (eje X)
  const tunnelGeo = new THREE.CylinderGeometry(
    radius,
    radius,
    length,
    18,
    1,
    true,
    -Math.PI / 2,
    Math.PI
  )
  tunnelGeo.rotateZ(Math.PI / 2)
  const tunnel = new THREE.Mesh(tunnelGeo, coverMat)
  tunnel.position.y = curbHeight
  tunnel.castShadow = true
  group.add(tunnel)

  // Arcos metálicos de refuerzo
  const ribGeo = new THREE.TorusGeometry(radius + 0.03 * scale, 0.06 * scale, 6, 18, Math.PI)
  ribGeo.rotateY(Math.PI / 2)
  const ribCount = 5
  for (let i = 0; i < ribCount; i++) {
    const xPos = -length / 2 + (length * i) / (ribCount - 1)
    const rib = new THREE.Mesh(ribGeo, frameMat)
    rib.position.set(xPos, curbHeight, 0)
    group.add(rib)
  }

  // Puerta frontal y trasera
  const doorGeo = new THREE.BoxGeometry(0.16 * scale, curbHeight + radius * 0.65, width * 0.34)
  for (const endSign of [-1, 1]) {
    const door = new THREE.Mesh(doorGeo, frameMat)
    door.position.set(endSign * (length / 2 - 0.08 * scale), (curbHeight + radius * 0.65) / 2, 0)
    group.add(door)
  }

  return group
}

const buildBarnMesh = (scale: number): THREE.Group => {
  const group = new THREE.Group()
  const w = 6.8 * scale
  const d = 5.0 * scale
  const h = 3.1 * scale

  const wallMat = new THREE.MeshStandardMaterial({ color: 0xd6c3a5, roughness: 0.9 })
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x6b482f, roughness: 0.85 })
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x9b4d32, roughness: 0.78 })

  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat)
  body.position.y = h / 2
  body.castShadow = true
  body.receiveShadow = true
  group.add(body)

  // Techo a dos aguas
  const roofRadius = d * 0.68
  const roofGeo = new THREE.CylinderGeometry(roofRadius, roofRadius, w + 0.8 * scale, 3)
  roofGeo.rotateZ(Math.PI / 2)
  roofGeo.rotateX(Math.PI / 6)
  const roof = new THREE.Mesh(roofGeo, roofMat)
  roof.scale.set(1, 0.56, 1)
  roof.position.y = h + 0.52 * scale
  roof.castShadow = true
  roof.receiveShadow = true
  group.add(roof)

  const door = new THREE.Mesh(
    new THREE.BoxGeometry(1.7 * scale, 2.1 * scale, 0.2 * scale),
    trimMat
  )
  door.position.set(0, 1.05 * scale, d / 2 + 0.04 * scale)
  group.add(door)

  return group
}

const buildWaterTankMesh = (scale: number): THREE.Group => {
  const group = new THREE.Group()
  const padMat = new THREE.MeshStandardMaterial({ color: 0x9e9b93, roughness: 0.92 })
  const tankMat = new THREE.MeshStandardMaterial({ color: 0x3b6e8c, roughness: 0.48, metalness: 0.3 })
  const bandMat = new THREE.MeshStandardMaterial({ color: 0x24465c, roughness: 0.5, metalness: 0.45 })

  const pad = new THREE.Mesh(new THREE.CylinderGeometry(2.6 * scale, 2.8 * scale, 0.25 * scale, 18), padMat)
  pad.position.y = 0.125 * scale
  pad.receiveShadow = true
  group.add(pad)

  const body = new THREE.Mesh(new THREE.CylinderGeometry(2.1 * scale, 2.1 * scale, 3.4 * scale, 18), tankMat)
  body.position.y = 1.95 * scale
  body.castShadow = true
  body.receiveShadow = true
  group.add(body)

  const cap = new THREE.Mesh(new THREE.ConeGeometry(2.18 * scale, 0.65 * scale, 18), bandMat)
  cap.position.y = 3.95 * scale
  cap.castShadow = true
  group.add(cap)

  const pump = new THREE.Mesh(new THREE.BoxGeometry(1.0 * scale, 0.8 * scale, 0.9 * scale), bandMat)
  pump.position.set(2.45 * scale, 0.55 * scale, 0)
  pump.castShadow = true
  group.add(pump)

  return group
}

const buildTreeClusterMesh = (scale: number): THREE.Group => {
  const group = new THREE.Group()
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b472b, roughness: 0.95 })
  const foliageA = new THREE.MeshStandardMaterial({ color: 0x3f6e33, roughness: 0.88 })
  const foliageB = new THREE.MeshStandardMaterial({ color: 0x527d3b, roughness: 0.88 })

  const offsets = [
    { x: 0, z: 0, h: 4.4 * scale, r: 1.75 * scale, mat: foliageA },
    { x: -1.9 * scale, z: 1.1 * scale, h: 3.4 * scale, r: 1.35 * scale, mat: foliageB },
    { x: 1.7 * scale, z: -1.2 * scale, h: 3.8 * scale, r: 1.45 * scale, mat: foliageA },
  ]

  for (const tree of offsets) {
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18 * scale, 0.28 * scale, tree.h * 0.45, 7),
      trunkMat
    )
    trunk.position.set(tree.x, tree.h * 0.225, tree.z)
    trunk.castShadow = true
    group.add(trunk)

    const canopy = new THREE.Mesh(new THREE.ConeGeometry(tree.r, tree.h * 0.72, 7), tree.mat)
    canopy.position.set(tree.x, tree.h * 0.62, tree.z)
    canopy.castShadow = true
    canopy.receiveShadow = true
    group.add(canopy)
  }

  return group
}

const sampleMountainElevation = (angle: number, radialT: number, maxDim: number): number => {
  // Perfil suave en los bordes (radialT = 0 junto al valle, radialT = 1 en el borde exterior)
  const envelope = Math.sin(radialT * Math.PI) ** 1.25
  const ridgeA = Math.sin(angle * 3 + 0.4) * 0.5 + 0.5
  const ridgeB = Math.sin(angle * 7 - 1.1) * 0.5 + 0.5
  const ridgeC = Math.cos(angle * 13 + 2.3) * 0.5 + 0.5
  const crag = Math.abs(Math.sin(angle * 19 + radialT * 5.2))

  const baseHeight = Math.max(38, Math.min(135, maxDim * 0.52))
  const heightFactor = 0.38 + ridgeA * 0.44 + ridgeB * 0.26 + ridgeC * 0.14 + crag * 0.12
  return envelope * baseHeight * heightFactor
}

const buildMountainRingMesh = (valley: ValleyMetrics): THREE.Mesh => {
  const angularSegments = 128
  const radialSegments = 10
  const vertices: number[] = []
  const colors: number[] = []
  const indices: number[] = []

  const footColor = new THREE.Color(0x8c6745)
  const scrubColor = new THREE.Color(0x6c6848)
  const rockColor = new THREE.Color(0x756c60)
  const crestColor = new THREE.Color(0xa6afb6)
  const tmpColor = new THREE.Color()

  for (let r = 0; r <= radialSegments; r++) {
    const radialT = r / radialSegments
    const radius =
      valley.innerMountainRadius +
      (valley.outerMountainRadius - valley.innerMountainRadius) * radialT

    for (let a = 0; a <= angularSegments; a++) {
      const angle = (a / angularSegments) * Math.PI * 2
      const x = Math.cos(angle) * radius
      const z = Math.sin(angle) * radius
      const elevation =
        r === 0
          ? -0.25
          : r === radialSegments
            ? -4.0
            : sampleMountainElevation(angle, radialT, valley.maxDim) - 0.2

      vertices.push(x, elevation, z)

      const normHeight = Math.max(0, Math.min(1, elevation / Math.max(42, valley.maxDim * 0.58)))
      if (normHeight < 0.28) {
        tmpColor.lerpColors(footColor, scrubColor, normHeight / 0.28)
      } else if (normHeight < 0.72) {
        tmpColor.lerpColors(scrubColor, rockColor, (normHeight - 0.28) / 0.44)
      } else {
        tmpColor.lerpColors(rockColor, crestColor, (normHeight - 0.72) / 0.28)
      }
      colors.push(tmpColor.r, tmpColor.g, tmpColor.b)
    }
  }

  const stride = angularSegments + 1
  for (let r = 0; r < radialSegments; r++) {
    for (let a = 0; a < angularSegments; a++) {
      const i0 = r * stride + a
      const i1 = i0 + 1
      const i2 = i0 + stride
      const i3 = i2 + 1
      indices.push(i0, i1, i2, i1, i3, i2)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.96,
    metalness: 0.02,
  })

  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'mountain-ring'
  mesh.receiveShadow = true
  return mesh
}

export const buildAgriculturalSurroundings = (
  field: ProjectedField,
  takeoffBase: FieldPoint
): {
  group: THREE.Group
  placements: SurroundingPlacement[]
  valley: ValleyMetrics
} => {
  const valley = computeValleyMetrics(field)
  const placements = computeSurroundingStructureAnchors(field, takeoffBase)
  const group = new THREE.Group()
  group.name = 'agronia-surroundings'

  for (const item of placements) {
    const structure =
      item.kind === 'greenhouse'
        ? buildGreenhouseMesh(item.scale)
        : item.kind === 'barn'
          ? buildBarnMesh(item.scale)
          : item.kind === 'water_tank'
            ? buildWaterTankMesh(item.scale)
            : buildTreeClusterMesh(item.scale)

    structure.name = `surrounding-${item.kind}`
    structure.position.set(item.x, 0, item.z)
    structure.rotation.y = item.rotationY
    group.add(structure)
  }

  group.add(buildMountainRingMesh(valley))

  return { group, placements, valley }
}
