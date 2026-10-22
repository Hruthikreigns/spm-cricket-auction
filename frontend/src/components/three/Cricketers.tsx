import { useFrame } from '@react-three/fiber'
import { Trail } from '@react-three/drei'
import { useMemo, useRef, type MutableRefObject, type RefObject } from 'react'
import * as THREE from 'three'

/**
 * A match in progress on the hero ground: the bowler runs in from the far
 * end and bowls, the ball pitches, the batter (back to camera, at the near
 * end) lofts it over cover and a fielder chases it down. The non-striker
 * backs up, the umpire watches, the rest of the field waits.
 *
 * The players are stylised mannequins built from primitives with jointed
 * limbs, so there is nothing to download. Every pose is a pure function of
 * the loop time, so the action stays in sync on any frame rate.
 */

const LOOP = 7 // seconds per delivery
const T_RUN_END = 2.3
const T_RELEASE = 2.65
const T_BOUNCE = 3.15
const T_HIT = 3.42
const T_LAND = 5.0

// Key points on the pitch (z runs from the far stumps at -10 to the near at +10).
const BATTER_POS = new THREE.Vector3(-0.35, 0, 8.65)
const RELEASE = new THREE.Vector3(0.3, 2.15, -9.0)
const BOUNCE = new THREE.Vector3(-0.32, 0.03, 4.4)
const CONTACT = new THREE.Vector3(-0.6, 0.42, 8.55)
const LANDING = new THREE.Vector3(-21, 0.05, -12)

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const seg = (t: number, a: number, b: number) => clamp01((t - a) / (b - a))
const smooth = (v: number) => v * v * (3 - 2 * v)

// --------------------------------------------------------------------------
// Materials, shared by every player
// --------------------------------------------------------------------------
interface Kit {
  shirt: THREE.Material
  trousers: THREE.Material
  skin: THREE.Material
  pads: THREE.Material
  helmet: THREE.Material
  cap: THREE.Material
  shoe: THREE.Material
  willow: THREE.Material
  grip: THREE.Material
}

function useKits() {
  return useMemo(() => {
    const std = (color: string, roughness = 0.7, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
      new THREE.MeshStandardMaterial({ color, roughness, ...extra })
    const skin = std('#8d5a3b', 0.6)
    const shoe = std('#f2f2f2', 0.5)
    const willow = std('#e8d3a2', 0.45)
    const grip = std('#1b1b1b', 0.8)
    const pads = std('#f4f4f0', 0.55)
    const batting: Kit = {
      shirt: std('#1f3f99', 0.55),
      trousers: std('#16306f', 0.65),
      skin,
      pads,
      helmet: std('#10235a', 0.3, { metalness: 0.2 }),
      cap: std('#10235a', 0.6),
      shoe,
      willow,
      grip,
    }
    const fielding: Kit = {
      shirt: std('#f0a21a', 0.55),
      trousers: std('#9a5a07', 0.65),
      skin,
      pads,
      helmet: std('#6b3d00', 0.3),
      cap: std('#6b3d00', 0.6),
      shoe,
      willow,
      grip,
    }
    const umpire: Kit = { ...fielding, shirt: std('#f4f2ea', 0.6), trousers: std('#22252b', 0.7), cap: std('#f4f2ea', 0.6) }
    return { batting, fielding, umpire }
  }, [])
}

// --------------------------------------------------------------------------
// A jointed figure
// --------------------------------------------------------------------------
interface Rig {
  root: THREE.Group | null
  hips: THREE.Group | null
  torso: THREE.Group | null
  head: THREE.Group | null
  lSh: THREE.Group | null
  lEl: THREE.Group | null
  rSh: THREE.Group | null
  rEl: THREE.Group | null
  lHip: THREE.Group | null
  lKn: THREE.Group | null
  rHip: THREE.Group | null
  rKn: THREE.Group | null
  swing: THREE.Group | null
}

const emptyRig = (): Rig => ({
  root: null, hips: null, torso: null, head: null, lSh: null, lEl: null, rSh: null, rEl: null,
  lHip: null, lKn: null, rHip: null, rKn: null, swing: null,
})

const capsule = new THREE.CapsuleGeometry(1, 1, 4, 10)
const sphere = new THREE.SphereGeometry(1, 16, 12)
const box = new THREE.BoxGeometry(1, 1, 1)

function Limb({ length, radius, material, shadow }: { length: number; radius: number; material: THREE.Material; shadow: boolean }) {
  // Capsule of total height `length`, hanging down from the joint.
  return (
    <mesh
      geometry={capsule}
      material={material}
      position={[0, -length / 2, 0]}
      scale={[radius, length / 3, radius]} // capsule(1,1) is 3 units tall
      castShadow={shadow}
    />
  )
}

function Figure({
  rig,
  kit,
  role,
  shadow,
}: {
  rig: MutableRefObject<Rig>
  kit: Kit
  role: 'batter' | 'fielder' | 'bowler' | 'umpire'
  shadow: boolean
}) {
  const set = (k: keyof Rig) => (el: THREE.Group | null) => {
    rig.current[k] = el
  }
  const batter = role === 'batter'
  const legMat = batter ? kit.pads : kit.trousers
  return (
    <group ref={set('root')}>
      <group ref={set('hips')} position={[0, 0.95, 0]}>
        <mesh geometry={sphere} material={kit.trousers} scale={[0.17, 0.1, 0.11]} castShadow={shadow} />
        <group ref={set('torso')}>
          <mesh geometry={capsule} material={kit.shirt} position={[0, 0.3, 0]} scale={[0.17, 0.22, 0.12]} castShadow={shadow} />
          <group ref={set('head')} position={[0, 0.62, 0]}>
            <mesh geometry={sphere} material={kit.skin} position={[0, 0.06, 0]} scale={0.105} castShadow={shadow} />
            {batter ? (
              <>
                <mesh geometry={sphere} material={kit.helmet} position={[0, 0.1, -0.01]} scale={[0.125, 0.11, 0.13]} />
                {/* Grille */}
                <mesh geometry={box} material={kit.grip} position={[0, 0.03, 0.11]} scale={[0.17, 0.08, 0.02]} />
              </>
            ) : (
              <>
                <mesh geometry={sphere} material={kit.cap} position={[0, 0.12, 0]} scale={[0.11, 0.06, 0.11]} />
                <mesh geometry={box} material={kit.cap} position={[0, 0.1, 0.09]} scale={[0.14, 0.012, 0.09]} />
              </>
            )}
          </group>

          {batter ? (
            // Batter: both arms and the bat hang from one pivot at the
            // shoulders, so the swing moves them together.
            <group ref={set('swing')} position={[0, 0.5, 0.04]}>
              {[-0.16, 0.16].map((x) => (
                <group key={x} position={[x, 0, 0]} rotation={[-0.45, 0, -x * 1.6]}>
                  <Limb length={0.55} radius={0.045} material={kit.shirt} shadow={shadow} />
                </group>
              ))}
              <group position={[0, -0.5, 0.22]}>
                <mesh geometry={sphere} material={kit.pads} scale={0.05} />
                <mesh geometry={box} material={kit.grip} position={[0, -0.12, 0]} scale={[0.035, 0.26, 0.035]} />
                <mesh geometry={box} material={kit.willow} position={[0, -0.55, 0]} scale={[0.11, 0.62, 0.045]} castShadow={shadow} />
              </group>
            </group>
          ) : (
            <>
              <group ref={set('lSh')} position={[-0.2, 0.5, 0]}>
                <Limb length={0.3} radius={0.045} material={kit.shirt} shadow={shadow} />
                <group ref={set('lEl')} position={[0, -0.3, 0]}>
                  <Limb length={0.28} radius={0.04} material={kit.skin} shadow={shadow} />
                </group>
              </group>
              <group ref={set('rSh')} position={[0.2, 0.5, 0]}>
                <Limb length={0.3} radius={0.045} material={kit.shirt} shadow={shadow} />
                <group ref={set('rEl')} position={[0, -0.3, 0]}>
                  <Limb length={0.28} radius={0.04} material={kit.skin} shadow={shadow} />
                </group>
              </group>
            </>
          )}
        </group>

        {[
          ['lHip', 'lKn', -0.09],
          ['rHip', 'rKn', 0.09],
        ].map(([hip, knee, x]) => (
          <group key={hip as string} ref={set(hip as keyof Rig)} position={[x as number, -0.02, 0]}>
            <Limb length={0.46} radius={batter ? 0.07 : 0.06} material={batter ? kit.trousers : legMat} shadow={shadow} />
            <group ref={set(knee as keyof Rig)} position={[0, -0.46, 0]}>
              <Limb length={0.44} radius={batter ? 0.075 : 0.05} material={legMat} shadow={shadow} />
              <mesh geometry={box} material={kit.shoe} position={[0, -0.45, 0.04]} scale={[0.09, 0.06, 0.2]} castShadow={shadow} />
            </group>
          </group>
        ))}
      </group>
    </group>
  )
}

// --------------------------------------------------------------------------
// Poses
// --------------------------------------------------------------------------
function legs(r: Rig, phase: number, stride: number, bend: number) {
  const s = Math.sin(phase)
  if (r.lHip) r.lHip.rotation.x = -s * stride
  if (r.rHip) r.rHip.rotation.x = s * stride
  if (r.lKn) r.lKn.rotation.x = Math.max(0, Math.cos(phase)) * bend
  if (r.rKn) r.rKn.rotation.x = Math.max(0, -Math.cos(phase)) * bend
}

function arms(r: Rig, phase: number, swing: number) {
  const s = Math.sin(phase)
  if (r.lSh) r.lSh.rotation.set(s * swing, 0, 0.12)
  if (r.rSh) r.rSh.rotation.set(-s * swing, 0, -0.12)
  if (r.lEl) r.lEl.rotation.x = -0.9
  if (r.rEl) r.rEl.rotation.x = -0.9
}

function run(r: Rig, phase: number, speed: number) {
  legs(r, phase, 0.85 * speed, 1.3 * speed)
  arms(r, phase, 0.9 * speed)
  if (r.hips) r.hips.position.y = 0.92 + Math.abs(Math.sin(phase)) * 0.06 * speed
  if (r.torso) r.torso.rotation.x = 0.18 * speed
}

function idle(r: Rig, t: number, seed: number) {
  const b = Math.sin(t * 1.3 + seed) * 0.03
  legs(r, 0, 0, 0)
  if (r.lHip) r.lHip.rotation.set(0, 0, -0.08)
  if (r.rHip) r.rHip.rotation.set(0, 0, 0.08)
  if (r.lSh) r.lSh.rotation.set(0.05 + b, 0, 0.18)
  if (r.rSh) r.rSh.rotation.set(0.05 - b, 0, -0.18)
  if (r.lEl) r.lEl.rotation.x = -0.25
  if (r.rEl) r.rEl.rotation.x = -0.25
  if (r.hips) r.hips.position.y = 0.95 + b * 0.3
  if (r.torso) r.torso.rotation.x = 0
}

/** Fielder walking in as the bowler runs up: hands on knees, ready. */
function ready(r: Rig, t: number, seed: number) {
  idle(r, t, seed)
  if (r.torso) r.torso.rotation.x = 0.35
  if (r.lKn) r.lKn.rotation.x = 0.35
  if (r.rKn) r.rKn.rotation.x = 0.35
  if (r.lHip) r.lHip.rotation.x = -0.35
  if (r.rHip) r.rHip.rotation.x = -0.35
  if (r.hips) r.hips.position.y = 0.88
  if (r.lSh) r.lSh.rotation.set(-0.5, 0, 0.1)
  if (r.rSh) r.rSh.rotation.set(-0.5, 0, -0.1)
}

// --------------------------------------------------------------------------
// The scene
// --------------------------------------------------------------------------
const FIELDERS: { pos: [number, number]; seed: number }[] = [
  { pos: [-9, -2], seed: 0.3 }, // cover
  { pos: [-15, -9], seed: 1.1 }, // long-off side, chases the drive
  { pos: [10, -3], seed: 2.2 }, // midwicket
  { pos: [7, 5], seed: 3.4 }, // square leg
  { pos: [-6, 4], seed: 4.1 }, // point
  { pos: [3, -16], seed: 5.0 }, // long-on
  { pos: [-3, -16], seed: 5.6 }, // long-off
]

function faceToward(from: THREE.Vector3, to: THREE.Vector3) {
  return Math.atan2(to.x - from.x, to.z - from.z)
}

export function Cricketers({
  reducedMotion,
  lite,
  trails,
}: {
  reducedMotion: boolean
  /** Phones / stepped-down GPUs: fewer fielders, no player shadows. */
  lite: boolean
  /** Light trail behind the ball (Ultra theme). */
  trails: boolean
}) {
  const kits = useKits()
  const bowler = useRef<Rig>(emptyRig())
  const striker = useRef<Rig>(emptyRig())
  const runner = useRef<Rig>(emptyRig())
  const ump = useRef<Rig>(emptyRig())
  const fieldRigs = useRef<MutableRefObject<Rig>[]>(FIELDERS.map(() => ({ current: emptyRig() })))
  const ball = useRef<THREE.Mesh>(null)
  const tmp = useMemo(() => new THREE.Vector3(), [])
  const chaserHome = useMemo(() => new THREE.Vector3(FIELDERS[1].pos[0], 0, FIELDERS[1].pos[1]), [])

  const fielders = lite ? FIELDERS.slice(0, 4) : FIELDERS

  useFrame((state) => {
    // Reduced motion: hold one frame — the bat coming down on the ball.
    const t = reducedMotion ? 3.36 : state.clock.elapsedTime % LOOP
    const clock = state.clock.elapsedTime

    // ---- Bowler: run-up, delivery, follow-through, walk back ----
    const b = bowler.current
    if (b.root) {
      if (t < T_RUN_END) {
        const p = t / T_RUN_END
        b.root.position.set(0.35, 0, THREE.MathUtils.lerp(-21, -10.4, smooth(p) * 0.6 + p * 0.4))
        b.root.rotation.set(0, 0, 0)
        run(b, t * 11, 0.7 + p * 0.4)
      } else if (t < 2.8) {
        // Delivery stride: bowling arm windmills over the top.
        const p = seg(t, T_RUN_END, 2.8)
        b.root.position.set(0.35, 0, THREE.MathUtils.lerp(-10.4, -9.3, p))
        legs(b, 0, 0, 0)
        if (b.lHip) b.lHip.rotation.x = -0.6 * p
        if (b.rHip) b.rHip.rotation.x = 0.5 * p
        if (b.rKn) b.rKn.rotation.x = 0.4
        if (b.hips) b.hips.position.y = 0.95 - 0.05 * p
        if (b.rSh) b.rSh.rotation.set(Math.PI * 1.55 * p, 0, -0.1)
        if (b.lSh) b.lSh.rotation.set(-Math.PI * 0.85 * (1 - p) - 0.2, 0, 0.1)
        if (b.rEl) b.rEl.rotation.x = 0
        if (b.lEl) b.lEl.rotation.x = -0.3
        if (b.torso) b.torso.rotation.x = -0.2 + p * 0.7
      } else if (t < 3.8) {
        const p = seg(t, 2.8, 3.8)
        b.root.position.set(THREE.MathUtils.lerp(0.35, 1.7, p), 0, THREE.MathUtils.lerp(-9.3, -7.6, smooth(p)))
        run(b, t * 9, 0.8 * (1 - p) + 0.2)
      } else {
        // Walks back to the mark, facing away.
        const p = seg(t, 3.8, LOOP)
        b.root.position.set(THREE.MathUtils.lerp(1.7, 0.35, p), 0, THREE.MathUtils.lerp(-7.6, -21, smooth(p)))
        b.root.rotation.y = Math.PI
        run(b, t * 7, 0.45)
      }
      if (t < 3.8) b.root.rotation.y = 0
    }

    // ---- Striker: stance, backlift, drive, follow-through ----
    const s = striker.current
    if (s.root) {
      s.root.position.copy(BATTER_POS)
      s.root.rotation.y = -Math.PI / 2 // side-on, left shoulder to the bowler
      if (s.head) s.head.rotation.y = -1.25 // looking down the pitch
      if (s.lHip) s.lHip.rotation.set(0, 0, -0.18)
      if (s.rHip) s.rHip.rotation.set(0, 0, 0.18)
      if (s.lKn) s.lKn.rotation.x = 0.2
      if (s.rKn) s.rKn.rotation.x = 0.2
      if (s.hips) s.hips.position.y = 0.9
      let theta = 0.25 // bat angle in the swing plane: + is behind, - toward the bowler
      if (t >= 2.9 && t < 3.25) theta = THREE.MathUtils.lerp(0.25, 2.3, smooth(seg(t, 2.9, 3.25)))
      else if (t >= 3.25 && t < T_HIT) theta = THREE.MathUtils.lerp(2.3, 0, seg(t, 3.25, T_HIT) ** 1.6)
      else if (t >= T_HIT && t < 3.8) theta = THREE.MathUtils.lerp(0, -2.5, smooth(seg(t, T_HIT, 3.8)))
      else if (t >= 3.8 && t < 4.7) theta = -2.5
      else if (t >= 4.7 && t < 5.6) theta = THREE.MathUtils.lerp(-2.5, 0.25, smooth(seg(t, 4.7, 5.6)))
      if (s.swing) s.swing.rotation.set(0, 0, theta)
      // Weight transfers onto the front foot through the shot.
      const lean = t >= 3.25 && t < 4.7 ? 0.3 : 0
      if (s.torso) s.torso.rotation.z = THREE.MathUtils.damp(s.torso.rotation.z, -lean, 8, 1 / 60)
      if (s.torso) s.torso.rotation.x = 0.15
    }

    // ---- Non-striker: backs up, then walks back ----
    const n = runner.current
    if (n.root) {
      let z = -9.6
      let moving = 0
      if (t >= 2.2 && t < 3.4) {
        z = THREE.MathUtils.lerp(-9.6, -7.6, smooth(seg(t, 2.2, 3.4)))
        moving = 1
      } else if (t >= 3.4 && t < 5.4) z = -7.6
      else if (t >= 5.4) {
        z = THREE.MathUtils.lerp(-7.6, -9.6, smooth(seg(t, 5.4, LOOP)))
        moving = 1
      }
      n.root.position.set(-1.2, 0, z)
      n.root.rotation.y = 0
      if (moving) run(n, t * 8, 0.4)
      else idle(n, clock, 0.7)
      if (n.rSh) n.rSh.rotation.x = -0.25 // bat arm forward
    }

    // ---- Umpire ----
    const u = ump.current
    if (u.root) {
      u.root.position.set(0.9, 0, -11.7)
      u.root.rotation.y = 0
      idle(u, clock, 1.9)
      if (t > T_LAND && t < 6.2) {
        // Signals four: arm waved across the body.
        if (u.rSh) u.rSh.rotation.set(-1.4, 0, -0.2 + Math.sin(clock * 9) * 0.7)
      }
    }

    // ---- Fielders: walk in with the bowler, one chases the drive ----
    fieldRigs.current.slice(0, fielders.length).forEach((ref, i) => {
      const f = ref.current
      if (!f.root) return
      const home = tmp.set(FIELDERS[i].pos[0], 0, FIELDERS[i].pos[1])
      if (i === 1 && t >= T_HIT && t < 6.2) {
        const p = smooth(seg(t, T_HIT, 5.3))
        f.root.position.lerpVectors(chaserHome, LANDING, p * 0.92)
        f.root.rotation.y = faceToward(chaserHome, LANDING)
        if (p < 1) run(f, t * 11, 1)
        else ready(f, clock, FIELDERS[i].seed)
      } else if (i === 1 && t >= 6.2) {
        const p = smooth(seg(t, 6.2, LOOP))
        tmp.copy(LANDING).multiplyScalar(0.92).addScaledVector(chaserHome, 0.08)
        f.root.position.lerpVectors(tmp, chaserHome, p)
        f.root.rotation.y = faceToward(tmp, chaserHome)
        run(f, t * 7, 0.45)
      } else {
        f.root.position.copy(home)
        f.root.rotation.y = faceToward(home, BATTER_POS)
        if (t > 1.6 && t < T_HIT + 0.3) ready(f, clock, FIELDERS[i].seed)
        else idle(f, clock, FIELDERS[i].seed)
      }
    })

    // ---- The ball ----
    const m = ball.current
    if (m) {
      let visible = true
      if (t < T_RELEASE) {
        // In the bowler's hand.
        if (b.root) m.position.set(b.root.position.x + 0.2, 1.3, b.root.position.z + 0.1)
        visible = t > T_RUN_END
      } else if (t < T_BOUNCE) {
        const p = seg(t, T_RELEASE, T_BOUNCE)
        m.position.lerpVectors(RELEASE, BOUNCE, p)
        m.position.y = THREE.MathUtils.lerp(RELEASE.y, BOUNCE.y, p ** 1.35)
      } else if (t < T_HIT) {
        const p = seg(t, T_BOUNCE, T_HIT)
        m.position.lerpVectors(BOUNCE, CONTACT, p)
        m.position.y = THREE.MathUtils.lerp(BOUNCE.y, CONTACT.y, p) + Math.sin(p * Math.PI) * 0.35
      } else if (t < T_LAND) {
        const p = seg(t, T_HIT, T_LAND)
        m.position.lerpVectors(CONTACT, LANDING, p)
        m.position.y = THREE.MathUtils.lerp(CONTACT.y, LANDING.y, p) + Math.sin(p * Math.PI) * 9
      } else if (t < 5.8) {
        const p = seg(t, T_LAND, 5.8)
        m.position.set(LANDING.x - p * 1.6, 0.05 + Math.abs(Math.sin(p * 9)) * 0.3 * (1 - p), LANDING.z - p * 1.2)
      } else visible = false
      m.visible = visible
    }
  })

  const shadow = !lite
  return (
    <group>
      <Figure rig={bowler} kit={kits.fielding} role="bowler" shadow={shadow} />
      <Figure rig={striker} kit={kits.batting} role="batter" shadow={shadow} />
      <Figure rig={runner} kit={kits.batting} role="fielder" shadow={false} />
      <Figure rig={ump} kit={kits.umpire} role="umpire" shadow={false} />
      {fielders.map((_, i) => (
        <Figure key={i} rig={fieldRigs.current[i]} kit={kits.fielding} role="fielder" shadow={false} />
      ))}

      {trails ? (
        <Trail width={0.35} length={5} color={new THREE.Color(4, 1.2, 1.4)} attenuation={(x) => x * x}>
          <BallMesh ballRef={ball} glow />
        </Trail>
      ) : (
        <BallMesh ballRef={ball} glow={false} />
      )}
    </group>
  )
}

function BallMesh({ ballRef, glow }: { ballRef: RefObject<THREE.Mesh>; glow: boolean }) {
  return (
    <mesh ref={ballRef} castShadow scale={0.07}>
      <sphereGeometry args={[1, 16, 12]} />
      {glow ? (
        <meshBasicMaterial color={[3.2, 0.5, 0.5]} toneMapped={false} />
      ) : (
        <meshStandardMaterial color="#b3151b" roughness={0.35} emissive="#5a0a0d" />
      )}
    </mesh>
  )
}
