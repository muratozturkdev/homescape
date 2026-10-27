import { useThree } from '@react-three/fiber'
import { useLayoutEffect, useRef, type ReactNode } from 'react'
import * as THREE from 'three'
import { animatePet, type PetAnimState, type PetRefs } from './petAnim'
import { FRAME, petMaterial, petParts, type PetLook } from './petModel'

/*
 * Cat and dog skeleton. Looks in petModel.ts (one merged geometry per bone), motion in petAnim.ts. The root is on the ground
 * under the middle of the body, local +z forward. Parts are not clickable (Pets.tsx puts an invisible hit box on the body);
 * they stay out of the shadow map (to keep it cheap), with a soft contact shadow under the feet.
 * In edit mode and in thumbnails `pose` sets the posture once (no frames requested).
 */

const noRay = () => {}
const DISC = new THREE.CircleGeometry(1, 24)
const shadowMat = new THREE.MeshBasicMaterial({ color: '#1b1f33', transparent: true, opacity: 0.2, depthWrite: false })

function Seg({ geo, refKey, set, pick }: { geo: THREE.BufferGeometry; refKey?: string; set: (k: string) => (o: THREE.Object3D | null) => void; pick?: boolean }) {
  return <mesh ref={refKey ? set(refKey) : undefined} geometry={geo} material={petMaterial} raycast={pick ? undefined : noRay} />
}

export function PetBody({ look, register, pose, pick, children }: { look: PetLook; register?: (r: PetRefs | null) => void; pose?: PetAnimState; pick?: boolean; children?: ReactNode }) {
  const g = petParts(look)
  const F = FRAME[look.species]
  const invalidate = useThree((s) => s.invalidate)
  const refs = useRef<Partial<Record<string, THREE.Object3D>>>({})
  const set = (k: string) => (o: THREE.Object3D | null) => {
    if (o) refs.current[k] = o
  }

  useLayoutEffect(() => {
    const r = refs.current
    const need = ['root', 'body', 'pelvis', 'chest', 'neck', 'head', 'earN', 'earP', 'leg0', 'leg1', 'leg2', 'leg3', 'knee0', 'knee1', 'knee2', 'knee3', 'tail0', 'tail1', 'tail2', 'tail3', 'rump', 'chestMesh', 'lids', 'mouth', 'tongue', 'shadow']
    if (need.some((k) => !r[k])) return
    const G = (k: string) => r[k] as THREE.Group
    const out: PetRefs = {
      root: G('root'),
      body: G('body'),
      pelvis: G('pelvis'),
      chest: G('chest'),
      neck: G('neck'),
      head: G('head'),
      ears: [G('earN'), G('earP')],
      legs: [G('leg0'), G('leg1'), G('leg2'), G('leg3')],
      knees: [G('knee0'), G('knee1'), G('knee2'), G('knee3')],
      tail: [G('tail0'), G('tail1'), G('tail2'), G('tail3')],
      rump: r.rump!,
      chestMesh: r.chestMesh!,
      lids: r.lids!,
      mouth: r.mouth!,
      tongue: r.tongue!,
      shadow: r.shadow!,
    }
    if (pose) {
      animatePet(out, pose, look.species)
      invalidate()
    }
    register?.(out)
    return () => register?.(null)
  }, [register, pose, look.species, invalidate])

  // sideways spread of the leg joints
  const hx = F.rumpR[0] * 0.55
  const fx = F.chestR[0] * 0.56
  const leg = (i: number, x: number, upper: THREE.BufferGeometry, lower: THREE.BufferGeometry) => (
    <group key={i} ref={set(`leg${i}`)} position={[x, -0.005, 0]}>
      <Seg pick={pick} geo={upper} set={set} />
      <group ref={set(`knee${i}`)} position={[0, -F.upper, 0]}>
        <Seg pick={pick} geo={lower} set={set} />
      </group>
    </group>
  )
  return (
    <group ref={set('root')} scale={look.scale}>
      {/* soft contact shadow under the feet */}
      <group scale={[F.chestR[0] * 1.9, 1, (F.ls / 2 + F.rumpR[2]) * 1.1]}>
        <mesh ref={set('shadow')} geometry={DISC} material={shadowMat} rotation-x={-Math.PI / 2} position-y={0.004} raycast={noRay} renderOrder={1} />
      </group>
      <group ref={set('body')} position={[0, F.hipY, 0]}>
        <group ref={set('pelvis')} position={[0, 0, -F.ls / 2]}>
          <Seg pick={pick} geo={g.rump} refKey="rump" set={set} />
          {leg(0, -hx, g.upperH, g.lowerH)}
          {leg(1, hx, g.upperH, g.lowerH)}
          <group ref={set('tail0')} position={F.tailBase}>
            <Seg pick={pick} geo={g.tail0} set={set} />
            <group ref={set('tail1')} position={[0, F.tailSeg * 0.92, 0]}>
              <Seg pick={pick} geo={g.tail1} set={set} />
              <group ref={set('tail2')} position={[0, F.tailSeg * 0.92, 0]}>
                <Seg pick={pick} geo={g.tail2} set={set} />
                <group ref={set('tail3')} position={[0, F.tailSeg * 0.92, 0]}>
                  <Seg pick={pick} geo={g.tail3} set={set} />
                </group>
              </group>
            </group>
          </group>
          <group ref={set('chest')} position={[0, F.shY - F.hipY, F.ls]}>
            <Seg pick={pick} geo={g.chest} refKey="chestMesh" set={set} />
            {leg(2, -fx, g.upperF, g.lowerF)}
            {leg(3, fx, g.upperF, g.lowerF)}
            <group ref={set('neck')} position={F.neck}>
              <group ref={set('head')} position={F.head}>
                <Seg pick={pick} geo={g.head} set={set} />
                <mesh ref={set('lids')} geometry={g.lids} material={petMaterial} raycast={noRay} visible={false} />
                <mesh ref={set('mouth')} geometry={g.mouth} material={petMaterial} raycast={noRay} visible={false} />
                <mesh ref={set('tongue')} geometry={g.tongue} material={petMaterial} raycast={noRay} visible={false} />
                <group ref={set('earN')} position={[-F.ear[0], F.ear[1], F.ear[2]]}>
                  <Seg pick={pick} geo={g.earN} set={set} />
                </group>
                <group ref={set('earP')} position={F.ear}>
                  <Seg pick={pick} geo={g.earP} set={set} />
                </group>
              </group>
            </group>
          </group>
        </group>
      </group>
      {children}
    </group>
  )
}
