import { useMemo } from 'react'
import * as THREE from 'three'
import { PetBody } from '../PetBody'
import { restState } from '../petAnim'
import { petKey, usePetLive } from '../petLive'
import { petLook, type Species } from '../petModel'
import { C } from './palette'
import { Ball, Box, Cyl, mat } from './primitives'
import type { Visual } from './visual'

/*
 * Pets and their items. The cat and dog items are the animal's home (its favorite spot); in view mode Pets.tsx animates
 * the animal and walks it around, and this component draws nothing. In edit mode, in thumbnails and in the ghost the animal
 * sits in place (dragged like an item). Items: cat bed, dog bed, food and water bowl, litter box, cat tree, dog house,
 * toy. Pastel and simple like toys.
 */

type P = { v: Visual }

const SIT_CAT = restState({ sit: 1, tailUp: 0.3, seed: 1.3, lookYaw: 0.25, lookPitch: 0.1 })
const SIT_DOG = restState({ sit: 1, tailUp: 0.4, seed: 2.1, lookYaw: -0.2, lookPitch: 0.05, tongue: true })

function PetFigure({ species, v }: { species: Species; v: Visual }) {
  const key = v.at ? petKey(v.at) : null
  const live = usePetLive((s) => key != null && s.keys.includes(key))
  const look = petLook(species, v.opts.variant)
  if (live && !v.edit) return null
  // pickable for dragging in edit mode (in view mode the live animal is picked by the hit box in Pets.tsx)
  return <PetBody look={look} pose={species === 'cat' ? SIT_CAT : SIT_DOG} pick />
}

/** Cat: live in view mode (Pets.tsx), sits in place in edit mode. Coat from Item.variant (tabby, black, white, gray). */
export function Cat({ v }: P) {
  return <PetFigure species="cat" v={v} />
}

/** Dog: live in view mode (Pets.tsx), sits in place in edit mode. Breed from Item.variant (golden, labrador, terrier, dalmatian). */
export function Dog({ v }: P) {
  return <PetFigure species="dog" v={v} />
}

const bedColor = (v: Visual, def: string) => v.opts.body ?? def
const soft = (hex: string, k: number) => `#${new THREE.Color(hex).multiplyScalar(k).getHexString()}`
const lighter = (hex: string, t: number) => `#${new THREE.Color(hex).lerp(new THREE.Color('#ffffff'), t).getHexString()}`

let donut: THREE.TorusGeometry | null = null
const donutGeo = () => (donut ??= new THREE.TorusGeometry(0.205, 0.075, 12, 32))

/** Cat bed (Ø 55 cm): round puffy rim with a soft cushion inside. Color from Item.body. */
export function CatBed({ v }: P) {
  const c = bedColor(v, '#c9c2ee')
  return (
    <group>
      <Cyl r={0.26} h={0.05} position={[0, 0.025, 0]} color={soft(c, 0.92)} segments={32} />
      <mesh geometry={donutGeo()} material={mat(c)} position={[0, 0.085, 0]} rotation-x={-Math.PI / 2} castShadow receiveShadow />
      <Cyl r={0.17} h={0.05} position={[0, 0.06, 0]} color={lighter(c, 0.55)} segments={28} />
    </group>
  )
}

/** Dog bed (95 × 70 cm): low base, puffy rim on three sides, low front, cushion inside. Color from Item.body. */
export function DogBed({ v }: P) {
  const c = bedColor(v, '#9fb0e8')
  return (
    <group>
      <Box size={[0.95, 0.07, 0.7]} position={[0, 0.035, 0]} color={soft(c, 0.9)} radius={0.035} />
      <Box size={[0.95, 0.2, 0.16]} position={[0, 0.12, -0.27]} color={c} radius={0.07} />
      <Box size={[0.15, 0.17, 0.6]} position={[-0.4, 0.105, 0.02]} color={c} radius={0.065} />
      <Box size={[0.15, 0.17, 0.6]} position={[0.4, 0.105, 0.02]} color={c} radius={0.065} />
      <Box size={[0.66, 0.09, 0.12]} position={[0, 0.075, 0.285]} color={c} radius={0.04} />
      <Box size={[0.66, 0.05, 0.46]} position={[0, 0.08, 0.0]} color={lighter(c, 0.6)} radius={0.025} />
    </group>
  )
}

const steel = () => mat('#cdd1da', { metalness: 0.55, roughness: 0.3 })
const water = () => mat('#7cc7ff', { roughness: 0.1, opacity: 0.75 })

/** Single bowl: stainless steel with a colored base ring; food or water inside. */
function Bowl({ x, kind, ring, s = 1 }: { x: number; kind: 'food' | 'water'; ring: string; s?: number }) {
  return (
    <group position={[x, 0, 0]} scale={s}>
      <Cyl r={0.075} rTop={0.085} h={0.012} position={[0, 0.006, 0]} color={ring} segments={28} />
      <Cyl r={0.065} rTop={0.08} h={0.05} position={[0, 0.031, 0]} material={steel()} segments={28} />
      {kind === 'food' ? (
        <>
          <Ball r={0.062} position={[0, 0.048, 0]} scale={[1, 0.22, 1]} color="#b98048" detail={2} shadow={false} />
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Ball key={i} r={0.008} position={[Math.cos(i * 1.7) * 0.03, 0.06, Math.sin(i * 1.7) * 0.03]} color={i % 2 ? '#a36d3a' : '#c98d55'} detail={0} shadow={false} />
          ))}
        </>
      ) : (
        <Cyl r={0.068} h={0.006} position={[0, 0.046, 0]} material={water()} segments={28} shadow={false} />
      )}
    </group>
  )
}

/** Food and water bowl: double (food and water on a tray), food only or water only (Item.variant). Base color from Item.body. */
export function PetBowl({ v }: P) {
  const ring = bedColor(v, C.coral)
  const kind = v.opts.variant ?? 'double'
  if (kind === 'double')
    return (
      <group>
        <Box size={[0.42, 0.02, 0.22]} position={[0, 0.01, 0]} color={ring} radius={0.01} />
        <group position={[0, 0.02, 0]}>
          <Bowl x={-0.1} kind="food" ring={soft(ring, 0.9)} />
          <Bowl x={0.1} kind="water" ring={soft(ring, 0.9)} />
        </group>
      </group>
    )
  return <Bowl x={0} kind={kind === 'water' ? 'water' : 'food'} ring={ring} s={1.15} />
}

/** Litter box: open (rimmed tray, litter, scoop) or covered (domed, flap at the front). Color from Item.body. */
export function LitterBox({ v }: P) {
  const c = bedColor(v, '#bfe3d4')
  if (v.opts.variant === 'covered')
    return (
      <group>
        <Box size={[0.5, 0.14, 0.4]} position={[0, 0.07, 0]} color={c} radius={0.03} />
        <Box size={[0.48, 0.24, 0.38]} position={[0, 0.25, 0]} color={lighter(c, 0.35)} radius={0.1} />
        <Box size={[0.2, 0.18, 0.012]} position={[0, 0.2, 0.19]} color={soft(c, 0.8)} radius={0.05} />
        <Box size={[0.08, 0.02, 0.02]} position={[0, 0.35, 0.19]} color={soft(c, 0.7)} radius={0.008} />
      </group>
    )
  return (
    <group>
      <Box size={[0.5, 0.12, 0.4]} position={[0, 0.06, 0]} color={c} radius={0.03} />
      <Box size={[0.44, 0.02, 0.34]} position={[0, 0.105, 0]} color="#ecdfc2" radius={0.01} shadow={false} />
      <Box size={[0.54, 0.035, 0.44]} position={[0, 0.13, 0]} color={soft(c, 0.88)} radius={0.017} />
      <Box size={[0.07, 0.008, 0.1]} position={[0.31, 0.004, 0.08]} color={soft(c, 0.75)} radius={0.003} />
    </group>
  )
}

/** Cat tree (1.25 m): carpeted base, sisal posts, a platform and a little house in the middle, a rimmed bed on top, a dangling ball. */
export function CatTree({ v }: P) {
  const c = bedColor(v, '#efe4cf')
  const sisal = mat('#d8bb88', { roughness: 0.95 })
  return (
    <group>
      <Box size={[0.55, 0.05, 0.55]} position={[0, 0.025, 0]} color={c} radius={0.02} />
      <Cyl r={0.05} h={0.68} position={[0.12, 0.39, -0.1]} material={sisal} segments={16} />
      <Box size={[0.32, 0.26, 0.3]} position={[-0.1, 0.18, 0.08]} color={soft(c, 0.94)} radius={0.04} />
      <Cyl r={0.07} h={0.012} position={[-0.1, 0.18, 0.231]} rotation-x={Math.PI / 2} color="#5b5470" segments={20} shadow={false} />
      <Cyl r={0.2} h={0.04} position={[0.04, 0.72, 0.06]} color={c} segments={28} />
      <Cyl r={0.045} h={0.48} position={[0, 0.97, -0.02]} material={sisal} segments={16} />
      <Cyl r={0.24} h={0.05} position={[0, 1.215, 0]} color={c} segments={28} />
      <mesh position={[0, 1.255, 0]} rotation-x={-Math.PI / 2} material={mat(soft(c, 0.95))} castShadow>
        <torusGeometry args={[0.2, 0.04, 8, 28]} />
      </mesh>
      <Cyl r={0.003} h={0.18} position={[0.2, 0.61, 0.16]} color="#8d93ae" segments={4} shadow={false} />
      <Ball r={0.03} position={[0.2, 0.5, 0.16]} color={C.coral} detail={1} />
    </group>
  )
}

/** Dog house (90 × 100 cm): wooden body, gable roof (brand blue), arched door at the front, bone plaque above the door. */
export function DogHouse({ v }: P) {
  const wood = bedColor(v, '#dcb98c')
  const roof = C.brand
  return (
    <group>
      <Box size={[0.8, 0.6, 0.86]} position={[0, 0.32, 0]} color={wood} radius={0.02} />
      <Box size={[0.84, 0.04, 0.9]} position={[0, 0.02, 0]} color={soft(wood, 0.85)} radius={0.01} />
      {/* gable roof: a box rotated 45° gives the triangular gables (lower half inside the body), two roof panels on top */}
      <Box size={[0.565, 0.565, 0.84]} position={[0, 0.62, 0]} rotation={[0, 0, Math.PI / 4]} color={wood} />
      {[-1, 1].map((s) => (
        <Box key={s} size={[0.66, 0.05, 1.0]} position={[s * 0.253, 0.803, 0]} rotation={[0, 0, -s * (Math.PI / 4)]} color={roof} radius={0.02} />
      ))}
      <Box size={[0.32, 0.36, 0.02]} position={[0, 0.2, 0.431]} color="#3b3550" radius={0.02} shadow={false} />
      <Cyl r={0.16} h={0.02} position={[0, 0.38, 0.431]} rotation-x={Math.PI / 2} color="#3b3550" segments={24} shadow={false} />
      <group position={[0, 0.62, 0.45]}>
        <Box size={[0.12, 0.025, 0.012]} color={C.white} radius={0.008} />
        {[-1, 1].map((s) => (
          <Ball key={s} r={0.017} position={[s * 0.06, 0, 0]} color={C.white} detail={1} shadow={false} />
        ))}
      </group>
    </group>
  )
}

/** Toy: ball (red and yellow), bone or plush mouse (Item.variant). */
export function PetToy({ v }: P) {
  const kind = v.opts.variant ?? 'ball'
  const toy = useMemo(() => mat(kind === 'ball' ? '#e2564b' : kind === 'bone' ? '#f4ecdc' : '#a6a9b8'), [kind])
  if (kind === 'bone')
    return (
      <group position={[0, 0.025, 0]} rotation-y={0.4}>
        <Cyl r={0.018} h={0.12} rotation-z={Math.PI / 2} material={toy} segments={12} />
        {[-0.065, 0.065].map((x) => [-0.016, 0.016].map((z) => <Ball key={`${x}${z}`} r={0.022} position={[x, 0, z]} material={toy} detail={1} />))}
      </group>
    )
  if (kind === 'mouse')
    return (
      <group position={[0, 0.03, 0]}>
        <Ball r={0.035} scale={[0.8, 0.75, 1.3]} material={toy} detail={2} />
        <Ball r={0.014} position={[-0.016, 0.024, 0.025]} color="#f2b8c6" detail={1} shadow={false} />
        <Ball r={0.014} position={[0.016, 0.024, 0.025]} color="#f2b8c6" detail={1} shadow={false} />
        <Ball r={0.006} position={[0, 0.002, 0.046]} color="#e58f8f" detail={0} shadow={false} />
        <Cyl r={0.003} h={0.09} position={[0, -0.015, -0.08]} rotation-x={Math.PI / 2 - 0.2} color="#e58f8f" segments={4} shadow={false} />
      </group>
    )
  return (
    <group position={[0, 0.045, 0]}>
      <Ball r={0.045} material={toy} detail={2} />
      <mesh rotation-x={Math.PI / 2} material={mat(C.sun)}>
        <torusGeometry args={[0.045, 0.009, 6, 24]} />
      </mesh>
    </group>
  )
}
