import { Billboard } from '@react-three/drei'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { mat } from './kit/primitives'
import type { HumanRefs } from './humanAnim'
import { EYE, eyeZ, humanMaterial, humanParts, LEG, propParts, type Look, type PropName } from './humanModel'

/*
 * Character: skeleton and parts. Looks in humanModel.ts (one merged geometry per bone), motion in humanAnim.ts. The root is
 * between the feet, local +z forward, ground at y = 0. Body parts cast shadows (in sunlight and in walk mode); not clickable.
 */

const noRay = () => {}

/** Letter "z" (above the head of a sleeper) */
let zGeo: THREE.ShapeGeometry | null = null
function zShape() {
  if (zGeo) return zGeo
  zGeo = new THREE.ShapeGeometry(
    new THREE.Shape()
      .moveTo(0, 0.3)
      .lineTo(0.3, 0.3)
      .lineTo(0.3, 0.24)
      .lineTo(0.09, 0.06)
      .lineTo(0.3, 0.06)
      .lineTo(0.3, 0)
      .lineTo(0, 0)
      .lineTo(0, 0.06)
      .lineTo(0.21, 0.24)
      .lineTo(0, 0.24)
      .closePath(),
  )
  return zGeo
}
const DISC = new THREE.CircleGeometry(0.3, 28)
const BLANKET = new THREE.BoxGeometry(0.66, 0.17, 1.44)

/** Bone segment: merged geometry, shared material, casts shadows */
function Seg({ geo, mirror, cast = true }: { geo: THREE.BufferGeometry; mirror?: boolean; cast?: boolean }) {
  return <mesh geometry={geo} material={humanMaterial} castShadow={cast} raycast={noRay} scale={mirror ? [-1, 1, 1] : 1} />
}

/** Placement of held props (from the right wrist, inside the fist) */
const PROP_AT: Record<PropName, { p: [number, number, number]; r: [number, number, number] }> = {
  phone: { p: [0.01, -0.075, 0.035], r: [-1.25, 0, 0.1] },
  book: { p: [0.12, -0.07, 0.07], r: [-1.1, 0, 0] },
  knife: { p: [0, -0.06, 0.03], r: [-1.5, 0, 0] },
  brush: { p: [0, -0.06, 0.03], r: [-1.35, 0, 0] },
  mug: { p: [0.035, -0.055, 0.03], r: [0, 0, 0] },
  bowl: { p: [0.03, -0.07, 0.035], r: [0, 0, 0] },
  glass: { p: [0.03, -0.055, 0.03], r: [0, 0, 0] },
}

export function Human({ look, register }: { look: Look; register: (r: HumanRefs | null) => void }) {
  const g = humanParts(look)
  const props = propParts()
  const b = look.build
  const refs = useRef<Partial<Record<string, THREE.Object3D>>>({})
  const set = (k: string) => (o: THREE.Object3D | null) => {
    if (o) refs.current[k] = o
  }
  const blanketMat = useMemo(() => mat(look.blanket, { roughness: 0.92 }), [look.blanket])

  useEffect(() => {
    const r = refs.current
    const need = ['root', 'body', 'hips', 'spine', 'chest', 'neck', 'head', 'tail', 'thighN', 'thighP', 'kneeN', 'kneeP', 'footN', 'footP', 'armN', 'armP', 'elbowN', 'elbowP', 'handN', 'handP', 'lidN', 'lidP', 'blanket', 'zzz', 'shadow']
    if (need.some((k) => !r[k])) return
    const G = (k: string) => r[k] as THREE.Group
    register({
      root: G('root'),
      body: G('body'),
      hips: G('hips'),
      spine: G('spine'),
      chest: G('chest'),
      neck: G('neck'),
      head: G('head'),
      tail: G('tail'),
      thigh: [G('thighN'), G('thighP')],
      knee: [G('kneeN'), G('kneeP')],
      foot: [G('footN'), G('footP')],
      arm: [G('armN'), G('armP')],
      elbow: [G('elbowN'), G('elbowP')],
      hand: [G('handN'), G('handP')],
      lids: [r.lidN!, r.lidP!],
      props: Object.fromEntries((Object.keys(PROP_AT) as PropName[]).map((k) => [k, r[`prop-${k}`]!])) as Record<PropName, THREE.Object3D>,
      blanket: r.blanket!,
      zzz: r.zzz!,
      shadow: r.shadow!,
    })
    return () => register(null)
  }, [register])

  const side = (s: -1 | 1) => (s < 0 ? 'N' : 'P')
  const ez = eyeZ()
  return (
    <group ref={set('root')} visible={false}>
      {/* Soft contact shadow under the feet */}
      <mesh ref={set('shadow')} geometry={DISC} rotation-x={-Math.PI / 2} position-y={0.004} raycast={noRay} renderOrder={1}>
        <meshBasicMaterial color="#1b1f33" transparent opacity={0.2} depthWrite={false} />
      </mesh>
      <group ref={set('body')}>
        <group ref={set('hips')} position={[0, LEG.hip, 0]}>
          <Seg geo={g.pelvis} />
          {([-1, 1] as const).map((s) => (
            <group key={s} ref={set(`thigh${side(s)}`)} position={[s * 0.095 * b, -0.02, 0]}>
              <Seg geo={g.thigh} />
              <group ref={set(`knee${side(s)}`)} position={[0, -LEG.thigh, 0]}>
                <Seg geo={g.shin} />
                <group ref={set(`foot${side(s)}`)} position={[0, -LEG.shin, 0]}>
                  <Seg geo={g.foot} />
                </group>
              </group>
            </group>
          ))}
          <group ref={set('spine')} position={[0, 0.06, 0]}>
            <Seg geo={g.spine} />
            <group ref={set('chest')} position={[0, 0.18, 0]}>
              <Seg geo={g.chest} />
              {([-1, 1] as const).map((s) => (
                <group key={s} ref={set(`arm${side(s)}`)} position={[s * 0.2 * b, 0.13, 0]}>
                  <Seg geo={g.upperArm} />
                  <group ref={set(`elbow${side(s)}`)} position={[0, -0.27, 0]}>
                    <Seg geo={g.forearm} />
                    <group ref={set(`hand${side(s)}`)} position={[0, -0.235, 0]}>
                      <Seg geo={g.hand} mirror={s > 0} />
                      {s < 0 &&
                        (Object.keys(PROP_AT) as PropName[]).map((k) => (
                          <mesh key={k} ref={set(`prop-${k}`)} geometry={props[k]} material={humanMaterial} position={PROP_AT[k].p} rotation={PROP_AT[k].r} visible={false} raycast={noRay} />
                        ))}
                    </group>
                  </group>
                </group>
              ))}
              <group ref={set('neck')} position={[0, 0.2, 0]}>
                <Seg geo={g.neck} />
                {/* Stylized large head (about 5.5 heads tall) */}
                <group ref={set('head')} position={[0, 0.07, 0.005]} scale={1.1}>
                  <Seg geo={g.head} />
                  <group ref={set('tail')} position={[0, 0.21, -0.115]}>
                    <Seg geo={g.tail} />
                  </group>
                  {([-1, 1] as const).map((s) => (
                    <group key={s} ref={set(`lid${side(s)}`)} position={[s * EYE.x, EYE.y, ez]} visible={false}>
                      <Seg geo={g.lid} cast={false} />
                    </group>
                  ))}
                </group>
              </group>
            </group>
          </group>
        </group>
      </group>
      {/* Lying down: blanket and "z z" */}
      <mesh ref={set('blanket')} geometry={BLANKET} material={blanketMat} raycast={noRay} visible={false} castShadow />
      <group ref={set('zzz')} visible={false}>
        <Billboard>
          <mesh geometry={zShape()} scale={0.3} raycast={noRay} renderOrder={12}>
            <meshBasicMaterial color="#8f7cff" toneMapped={false} side={THREE.DoubleSide} />
          </mesh>
          <mesh geometry={zShape()} scale={0.2} position={[0.11, 0.12, 0]} raycast={noRay} renderOrder={12}>
            <meshBasicMaterial color="#8f7cff" toneMapped={false} side={THREE.DoubleSide} />
          </mesh>
        </Billboard>
      </group>
    </group>
  )
}
