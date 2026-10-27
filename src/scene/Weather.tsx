import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { play } from '@/audio/engine'
import { currentWeather, useWeatherPref } from '@/ha/weather'
import { useHa } from '@/ha/store'
import { bounds, isOutdoor, rectsOf, WALL_H } from '@/model/geometry'
import { activeHomeId, activeLevel, useLayout } from '@/model/layoutStore'
import type { Level } from '@/model/types'
import { roofView, useView } from './camera'
import { useAmbient } from './kit/effects'
import { ROOF_MAX, ROOF_PITCH } from './roof'
import { useNight } from './useNight'
import { weatherDebug, weatherLight } from './weatherState'

/*
 * Weather in the scene (ha/weather.ts):
 * - Precipitation: rain streaks (dense in a downpour), snowflakes (swaying down), hail (short, white, fast). Each kind is a
 *   single draw call: drop positions come from a seed, the fall and the wind drift are computed on the GPU (the CPU moves
 *   nothing per frame). The area is the plot plus 8 m around it (in walk mode the same size around the camera), 14 m high.
 *   No rain indoors: a drop over the interior stops at the roof surface (on a hip roof the height rises from the eaves
 *   inwards, on a concrete roof it is the slab); when the roof lifts (looking inside) the drops over the house fade out and
 *   it only rains outside. Drops right in front of the camera fade too (so they do not cover the screen). Drops are at
 *   least 1.5-2 px wide so the rain shows from afar. Wind tilts the precipitation. Lite mode draws no precipitation.
 * - Clouds and fog live in Lights and FogRange (weatherLight), snow cover and wetness on the ground and the roofs.
 * - Lightning (thunder, thunderstorm): every 6-28 s two or three short flashes (ambient light and sky); the thunder follows
 *   0.7-2.2 s after the flash.
 * Changing weather blends in over 2-3 s.
 */

const TOP = 14
const MARGIN = 8
const CELL = 0.5
/** Lift of the hip roof above the wall top (about roof.ts > LIFT) */
const ROOF_LIFT = 0.16

const VERT = /* glsl */ `
uniform float uTime;
uniform float uTop;
uniform float uSpeed;
uniform float uLen;
uniform float uWidth;
uniform float uDensity;
uniform float uRoof;
uniform float uKind;
uniform vec2 uWind;
uniform vec4 uRegion;
uniform vec4 uFloorBox;
uniform sampler2D uFloor;
attribute vec4 aSeed;
varying float vAlpha;
varying vec2 vUv;
void main() {
  vUv = position.xy;
  if ( aSeed.w > uDensity ) {
    gl_Position = vec4( 2.0, 2.0, 2.0, 1.0 );
    vAlpha = 0.0;
    return;
  }
  // Falls from the top to the ground; the height below (roof, wall top) is read from a texture at the drop's current
  // position, so a drop the wind carries over the house ends on the roof
  float h = uTop + 0.2;
  float fall = uSpeed * ( 0.85 + 0.3 * fract( aSeed.z * 7.13 ) );
  float y = uTop - mod( uTime * fall + aSeed.z * h, h );
  float age = ( uTop - y ) / fall;
  vec2 drift = uWind * age;
  float sway = uKind > 0.5 ? sin( uTime * 1.7 + aSeed.z * 40.0 ) * 0.25 : 0.0;
  // The area is a window: drops stay put in the world, and when the window moves (with the camera in walk mode) they only wrap from one edge to the other
  vec3 c = vec3( uRegion.x + mod( aSeed.x * uRegion.z + drift.x + sway - uRegion.x, uRegion.z ), y, uRegion.y + mod( aSeed.y * uRegion.w + drift.y - uRegion.y, uRegion.w ) );
  vec2 fl = texture2D( uFloor, ( c.xz - uFloorBox.xy ) / uFloorBox.zw ).rg;
  float floorY = mix( fl.x, fl.y, uRoof );
  // In view space: distance from depth, width in the screen plane (cameraPosition is not used: some drivers leave it empty)
  vec4 mv = viewMatrix * vec4( c, 1.0 );
  float dist = max( 0.5, - mv.z );
  if ( uKind < 0.5 ) {
    // Streak along the fall, its width perpendicular on screen (a thin line from the side and from above)
    vec3 dir = normalize( vec3( uWind.x, -fall, uWind.y ) );
    vec3 dv = ( viewMatrix * vec4( dir, 0.0 ) ).xyz;
    vec2 sv = length( dv.xy ) > 1e-4 ? normalize( vec2( - dv.y, dv.x ) ) : vec2( 1.0, 0.0 );
    float w = max( uWidth, dist * 0.0011 );
    float l = max( uLen, dist * 0.01 );
    mv.xyz += - dv * position.y * l + vec3( sv * position.x * w, 0.0 );
  } else {
    mv.xy += position.xy * max( uWidth, dist * 0.0032 );
  }
  vAlpha = smoothstep( 0.0, 0.3, y - floorY ) * smoothstep( 0.0, 1.5, uTop - y );
  // With the roof lifted the drops over the house fade (the interior stays visible, it does not look like rain indoors); so do the ones at the camera
  vAlpha *= mix( 1.0, uRoof, step( 0.01, fl.y ) ) * smoothstep( 2.0, 6.0, dist );
  gl_Position = projectionMatrix * mv;
}`

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uKind;
varying float vAlpha;
varying vec2 vUv;
void main() {
  float a;
  if ( uKind < 0.5 ) a = ( 1.0 - abs( vUv.x ) * 2.0 ) * smoothstep( 0.0, 0.25, vUv.y ) * ( 1.0 - smoothstep( 0.65, 1.0, vUv.y ) );
  else a = 1.0 - smoothstep( 0.55, 1.0, length( vUv ) * 2.0 );
  if ( a * vAlpha < 0.01 ) discard;
  gl_FragColor = vec4( uColor, a * vAlpha * uOpacity );
  #include <colorspace_fragment>
}`

/** Seeded pseudo random (drops in the same place on every load) */
function lcg(seed: number) {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
}

type Kind = 'rain' | 'snow' | 'hail'
/** Per kind: drops per m², maximum count, fall speed (m/s), length and width (m), flake or streak */
const KIND: Record<Kind, { perM2: number; cap: number; speed: number; len: number; width: number; flake: boolean }> = {
  rain: { perM2: 4, cap: 16_000, speed: 9, len: 0.5, width: 0.012, flake: false },
  snow: { perM2: 2.2, cap: 10_000, speed: 1.1, len: 0, width: 0.05, flake: true },
  hail: { perM2: 0.8, cap: 4_000, speed: 13, len: 0.07, width: 0.022, flake: false },
}

/**
 * Precipitation area and the height where drops over the interior stop: interior cells on a 0.5 m grid of the plot with
 * their chessboard distance to the outer edge (the hip roof rises with it, as in roof.ts).
 */
function regionOf(level: Level) {
  const all = level.rooms.length ? bounds(level.rooms) : { minX: -6, maxX: 6, minZ: -6, maxZ: 6 }
  const minX = all.minX - MARGIN
  const minZ = all.minZ - MARGIN
  const nx = Math.ceil((all.maxX - all.minX + MARGIN * 2) / CELL)
  const nz = Math.ceil((all.maxZ - all.minZ + MARGIN * 2) / CELL)
  const w = nx * CELL
  const d = nz * CELL
  const indoor = level.rooms.filter((r) => !isOutdoor(r)).flatMap(rectsOf)
  const dist = new Float32Array(nx * nz)
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const x = minX + (i + 0.5) * CELL
      const z = minZ + (j + 0.5) * CELL
      dist[j * nx + i] = indoor.some((q) => x > q.x && x < q.x + q.w && z > q.z && z < q.z + q.d) ? 1e6 : 0
    }
  const at = (i: number, j: number) => (i < 0 || j < 0 || i >= nx || j >= nz ? 0 : dist[j * nx + i])
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i
      if (dist[k]) dist[k] = Math.min(dist[k], at(i - 1, j) + 1, at(i - 1, j - 1) + 1, at(i, j - 1) + 1, at(i + 1, j - 1) + 1)
    }
  for (let j = nz - 1; j >= 0; j--)
    for (let i = nx - 1; i >= 0; i--) {
      const k = j * nx + i
      if (dist[k]) dist[k] = Math.min(dist[k], at(i + 1, j) + 1, at(i + 1, j + 1) + 1, at(i, j + 1) + 1, at(i - 1, j + 1) + 1)
    }
  return { minX, minZ, w, d, nx, nz, dist }
}
type Region = ReturnType<typeof regionOf>

/** Ground height texture (per cell): R wall top (roof lifted), G roof surface; both 0 outdoors */
function floorTexture(region: Region, style: 'tile' | 'concrete') {
  const data = new Float32Array(region.nx * region.nz * 2)
  for (let k = 0; k < region.nx * region.nz; k++) {
    const dc = region.dist[k]
    if (!dc) continue
    data[k * 2] = WALL_H + 0.05
    data[k * 2 + 1] = style === 'concrete' ? WALL_H + 0.25 : WALL_H + ROOF_LIFT + ROOF_PITCH * Math.min((dc - 0.5) * CELL, ROOF_MAX / ROOF_PITCH) + 0.05
  }
  const t = new THREE.DataTexture(data, region.nx, region.nz, THREE.RGFormat, THREE.FloatType)
  t.minFilter = t.magFilter = THREE.NearestFilter
  t.needsUpdate = true
  return t
}

function Precip({ kind, density, region, style, levelId, wind, night }: { kind: Kind; density: number; region: Region; style: 'tile' | 'concrete'; levelId: string; wind: [number, number]; night: boolean }) {
  const k = KIND[kind]
  const n = Math.min(k.cap, Math.round(region.w * region.d * k.perM2))
  const geo = useMemo(() => {
    const base = new THREE.PlaneGeometry(1, 1)
    if (!k.flake) base.translate(0, 0.5, 0)
    const g = new THREE.InstancedBufferGeometry()
    g.index = base.index
    g.setAttribute('position', base.getAttribute('position'))
    const seed = new Float32Array(n * 4)
    const rnd = lcg(1234567 + n)
    for (let i = 0; i < n * 4; i++) seed[i] = rnd()
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4))
    g.instanceCount = n
    return g
  }, [n, k.flake])
  useEffect(() => () => geo.dispose(), [geo])
  const floorTex = useMemo(() => floorTexture(region, style), [region, style])
  useEffect(() => () => floorTex.dispose(), [floorTex])
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        uniforms: {
          uTime: { value: 0 },
          uTop: { value: TOP },
          uSpeed: { value: k.speed },
          uLen: { value: k.len },
          uWidth: { value: k.width },
          uDensity: { value: 0 },
          uRoof: { value: 1 },
          uKind: { value: k.flake ? 1 : 0 },
          uWind: { value: new THREE.Vector2() },
          uRegion: { value: new THREE.Vector4() },
          uFloorBox: { value: new THREE.Vector4() },
          uFloor: { value: null },
          uColor: { value: new THREE.Color() },
          uOpacity: { value: 1 },
        },
      }),
    [k],
  )
  useEffect(() => () => mat.dispose(), [mat])
  useFrame(({ clock, camera }) => {
    // In walk mode the area surrounds the camera (rain in every direction), from above it surrounds the house
    const at = useView.getState().fps ? [camera.position.x - region.w / 2, camera.position.z - region.d / 2] : [region.minX, region.minZ]
    drive(mat, { time: clock.elapsedTime, density, roof: roofView.alpha[levelId] ?? 0, wind, region, at, kind, night, floor: floorTex })
  })
  useEffect(() => {
    weatherDebug[kind] = Math.round(n * density)
    return () => {
      weatherDebug[kind] = 0
    }
  }, [kind, n, density])
  return <mesh geometry={geo} material={mat} frustumCulled={false} renderOrder={12} raycast={() => {}} />
}

/** Uploads the frame's values to the GPU */
function drive(mat: THREE.ShaderMaterial, o: { time: number; density: number; roof: number; wind: [number, number]; region: Region; at: number[]; kind: Kind; night: boolean; floor: THREE.DataTexture }) {
  const u = mat.uniforms
  u.uFloor.value = o.floor
  u.uTime.value = o.time
  u.uDensity.value = o.density
  u.uRoof.value = o.roof
  u.uWind.value.set(o.wind[0], o.wind[1])
  u.uRegion.value.set(o.at[0], o.at[1], o.region.w, o.region.d)
  u.uFloorBox.value.set(o.region.minX, o.region.minZ, o.region.w, o.region.d)
  u.uColor.value.set(o.kind === 'rain' ? (o.night ? '#8ea2c8' : '#c5d3e8') : o.kind === 'hail' ? '#eef3f8' : '#ffffff')
  u.uOpacity.value = o.kind === 'rain' ? (o.night ? 0.45 : 0.6) : 0.95
}

const step = (cur: number, to: number, rate: number) => (Math.abs(to - cur) < 0.002 ? to : cur + (to - cur) * Math.min(1, rate))

export function Weather() {
  const invalidate = useThree((s) => s.invalidate)
  const pref = useWeatherPref()
  const entities = useHa((s) => s.entities)
  const weather = useMemo(() => currentWeather(entities, pref), [entities, pref])
  const level = useLayout((s) => activeLevel(s))
  const homeId = useLayout((s) => activeHomeId(s))
  const style = useView((s) => s.roofStyle[homeId] ?? 'tile')
  const lite = useView((s) => s.lite)
  const night = useNight()
  // The area is rebuilt only when rooms change (not on every frame while an item is dragged)
  const roomsSig = useLayout((s) => JSON.stringify(activeLevel(s)?.rooms.map((r) => [r.x, r.z, r.w, r.d, r.parts ?? null, isOutdoor(r)]) ?? []))
  const region = useMemo(
    () => (level ? regionOf(level) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [roomsSig, level?.id],
  )
  const f = weather.fx
  const wet = f.rain > 0 || f.snow > 0 || f.hail > 0
  useAmbient(wet || f.lightning)
  // Wind speed from the weather (rain drifts 0-5 m/s); direction from Home Assistant's wind_bearing relative to the plan's north (else from the north-west)
  const up = useLayout((s) => s.layout?.up ?? 0)
  const toward = weather.windBearing == null ? [0.87, 0.49] : [-Math.sin(((weather.windBearing - up) * Math.PI) / 180), Math.cos(((weather.windBearing - up) * Math.PI) / 180)]
  const wx = f.wind * 5 * toward[0]
  const wz = f.wind * 5 * toward[1]
  const wind = useMemo<[number, number]>(() => [wx, wz], [wx, wz])
  const flash = useRef({ next: 0, t0: -1 })
  const amb = useRef<THREE.AmbientLight>(null)

  useEffect(() => {
    weatherDebug.sky = weather.sky
    weatherDebug.preview = weather.preview
    weatherDebug.wind = f.wind
    weatherDebug.windVec = wind
    weatherDebug.drawn = wet && !lite
    if (!wet || lite) weatherDebug.rain = weatherDebug.snow = weatherDebug.hail = 0
    invalidate()
  }, [weather, f.wind, wind, wet, lite, invalidate])

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1)
    const L = weatherLight
    // A frame is requested only for a visible change (wetness and snow cover change slowly)
    const seen = () => `${L.cloud.toFixed(3)},${L.fog.toFixed(3)},${L.snow.toFixed(2)},${L.wet.toFixed(2)},${L.flash.toFixed(2)}`
    const before = seen()
    L.cloud = step(L.cloud, f.cloud, dt * 0.6)
    L.fog = step(L.fog, f.fog, dt * 0.6)
    // Snow cover builds up over 90 s and melts over 2 min; wetness comes in 20 s and dries in 1 min
    L.snow = Math.max(0, Math.min(1, L.snow + (f.snow > 0 ? (dt / 90) * f.snow : -dt / 120)))
    L.wet = Math.max(0, Math.min(1, L.wet + (f.rain > 0 ? (dt / 20) * f.rain : -dt / 60)))
    // Lightning: two or three short flashes; the thunder a little later
    const now = state.clock.elapsedTime
    const fl = flash.current
    if (f.lightning) {
      if (!fl.next) fl.next = now + 3 + Math.random() * 6
      if (now > fl.next) {
        fl.t0 = now
        fl.next = now + (weather.sky === 'storm' ? 6 + Math.random() * 14 : 10 + Math.random() * 18)
        weatherDebug.flashes += 1
        const b = region ? { x: region.minX - 25, z: region.minZ - 25 } : { x: -30, z: -30 }
        window.setTimeout(() => play('thunder', { x: b.x, y: 20, z: b.z }, { bus: 'nature', ref: 40 }), 700 + Math.random() * 1500)
      }
    } else fl.next = 0
    const a = fl.t0 < 0 ? 1 : now - fl.t0
    L.flash = a < 0.55 ? Math.max(0, 1 - Math.abs(a - 0.03) / 0.06, 0.7 - Math.abs(a - 0.18) / 0.07, 0.85 - Math.abs(a - 0.4) / 0.09) : 0
    if (amb.current) amb.current.intensity = L.flash * (night ? 2.2 : 1.6)
    if (before !== seen()) state.invalidate()
  })

  return (
    <>
      <ambientLight ref={amb} color="#e3e9ff" intensity={0} />
      {region && level && !lite && f.rain > 0 && <Precip kind="rain" density={f.rain} region={region} style={style} levelId={level.id} wind={wind} night={night} />}
      {region && level && !lite && f.snow > 0 && <Precip kind="snow" density={f.snow} region={region} style={style} levelId={level.id} wind={[wind[0] * 0.35, wind[1] * 0.35]} night={night} />}
      {region && level && !lite && f.hail > 0 && <Precip kind="hail" density={f.hail} region={region} style={style} levelId={level.id} wind={wind} night={night} />}
    </>
  )
}
