import type { ThreeElements } from '@react-three/fiber'
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { C } from './palette'

type MatOpts = { roughness?: number; metalness?: number; emissive?: string; emissiveIntensity?: number; opacity?: number; flat?: boolean }

const cache = new Map<string, THREE.MeshStandardMaterial>()

/** One material per color. Surfaces that change with state (glowing ones) get their own material from Glow/emissive components. */
export function mat(color: string, o: MatOpts = {}) {
  const key = JSON.stringify([color, o])
  let m = cache.get(key)
  if (!m) {
    const opacity = o.opacity ?? 1
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: o.roughness ?? 0.85,
      metalness: o.metalness ?? 0,
      emissive: o.emissive ?? '#000000',
      emissiveIntensity: o.emissiveIntensity ?? 1,
      transparent: opacity < 1,
      opacity,
      flatShading: o.flat ?? false,
    })
    cache.set(key, m)
  }
  return m
}

type MeshProps = Omit<ThreeElements['mesh'], 'args' | 'material' | 'ref'>
type Size = [number, number, number]

/*
 * Geometry cache: boxes, cylinders and spheres of the same size share one geometry.
 * Rounded boxes use three's RoundedBoxGeometry with 2 segments instead of drei RoundedBox (separate and dense each):
 * less than half the triangles, same look. Cached geometries are never disposed.
 */
const geos = new Map<string, THREE.BufferGeometry>()
function cached(key: string, make: () => THREE.BufferGeometry) {
  let g = geos.get(key)
  if (!g) {
    g = make()
    geos.set(key, g)
  }
  return g
}
const k3 = (n: number) => Math.round(n * 1000)
const boxGeo = ([w, h, d]: Size) => cached(`b${k3(w)},${k3(h)},${k3(d)}`, () => new THREE.BoxGeometry(w, h, d))
const roundGeo = ([w, h, d]: Size, r: number) =>
  cached(`r${k3(w)},${k3(h)},${k3(d)},${k3(r)}`, () => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2)))
const cylGeo = (rt: number, rb: number, h: number, seg: number) => cached(`c${k3(rt)},${k3(rb)},${k3(h)},${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg))
const icoGeo = (r: number, detail: number) => cached(`i${k3(r)},${detail}`, () => new THREE.IcosahedronGeometry(r, detail))

export function Box({
  size,
  color = C.white,
  radius = 0,
  shadow = true,
  material,
  ...rest
}: MeshProps & { size: Size; color?: string; radius?: number; shadow?: boolean; material?: THREE.Material }) {
  const m = material ?? mat(color)
  return <mesh castShadow={shadow} receiveShadow material={m} geometry={radius > 0 ? roundGeo(size, radius) : boxGeo(size)} {...rest} />
}

export function Cyl({
  r,
  rTop,
  h,
  color = C.white,
  segments = 24,
  shadow = true,
  material,
  ...rest
}: MeshProps & { r: number; rTop?: number; h: number; color?: string; segments?: number; shadow?: boolean; material?: THREE.Material }) {
  return <mesh castShadow={shadow} receiveShadow material={material ?? mat(color)} geometry={cylGeo(rTop ?? r, r, h, segments)} {...rest} />
}

export function Ball({
  r,
  color = C.white,
  detail = 2,
  flat = false,
  shadow = true,
  material,
  ...rest
}: MeshProps & { r: number; color?: string; detail?: number; flat?: boolean; shadow?: boolean; material?: THREE.Material }) {
  return <mesh castShadow={shadow} receiveShadow material={material ?? mat(color, { flat })} geometry={icoGeo(r, detail)} {...rest} />
}

/** Seeded random number generator: same result on every load. */
export function rng(seed = 1) {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s >>>= 0
    s ^= s >> 17
    s ^= s << 5
    s >>>= 0
    return s / 4294967296
  }
}
