import { OrbitControls } from '@react-three/drei'
import { Canvas, useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { Activity } from '@/model/people'
import { Human } from '@/scene/Human'
import { animateHuman, type AnimState, type HumanRefs } from '@/scene/humanAnim'
import { LOOKS } from '@/scene/humanModel'

/*
 * Character lab (developer tool; #characters in the address bar): four people on a bright, plain floor, each with a
 * different motion (walking, seated activity, standing activity). For inspecting looks and motion and taking screenshots;
 * the rest of the app is not loaded. Query: #characters?is=cook (same activity for all), ?walk (all walk), ?close=2
 * (close-up of the 2nd person's face), ?side (side view).
 */

interface Slot {
  activity: Activity
  sit: number
  walk: boolean
  seatY: number
  lean: number
}

const SLOTS: Slot[] = [
  { activity: 'idle', sit: 0, walk: true, seatY: 0, lean: 0 },
  { activity: 'phone', sit: 1, walk: false, seatY: 0.48, lean: 0.12 },
  { activity: 'cook', sit: 0, walk: false, seatY: 0, lean: 0 },
  { activity: 'read', sit: 1, walk: false, seatY: 0.49, lean: 0 },
]

function Person({ i, slot }: { i: number; slot: Slot }) {
  const refs = useRef<HumanRefs | null>(null)
  const register = useMemo(() => (r: HumanRefs | null) => void (refs.current = r), [])
  useFrame(({ clock }) => {
    const r = refs.current
    if (!r) return
    r.root.visible = true
    r.root.position.set((i - 1.5) * 1.1, 0, 0)
    const t = clock.elapsedTime
    const s: AnimState = {
      t: t + i * 3,
      walk: slot.walk ? 1 : 0,
      phase: t * 6,
      pace: 1,
      sit: slot.sit,
      lie: 0,
      seatY: slot.seatY,
      lean: slot.lean,
      activity: slot.activity,
      act: slot.walk ? 0 : 1,
      actAge: t % 6,
      reach: 0.5 + ((i * 0.33) % 1.05),
      lookYaw: 0.2 * Math.sin(t * 0.5 + i),
      lookPitch: 0,
      blink: t % 4 < 0.13,
      seed: i * 1.7,
    }
    animateHuman(r, s)
  })
  return (
    <>
      <Human look={LOOKS[i % LOOKS.length]} register={register} />
      {slot.sit > 0 && (
        <mesh position={[(i - 1.5) * 1.1, slot.seatY / 2, -0.12]} castShadow receiveShadow>
          <boxGeometry args={[0.55, slot.seatY, 0.5]} />
          <meshStandardMaterial color="#c9cde0" />
        </mesh>
      )}
    </>
  )
}

export default function HumanLab() {
  const q = new URLSearchParams(location.hash.split('?')[1] ?? '')
  const all = q.get('is') as Activity | null
  const walkAll = q.has('walk')
  const slots = SLOTS.map((s) => (walkAll ? { ...s, walk: true, sit: 0 } : all ? { ...s, activity: all, walk: false } : s))
  const close = q.get('close')
  const cx = close ? (Number(close) - 1.5) * 1.1 : 0
  const side = q.has('side')
  const cam: [number, number, number] = close ? [cx + (side ? 0.9 : 0), 1.45, side ? 0 : 0.95] : side ? [3.6, 1.3, 0.2] : [0, 1.45, 3.4]
  const target: [number, number, number] = close ? [cx, 1.4, 0] : [0, 0.95, 0]
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#e9ebf3' }}>
      <Canvas shadows camera={{ position: cam, fov: 40 }} onCreated={({ gl }) => (gl.toneMapping = THREE.NeutralToneMapping)}>
        <color attach="background" args={['#e9ebf3']} />
        <hemisphereLight args={['#ffffff', '#c6cbea', 1.1]} />
        <directionalLight position={[3, 6, 4]} intensity={2.2} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} />
        <mesh rotation-x={-Math.PI / 2} receiveShadow>
          <planeGeometry args={[20, 20]} />
          <meshStandardMaterial color="#dde1f3" />
        </mesh>
        {slots.map((s, i) => (
          <Person key={i} i={i} slot={s} />
        ))}
        <OrbitControls target={target} />
      </Canvas>
    </div>
  )
}
