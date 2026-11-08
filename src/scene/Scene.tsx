import { AdaptiveDpr, CameraControls, CameraControlsImpl } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { SoundScape } from '@/audio/SoundScape'
import { useHa } from '@/ha/store'
import { activeLevel, FLOOR_H, useLayout } from '@/model/layoutStore'
import { usePlacement } from '@/model/placement'
import type { HassEntity } from '@/ha/types'
import type { Item, Level } from '@/model/types'
import { rectsOf } from '@/model/geometry'
import { setGridHoles } from '@/model/pets'
import { stairwellsOf } from '@/model/stairwell'
import { cameraApi, FOV, useView } from './camera'
import { CameraRig } from './CameraRig'
import { Ground, RoomHandles } from './EditLayer'
import { HomeFlight } from './HomeFlight'
import { QuickAnchor } from './QuickAnchor'
import { ItemNode } from './ItemNode'
import { C } from './kit/palette'
import { LabelProjector } from './LabelProjector'
import { Ghost } from './Ghost'
import { AMBIENT_FPS, ambientActive, ambientCount, markShadows, slowAmbientActive, registerInvalidate, sceneRef, takeShadowFrame } from './frame'
import { perf } from './perf'
import { AlarmFlash } from './AlarmFlash'
import { FpsControls } from './FpsControls'
import { ACTIVE_LEVEL, useFps } from './fps'
import { People } from './People'
import { Pets } from './Pets'
import { StreetLife } from './StreetLife'
import { computeRoomLights, setRoomLights } from './roomLights'
import { RoomMesh } from './RoomMesh'
import { Roofs } from './Roofs'
import { daylight, lightDebug, sunDirection, sunOf, sunStrength, sunWarmth, type RealSun } from './sun'
import { useNight } from './useNight'
import { Weather } from './Weather'
import { weatherLight } from './weatherState'

// Stairwells on upper floors are blocked in the walking grid of people and pets (model/pets.ts, model/stairwell.ts)
setGridHoles((level) => stairwellsOf(useLayout.getState().layout?.levels ?? [], level).map((w) => w.r))

/*
 * Performance:
 * - frameloop="demand": the idle scene is never drawn; it is drawn on camera moves, changes or animations.
 * - The shadow map only when the scene changes (ShadowManager), not while the camera turns.
 * - Resolution at most 1.5x; it drops temporarily while the camera moves (AdaptiveDpr + regress).
 * - Recordings (tools/promo-video.mjs) set `homescape-capture` in local storage: 2x all the time, no drop while moving.
 * - Ambient animations at 24 fps (AmbientTicker).
 * - Lite mode: no shadows, no ambient animations, 1x resolution.
 * - Lamps are room lights (roomLights.ts), not three.js point lights: cheap in numbers and they do not pass through walls.
 */

/** Registers R3F's invalidate so the UI (labels) and the frame.ts helpers can request frames. */
function FrameRegistrar() {
  const invalidate = useThree((s) => s.invalidate)
  const scene = useThree((s) => s.scene)
  useEffect(() => {
    registerInvalidate(invalidate)
    sceneRef.scene = scene
    return () => {
      registerInvalidate(null)
      sceneRef.scene = null
    }
  }, [invalidate, scene])
  return null
}

/** The shadow map is redrawn only on request, not every frame. */
function ShadowManager() {
  const get = useThree((s) => s.get)
  useEffect(() => {
    const { shadowMap } = get().gl
    shadowMap.autoUpdate = false
    markShadows(12) // while items settle on startup
    // Refresh the shadows when the plan, theme, floor or HA states change.
    const offLayout = useLayout.subscribe((s, p) => {
      if (s.layout !== p.layout || s.theme !== p.theme || s.levelId !== p.levelId) markShadows(3)
    })
    const offHa = useHa.subscribe((s, p) => {
      if (s.entities !== p.entities) markShadows(2)
    })
    const offView = useView.subscribe((s, p) => {
      if (s.plan !== p.plan) markShadows(3)
    })
    return () => {
      offLayout()
      offHa()
      offView()
      shadowMap.autoUpdate = true
    }
  }, [get])
  useFrame(({ gl }) => {
    if (!takeShadowFrame()) return
    gl.shadowMap.needsUpdate = true
    perf.shadowUpdates += 1
  })
  return null
}

/** While an ambient animation runs (AC, diffuser, motion wave...) requests AMBIENT_FPS frames per second; not while the tab is hidden. */
function AmbientTicker() {
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    let tick = 0
    const t = setInterval(() => {
      tick += 1
      if (document.hidden) return
      // Every tick when a fast animation runs, every second tick when only slow ones (fish) do.
      if (ambientActive() || (slowAmbientActive() && tick % 2 === 0)) invalidate()
    }, 1000 / AMBIENT_FPS)
    return () => clearInterval(t)
  }, [invalidate])
  return null
}

/** Updates the counters on every drawn frame (values of the previous frame; info is reset on every render). */
function PerfProbe() {
  useFrame(({ gl }) => {
    perf.frames += 1
    perf.calls = gl.info.render.calls
    perf.triangles = gl.info.render.triangles
    perf.geometries = gl.info.memory.geometries
    perf.textures = gl.info.memory.textures
    perf.programs = gl.info.programs?.length ?? 0
    perf.ambient = ambientCount()
  })
  return null
}

function ReadyFlag() {
  const frames = useRef(0)
  useFrame(({ invalidate }) => {
    if (frames.current > 4) return
    frames.current += 1
    if (frames.current === 4) document.body.dataset.ready = '1'
    else invalidate()
  })
  return null
}

/** Day and night values of ambient light, sky and fog; a transition blends smoothly between them. */
const SKY = {
  day: { hemiSky: '#ffffff', hemiGround: '#c6cbea', hemi: 1.25, sun: '#ffffff', sunI: 2.2, sunPos: [9, 16, 11], bg: C.sky },
  night: { hemiSky: '#6f7fe0', hemiGround: '#141936', hemi: 0.55, sun: '#a9b8ff', sunI: 0.6, sunPos: [-8, 18, 10], bg: C.skyNight },
} as const
/**
 * Real sun in walk mode (the ceiling blocks the sun from above, so it comes through windows and doors at the sun's
 * angle): skylight (hemisphere) dim inside, bright outside (the eye adapts); the sun is orange when low; warm light
 * bounced from the floor of the home.
 */
const REAL = {
  hemiSky: '#dfe8ff',
  hemiGround: '#b9b0a3',
  indoor: 0.6,
  outdoor: 1,
  sunLow: '#ffb26e',
  sunHigh: '#fff4e6',
  sunI: 3,
  skyTop: '#78a2de',
  horizon: '#dfe7f2',
  horizonWarm: '#f1cfae',
}
/**
 * Distance of the sun light from the center of the home in walk mode: at least 45 m, 10 m more than the floor's radius.
 * If the light sat inside the floor, walls and ceilings on its sun side would be in front of the shadow camera and cast
 * no shadow, so sun leaked into closed rooms (with a large garden or a spread out plan).
 */
/** In overcast weather the sky (background and fog color) shifts towards this color; it flashes white for a moment on lightning */
const OVERCAST = { day: '#b9bfcc', night: '#1b2033', flash: '#dfe5ff' }
const sunDist = (r: number) => Math.max(45, r + 10)
const _a = new THREE.Color()
const _b = new THREE.Color()
const _d = new THREE.Color()
const _r = new THREE.Color()
const mixColor = (out: THREE.Color, a: string, b: string, t: number) => out.copy(_a.set(a)).lerp(_b.set(b), t)

/**
 * Real sun in walk mode: HA sun.sun (approximated from the clock without it), by the plan orientation (Layout.up). With
 * the day theme selected after sunset, an afternoon sun. null outside walk mode (the bird's eye view keeps a fixed, bright sun).
 */
function useRealSun(): RealSun | null {
  const fps = useView((s) => s.fps)
  const theme = useLayout((s) => s.theme)
  const up = useLayout((s) => s.layout?.up ?? 0)
  const sunE = useHa((s) => s.entities['sun.sun'])
  // Computed from the clock when sun.sun gives no azimuth: refreshed every minute
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!fps) return
    const id = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(id)
  }, [fps])
  return useMemo(() => {
    if (!fps) return null
    let pos = sunOf(sunE, now)
    if (theme === 'day' && pos.elevation < 8) pos = { azimuth: 215, elevation: 38 }
    return { pos, dir: sunDirection(pos, up), level: daylight(pos.elevation), strength: sunStrength(pos.elevation), warmth: sunWarmth(pos.elevation) }
  }, [fps, theme, up, sunE, now])
}

/** Center of the floor and the radius covering it (at any sun angle): the shadow camera fits to it in walk mode. */
function levelBounds(level: Level | null) {
  const rs = (level?.rooms ?? []).flatMap(rectsOf)
  if (!rs.length) return { x: 0, z: 0, r: 16 }
  const minX = Math.min(...rs.map((q) => q.x))
  const maxX = Math.max(...rs.map((q) => q.x + q.w))
  const minZ = Math.min(...rs.map((q) => q.z))
  const maxZ = Math.max(...rs.map((q) => q.z + q.d))
  return { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, r: Math.hypot(maxX - minX, maxZ - minZ) / 2 + 3 }
}

/**
 * A single light rig (no separate lights for night and day): with two rigs, switching from night to day did not remove
 * the old rig cleanly and the scene stayed gray and dim. Colors, intensities, sun position, sky and fog blend from one to
 * the other in 0.6 s; frames and shadow updates are requested until it finishes. In walk mode (real) the sun is at its
 * true angle and aims at the center of the home, the shadow camera covers the home; ceilings cast shadows, so the sun
 * only enters through windows and doors.
 */
function Lights({ night, shadows, real }: { night: boolean; shadows: boolean; real: RealSun | null }) {
  const hemi = useRef<THREE.HemisphereLight>(null)
  const sun = useRef<THREE.DirectionalLight>(null)
  const get = useThree((s) => s.get)
  const invalidate = useThree((s) => s.invalidate)
  const level = useLayout((s) => activeLevel(s))
  const bounds = useMemo(() => levelBounds(level), [level])
  const indoor = useFps((s) => s.indoor)
  const k = useRef(night ? 1 : 0)
  // Walk mode blend (0 bird's eye, 1 walk) and being indoors (eye adaptation)
  const f = useRef(real ? 1 : 0)
  const ind = useRef(1)
  const shown = useRef('')
  // Shadow map only when the sun position changes (weather only changes the intensity)
  const shownBase = useRef('')
  // Last real sun used (while leaving walk mode, until the blend finishes)
  const lastReal = useRef<RealSun | null>(null)
  // Radius the shadow camera last fit to (-1 in the bird's eye view): it refits when the plan grows or shrinks too
  const wide = useRef<number | null>(null)
  useEffect(() => {
    const { scene } = get()
    scene.background = new THREE.Color()
    scene.fog = new THREE.Fog('#000000', 45, 130)
    shown.current = ''
    shownBase.current = ''
    invalidate()
    return () => {
      scene.background = null
      scene.fog = null
    }
  }, [get, invalidate])
  useEffect(() => {
    shown.current = ''
    shownBase.current = ''
    invalidate()
  }, [night, real, indoor, bounds, invalidate])
  useFrame((state, dt) => {
    const step = (cur: number, to: number) => (Math.abs(to - cur) < 0.003 ? to : cur + (to - cur) * Math.min(1, dt * 6))
    k.current = step(k.current, night ? 1 : 0)
    f.current = step(f.current, real ? 1 : 0)
    ind.current = step(ind.current, indoor ? 1 : 0)
    // Weather (scene/Weather.tsx writes it smoothly): clouds dim the sun and gray the sky; lightning flashes the sky white for a moment
    const W = weatherLight
    const base = `${k.current},${f.current},${ind.current}`
    const sig = `${base},${W.cloud.toFixed(3)},${W.fog.toFixed(3)},${W.flash.toFixed(2)}`
    if (shown.current === sig) return
    shown.current = sig
    const t = k.current
    const g = f.current
    if (real) lastReal.current = real
    const R = lastReal.current
    perf.skyBlend = t
    const D = SKY.day
    const N = SKY.night
    // Day: between the bird's eye fixed sun and the walk mode real sun (g), then with night (t)
    const realHemi = R ? THREE.MathUtils.lerp(REAL.outdoor, REAL.indoor, ind.current) * (0.3 + 0.7 * R.level) : D.hemi
    if (hemi.current) {
      mixColor(hemi.current.color, D.hemiSky, REAL.hemiSky, g).lerp(_d.set(N.hemiSky), t)
      mixColor(hemi.current.groundColor, D.hemiGround, REAL.hemiGround, g).lerp(_d.set(N.hemiGround), t)
      hemi.current.intensity = THREE.MathUtils.lerp(THREE.MathUtils.lerp(D.hemi, realHemi, g), N.hemi, t) * (1 - 0.15 * W.cloud)
    }
    const cx = bounds.x * g
    const cz = bounds.z * g
    if (sun.current) {
      const realCol = R ? mixColor(_r, REAL.sunLow, REAL.sunHigh, R.warmth) : _r.set(D.sun)
      sun.current.color.copy(_d.set(D.sun).lerp(realCol, g)).lerp(_a.set(N.sun), t)
      sun.current.intensity = THREE.MathUtils.lerp(THREE.MathUtils.lerp(D.sunI, REAL.sunI * (R?.strength ?? 1), g), N.sunI, t) * (1 - 0.7 * W.cloud)
      const dayPos = D.sunPos.map((v, i) => {
        const real = R ? (i === 1 ? R.dir[1] * sunDist(bounds.r) : [bounds.x, 0, bounds.z][i] + R.dir[i] * sunDist(bounds.r)) : v
        return THREE.MathUtils.lerp(v, real, g)
      })
      sun.current.position.set(...(dayPos.map((v, i) => THREE.MathUtils.lerp(v, N.sunPos[i] + [cx, 0, cz][i], t)) as [number, number, number]))
      sun.current.target.position.set(cx, 0, cz)
      sun.current.target.updateMatrixWorld()
      // Shadow camera: fixed in the bird's eye view, covers the home from any angle in walk mode
      const fit = g > 0.5
      if (wide.current !== (fit ? bounds.r : -1)) {
        wide.current = fit ? bounds.r : -1
        const cam = sun.current.shadow.camera
        const r = fit ? bounds.r : 0
        cam.left = fit ? -r : -16
        cam.right = fit ? r : 16
        cam.top = fit ? r : 14
        cam.bottom = fit ? -r : -14
        cam.far = fit ? sunDist(r) + r + 10 : 70
        cam.updateProjectionMatrix()
      }
      lightDebug.sunDir = sun.current.position.clone().sub(sun.current.target.position).normalize().toArray()
      lightDebug.sunI = sun.current.intensity
    }
    lightDebug.hemiI = hemi.current?.intensity ?? 0
    lightDebug.fps = g
    lightDebug.indoor = ind.current
    const { scene } = state
    // Horizon color in walk mode (lower edge of the sky dome): the distant ground blends into the horizon through the fog
    const horizon = R ? mixColor(_r, REAL.horizonWarm, REAL.horizon, R.warmth) : _r.set(D.bg)
    const bg = _d.set(D.bg).lerp(horizon, g).lerp(_a.set(N.bg), t)
    bg.lerp(mixColor(_r, OVERCAST.day, OVERCAST.night, t), Math.min(1, W.cloud * 0.6 + W.fog * 0.4))
    if (W.flash > 0) bg.lerp(_a.set(OVERCAST.flash), W.flash * 0.55)
    if (scene.background instanceof THREE.Color) scene.background.copy(bg)
    if (scene.fog) scene.fog.color.copy(bg)
    if (shownBase.current !== base) {
      shownBase.current = base
      markShadows(1)
    }
    if (base !== `${night ? 1 : 0},${real ? 1 : 0},${indoor ? 1 : 0}`) state.invalidate()
  })
  return (
    <>
      <hemisphereLight ref={hemi} />
      <directionalLight
        ref={sun}
        castShadow={shadows}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
        shadow-camera-left={-16}
        shadow-camera-right={16}
        shadow-camera-top={14}
        shadow-camera-bottom={-14}
        shadow-camera-near={1}
        shadow-camera-far={70}
      />
      {real && !night && <SkyDome sun={real} at={bounds} />}
      {real && !night && real.pos.elevation > -1 && <SunDisc dir={real.dir} at={bounds} warmth={real.warmth} />}
    </>
  )
}

/**
 * In the bird's eye view the fog range scales with the camera's distance to its target. A fixed 45-130 m suits a small
 * home (seen from 26-30 m on desktop), but a large home seen from 87 m was half fogged and pale, and its plan view
 * (142 m) showed little more than labels. When the camera is closer to the target than `ref` (32 m) the range stays as is
 * (a small home is unchanged); farther away it grows in proportion, so the area around the target never fogs. The far
 * limit ends before the camera's far plane: the ground edge and the clipping line disappear in the fog. No fog in the
 * plan view (top down): the ground has the same depth everywhere and fog would only wash it out. Walk mode keeps the
 * fixed range (horizon).
 */
const FOG = { near: 45, far: 130, ref: 32 }
function FogRange() {
  useFrame(({ scene, camera, controls }) => {
    const fog = scene.fog
    if (!(fog instanceof THREE.Fog)) return
    const { plan, fps } = useView.getState()
    const clip = (camera as THREE.PerspectiveCamera).far
    if (fps) {
      fog.near = FOG.near
      fog.far = FOG.far
    } else if (plan) {
      // Depth never passes the far plane: the fog is invisible (it is not removed; removing it recompiles every material)
      fog.near = clip * 2
      fog.far = clip * 3
    } else {
      const d = (controls as unknown as CameraControlsImpl | null)?.distance ?? 0
      const s = Math.max(1, d / FOG.ref)
      fog.far = Math.min(FOG.far * s, clip * 0.92)
      fog.near = Math.min(FOG.near * s, fog.far * 0.9)
    }
    // In foggy weather the fog comes closer (not in the plan view)
    const wf = weatherLight.fog
    if (wf > 0 && !plan) {
      fog.far *= 1 - 0.7 * wf
      fog.near *= 1 - 0.9 * wf
    }
    lightDebug.fog = [fog.near, fog.far]
  })
  return null
}

/**
 * Sky dome in walk mode: blue at the zenith, light at the horizon (warm when the sun is low), a glow around the sun;
 * below the horizon it fades to the ground color. Not in the bird's eye view (the flat background color stays). No fog or
 * tone mapping, writes no depth, drawn first.
 */
const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize( position );
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`
const SKY_FRAG = /* glsl */ `
uniform vec3 top;
uniform vec3 horizon;
uniform vec3 ground;
uniform vec3 sunDir;
uniform vec3 sunCol;
uniform vec3 grey;
uniform float cover;
varying vec3 vDir;
void main() {
  vec3 d = normalize( vDir );
  vec3 c = d.y > 0.0 ? mix( horizon, top, pow( d.y, 0.55 ) ) : mix( horizon, ground, min( 1.0, - d.y * 5.0 ) );
  float s = max( dot( d, sunDir ), 0.0 );
  c += sunCol * ( pow( s, 48.0 ) * 0.5 + pow( s, 5.0 ) * 0.12 ) * ( 1.0 - cover );
  if ( d.y > 0.0 ) c = mix( c, grey, cover );
  gl_FragColor = vec4( c, 1.0 );
}`
const srgb = (hex: string) => new THREE.Color(hex).convertLinearToSRGB()
function SkyDome({ sun, at }: { sun: RealSun; at: { x: number; z: number } }) {
  const invalidate = useThree((s) => s.invalidate)
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        uniforms: {
          top: { value: new THREE.Color() },
          horizon: { value: new THREE.Color() },
          ground: { value: new THREE.Color() },
          sunDir: { value: new THREE.Vector3() },
          sunCol: { value: new THREE.Color() },
          grey: { value: new THREE.Color() },
          cover: { value: 0 },
        },
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      }),
    [],
  )
  useEffect(() => () => material.dispose(), [material])
  useEffect(() => {
    const u = material.uniforms
    // The sky brightens with daylight and darkens at twilight
    const k = 0.35 + 0.65 * sun.level
    u.top.value.copy(srgb(REAL.skyTop)).multiplyScalar(k)
    u.horizon.value.copy(srgb(REAL.horizonWarm).lerp(srgb(REAL.horizon), sun.warmth)).multiplyScalar(k)
    u.ground.value.copy(srgb('#a7ae98')).multiplyScalar(k)
    u.sunDir.value.set(...sun.dir)
    u.sunCol.value.copy(srgb('#fff1d6')).multiplyScalar(sun.strength)
    u.grey.value.copy(srgb(OVERCAST.day)).multiplyScalar(k)
    invalidate()
  }, [material, sun, invalidate])
  // In cloudy weather the sky turns gray and the sun glow fades (the weather changes smoothly: every frame)
  useFrame(() => cover(material, weatherLight.cloud * 0.85 + weatherLight.fog * 0.15))
  return (
    <mesh position={[at.x, 0, at.z]} material={material} renderOrder={-10} frustumCulled={false} raycast={() => null}>
      <sphereGeometry args={[240, 32, 16]} />
    </mesh>
  )
}

function cover(m: THREE.ShaderMaterial, v: number) {
  m.uniforms.cover.value = Math.min(1, v)
}

/** The sun in the sky in walk mode: a bright disc seen through windows and outdoors (no fog or tone mapping). */
function SunDisc({ dir, at, warmth }: { dir: [number, number, number]; at: { x: number; z: number }; warmth: number }) {
  const color = useMemo(() => mixColor(new THREE.Color(), '#ffc58a', '#fffaf0', warmth), [warmth])
  const ref = useRef<THREE.Mesh>(null)
  // The sun is hidden in overcast weather
  useFrame(() => {
    if (ref.current) ref.current.visible = weatherLight.cloud < 0.6
  })
  return (
    <mesh ref={ref} position={[at.x + dir[0] * 180, dir[1] * 180, at.z + dir[2] * 180]} raycast={() => null}>
      <sphereGeometry args={[3.2, 24, 12]} />
      <meshBasicMaterial color={color} fog={false} toneMapped={false} />
    </mesh>
  )
}

/** Computes the room lights from the lamps that are on (when the plan, HA state or day/night changes); daylight too in walk mode. */
function RoomLightSync({ night, real }: { night: boolean; real: RealSun | null }) {
  const level = useLayout((s) => activeLevel(s))
  const entities = useHa((s) => s.entities)
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    const sky = real && !night ? { level: real.level, sun: real.dir, strength: real.strength } : undefined
    setRoomLights(level ? computeRoomLights(level, entities, night, sky) : [])
    invalidate()
  }, [level, entities, night, real, invalidate])
  return null
}

const NONE: HassEntity[] = []
/** Extra linked entities; a constant empty array for items without extras (so Visual is not recomputed). */
const relatedOf = (it: Item, entities: Record<string, HassEntity>) =>
  it.extras?.length ? it.extras.map((id) => entities[id]).filter((e): e is HassEntity => Boolean(e)) : NONE

/**
 * Floors: the active floor at y = 0, the others a floor height below or above it. In view mode the active floor and (when
 * the setting is on) the ground and upper floors below it ("show lower floors below"); a basement counts as underground.
 * In first person walk mode all floors (from outside the two storey home with its roof, the upper floor through the
 * stairwell). Every floor is drawn with the same components (RoomMesh, ItemNode); an inactive one only gets the `still`
 * flag: a floor change (on the stairs in walk mode) rebuilds nothing, only the group heights and the flag change (drawing
 * lower floors with separate components rebuilt hundreds of items on every switch and froze walk mode). The active floor's
 * group is named `level-active` (aiming in walk mode only looks at it).
 */
function Levels({ night }: { night: boolean }) {
  const layout = useLayout((s) => s.layout)
  const level = useLayout((s) => activeLevel(s))
  const lower = useView((s) => s.lowerFloors)
  const fps = useView((s) => s.fps)
  const entities = useHa((s) => s.entities)
  if (!layout || !level) return null
  const e0 = level.elevation ?? 0
  const shown = layout.levels.filter((l) => {
    const e = l.elevation ?? 0
    return l.id === level.id || fps || (lower && e < e0 && e >= 0)
  })
  return (
    <>
      {shown.map((l) => {
        const active = l.id === level.id
        return (
          <group key={l.id} name={active ? ACTIVE_LEVEL : undefined} position-y={((l.elevation ?? 0) - e0) * FLOOR_H}>
            {l.rooms.map((r) => (
              <RoomMesh key={r.id} room={r} rooms={l.rooms} level={active ? undefined : l} still={!active} />
            ))}
            {l.items.map((it) => (
              <ItemNode
                key={it.id}
                item={it}
                entity={it.entityId ? entities[it.entityId] : undefined}
                related={relatedOf(it, entities)}
                night={night}
                levelId={l.id}
                still={!active}
              />
            ))}
          </group>
        )
      })}
    </>
  )
}

function Contents() {
  const level = useLayout((s) => activeLevel(s))
  const night = useNight()
  const lite = useView((s) => s.lite)
  const real = useRealSun()
  // On an upper floor the ground plane drops to the ground floor level (so lower floors show)
  const lower = useView((s) => s.lowerFloors)
  const fps = useView((s) => s.fps)
  const groundY = lower || fps ? -Math.max(0, level?.elevation ?? 0) * FLOOR_H : 0

  if (!level) return null
  return (
    <>
      <Lights night={night} shadows={!lite} real={real} />
      <FogRange />
      <Weather />
      <RoomLightSync night={night} real={real} />
      <AlarmFlash />
      <People />
      <Pets />
      <StreetLife />
      <SoundScape />
      <Ground night={night} y={groundY} />
      <Levels night={night} />
      <Roofs />
      <RoomHandles />
      <Ghost />
    </>
  )
}

/** The cursor turns into a crosshair while drawing a room or placing. */
function ToolGuard() {
  const tool = useLayout((s) => s.tool)
  const mode = useLayout((s) => s.mode)
  const placing = usePlacement((s) => Boolean(s.target))
  useEffect(() => {
    document.body.style.cursor = placing || (mode === 'edit' && tool !== 'select') ? 'crosshair' : ''
  }, [tool, mode, placing])
  return null
}

/*
 * Game-like controls: left drag rotates or pans (left drag setting, camera.ts > mapButtons; panning moves like a map in
 * the ground plane), right or middle drag does the other, the wheel zooms towards the cursor. Space + left drag pans.
 * While placing or drawing a room the left button belongs to the scene; the camera only uses the right button and the
 * wheel. Touch: one finger acts like the left button, two fingers zoom and do the rest.
 */
/**
 * Must sit inside the Canvas, AFTER CameraRig: applies the mapping once the controls are registered.
 * (An effect outside the Canvas runs before the children mount and the mapping is never applied.)
 */
function ButtonMap() {
  const c = useThree((s) => s.controls)
  const gl = useThree((s) => s.gl)
  const panKey = useView((s) => s.panKey)
  const rotateKey = useView((s) => s.rotateKey)
  const leftDrag = useView((s) => s.leftDrag)
  const placing = usePlacement((s) => Boolean(s.target))
  const drawing = useLayout((s) => s.mode === 'edit' && s.tool !== 'select')
  useEffect(() => {
    // Space always pans; ⌥/⇧ rotates (while placing ⇧ means "place repeatedly", so they must not mix).
    const left = panKey ? 'pan' : rotateKey && !placing ? 'rotate' : placing || drawing ? 'none' : leftDrag
    cameraApi.mapButtons(left, leftDrag, CameraControlsImpl.ACTION)
  }, [c, panKey, rotateKey, leftDrag, placing, drawing])

  // Trackpad: a two-finger horizontal swipe rotates (vertical scroll and pinch zoom).
  useEffect(() => {
    const el = gl.domElement
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaX) < 1 || Math.abs(e.deltaX) < Math.abs(e.deltaY) * 1.2) return
      cameraApi.rotateBy(-e.deltaX * 0.006)
    }
    el.addEventListener('wheel', onWheel, { passive: true })
    return () => el.removeEventListener('wheel', onWheel)
  }, [gl])
  return null
}

/** Recording a video (local storage `homescape-capture`): sharp frames matter, the frame rate does not */
const CAPTURE = (() => {
  try {
    return localStorage.getItem('homescape-capture') === '1'
  } catch {
    return false
  }
})()

export default function Scene() {
  const plan = useView((s) => s.plan)
  const lite = useView((s) => s.lite)
  // In first person walk mode the orbit camera is removed and FpsControls drives the camera
  const fps = useView((s) => s.fps)
  // At most 1.5x instead of 2x on Retina screens: nearly halves the pixel count, the difference is hard to see.
  const dpr: [number, number] = CAPTURE ? [2, 2] : lite ? [1, 1] : [1, 1.5]

  return (
    <Canvas
      // Lite mode changes the shadow setting, so the canvas is rebuilt (materials are recompiled).
      key={lite ? 'lite' : 'full'}
      frameloop="demand"
      shadows={lite ? false : 'percentage'}
      dpr={dpr}
      performance={{ min: 0.6, debounce: 250 }}
      camera={{ position: [12, 16, 15], fov: FOV, near: 0.3, far: 400 }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.NeutralToneMapping
        gl.toneMappingExposure = 1
      }}
    >
      <Contents />
      {!fps && (
        <CameraControls
          makeDefault
          minDistance={3}
          maxDistance={90}
          minPolarAngle={plan ? 0 : 0.25}
          maxPolarAngle={plan ? 0.02 : 1.25}
          azimuthRotateSpeed={0.6}
          polarRotateSpeed={0.6}
          smoothTime={0.45}
          dollyToCursor
          regress={!CAPTURE}
        />
      )}
      <FpsControls />
      {!CAPTURE && <AdaptiveDpr />}
      <FrameRegistrar />
      {!lite && <ShadowManager />}
      <AmbientTicker />
      <CameraRig />
      <HomeFlight />
      <QuickAnchor />
      <ButtonMap />
      <LabelProjector />
      <ToolGuard />
      <ReadyFlag />
      <PerfProbe />
    </Canvas>
  )
}
