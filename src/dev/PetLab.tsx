import { OrbitControls } from '@react-three/drei'
import { Canvas, useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { CatBed, CatTree, DogBed, DogHouse, LitterBox, PetBowl, PetToy } from '@/scene/kit/pets'
import { OFF_VISUAL } from '@/scene/kit/visual'
import { PetBody } from '@/scene/PetBody'
import { animatePet, restState, type PetAnimState, type PetRefs } from '@/scene/petAnim'
import { birdParts, butterflyParts, CAT_LOOKS, DOG_LOOKS, petMaterial, squirrelParts, type PetLook } from '@/scene/petModel'

/*
 * Pet lab (developer tool; #pets in the address bar): every cat and dog look on a bright floor, in the chosen pose or
 * motion; visitors (bird, squirrel, butterfly) and props behind them. For inspecting looks and motion and taking
 * screenshots; the rest of the app is not loaded. Query: #pets?pose=walk|trot|run|sit|lie|sleep|groom|stretch|eat|crouch|
 * roll|jump|meow|wag (default sit), ?close=2 (close to the 2nd animal), ?side (side view), ?gear (props in front).
 */

const ROW: PetLook[] = [CAT_LOOKS.tabby, CAT_LOOKS.black, CAT_LOOKS.white, CAT_LOOKS.grey, CAT_LOOKS.tuxedo, DOG_LOOKS.golden, DOG_LOOKS.labrador, DOG_LOOKS.terrier, DOG_LOOKS.dalmatian, DOG_LOOKS.stray]
const X = (i: number) => (i - (ROW.length - 1) / 2) * 0.8

function poseOf(name: string, t: number, seed: number): PetAnimState {
  const s = restState({ t, seed, lookYaw: 0.25 * Math.sin(t * 0.5 + seed), blink: (t + seed) % 4 < 0.12 })
  switch (name) {
    case 'walk':
    case 'trot':
    case 'run':
      s.walk = 1
      s.gait = name === 'walk' ? 0 : name === 'trot' ? 1 : 2
      s.phase = t * (name === 'walk' ? 5 : name === 'trot' ? 8 : 12)
      s.tailUp = 0.9
      s.tongue = name === 'run'
      break
    case 'sit':
      s.sit = 1
      s.tailUp = 0.3
      break
    case 'lie':
      s.lie = 1
      break
    case 'sleep':
      s.lie = 1
      s.curl = 1
      break
    case 'groom':
      s.sit = 1
      s.groom = 1
      break
    case 'stretch':
      s.stretch = 1
      break
    case 'eat':
      s.eat = 1
      break
    case 'crouch':
      s.crouch = 1
      break
    case 'roll':
      s.roll = 1
      break
    case 'jump':
      s.jump = 1
      break
    case 'meow':
      s.sit = 1
      s.mouth = 1
      s.lookPitch = 0.4
      break
    case 'wag':
      s.wag = 1
      s.tongue = true
      s.tailUp = 0.9
      break
  }
  return s
}

function Pet({ i, look, pose }: { i: number; look: PetLook; pose: string }) {
  const refs = useRef<PetRefs | null>(null)
  const register = useMemo(() => (r: PetRefs | null) => void (refs.current = r), [])
  useFrame(({ clock }) => {
    const r = refs.current
    if (!r) return
    r.root.position.set(X(i), 0, 0)
    animatePet(r, poseOf(pose, clock.elapsedTime, i * 1.3), look.species)
  })
  return <PetBody look={look} register={register} />
}

function Visitors() {
  const bird = birdParts('robin')
  const tit = birdParts('tit')
  const sq = squirrelParts()
  const bf = butterflyParts('#8f6cf0')
  const wings = useRef<THREE.Group[]>([])
  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    wings.current.forEach((w, k) => {
      if (w) w.rotation.z = (k % 2 ? -1 : 1) * Math.sin(t * (k < 2 ? 3 : 8)) * 0.8
    })
  })
  const w = (k: number) => (o: THREE.Group | null) => void (o && (wings.current[k] = o))
  return (
    <group position={[0, 0, -1.3]}>
      <group position={[-1.2, 0, 0]} scale={2}>
        <mesh geometry={bird.body} material={petMaterial} />
        <group ref={w(0)} position={[0.03, 0.09, 0]}>
          <mesh geometry={bird.wing} material={petMaterial} />
        </group>
        <group ref={w(1)} position={[-0.03, 0.09, 0]} scale={[-1, 1, 1]}>
          <mesh geometry={bird.wing} material={petMaterial} />
        </group>
      </group>
      <group position={[-0.6, 0, 0]} scale={2} rotation-y={0.6}>
        <mesh geometry={tit.body} material={petMaterial} />
      </group>
      <group position={[0.2, 0, 0]} scale={2} rotation-y={-0.5}>
        <mesh geometry={sq.body} material={petMaterial} />
        <group position={[0, 0.07, -0.08]}>
          <mesh geometry={sq.tail} material={petMaterial} />
        </group>
      </group>
      <group position={[1.1, 0.5, 0]} scale={3}>
        <mesh geometry={bf.body} material={petMaterial} />
        <group ref={w(2)}>
          <mesh geometry={bf.wing} material={petMaterial} />
        </group>
        <group ref={w(3)} scale={[-1, 1, 1]}>
          <mesh geometry={bf.wing} material={petMaterial} />
        </group>
      </group>
    </group>
  )
}

function Gear({ front }: { front: boolean }) {
  const v = OFF_VISUAL
  const items = [CatBed, DogBed, PetBowl, LitterBox, CatTree, DogHouse, PetToy]
  return (
    <group position={[0, 0, front ? 1.2 : -2.6]}>
      {items.map((C, k) => (
        <group key={k} position={[(k - 3) * 1.15, 0, 0]}>
          <C v={v} />
        </group>
      ))}
    </group>
  )
}

export default function PetLab() {
  const q = new URLSearchParams(location.hash.split('?')[1] ?? '')
  const pose = q.get('pose') ?? 'sit'
  const close = q.get('close')
  const side = q.has('side')
  const cx = close ? X(Number(close) - 1) : 0
  const cam: [number, number, number] = close ? [cx + (side ? 1.1 : 0.25), 0.6, side ? 0 : 1.1] : side ? [7, 1.6, 0.2] : [0, 2.4, 7.2]
  const target: [number, number, number] = close ? [cx, 0.3, 0] : [0, 0.35, -0.4]
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#e9ebf3' }}>
      <Canvas shadows camera={{ position: cam, fov: 40 }} onCreated={({ gl }) => (gl.toneMapping = THREE.NeutralToneMapping)}>
        <color attach="background" args={['#e9ebf3']} />
        <hemisphereLight args={['#ffffff', '#c6cbea', 1.1]} />
        <directionalLight position={[3, 6, 4]} intensity={2.2} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} />
        <mesh rotation-x={-Math.PI / 2} receiveShadow>
          <planeGeometry args={[30, 30]} />
          <meshStandardMaterial color="#dde1f3" />
        </mesh>
        {ROW.map((look, i) => (
          <Pet key={look.key} i={i} look={look} pose={pose} />
        ))}
        <Visitors />
        <Gear front={q.has('gear')} />
        <OrbitControls target={target} />
      </Canvas>
    </div>
  )
}
