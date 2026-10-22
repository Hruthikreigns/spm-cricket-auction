import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Environment, Lightformer, PerformanceMonitor, Sparkles, Trail } from '@react-three/drei'
import { Bloom, ChromaticAberration, EffectComposer, Noise, ToneMapping, Vignette } from '@react-three/postprocessing'
import { BlendFunction, ToneMappingMode } from 'postprocessing'
import { useEffect, useMemo, useRef, useState, type MutableRefObject, type RefObject } from 'react'
import * as THREE from 'three'

import type { GfxTier, Palette } from '../../lib/device'

/**
 * The hero: a night ground seen from behind the bowler's arm.
 *
 * Everything is procedural — no model or HDR downloads — so the scene costs
 * one lazy JS chunk and nothing else over the network. The ball is the only
 * interactive object: it leans toward the pointer and can be flicked to spin.
 */

export interface StadiumSceneProps {
  palette: Palette
  tier: Exclude<GfxTier, 'none'>
  reducedMotion: boolean
  /** Rendering stops (last frame stays on screen) while this is false. */
  active: boolean
  /** 0 → 1 as the hero scrolls away; written by GSAP ScrollTrigger. */
  progress: MutableRefObject<number>
  /** Element that receives pointer events, so text over the canvas stays live. */
  eventSource: RefObject<HTMLElement>
  onFail: () => void
  /** 'hero': ball beside the headline. 'center': ball in the middle, for a card. */
  layout?: 'hero' | 'center'
}

// --------------------------------------------------------------------------
// Textures, built once on a 2D canvas
// --------------------------------------------------------------------------
function leatherTextures() {
  const w = 1024
  const h = 512
  const color = document.createElement('canvas')
  color.width = w
  color.height = h
  const c = color.getContext('2d')!
  const grad = c.createLinearGradient(0, 0, 0, h)
  grad.addColorStop(0, '#6e0f12')
  grad.addColorStop(0.5, '#a3191b')
  grad.addColorStop(1, '#6e0f12')
  c.fillStyle = grad
  c.fillRect(0, 0, w, h)

  const bump = document.createElement('canvas')
  bump.width = w
  bump.height = h
  const b = bump.getContext('2d')!
  b.fillStyle = '#808080'
  b.fillRect(0, 0, w, h)

  // Grain and scuffs: the ball has had a few overs.
  for (let i = 0; i < 9000; i++) {
    const x = Math.random() * w
    const y = Math.random() * h
    const r = Math.random() * 1.6 + 0.3
    const a = Math.random() * 0.12
    c.fillStyle = Math.random() > 0.5 ? `rgba(255,190,170,${a})` : `rgba(30,0,0,${a * 1.4})`
    c.beginPath()
    c.arc(x, y, r, 0, Math.PI * 2)
    c.fill()
    const g = 110 + Math.random() * 40
    b.fillStyle = `rgb(${g},${g},${g})`
    b.fillRect(x, y, r, r)
  }
  // The quarter seams: two faint lines perpendicular to the main seam.
  c.strokeStyle = 'rgba(40,0,0,0.45)'
  c.lineWidth = 2
  for (const x of [w * 0.25, w * 0.75]) {
    c.beginPath()
    c.moveTo(x, h * 0.08)
    c.lineTo(x, h * 0.92)
    c.stroke()
  }
  b.strokeStyle = '#5a5a5a'
  b.lineWidth = 3
  for (const x of [w * 0.25, w * 0.75]) {
    b.beginPath()
    b.moveTo(x, h * 0.08)
    b.lineTo(x, h * 0.92)
    b.stroke()
  }

  const map = new THREE.CanvasTexture(color)
  map.colorSpace = THREE.SRGBColorSpace
  map.anisotropy = 4
  const bumpMap = new THREE.CanvasTexture(bump)
  return { map, bumpMap }
}

/** Soft radial glow, so lamp banks read as lit even without bloom. */
function haloTexture() {
  const size = 128
  const cv = document.createElement('canvas')
  cv.width = cv.height = size
  const c = cv.getContext('2d')!
  const g = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.18, 'rgba(255,240,210,0.55)')
  g.addColorStop(0.5, 'rgba(255,210,150,0.12)')
  g.addColorStop(1, 'rgba(255,200,140,0)')
  c.fillStyle = g
  c.fillRect(0, 0, size, size)
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Mowing stripes across the outfield, in the theme's ground tones. */
function outfieldTexture(base: string, dark: boolean) {
  const size = 512
  const cv = document.createElement('canvas')
  cv.width = size
  cv.height = size
  const c = cv.getContext('2d')!
  const a = new THREE.Color(base)
  const b = a.clone().offsetHSL(0, 0, dark ? 0.025 : -0.03)
  const stripes = 16
  for (let i = 0; i < stripes; i++) {
    c.fillStyle = `#${(i % 2 ? a : b).getHexString()}`
    c.fillRect((i * size) / stripes, 0, size / stripes, size)
  }
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(6, 6)
  tex.anisotropy = 8
  return tex
}

// --------------------------------------------------------------------------
// The ball
// --------------------------------------------------------------------------
const BALL_RADIUS = 0.34
const BALL_Z = 10.2
// Height of the view's centre line where it passes the ball.
const SCREEN_MID_Y = 1.74
const STITCHES = 72

function Ball({
  reducedMotion,
  tier,
  layout = 'hero',
  groupRef,
}: {
  reducedMotion: boolean
  tier: 'low' | 'high'
  layout?: 'hero' | 'center'
  groupRef?: MutableRefObject<THREE.Group | null>
}) {
  const group = useRef<THREE.Group>(null)
  useEffect(() => {
    if (groupRef) groupRef.current = group.current
  })
  const spinner = useRef<THREE.Group>(null)
  const stitches = useRef<THREE.InstancedMesh>(null)
  const { camera, size } = useThree()
  const textures = useMemo(leatherTextures, [])
  const [hovered, setHovered] = useState(false)

  // Spin state lives in refs — nothing here should cause a React render.
  const spin = useRef({ velocity: 0.9, dragging: false, lastX: 0, lastY: 0, tiltVel: 0 })
  const intro = useRef(reducedMotion ? 1 : 0)

  useEffect(() => () => {
    textures.map.dispose()
    textures.bumpMap.dispose()
  }, [textures])

  // Two rows of stitches either side of the seam, slanting opposite ways.
  useEffect(() => {
    const mesh = stitches.current
    if (!mesh) return
    const dummy = new THREE.Object3D()
    let i = 0
    for (const row of [-1, 1]) {
      for (let s = 0; s < STITCHES; s++) {
        const theta = (s / STITCHES) * Math.PI * 2
        const phi = row * 0.072
        const r = BALL_RADIUS * 1.006
        dummy.position.set(
          Math.cos(theta) * Math.cos(phi) * r,
          Math.sin(phi) * r,
          Math.sin(theta) * Math.cos(phi) * r,
        )
        dummy.lookAt(0, 0, 0)
        dummy.rotateZ(row * 0.55)
        dummy.updateMatrix()
        mesh.setMatrixAt(i++, dummy.matrix)
      }
    }
    mesh.instanceMatrix.needsUpdate = true
  }, [])

  useEffect(() => {
    document.body.style.cursor = hovered ? (spin.current.dragging ? 'grabbing' : 'grab') : ''
    return () => {
      document.body.style.cursor = ''
    }
  }, [hovered])

  // Release the drag even when the pointer leaves the ball.
  useEffect(() => {
    const up = () => {
      spin.current.dragging = false
    }
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [])

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    spin.current.dragging = true
    spin.current.lastX = e.clientX
    spin.current.lastY = e.clientY
  }
  const onPointerMove = (e: ThreeEvent<PointerEvent>) => {
    const s = spin.current
    if (!s.dragging) return
    const dx = e.clientX - s.lastX
    const dy = e.clientY - s.lastY
    s.lastX = e.clientX
    s.lastY = e.clientY
    s.velocity = THREE.MathUtils.clamp(s.velocity + dx * 0.04, -24, 24)
    s.tiltVel = THREE.MathUtils.clamp(s.tiltVel + dy * 0.01, -4, 4)
  }

  useFrame((state, delta) => {
    const g = group.current
    const sp = spinner.current
    if (!g || !sp) return
    const dt = Math.min(delta, 1 / 20)

    // Composition: right of the headline on wide screens, above it on narrow.
    const wide = size.width >= 768
    // Sized and placed from the resting camera, so scrolling moves the
    // camera away from the ball instead of rescaling it.
    const dist = CAM_REST.z - BALL_Z
    const halfH = Math.tan(THREE.MathUtils.degToRad((camera as THREE.PerspectiveCamera).fov / 2)) * dist
    const halfW = halfH * (size.width / size.height)
    const center = layout === 'center'
    const fit = center
      ? Math.min(halfH * 0.3, halfW * 0.3) / BALL_RADIUS
      : Math.min(halfH * (wide ? 0.3 : 0.22), halfW * (wide ? 0.2 : 0.4)) / BALL_RADIUS
    const targetX = center ? 0 : wide ? halfW * 0.5 : 0
    const targetY = SCREEN_MID_Y + (center ? halfH * 0.34 : wide ? halfH * 0.1 : halfH * 0.56)

    if (!reducedMotion) intro.current = Math.min(1, state.clock.elapsedTime / 1.6)
    const t = intro.current
    const ease = reducedMotion ? 1 : 1 - Math.pow(1 - t, 4) * Math.cos(t * Math.PI * 1.5)

    const px = reducedMotion ? 0 : state.pointer.x
    const py = reducedMotion ? 0 : state.pointer.y
    const float = reducedMotion ? 0 : Math.sin(state.clock.elapsedTime * 1.1) * 0.06

    g.position.x = THREE.MathUtils.damp(g.position.x, targetX + px * 0.12, 4, dt)
    g.position.y = THREE.MathUtils.damp(g.position.y, targetY + py * 0.08 + float, 4, dt)
    const scale = ease * fit * (hovered ? 1.06 : 1)
    g.scale.setScalar(THREE.MathUtils.damp(g.scale.x, scale, 8, dt))

    // Lean toward the pointer like a bowler showing the seam.
    g.rotation.x = THREE.MathUtils.damp(g.rotation.x, -py * 0.35 + 0.25, 3, dt)
    g.rotation.z = THREE.MathUtils.damp(g.rotation.z, -px * 0.3 - 0.35, 3, dt)

    if (!reducedMotion) {
      const s = spin.current
      // Back-spin, the seam bolt upright; drag to flick it faster.
      sp.rotation.x += s.velocity * dt
      sp.rotation.y += s.tiltVel * dt
      if (!s.dragging) {
        s.velocity = THREE.MathUtils.damp(s.velocity, 0.9, 0.8, dt)
        s.tiltVel = THREE.MathUtils.damp(s.tiltVel, 0, 1.2, dt)
      }
    }
  })

  return (
    <group ref={group} position={[0, SCREEN_MID_Y, BALL_Z]} scale={reducedMotion ? 1 : 0}>
      <group
        ref={spinner}
        rotation={[0, 0, Math.PI / 2]}
        onPointerOver={(e) => {
          e.stopPropagation()
          setHovered(true)
        }}
        onPointerOut={() => setHovered(false)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
      >
        <mesh castShadow>
          <sphereGeometry args={[BALL_RADIUS, tier === 'high' ? 96 : 48, tier === 'high' ? 64 : 32]} />
          <meshPhysicalMaterial
            map={textures.map}
            bumpMap={textures.bumpMap}
            bumpScale={1.2}
            roughness={0.42}
            clearcoat={0.85}
            clearcoatRoughness={0.22}
            sheen={0.4}
            sheenColor="#ff9a8a"
          />
        </mesh>
        {/* The raised seam: a thin ridge with the stitching either side. */}
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[BALL_RADIUS * 1.0, BALL_RADIUS * 0.035, 10, 120]} />
          <meshStandardMaterial color="#7d1214" roughness={0.6} />
        </mesh>
        <instancedMesh ref={stitches} args={[undefined, undefined, STITCHES * 2]}>
          <boxGeometry args={[BALL_RADIUS * 0.022, BALL_RADIUS * 0.085, BALL_RADIUS * 0.02]} />
          <meshStandardMaterial color="#d9c9a8" roughness={0.85} />
        </instancedMesh>
      </group>
    </group>
  )
}

// --------------------------------------------------------------------------
// The ground
// --------------------------------------------------------------------------
function Stumps({ z, wood }: { z: number; wood: string }) {
  const xs = [-0.114, 0, 0.114]
  return (
    <group position={[0, 0, z]}>
      {xs.map((x) => (
        <mesh key={x} position={[x, 0.355, 0]} castShadow>
          <cylinderGeometry args={[0.019, 0.019, 0.71, 16]} />
          <meshPhysicalMaterial color={wood} roughness={0.35} clearcoat={0.6} />
        </mesh>
      ))}
      {[-0.057, 0.057].map((x) => (
        <mesh key={x} position={[x, 0.722, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.009, 0.009, 0.11, 8]} />
          <meshPhysicalMaterial color={wood} roughness={0.35} clearcoat={0.6} />
        </mesh>
      ))}
    </group>
  )
}

function Ground({ palette }: { palette: Palette }) {
  const grass = palette.ultra ? '#0a0f24' : palette.dark ? '#123524' : new THREE.Color(palette.raised).lerp(new THREE.Color('#9ccc8a'), 0.35).getStyle()
  const tex = useMemo(() => outfieldTexture(grass, palette.dark), [grass, palette.dark])
  useEffect(() => () => tex.dispose(), [tex])
  const strip = palette.ultra ? '#1b1f44' : palette.dark ? '#b8a272' : new THREE.Color(palette.willow).lerp(new THREE.Color('#e8dcc0'), 0.6).getStyle()
  // Ultra: crease lines glow neon cyan (above 1.0 so the bloom catches them).
  const chalk: string | [number, number, number] = palette.ultra ? [0.9, 3.2, 4] : palette.dark ? '#f2efe6' : '#ffffff'

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[70, 96]} />
        <meshStandardMaterial map={tex} roughness={0.95} />
      </mesh>
      {/* 22 yards of strip. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0]} receiveShadow>
        <planeGeometry args={[3.05, 20.12]} />
        <meshStandardMaterial color={strip} roughness={0.85} />
      </mesh>
      {[10.06, -10.06].flatMap((z) => {
        const s = Math.sign(z)
        return [
          // Bowling crease, popping crease, and the two return creases.
          <mesh key={`b${z}`} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.008, z]}>
            <planeGeometry args={[2.64, 0.05]} />
            <meshBasicMaterial color={chalk} toneMapped={false} />
          </mesh>,
          <mesh key={`p${z}`} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.008, z - s * 1.22]}>
            <planeGeometry args={[3.05, 0.05]} />
            <meshBasicMaterial color={chalk} toneMapped={false} />
          </mesh>,
          ...[-1.32, 1.32].map((x) => (
            <mesh key={`r${z}${x}`} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.008, z - s * 0.3]}>
              <planeGeometry args={[0.05, 2.44]} />
              <meshBasicMaterial color={chalk} toneMapped={false} />
            </mesh>
          )),
        ]
      })}
      <Stumps z={-10.06} wood="#eadcbc" />
      <Stumps z={10.06} wood="#eadcbc" />
    </group>
  )
}

// --------------------------------------------------------------------------
// Floodlights: towers, glowing banks and soft volumetric beams
// --------------------------------------------------------------------------
const beamVertex = /* glsl */ `
  varying float vAlong;
  varying vec3 vNormalV;
  varying vec3 vViewDir;
  void main() {
    vAlong = uv.y;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormalV = normalize(normalMatrix * normal);
    vViewDir = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`
const beamFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vAlong;
  varying vec3 vNormalV;
  varying vec3 vViewDir;
  void main() {
    float edge = pow(abs(dot(vNormalV, vViewDir)), 1.6);
    float fade = pow(vAlong, 2.2);
    gl_FragColor = vec4(uColor, edge * fade * uOpacity);
  }
`

// Two banks framing the far end of the ground, two wide at square leg.
const TOWERS: [number, number][] = [
  [-13, -26],
  [13, -26],
  [-26, -4],
  [26, -4],
]
const TOWER_HEIGHT = 11.5
const LAMP_ROWS = 3
const LAMP_COLS = 5

function Floodlights({ palette, tier }: { palette: Palette; tier: 'low' | 'high' }) {
  const lamps = useRef<THREE.InstancedMesh>(null)
  const beamColor = useMemo(() => new THREE.Color(palette.dark ? '#ffe2a6' : palette.amber), [palette])
  const beamOpacity = palette.ultra ? 0.17 : palette.dark ? (tier === 'high' ? 0.11 : 0.08) : 0.0
  const neon = useMemo(() => [new THREE.Color('#5ce1ff'), new THREE.Color('#ff3d7f')], [])

  const heads = useMemo(
    () =>
      TOWERS.map(([x, z]) => {
        const head = new THREE.Vector3(x, TOWER_HEIGHT, z)
        const target = new THREE.Vector3(x * 0.15, 0, z * 0.2 - 1)
        const dir = target.clone().sub(head)
        const length = dir.length()
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.normalize())
        const face = new THREE.Object3D()
        face.position.copy(head)
        face.lookAt(target)
        return { head, length, q, faceQ: face.quaternion.clone() }
      }),
    [],
  )

  useEffect(() => {
    const mesh = lamps.current
    if (!mesh) return
    const dummy = new THREE.Object3D()
    let i = 0
    for (const { head, faceQ } of heads) {
      for (let r = 0; r < LAMP_ROWS; r++) {
        for (let c = 0; c < LAMP_COLS; c++) {
          const local = new THREE.Vector3((c - (LAMP_COLS - 1) / 2) * 0.55, (r - (LAMP_ROWS - 1) / 2) * 0.55, 0.12)
          local.applyQuaternion(faceQ)
          dummy.position.copy(head).add(local)
          dummy.quaternion.copy(faceQ)
          dummy.updateMatrix()
          mesh.setMatrixAt(i++, dummy.matrix)
        }
      }
    }
    mesh.instanceMatrix.needsUpdate = true
  }, [heads])

  const beamGeometry = useMemo(() => {
    const g = new THREE.ConeGeometry(1, 1, 40, 1, true)
    g.translate(0, -0.5, 0) // apex at the origin, opening downward
    return g
  }, [])

  const halo = useMemo(haloTexture, [])
  useEffect(() => () => halo.dispose(), [halo])

  const steel = palette.ultra ? '#1c2046' : palette.dark ? '#2a3a33' : new THREE.Color(palette.line).getStyle()

  return (
    <group>
      {heads.map(({ head, length, q, faceQ }, idx) => (
        <group key={idx}>
          {/* Mast */}
          <mesh position={[head.x, TOWER_HEIGHT / 2, head.z]}>
            <cylinderGeometry args={[0.14, 0.32, TOWER_HEIGHT, 8]} />
            <meshStandardMaterial color={steel} roughness={0.6} metalness={0.6} />
          </mesh>
          {/* Lamp frame */}
          <mesh position={head} quaternion={faceQ}>
            <boxGeometry args={[3.0, 1.9, 0.18]} />
            <meshStandardMaterial color={steel} roughness={0.5} metalness={0.7} />
          </mesh>
          {/* Glow around the bank */}
          {palette.dark && (
            <sprite position={head} scale={tier === 'high' ? 9 : 11} renderOrder={3}>
              <spriteMaterial
                map={halo}
                color="#ffe3b0"
                transparent
                opacity={tier === 'high' ? 0.55 : 0.85}
                depthWrite={false}
                blending={THREE.AdditiveBlending}
                toneMapped={false}
              />
            </sprite>
          )}
          {/* Beam */}
          {beamOpacity > 0 && (
            <mesh
              geometry={beamGeometry}
              position={head}
              quaternion={q}
              scale={[length * 0.32, length, length * 0.32]}
              renderOrder={2}
            >
              <shaderMaterial
                vertexShader={beamVertex}
                fragmentShader={beamFragment}
                uniforms={{ uColor: { value: palette.ultra ? neon[idx % 2] : beamColor }, uOpacity: { value: beamOpacity } }}
                transparent
                depthWrite={false}
                blending={THREE.AdditiveBlending}
                side={THREE.DoubleSide}
              />
            </mesh>
          )}
        </group>
      ))}
      {/* Lamps — bright enough to clear the bloom threshold. */}
      <instancedMesh ref={lamps} args={[undefined, undefined, TOWERS.length * LAMP_ROWS * LAMP_COLS]}>
        <circleGeometry args={[0.22, 20]} />
        <meshBasicMaterial color={palette.dark ? [6, 5.2, 3.6] : [1.6, 1.5, 1.3]} toneMapped={false} />
      </instancedMesh>
    </group>
  )
}

// --------------------------------------------------------------------------
// Dust motes drifting through the light
// --------------------------------------------------------------------------
const moteVertex = /* glsl */ `
  uniform float uTime;
  uniform float uSize;
  uniform float uPixelRatio;
  attribute float aSeed;
  varying float vTwinkle;
  void main() {
    vec3 p = position;
    p.x += sin(uTime * 0.18 + aSeed * 6.28) * 0.9;
    p.y += sin(uTime * 0.23 + aSeed * 12.0) * 0.6 + mod(uTime * 0.12 + aSeed * 10.0, 10.0) * 0.12;
    p.z += cos(uTime * 0.15 + aSeed * 9.0) * 0.9;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * uPixelRatio * (0.6 + aSeed) * (12.0 / -mv.z);
    vTwinkle = 0.55 + 0.45 * sin(uTime * 1.7 + aSeed * 40.0);
  }
`
const moteFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vTwinkle;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(uColor, a * a * vTwinkle * uOpacity);
  }
`

function Motes({ count, palette, reducedMotion }: { count: number; palette: Palette; reducedMotion: boolean }) {
  const material = useRef<THREE.ShaderMaterial>(null)
  const { gl } = useThree()
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const pos = new Float32Array(count * 3)
    const seed = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 34
      pos[i * 3 + 1] = Math.random() * 11
      pos[i * 3 + 2] = Math.random() * 30 - 18
      seed[i] = Math.random()
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1))
    return g
  }, [count])
  useEffect(() => () => geometry.dispose(), [geometry])

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uSize: { value: 2.4 },
      uPixelRatio: { value: gl.getPixelRatio() },
      uColor: { value: new THREE.Color() },
      uOpacity: { value: 1 },
    }),
    [gl],
  )
  uniforms.uColor.value.set(palette.ultra ? '#7fe9ff' : palette.dark ? '#ffd690' : palette.amber)
  uniforms.uOpacity.value = palette.dark ? 0.85 : 0.45

  useFrame((state) => {
    if (!material.current) return
    if (!reducedMotion) material.current.uniforms.uTime.value = state.clock.elapsedTime
    material.current.uniforms.uPixelRatio.value = state.gl.getPixelRatio()
  })

  return (
    <points geometry={geometry} frustumCulled={false}>
      <shaderMaterial
        ref={material}
        vertexShader={moteVertex}
        fragmentShader={moteFragment}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={palette.dark ? THREE.AdditiveBlending : THREE.NormalBlending}
      />
    </points>
  )
}

// --------------------------------------------------------------------------
// Camera: a load-in push, then scroll pulls it up and back
// --------------------------------------------------------------------------
const CAM_START = new THREE.Vector3(0, 1.3, 11.6)
const CAM_REST = new THREE.Vector3(0, 1.95, 14.2)
const CAM_END = new THREE.Vector3(0, 7.5, 19.5)
const LOOK_REST = new THREE.Vector3(0, 1.2, 0)
const LOOK_END = new THREE.Vector3(0, 0, -2)

function CameraRig({ progress, reducedMotion }: { progress: MutableRefObject<number>; reducedMotion: boolean }) {
  const intro = useRef(reducedMotion ? 1 : 0)
  const look = useMemo(() => new THREE.Vector3(), [])
  const goal = useMemo(() => new THREE.Vector3(), [])

  useFrame((state, delta) => {
    const dt = Math.min(delta, 1 / 20)
    if (!reducedMotion) intro.current = Math.min(1, state.clock.elapsedTime / 2.4)
    const t = 1 - Math.pow(1 - intro.current, 3)
    const p = reducedMotion ? 0 : THREE.MathUtils.clamp(progress.current, 0, 1)
    const pe = p * p * (3 - 2 * p)

    goal.copy(CAM_START).lerp(CAM_REST, t).lerp(CAM_END, pe)
    if (!reducedMotion) {
      goal.x += state.pointer.x * 0.45
      goal.y += state.pointer.y * 0.22
    }
    const cam = state.camera
    if (reducedMotion) cam.position.copy(goal)
    else cam.position.lerp(goal, 1 - Math.exp(-dt * 3.2))
    look.copy(LOOK_REST).lerp(LOOK_END, pe)
    cam.lookAt(look)
  })
  return null
}

// --------------------------------------------------------------------------
// Lights
// --------------------------------------------------------------------------
function Lights({ palette, tier }: { palette: Palette; tier: 'low' | 'high' }) {
  const key = useRef<THREE.SpotLight>(null)
  const target = useMemo(() => {
    const o = new THREE.Object3D()
    o.position.set(0, 0, 4)
    return o
  }, [])
  useEffect(() => {
    if (key.current) key.current.target = target
  }, [target])

  const warm = palette.dark ? '#ffe6b8' : '#fff6e6'
  return (
    <>
      <primitive object={target} />
      <hemisphereLight args={[palette.ultra ? '#6a5cff' : palette.dark ? '#5d7a8c' : '#ffffff', palette.dark ? palette.pitch : '#b9c9b0', palette.dark ? 0.35 : 1.4]} />
      <spotLight
        ref={key}
        position={[13, 11.5, -26]}
        angle={0.42}
        penumbra={0.7}
        intensity={palette.dark ? 4200 : 1500}
        distance={90}
        decay={2}
        color={warm}
        castShadow
        shadow-mapSize={tier === 'high' ? [2048, 2048] : [512, 512]}
        shadow-bias={-0.0004}
        shadow-camera-near={10}
        shadow-camera-far={60}
      />
      <spotLight position={[-26, 11.5, -4]} angle={0.5} penumbra={0.8} intensity={palette.dark ? 2200 : 800} distance={90} decay={2} color={warm} />
      {/* Rim from behind the camera so the ball's clearcoat catches a line. */}
      <directionalLight position={[-3, 4, 16]} intensity={palette.ultra ? 1.4 : palette.dark ? 0.6 : 1.2} color={palette.ultra ? '#5ce1ff' : palette.dark ? '#9fc6ff' : '#ffffff'} />
      {/* Ultra: a magenta kicker from the other side for a two-tone rim. */}
      {palette.ultra && <pointLight position={[4, 3, 12]} intensity={6} distance={10} color="#ff3d7f" />}
    </>
  )
}


// --------------------------------------------------------------------------
// Ultra theme effects: comets with light trails orbiting the ball, sparkles,
// sweeping searchlights into the sky and a pulsing neon boundary rope.
// Only mounted for the Ultra theme on devices that haven't stepped down.
// --------------------------------------------------------------------------
const COMETS = [
  { color: [0.6, 3.6, 4.5] as [number, number, number], radius: 1.55, speed: 1.25, tilt: 0.5, phase: 0 },
  { color: [4.5, 0.8, 2.4] as [number, number, number], radius: 1.8, speed: -0.95, tilt: -0.7, phase: 2.1 },
  { color: [4.8, 3.6, 0.6] as [number, number, number], radius: 1.35, speed: 1.6, tilt: 1.2, phase: 4.2 },
]

function Comet({
  ball,
  radius,
  speed,
  tilt,
  phase,
  color,
}: {
  ball: MutableRefObject<THREE.Group | null>
  radius: number
  speed: number
  tilt: number
  phase: number
  color: [number, number, number]
}) {
  const head = useRef<THREE.Mesh>(null)
  const centre = useMemo(() => new THREE.Vector3(), [])
  const trailColor = useMemo(() => new THREE.Color(...color), [color])
  useFrame((state) => {
    const b = ball.current
    const h = head.current
    if (!b || !h) return
    b.getWorldPosition(centre)
    const k = b.scale.x * BALL_RADIUS // orbit scales with the ball as it resizes
    const a = state.clock.elapsedTime * speed + phase
    h.position.set(
      centre.x + Math.cos(a) * radius * k,
      centre.y + Math.sin(a) * Math.sin(tilt) * radius * k,
      centre.z + Math.sin(a) * Math.cos(tilt) * radius * k,
    )
  })
  return (
    <Trail width={0.55} length={4} color={trailColor} attenuation={(t) => t * t} decay={1.4} interval={1}>
      <mesh ref={head}>
        <sphereGeometry args={[0.018, 12, 12]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
    </Trail>
  )
}

function Searchlights() {
  const beams = useRef<(THREE.Mesh | null)[]>([])
  const geometry = useMemo(() => {
    const g = new THREE.CylinderGeometry(0.02, 1, 1, 24, 1, true)
    g.translate(0, 0.5, 0) // base at the origin, opening upward
    return g
  }, [])
  const colours = useMemo(() => [new THREE.Color('#5ce1ff'), new THREE.Color('#ff3d7f'), new THREE.Color('#ffd23f'), new THREE.Color('#5ce1ff')], [])
  const origins: [number, number, number][] = [
    [-13, TOWER_HEIGHT + 0.8, -26],
    [13, TOWER_HEIGHT + 0.8, -26],
    [-26, TOWER_HEIGHT + 0.8, -4],
    [26, TOWER_HEIGHT + 0.8, -4],
  ]
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), [])
  const dir = useMemo(() => new THREE.Vector3(), [])
  useFrame((state) => {
    const t = state.clock.elapsedTime
    beams.current.forEach((m, i) => {
      if (!m) return
      const side = origins[i][0] > 0 ? -1 : 1
      dir.set(side * 0.35 + Math.sin(t * 0.35 + i * 1.7) * 0.45, 1, 0.15 + Math.cos(t * 0.27 + i) * 0.25).normalize()
      m.quaternion.setFromUnitVectors(up, dir)
    })
  })
  return (
    <group>
      {origins.map((o, i) => (
        <mesh
          key={i}
          ref={(el) => {
            beams.current[i] = el
          }}
          geometry={geometry}
          position={o}
          scale={[1.4, 70, 1.4]}
          renderOrder={2}
        >
          <shaderMaterial
            vertexShader={beamVertex}
            fragmentShader={/* glsl */ `
              uniform vec3 uColor;
              uniform float uOpacity;
              varying float vAlong;
              varying vec3 vNormalV;
              varying vec3 vViewDir;
              void main() {
                float edge = pow(abs(dot(vNormalV, vViewDir)), 2.0);
                float fade = pow(1.0 - vAlong, 1.6);
                gl_FragColor = vec4(uColor, edge * fade * uOpacity);
              }
            `}
            uniforms={{ uColor: { value: colours[i] }, uOpacity: { value: 0.22 } }}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
    </group>
  )
}

function BoundaryRope() {
  const mat = useRef<THREE.MeshBasicMaterial>(null)
  useFrame((state) => {
    if (!mat.current) return
    const p = 0.75 + Math.sin(state.clock.elapsedTime * 1.6) * 0.25
    mat.current.color.setRGB(4.2 * p, 0.7 * p, 2.4 * p)
  })
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, -4]}>
      <ringGeometry args={[23.8, 24.05, 160]} />
      <meshBasicMaterial ref={mat} toneMapped={false} />
    </mesh>
  )
}

function UltraFX({
  ball,
  reducedMotion,
  lite,
}: {
  ball: MutableRefObject<THREE.Group | null>
  reducedMotion: boolean
  /** Phones and slower GPUs: only the cheap layers (rope and sparkles). */
  lite: boolean
}) {
  if (lite)
    return (
      <>
        <BoundaryRope />
        <Sparkles count={40} scale={[24, 8, 22]} position={[0, 4, -4]} size={3} speed={0.3} color="#ffd23f" opacity={0.8} />
      </>
    )
  return (
    <>
      {!reducedMotion && COMETS.map((c, i) => <Comet key={i} ball={ball} {...c} />)}
      {!reducedMotion && <Searchlights />}
      <BoundaryRope />
      <Sparkles count={90} scale={[30, 9, 26]} position={[0, 4.5, -4]} size={3.2} speed={0.35} color="#ffd23f" opacity={0.8} />
      <Sparkles count={60} scale={[30, 9, 26]} position={[0, 4.5, -4]} size={2.4} speed={0.25} color="#5ce1ff" opacity={0.7} />
    </>
  )
}

// --------------------------------------------------------------------------
export default function StadiumScene({
  palette,
  tier,
  reducedMotion,
  active,
  progress,
  eventSource,
  onFail,
  layout = 'hero',
}: StadiumSceneProps) {
  const [degraded, setDegraded] = useState(tier === 'low')
  // Ultra on a strong device renders at the screen's full native resolution
  // (sharp on 4K displays); everything else keeps the usual caps.
  const maxDpr = tier === 'high' ? (palette.ultra ? 3 : 2) : 1.25
  const [dpr, setDpr] = useState(Math.min(window.devicePixelRatio || 1, maxDpr))
  useEffect(() => {
    if (!degraded) setDpr(Math.min(window.devicePixelRatio || 1, maxDpr))
  }, [maxDpr, degraded])
  const bloom = !degraded && palette.dark
  const ultraFx = palette.ultra && !degraded
  const ballRef = useRef<THREE.Group | null>(null)
  const aberration = useMemo(() => new THREE.Vector2(0.0009, 0.0006), [])

  const frameloop = !active ? 'never' : reducedMotion ? 'demand' : 'always'

  return (
    <Canvas
      className="!absolute inset-0"
      eventSource={eventSource as MutableRefObject<HTMLElement>}
      eventPrefix="client"
      frameloop={frameloop}
      dpr={dpr}
      shadows={tier === 'high' ? 'soft' : true}
      camera={{ fov: 40, near: 0.1, far: 140, position: CAM_START.toArray() }}
      gl={{ antialias: !bloom, powerPreference: 'high-performance', alpha: false, stencil: false }}
      onCreated={({ gl }) => {
        gl.domElement.addEventListener(
          'webglcontextlost',
          (e) => {
            e.preventDefault()
            onFail()
          },
          { once: true },
        )
      }}
      aria-hidden
    >
      <color attach="background" args={[palette.pitch]} />
      <fog attach="fog" args={[palette.pitch, 22, palette.dark ? 62 : 75]} />

      <PerformanceMonitor
        onDecline={() => {
          setDegraded(true)
          setDpr(1)
        }}
        flipflops={2}
        onFallback={() => setDpr(1)}
      />

      <CameraRig progress={progress} reducedMotion={reducedMotion} />
      <Lights palette={palette} tier={degraded ? 'low' : 'high'} />

      {/* Studio reflections for the ball, built from light panels instead of
          a downloaded HDR. */}
      <Environment resolution={degraded ? 64 : 256} frames={1}>
        <Lightformer form="rect" intensity={palette.dark ? 4 : 2.5} color="#fff1d6" position={[4, 5, 3]} scale={[6, 3, 1]} />
        <Lightformer form="rect" intensity={1.6} color={palette.ultra ? '#ff3d7f' : palette.dark ? '#8fb8ff' : '#ffffff'} position={[-5, 2, 4]} scale={[3, 6, 1]} />
        <Lightformer form="ring" intensity={2} color={palette.amber} position={[0, 6, -6]} scale={4} />
      </Environment>

      <Ground palette={palette} />
      <Floodlights palette={palette} tier={degraded ? 'low' : 'high'} />
      <Motes count={degraded ? 380 : 1400} palette={palette} reducedMotion={reducedMotion} />
      <Ball reducedMotion={reducedMotion} tier={degraded ? 'low' : 'high'} layout={layout} groupRef={ballRef} />
      {palette.ultra && <UltraFX ball={ballRef} reducedMotion={reducedMotion} lite={degraded} />}

      {bloom ? (
        ultraFx ? (
          // Ultra grade: hotter bloom, a touch of lens fringing and film grain.
          <EffectComposer multisampling={0} enableNormalPass={false}>
            <Bloom mipmapBlur luminanceThreshold={0.85} luminanceSmoothing={0.25} intensity={1.5} radius={0.82} />
            <ChromaticAberration offset={aberration} radialModulation={false} modulationOffset={0} />
            <Noise premultiply blendFunction={BlendFunction.SOFT_LIGHT} opacity={0.18} />
            <Vignette offset={0.2} darkness={0.7} />
            <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
          </EffectComposer>
        ) : (
          <EffectComposer multisampling={0} enableNormalPass={false}>
            <Bloom mipmapBlur luminanceThreshold={1} luminanceSmoothing={0.2} intensity={0.85} radius={0.7} />
            <Vignette offset={0.25} darkness={0.55} />
            <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
          </EffectComposer>
        )
      ) : null}
    </Canvas>
  )
}
