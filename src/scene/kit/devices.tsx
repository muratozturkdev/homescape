import { Billboard } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { deviceClass, domainOf, friendlyName, isActive, lightColor, lightLevel, num } from '@/ha/derive'
import { isSocketEntity, SOCKET_DOMAINS, socketCount } from '@/model/bindings'
import { BEAM, consoleModel, STRIP_PITCH, STRIP_WALL_Y, stripWidth, WINDOW_BOTTOM, windowSize } from '@/model/catalog'
import { APERTURE_INSET, inRoom, roomAt, WALL_CUT_H, WALL_H, WALL_IN, WALL_INNER_H, wallRuns, type Side } from '@/model/geometry'
import { roofView } from '../camera'
import { activeLevel, useLayout } from '@/model/layoutStore'
import type { Room } from '@/model/types'
import { useView } from '../camera'
import { doorKey, useDoorTraffic } from '../doorTraffic'
import { markShadows } from '../frame'
import { Airflow, Glow, Mist, MusicNotes, Ripple, Spin, StripGlow, useAmbient, useEased, useLitMaterial, Wash } from './effects'
import { C } from './palette'
import { bandGlowTexture, glowTexture, siriTexture, softRectTexture, woodGrainTexture } from './textures'
import { Ball, Box, Cyl, mat } from './primitives'
import { gainOf, monitorOn, type Visual } from './visual'
import { useFilm } from './film'
import { useScreen } from './screens'

/*
 * Lights, devices, sensors, doors and windows. All built in code, all showing their state.
 * Local convention: origin at the base center on the floor, front at +z, wall items have their back at -z.
 * Exception ledStrip: its origin is the strip itself (the height comes from ItemNode).
 */

type P = { v: Visual }
const DIM = '#9aa0b8'

/* ---------- lights ---------- */

export function Pendant({ v }: P) {
  const bulb = useLitMaterial(C.offWhite, v.on, v.color, v.level)
  return (
    <group>
      <Cyl r={0.08} h={0.04} position={[0, 2.58, 0]} color={C.white} shadow={false} />
      <Cyl r={0.008} h={0.5} position={[0, 2.33, 0]} color={C.ink} shadow={false} />
      <Cyl r={0.34} rTop={0.12} h={0.24} position={[0, 2.0, 0]} color={v.unavailable ? DIM : C.white} />
      <Ball r={0.09} position={[0, 1.88, 0]} material={bulb} shadow={false} />
    </group>
  )
}

export function FloorLamp({ v }: P) {
  const shade = useLitMaterial(C.sunPale, v.on, v.color, v.level, 0.9)
  return (
    <group>
      <Cyl r={0.17} h={0.04} position={[0, 0.02, 0]} color={C.ink} />
      <Cyl r={0.02} h={1.48} position={[0, 0.76, 0]} color={C.ink} />
      <Cyl r={0.26} rTop={0.16} h={0.3} position={[0, 1.6, 0]} material={shade} />
    </group>
  )
}

export function DeskLamp({ v }: P) {
  const head = useLitMaterial(C.sun, v.on, v.color, v.level, 1)
  return (
    <group>
      <Cyl r={0.08} h={0.025} position={[0, 0.012, 0]} color={C.ink} />
      <Cyl r={0.012} h={0.32} position={[0, 0.17, -0.02]} rotation={[0.25, 0, 0]} color={C.ink} shadow={false} />
      <Cyl r={0.09} rTop={0.04} h={0.12} position={[0, 0.33, 0.06]} rotation={[0.6, 0, 0]} material={head} />
    </group>
  )
}

export function WallLight({ v }: P) {
  const shade = useLitMaterial(C.white, v.on, v.color, v.level, 1.2)
  return (
    <group>
      <Box size={[0.14, 0.2, 0.03]} position={[0, 1.95, -0.08]} color={C.steel} shadow={false} />
      <Cyl r={0.13} rTop={0.08} h={0.18} position={[0, 2.0, 0.02]} material={shade} />
    </group>
  )
}

/**
 * Wall LED strip (2 m): the strip itself glows continuously, its light spreads down and up the wall (wall face at local
 * z -0.11). The line light that lights the room along the strip is in roomLights.ts.
 */
export function LedStrip({ v }: P) {
  const strip = useLitMaterial(C.steel, v.on, v.color, v.level, 2.2)
  return (
    <group>
      <Box size={[2, 0.035, 0.035]} position={[0, 0, -0.06]} material={strip} shadow={false} />
      {v.on && (
        <>
          <StripGlow length={2} width={0.08} position={[0, 0, -0.05]} color={v.color} opacity={v.level * (v.night ? 0.9 : 0.45)} />
          <Wash length={2.2} depth={0.7} position={[0, -0.35, -0.105]} color={v.color} opacity={v.level * (v.night ? 0.55 : 0.25)} />
          <Wash length={2.2} depth={0.5} position={[0, 0.25, -0.105]} rotation={[0, 0, Math.PI]} color={v.color} opacity={v.level * (v.night ? 0.45 : 0.2)} />
        </>
      )}
    </group>
  )
}

/** Downlight: small ring in the ceiling; when on, the lens glows and a faint light cone falls downward. */
export function Downlight({ v }: P) {
  const lens = useLitMaterial(C.offWhite, v.on, v.color, v.level, 2)
  const cone = useMemo(
    // The beam fades as the angle widens (light spreads) and gets stronger when narrow
    () => new THREE.MeshBasicMaterial({ color: v.color, transparent: true, opacity: 0.07 * v.level * (v.night ? 1.6 : 1) * Math.min(1.4, Math.pow(BEAM.def / (v.opts.beam ?? BEAM.def), 0.8)), depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    [v.color, v.level, v.night, v.opts.beam],
  )
  return (
    <group>
      <Cyl r={0.075} h={0.02} position={[0, 2.59, 0]} color={C.white} segments={20} shadow={false} />
      <Cyl r={0.05} h={0.012} position={[0, 2.576, 0]} material={lens} segments={20} shadow={false} />
      {/* The visible beam widens with the beam angle (Item.beam; 0.7 m base at 90°). No beam when set to omnidirectional. */}
      {v.on && v.opts.variant !== 'omni' && (
        <mesh position={[0, 1.3, 0]} material={cone} renderOrder={9}>
          <coneGeometry args={[2.5 * Math.tan(((v.opts.beam ?? BEAM.def) / 2) * 0.35 * (Math.PI / 180)), 2.5, 24, 1, true]} />
        </mesh>
      )}
    </group>
  )
}

/** Direction a wall faces out of the room (wallRuns side): the strip is pulled the opposite way, into the room. */
const OUT_SIDE: Record<Side, number> = { back: -1, front: 1, left: -1, right: 1 }
/** Distance of the strip from the inner wall face, and its height below the ceiling */
const STRIP_IN = WALL_IN + 0.035
const STRIP_Y = WALL_H - 0.08

/** Strip segments: along each wall run of the room, joined at corners (shorter at outer corners, longer at inner ones). */
function stripSegments(room: Room, rooms: Room[]) {
  return wallRuns(room, rooms).map((r) => {
    const fixed = r.line - OUT_SIDE[r.side] * STRIP_IN
    const end = (a: number, dir: number) => {
      const probe = a + dir * (STRIP_IN + 0.02)
      const inside = r.horizontal ? inRoom(room, probe, fixed) : inRoom(room, fixed, probe)
      return a + dir * (inside ? STRIP_IN : -STRIP_IN)
    }
    const a0 = end(r.a0, -1)
    const a1 = end(r.a1, 1)
    return { horizontal: r.horizontal, fixed, a0, a1, side: r.side, interior: r.interior }
  })
}

/**
 * Ceiling LED strip: runs along ALL walls of its room just below the ceiling (follows L, T and U shaped rooms too and
 * adapts by itself when the room is resized). The light that lights the room from above is in roomLights.ts (kind 2).
 * The strip on a lowered wall is hidden (outer wall facing the camera, low interior wall, plan view) so it does not float.
 * In the placement ghost and in thumbnails the room is unknown, so a len × len2 rectangle is drawn.
 */
export function CeilingStrip({ v }: P) {
  const rooms = useLayout((s) => activeLevel(s)?.rooms)
  const at = v.at
  const room = at && rooms ? roomAt(rooms, at.x, at.z) : undefined
  const segs = useMemo(() => (room && rooms ? stripSegments(room, rooms) : null), [room, rooms])
  const strip = useLitMaterial(C.offWhite, v.on, v.color, v.level, 2.4)
  const parts = useRef<(THREE.Group | null)[]>([])
  useFrame(({ camera, invalidate }) => {
    if (!segs) return
    const { plan, innerWalls } = useView.getState()
    let changed = false
    segs.forEach((g, i) => {
      const grp = parts.current[i]
      if (!grp) return
      let show = !plan
      if (show && g.interior) show = innerWalls === 'full'
      else if (show) {
        const mid = (g.a0 + g.a1) / 2
        const dx = camera.position.x - (g.horizontal ? mid : g.fixed)
        const dz = camera.position.z - (g.horizontal ? g.fixed : mid)
        const out = OUT_SIDE[g.side]
        show = ((g.horizontal ? 0 : out * dx) + (g.horizontal ? out * dz : 0)) / (Math.hypot(dx, dz) || 1) <= 0.2
      }
      if (grp.visible !== show) {
        grp.visible = show
        changed = true
      }
    })
    if (changed) invalidate()
  })
  const t = 0.035
  if (segs && at) {
    return (
      <group rotation-y={-at.rot}>
        <group position={[-at.x, 0, -at.z]}>
          {segs.map((g, i) => {
            const len = g.a1 - g.a0
            const mid = (g.a0 + g.a1) / 2
            // The wall face is 3.5 cm behind the strip; the light spreads down from there.
            const face = g.fixed + OUT_SIDE[g.side] * 0.031
            return (
              <group
                key={i}
                ref={(el) => {
                  parts.current[i] = el
                }}
              >
                <Box size={g.horizontal ? [len, t, t] : [t, t, len]} position={g.horizontal ? [mid, STRIP_Y, g.fixed] : [g.fixed, STRIP_Y, mid]} material={strip} shadow={false} />
                {v.on && (
                  <>
                    <StripGlow
                      length={len}
                      width={0.06}
                      position={g.horizontal ? [mid, STRIP_Y, g.fixed] : [g.fixed, STRIP_Y, mid]}
                      rotation={g.horizontal ? [0, 0, 0] : [0, Math.PI / 2, 0]}
                      color={v.color}
                      opacity={v.level * (v.night ? 0.85 : 0.4)}
                    />
                    <Wash
                      length={len}
                      depth={1.3}
                      position={g.horizontal ? [mid, STRIP_Y - 0.65, face] : [face, STRIP_Y - 0.65, mid]}
                      rotation={g.horizontal ? [0, 0, 0] : [0, Math.PI / 2, 0]}
                      color={v.color}
                      opacity={v.level * (v.night ? 0.5 : 0.22)}
                    />
                  </>
                )}
              </group>
            )
          })}
        </group>
      </group>
    )
  }
  const W = v.opts.len ?? 3
  const D = v.opts.len2 ?? 3
  return (
    <group>
      <Box size={[W, t, t]} position={[0, STRIP_Y, -D / 2]} material={strip} shadow={false} />
      <Box size={[W, t, t]} position={[0, STRIP_Y, D / 2]} material={strip} shadow={false} />
      <Box size={[t, t, D]} position={[-W / 2, STRIP_Y, 0]} material={strip} shadow={false} />
      <Box size={[t, t, D]} position={[W / 2, STRIP_Y, 0]} material={strip} shadow={false} />
    </group>
  )
}

export function MirrorLight({ v }: P) {
  const bar = useLitMaterial(C.white, v.on, v.color, v.level, 1.8)
  return (
    <group>
      <Box size={[0.62, 0.82, 0.03]} position={[0, 1.45, -0.07]} material={mat(C.glass, { roughness: 0.1, metalness: 0.3 })} shadow={false} />
      <Box size={[0.66, 0.86, 0.02]} position={[0, 1.45, -0.085]} color={C.steel} shadow={false} />
      <Box size={[0.5, 0.04, 0.06]} position={[0, 1.92, -0.04]} material={bar} />
    </group>
  )
}

/* ---------- devices ---------- */

/** Panel center height (m): above the stand base for a TV on a stand, above the floor for a wall TV. */
const TV_STAND_Y = 0.56
const TV_WALL_Y = 1.3

/**
 * Television (its unit is a separate item, kit/furniture.tsx > TvUnit). Placement from Item.variant:
 * "On a unit / table" ('stand'): on a stand, the item height (item.y) comes from the surface below;
 * "On the wall" ('wall'): wall mounted, panel center 1.3 m above the floor. Panel at local z -0.08 (close to the wall face).
 */
export function Tv({ v }: P) {
  const wall = v.opts.variant === 'wall'
  const py = wall ? TV_WALL_Y : TV_STAND_Y
  const tv = tvScreenOf(v)
  // A film plays on the screen when on (kit/film.ts); the frame freezes when paused
  const screen = useFilm(tv.on, tv.paused, mat(C.screenOff, { roughness: 0.25 }), Math.abs((v.at?.x ?? 0) * 3.1 + (v.at?.z ?? 0) * 1.7))
  const back = backlightOf(v, tv.on)
  return (
    <group>
      {wall ? (
        <Box size={[0.36, 0.26, 0.03]} position={[0, py, -0.12]} color={C.inkSoft} shadow={false} />
      ) : (
        <>
          <Box size={[0.26, 0.04, 0.16]} position={[0, 0.02, -0.06]} color={C.ink} />
          <Box size={[0.06, 0.14, 0.04]} position={[0, 0.11, -0.08]} color={C.ink} />
        </>
      )}
      <Box size={[1.42, 0.82, 0.05]} position={[0, py, -0.08]} color={C.ink} radius={0.015} />
      <Box size={[1.34, 0.74, 0.01]} position={[0, py, -0.05]} material={screen} shadow={false} />
      {back && <TvBacklight {...back} night={v.night} y={py} />}
    </group>
  )
}

/** Entity domains that drive the screen: media player, remote, plug. */
const TV_DOMAINS = ['media_player', 'remote', 'switch']

/**
 * Whether the screen is on and playing: on if any bound TV entity, main or related, is on (so a backlight as the main
 * entity with the TV remote as a related one still shows the screen on). With only a light bound the screen stays off
 * (the light is the backlight).
 */
function tvScreenOf(v: Visual) {
  const self = v.bound && TV_DOMAINS.includes(v.domain)
  const ents = v.related.filter((e) => TV_DOMAINS.includes(domainOf(e.entity_id)))
  if (!self && !ents.length) return { on: v.bound && v.domain !== 'light' && v.on, paused: false }
  const playing = (self && v.state === 'playing') || ents.some((e) => e.state === 'playing')
  return {
    on: (self && v.on) || ents.some(isActive),
    // Paused (and no other entity playing): the film freezes
    paused: !playing && ((self && v.state === 'paused') || ents.some((e) => e.state === 'paused')),
  }
}

/** TV backlight colors without a bound light: like Ambilight, blue on the left and purple on the right. */
const AMBI: [string, string] = ['#5d76ff', '#c07cff']

/**
 * Which entity lights the TV backlight: the first light bound to the TV (related or main), else the TV itself.
 * None when the option is explicitly "None", or unset with no light bound (same rule as bindings.ts > ledOf).
 */
function backlightOf(v: Visual, screenOn: boolean) {
  // Backlight entity picked on the card; if none is picked, the first light bound to the TV
  const picked = v.opts.ledEntity ? v.related.find((e) => e.entity_id === v.opts.ledEntity) : undefined
  const light = picked ?? v.related.find((e) => domainOf(e.entity_id) === 'light')
  const selfLight = v.domain === 'light'
  const mode = v.opts.led ?? (light || selfLight ? 'back' : 'none')
  if (mode !== 'back') return null
  if (light) {
    const c = lightColor(light)
    return { on: isActive(light), level: Math.max(0.35, lightLevel(light)) * gainOf(v), c1: c, c2: c }
  }
  if (selfLight) return { on: v.on, level: Math.max(0.35 * gainOf(v), v.level), c1: v.color, c2: v.color }
  return { on: screenOn, level: 0.9 * gainOf(v), c1: AMBI[0], c2: AMBI[1] }
}

/**
 * Soft halo on the wall behind the TV (2 cm behind the panel) and an LED strip on the panel edge.
 * The halo belongs to the TV, not the wall: even when the wall facing the camera is cut away it does not float, it glows around the TV.
 */
function TvBacklight({ on, level, c1, c2, night, y }: { on: boolean; level: number; c1: string; c2: string; night: boolean; y: number }) {
  const strip = useLitMaterial(C.steel, on, c1, level, 2.2)
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(2.5, 1.65)
    const a = new THREE.Color(c1)
    const b = new THREE.Color(c2)
    const pos = g.attributes.position
    const cols = new Float32Array(pos.count * 3)
    for (let i = 0; i < pos.count; i++) (pos.getX(i) < 0 ? a : b).toArray(cols, i * 3)
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3))
    return g
  }, [c1, c2])
  useEffect(() => () => geo.dispose(), [geo])
  const tex = useMemo(() => softRectTexture(), [])
  return (
    <group position={[0, y, -0.115]}>
      <Box size={[1.36, 0.016, 0.016]} position={[0, 0.39, 0]} material={strip} shadow={false} />
      <Box size={[1.36, 0.016, 0.016]} position={[0, -0.39, 0]} material={strip} shadow={false} />
      <Box size={[0.016, 0.76, 0.016]} position={[-0.69, 0, 0]} material={strip} shadow={false} />
      <Box size={[0.016, 0.76, 0.016]} position={[0.69, 0, 0]} material={strip} shadow={false} />
      {on && (
        <mesh geometry={geo} position={[0, 0, -0.01]} renderOrder={8}>
          <meshBasicMaterial map={tex} vertexColors transparent opacity={level * (night ? 1 : 0.55)} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  )
}

/**
 * PlayStation 5 Slim body, centered at the origin and standing upright: black center body, white covers on both sides (a
 * thin line between the upper and lower parts), light strips on both front edges (blue when on). Front at +z.
 */
function Ps5Body({ led }: { led: THREE.Material }) {
  return (
    <group>
      <Box size={[0.064, 0.355, 0.27]} color="#1c1e26" radius={0.012} />
      {[-1, 1].map((sx) => (
        <group key={sx} position={[sx * 0.04, 0, 0]}>
          <Box size={[0.016, 0.36, 0.29]} color="#f4f5f8" radius={0.008} />
          <Box size={[0.0168, 0.004, 0.292]} position={[0, 0.045, 0]} rotation={[0.12, 0, 0]} color="#2a2c34" shadow={false} />
          <Box size={[0.003, 0.33, 0.004]} position={[-sx * 0.009, 0, 0.137]} material={led} shadow={false} />
        </group>
      ))}
    </group>
  )
}

/**
 * Xbox Series S body, centered at the origin and standing upright: white box (6.5 × 27.5 × 15.1 cm), large black vent
 * circle on the side (-x), light gray perforated top, Xbox button (glows white when on) and USB on the front (+z).
 */
function XboxBody({ led }: { led: THREE.Material }) {
  return (
    <group>
      <Box size={[0.065, 0.275, 0.151]} color="#f6f7f9" radius={0.006} />
      <Cyl r={0.058} h={0.002} position={[-0.0331, 0.02, 0]} rotation={[0, 0, Math.PI / 2]} color="#17181d" segments={40} shadow={false} />
      <Box size={[0.058, 0.002, 0.142]} position={[0, 0.1376, 0]} color="#dfe1e7" shadow={false} />
      <Cyl r={0.0075} h={0.002} position={[0, 0.112, 0.0761]} rotation={[Math.PI / 2, 0, 0]} material={led} segments={20} shadow={false} />
      <Box size={[0.006, 0.011, 0.002]} position={[0, -0.112, 0.0761]} color="#2a2c34" shadow={false} />
      <Cyl r={0.0025} h={0.002} position={[0, -0.09, 0.0761]} rotation={[Math.PI / 2, 0, 0]} color="#c9ccd6" segments={10} shadow={false} />
    </group>
  )
}

/**
 * Game console: PlayStation or Xbox, vertical or horizontal. Item.variant `${brand}-${pose}` (catalog.ts > consoleModel).
 * A vertical PlayStation stands on a round chrome base; horizontally the body lies on its side (PlayStation on small feet,
 * Xbox with the vent on top). When on, the PlayStation light strip glows blue and the Xbox button white.
 */
export function Console({ v }: P) {
  const { brand, pose } = consoleModel(v.opts.variant)
  const ps = brand === 'ps5'
  const led = useLitMaterial(ps ? '#3a3f55' : '#d6d9e2', v.on, ps ? '#4d7dff' : '#ffffff', 1, 2.4)
  const Body = ps ? Ps5Body : XboxBody
  if (pose === 'v') {
    return (
      <group>
        {ps && <Cyl r={0.055} h={0.008} position={[0, 0.004, 0]} material={mat('#c9ccd4', { metalness: 0.6, roughness: 0.3 })} segments={32} />}
        <group position={[0, ps ? 0.008 + 0.18 : 0.002 + 0.1375, 0]}>
          <Body led={led} />
        </group>
      </group>
    )
  }
  // Horizontal: the vertical body turns around z. PlayStation 9.6 cm thick (small feet), Xbox 6.5 cm (vent on top).
  return (
    <group>
      {ps &&
        [-0.13, 0.13].flatMap((x) => [-0.1, 0.1].map((z) => <Cyl key={`${x}${z}`} r={0.01} h={0.006} position={[x, 0.003, z]} color="#2a2c34" segments={10} shadow={false} />))}
      <group position={[0, ps ? 0.006 + 0.048 : 0.002 + 0.0325, 0]} rotation={[0, 0, ps ? Math.PI / 2 : -Math.PI / 2]}>
        <Body led={led} />
      </group>
    </group>
  )
}

export function Monitor({ v }: P) {
  // When on, a blurry desktop: editor and browser windows, scrolling lines (kit/screens.ts)
  const screen = useScreen(monitorOn(v), 1, mat(C.screenOff, { roughness: 0.25 }), Math.abs((v.at?.x ?? 0) * 3.1 + (v.at?.z ?? 0) * 1.7))
  return (
    <group>
      <Box size={[0.22, 0.02, 0.16]} position={[0, 0.01, 0]} color={C.ink} />
      <Box size={[0.04, 0.22, 0.04]} position={[0, 0.12, -0.03]} color={C.ink} />
      <Box size={[0.66, 0.38, 0.03]} position={[0, 0.38, -0.02]} color={C.ink} radius={0.01} />
      <Box size={[0.62, 0.34, 0.01]} position={[0, 0.38, 0.0]} material={screen} shadow={false} />
    </group>
  )
}

export function AcUnit({ v }: P) {
  const heating = v.state === 'heat' || v.attrs.hvac_action === 'heating'
  const body = v.unavailable ? mat(DIM) : mat(C.white)
  const led = useLitMaterial(C.steel, v.on, heating ? C.heat : C.cool, 1, 2)
  return (
    <group>
      <Box size={[1, 0.3, 0.22]} position={[0, 2.18, -0.04]} material={body} radius={0.06} />
      <Box size={[0.86, 0.025, 0.02]} position={[0, 2.06, 0.075]} color={C.steel} shadow={false} />
      <Box size={[0.08, 0.02, 0.01]} position={[0.38, 2.24, 0.075]} material={led} shadow={false} />
      <Airflow active={v.on} color={heating ? C.heat : C.cool} y={2.02} />
    </group>
  )
}

export function Radiator({ v }: P) {
  const heating = v.on && (v.attrs.hvac_action === 'heating' || v.domain === 'switch' || v.attrs.hvac_action == null)
  const fins = useLitMaterial(C.white, heating, C.heat, 0.5, 0.6)
  return (
    <group>
      {Array.from({ length: 8 }, (_, i) => (
        <Box key={i} size={[0.1, 0.6, 0.08]} position={[-0.42 + i * 0.12, 0.45, 0]} material={fins} radius={0.02} />
      ))}
      <Box size={[0.98, 0.04, 0.05]} position={[0, 0.77, 0]} color={C.steel} shadow={false} />
      <Box size={[0.98, 0.04, 0.05]} position={[0, 0.13, 0]} color={C.steel} shadow={false} />
      {heating && <Glow position={[0, 0.5, 0.25]} color={C.heat} opacity={v.night ? 0.6 : 0.3} size={1.3} />}
    </group>
  )
}

/** Diffuser body: lower bowl and upper dome are separate lathe profiles; the seam between them (the widest point) holds the strip. */
const DIF_SEAM = 0.066
const DIF_R = 0.0905
let difGeos: { lower: THREE.LatheGeometry; upper: THREE.LatheGeometry } | null = null
function diffuserBody() {
  if (difGeos) return difGeos
  // Lower bowl: 6 cm radius at the bottom, widest at the seam (9 cm)
  const lower = [new THREE.Vector2(0, 0.008)]
  for (let i = 0; i <= 12; i++) {
    const t = i / 12
    lower.push(new THREE.Vector2(0.06 + (DIF_R - 0.06) * Math.sin((t * Math.PI) / 2), 0.008 + t * (DIF_SEAM - 0.008)))
  }
  // Upper dome: narrows like an onion into a thin neck, small lip and mist hole at the mouth
  const upper: THREE.Vector2[] = []
  for (let i = 0; i <= 22; i++) {
    const t = i / 22
    upper.push(new THREE.Vector2(0.016 + (DIF_R - 0.016) * Math.pow(Math.cos((t * Math.PI) / 2), 1.7), DIF_SEAM + t * 0.108))
  }
  upper.push(new THREE.Vector2(0.0135, 0.177), new THREE.Vector2(0.0098, 0.1765), new THREE.Vector2(0.009, 0.168), new THREE.Vector2(0, 0.166))
  difGeos = { lower: new THREE.LatheGeometry(lower, 48), upper: new THREE.LatheGeometry(upper, 48) }
  return difGeos
}
/** Position of the front buttons: on the lower bowl surface (4 cm high) and its slope there */
const DIF_BTN_Y = 0.04
const DIF_BTN_T = (DIF_BTN_Y - 0.008) / (DIF_SEAM - 0.008)
const DIF_BTN_R = 0.06 + (DIF_R - 0.06) * Math.sin((DIF_BTN_T * Math.PI) / 2)
const DIF_BTN_TILT = Math.atan(((DIF_R - 0.06) * Math.cos((DIF_BTN_T * Math.PI) / 2) * (Math.PI / 2)) / (DIF_SEAM - 0.008))

/**
 * Entity that drives the diffuser ring light (Item.led 'strip'): the one picked on the card, else the first light bound
 * to the diffuser, else the diffuser itself if it is a light. With the option on but no light, the strip stays dark.
 */
function diffuserLight(v: Visual) {
  const picked = v.opts.ledEntity ? v.related.find((e) => e.entity_id === v.opts.ledEntity) : undefined
  const light = picked ?? v.related.find((e) => domainOf(e.entity_id) === 'light')
  const selfLight = v.bound && v.domain === 'light'
  const mode = v.opts.led ?? (light || selfLight ? 'strip' : 'none')
  if (mode !== 'strip') return null
  if (light) return { on: isActive(light), level: Math.max(0.35, lightLevel(light)) * gainOf(v), color: lightColor(light) }
  if (selfLight) return { on: v.on, level: Math.max(0.35 * gainOf(v), v.level), color: v.color }
  return { on: false, level: 0, color: C.mint }
}

/**
 * Diffuser (ultrasonic, wood grain): onion shaped body, wood grain (Item.body: light wood, dark wood; plain when white),
 * a light strip at its widest point (the seam between lower bowl and upper dome), two buttons at the front, three feet,
 * mist from the narrow mouth when on.
 * Light option (Item.led 'strip', "Light: None / Ring strip" on the card): the strip glows in the light's color with a
 * soft band halo around it and a pool of light on the surface below, the mist takes on that color, and it lights the room
 * softly (roomLights.ts). Without the strip ("None") the seam is just a thin line.
 */
export function Diffuser({ v }: P) {
  const color = v.opts.body ?? '#d9a066'
  const wood = color !== '#f4f2ee'
  const shell = useMemo(() => new THREE.MeshStandardMaterial({ color: v.unavailable ? DIM : color, map: wood ? woodGrainTexture() : null, roughness: 0.38 }), [color, wood, v.unavailable])
  useEffect(() => () => shell.dispose(), [shell])
  const dark = useMemo(() => `#${new THREE.Color(color).multiplyScalar(0.62).getHexString()}`, [color])
  const g = diffuserBody()
  const led = diffuserLight(v)
  const lit = Boolean(led?.on)
  const strip = useLitMaterial('#f3efe6', lit, led?.color ?? C.mint, led?.level ?? 0, 2.4)
  const band = useMemo(() => bandGlowTexture(), [])
  const pool = useMemo(() => glowTexture(), [])
  const k = (led?.level ?? 0) * (v.night ? 1 : 0.55)
  // The mist takes on the light color but stays close to white (a saturated color looks like paint, not mist).
  const ledColor = led?.color
  const mistColor = useMemo(() => (lit && ledColor ? `#${new THREE.Color(ledColor).lerp(new THREE.Color('#ffffff'), 0.45).getHexString()}` : undefined), [lit, ledColor])
  return (
    <group>
      {[Math.PI / 2, (Math.PI * 7) / 6, (Math.PI * 11) / 6].map((a) => (
        <Cyl key={a} r={0.009} h={0.008} position={[Math.cos(a) * 0.045, 0.004, Math.sin(a) * 0.045]} color={dark} segments={12} shadow={false} />
      ))}
      <mesh geometry={g.lower} material={shell} castShadow receiveShadow />
      <mesh geometry={g.upper} material={shell} castShadow receiveShadow />
      {/* two front buttons (light, mist): tilted to the bowl's slope */}
      {[-1, 1].map((sx) => (
        <Box key={sx} size={[0.026, 0.011, 0.004]} position={[sx * 0.0145, DIF_BTN_Y, DIF_BTN_R - 0.0012]} rotation={[DIF_BTN_TILT, 0, 0]} color={dark} radius={0.002} shadow={false} />
      ))}
      {led ? (
        <>
          <mesh position={[0, DIF_SEAM, 0]} material={strip}>
            <cylinderGeometry args={[DIF_R + 0.0004, DIF_R + 0.0004, 0.005, 48, 1, true]} />
          </mesh>
          {lit && (
            <>
              <mesh position={[0, DIF_SEAM, 0]} renderOrder={10}>
                <cylinderGeometry args={[DIF_R + 0.0025, DIF_R + 0.0025, 0.035, 48, 1, true]} />
                <meshBasicMaterial map={band} color={led.color} transparent opacity={0.85 * k} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} side={THREE.DoubleSide} />
              </mesh>
              <mesh position={[0, 0.003, 0]} rotation-x={-Math.PI / 2} renderOrder={9}>
                <planeGeometry args={[0.46, 0.46]} />
                <meshBasicMaterial map={pool} color={led.color} transparent opacity={0.75 * k} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
              </mesh>
            </>
          )}
        </>
      ) : (
        <mesh position={[0, DIF_SEAM, 0]}>
          <cylinderGeometry args={[DIF_R + 0.0003, DIF_R + 0.0003, 0.0015, 48, 1, true]} />
          <meshStandardMaterial color={dark} roughness={0.6} />
        </mesh>
      )}
      <Mist active={v.on} y={0.18} color={mistColor} size={0.55} />
    </group>
  )
}

/** Privacy mode switch of a desk camera (when on, the lens turns down). Matches entity ids and names in several languages. */
const PRIVACY = new RegExp(
  ['privacy', 'privat', 'gizlilik', 'mahremiyet', 'privacidad', 'confidentialit', 'privé', 'riservatezza', 'prywatno', 'приватн', 'конфиденц', 'プライバシー', '프라이버시', '개인정보', '隐私', '隱私', 'गोपनीयता'].join('|'),
  'i',
)

/**
 * Desk camera (indoor pan/tilt camera like the Tapo C200): base, body, ball head, dark face, lens, status light. Live
 * when the bound camera entity is available or its plug is on: green light; while recording or streaming the light is red
 * and the head pans slowly left and right. With the privacy switch on, the head turns the lens down. At night while live,
 * infrared dots around the lens.
 */
export function DeskCamera({ v }: P) {
  const color = v.opts.body ?? '#f4f4f6'
  // The main entity may be the camera (on when available), a plug (when on) or the privacy switch; related entities count too.
  const mainPrivacy = v.domain === 'switch' && PRIVACY.test(String(v.attrs.friendly_name ?? ''))
  const priv = v.related.find((e) => domainOf(e.entity_id) === 'switch' && PRIVACY.test(`${e.entity_id} ${friendlyName(e)}`))
  const privacy = priv ? isActive(priv) : mainPrivacy && v.on
  const camEnt = v.related.find((e) => domainOf(e.entity_id) === 'camera')
  const camUp = (state: string) => !['unavailable', 'unknown', 'off'].includes(state)
  const power = v.domain === 'camera' ? camUp(v.state) : v.domain === 'switch' && !mainPrivacy ? v.on : Boolean(camEnt && camUp(camEnt.state))
  const live = v.bound && power && !privacy
  const camState = v.domain === 'camera' ? v.state : (camEnt?.state ?? '')
  const recording = live && (camState === 'recording' || camState === 'streaming')
  const tiltTarget = privacy ? 1.4 : 0.12
  const [tilt0] = useState(tiltTarget)
  const pan = useRef<THREE.Group>(null)
  const head = useRef<THREE.Group>(null)
  const invalidate = useThree((s) => s.invalidate)
  useAmbient(recording)
  useEffect(() => invalidate(), [tiltTarget, recording, invalidate])
  useFrame((state, dt) => {
    const p = pan.current
    const h = head.current
    if (!p || !h) return
    let moving = false
    if (recording) {
      p.rotation.y = 0.75 * Math.sin(state.clock.elapsedTime * 0.4)
      moving = true
    } else if (Math.abs(p.rotation.y) > 0.0005) {
      p.rotation.y -= p.rotation.y * Math.min(1, dt * 4)
      moving = true
    }
    const d = tiltTarget - h.rotation.x
    if (Math.abs(d) > 0.0005) {
      h.rotation.x += d * Math.min(1, dt * 5)
      moving = true
    }
    if (moving) {
      markShadows(1)
      if (!recording) state.invalidate()
    }
  })
  const ledMat = useLitMaterial('#8d93ae', live, recording ? C.alarm : C.ok, 1, 2.5)
  const face = mat('#16171d', { roughness: 0.35 })
  const lens = mat('#05060a', { roughness: 0.08, metalness: 0.4 })
  return (
    <group>
      <Cyl r={0.043} rTop={0.041} h={0.014} position={[0, 0.007, 0]} color={color} segments={32} />
      <group ref={pan} position={[0, 0.014, 0]}>
        <Cyl r={0.036} rTop={0.033} h={0.05} position={[0, 0.025, 0]} color={color} segments={32} />
        <group ref={head} position={[0, 0.078, 0]} rotation-x={tilt0}>
          <Ball r={0.043} detail={3} color={color} />
          <Cyl r={0.03} h={0.012} position={[0, 0, 0.033]} rotation={[Math.PI / 2, 0, 0]} material={face} segments={32} shadow={false} />
          <Cyl r={0.011} h={0.004} position={[0, 0.002, 0.0395]} rotation={[Math.PI / 2, 0, 0]} material={lens} segments={24} shadow={false} />
          <Ball r={0.0045} position={[0.002, 0.004, 0.0405]} color="#33457a" shadow={false} />
          <Ball r={0.0026} position={[0.018, -0.017, 0.0392]} material={ledMat} shadow={false} />
          {live &&
            v.night &&
            [0, 1, 2, 3].map((i) => (
              <mesh key={i} position={[Math.cos((i * Math.PI) / 2 + 0.78) * 0.019, 0.002 + Math.sin((i * Math.PI) / 2 + 0.78) * 0.019, 0.0394]} userData={{ selectionAid: true }}>
                <circleGeometry args={[0.0018, 10]} />
                <meshBasicMaterial color="#c4303a" toneMapped={false} />
              </mesh>
            ))}
        </group>
      </group>
    </group>
  )
}

const fanSpeed = (v: Visual) => (v.on ? 6 + (Number(v.attrs.percentage ?? 60) / 100) * 14 : 0)

/** Fan head: motor, three blades (spinning when on), guard ring. Front at +z. */
function FanHead({ speed, scale = 1 }: { speed: number; scale?: number }) {
  return (
    <group scale={scale}>
      <Cyl r={0.06} h={0.14} rotation={[Math.PI / 2, 0, 0]} color={C.white} />
      <Spin speed={speed}>
        {[0, 1, 2].map((i) => (
          <Box key={i} size={[0.07, 0.32, 0.01]} position={[Math.sin((i * 2 * Math.PI) / 3) * 0.16, Math.cos((i * 2 * Math.PI) / 3) * 0.16, 0.08]} rotation={[0, 0, (-i * 2 * Math.PI) / 3]} color={C.brandLight} shadow={false} />
        ))}
      </Spin>
      <mesh position={[0, 0, 0.1]}>
        <torusGeometry args={[0.34, 0.01, 6, 32]} />
        <meshStandardMaterial color={C.steel} />
      </mesh>
    </group>
  )
}

export function Fan({ v }: P) {
  return (
    <group>
      <Cyl r={0.2} h={0.04} position={[0, 0.02, 0]} color={C.ink} />
      <Cyl r={0.025} h={1.05} position={[0, 0.55, 0]} color={C.ink} />
      <group position={[0, 1.15, 0.05]}>
        <FanHead speed={fanSpeed(v)} />
      </group>
    </group>
  )
}

/** Wall fan: mount near the ceiling, head tilted slightly down. */
export function WallFan({ v }: P) {
  return (
    <group>
      <Box size={[0.12, 0.16, 0.03]} position={[0, 2.15, -0.135]} color={C.white} radius={0.01} />
      <Box size={[0.04, 0.04, 0.14]} position={[0, 2.15, -0.06]} color={C.white} />
      <group position={[0, 2.08, 0.04]} rotation={[0.35, 0, 0]}>
        <FanHead speed={fanSpeed(v)} scale={0.62} />
      </group>
    </group>
  )
}

/** Desk fan: round base, short neck, small head. */
export function DeskFan({ v }: P) {
  return (
    <group>
      <Cyl r={0.085} h={0.02} position={[0, 0.01, 0]} color={C.white} segments={24} />
      <Cyl r={0.012} h={0.14} position={[0, 0.09, 0]} color={C.white} segments={10} />
      <group position={[0, 0.24, 0.01]}>
        <FanHead speed={fanSpeed(v)} scale={0.36} />
      </group>
    </group>
  )
}

/**
 * Ceiling fan motor: the main entity if it is a fan or switch, otherwise (main entity is a light) the first bound fan or
 * switch. Spin speed (rad/s) follows the fan percentage; medium speed for a switch or a fan without percentage.
 */
function ceilingFanSpeed(v: Visual) {
  const own = v.domain === 'fan' || v.domain === 'switch'
  const e = own ? undefined : v.related.find((x) => ['fan', 'switch'].includes(domainOf(x.entity_id)))
  const on = own ? v.on : Boolean(e && isActive(e))
  if (!on) return 0
  const pct = Number((own ? v.attrs.percentage : e?.attributes.percentage) ?? 60)
  return 1.6 + (Math.min(100, Math.max(0, pct)) / 100) * 7
}

/** Ceiling fan light kit (Item.led 'under'): the one picked on the card, else the first bound light, else the main entity if it is a light. */
function ceilingFanLight(v: Visual) {
  const picked = v.opts.ledEntity ? v.related.find((e) => e.entity_id === v.opts.ledEntity) : undefined
  const light = picked ?? v.related.find((e) => domainOf(e.entity_id) === 'light')
  const selfLight = v.bound && v.domain === 'light'
  const mode = v.opts.led ?? (light || selfLight ? 'under' : 'none')
  if (mode !== 'under') return null
  if (light) return { on: isActive(light), level: Math.max(0.35, lightLevel(light)) * gainOf(v), color: lightColor(light) }
  if (selfLight) return { on: v.on, level: Math.max(0.35 * gainOf(v), v.level), color: v.color }
  return { on: false, level: 0, color: '#ffd29a' }
}

const WOOD_BLADES = ['#c9a27a', '#7a5236']

/**
 * Ceiling fan: canopy, downrod, motor housing, 3-5 blades (Item.variant; diameter Item.len, 0.8-1.6 m); when on the
 * blades spin with a translucent motion blur disc below them. With a light kit (Item.led 'under') the opal bowl under the
 * motor glows in the light's color and lights the room like a chandelier (roomLights.ts).
 */
export function CeilingFan({ v }: P) {
  const R = (v.opts.len ?? 1.3) / 2
  const n = Math.min(5, Math.max(3, Number(v.opts.variant) || 3))
  const bladeColor = v.opts.top ?? '#c9a27a'
  const body = v.unavailable ? DIM : (v.opts.body ?? '#f4f4f6')
  const speed = ceilingFanSpeed(v)
  const led = ceilingFanLight(v)
  const bowl = useLitMaterial('#f6f3ec', Boolean(led?.on), led?.color ?? '#ffd29a', led?.level ?? 0, 1.4)
  const wood = WOOD_BLADES.includes(bladeColor)
  const blade = useMemo(() => new THREE.MeshStandardMaterial({ color: bladeColor, map: wood ? woodGrainTexture() : null, roughness: 0.55 }), [bladeColor, wood])
  useEffect(() => () => blade.dispose(), [blade])
  const len = R - 0.2
  const y = 2.27
  return (
    <group>
      <Cyl r={0.06} rTop={0.08} h={0.05} position={[0, WALL_H - 0.025, 0]} color={body} shadow={false} />
      <Cyl r={0.013} h={0.18} position={[0, 2.48, 0]} color={body} shadow={false} />
      <Cyl r={0.15} rTop={0.12} h={0.11} position={[0, 2.335, 0]} color={body} />
      <Cyl r={0.12} rTop={0.15} h={0.05} position={[0, 2.255, 0]} color={body} />
      <Spin speed={speed} axis="y">
        {Array.from({ length: n }, (_, i) => (
          <group key={i} rotation-y={(i * Math.PI * 2) / n}>
            <Box size={[0.17, 0.012, 0.03]} position={[0.17, y + 0.004, 0]} color={C.steel} shadow={false} />
            <Box size={[len, 0.012, 0.14]} position={[0.2 + len / 2, y, 0]} rotation-x={0.12} material={blade} />
          </group>
        ))}
      </Spin>
      {speed > 0 && (
        <mesh position-y={y - 0.012} rotation-x={-Math.PI / 2} renderOrder={5} userData={{ selectionAid: true }} raycast={() => null}>
          <ringGeometry args={[0.16, R, 48]} />
          <meshBasicMaterial color={bladeColor} transparent opacity={Math.min(0.22, speed * 0.025)} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      )}
      {led ? (
        <>
          <Cyl r={0.135} h={0.012} position={[0, 2.226, 0]} color={body} shadow={false} />
          <Ball r={0.13} position={[0, 2.215, 0]} scale={[1, 0.5, 1]} material={bowl} shadow={false} />
        </>
      ) : (
        <Ball r={0.06} position={[0, 2.226, 0]} scale={[1, 0.6, 1]} color={body} shadow={false} />
      )}
    </group>
  )
}

/** HomePod bodies (lathe profiles), built once per model. */
const podGeo = new Map<string, THREE.LatheGeometry>()
function podBody(mini: boolean) {
  const key = mini ? 'mini' : 'full'
  let g = podGeo.get(key)
  if (g) return g
  const pts: THREE.Vector2[] = [new THREE.Vector2(0, 0)]
  if (mini) {
    // 9.8 cm diameter, 8.4 cm tall: a squashed sphere cut flat at the top and bottom.
    const a = 0.049
    const b = 0.055
    const c = 0.042
    const t0 = Math.asin(c / b)
    for (let i = 0; i <= 24; i++) {
      const t = -t0 + (2 * t0 * i) / 24
      pts.push(new THREE.Vector2(a * Math.cos(t), c + b * Math.sin(t)))
    }
    pts.push(new THREE.Vector2(0, 2 * c))
  } else {
    // 14.2 cm diameter, 16.8 cm tall: a cylinder with soft edges and a small recessed base.
    const R = 0.071
    const y0 = 0.006
    const y1 = 0.168
    const rb = 0.03
    const rt = 0.024
    pts.push(new THREE.Vector2(0.04, 0))
    for (let i = 0; i <= 8; i++) {
      const t = -Math.PI / 2 + ((Math.PI / 2) * i) / 8
      pts.push(new THREE.Vector2(R - rb + rb * Math.cos(t), y0 + rb + rb * Math.sin(t)))
    }
    for (let i = 0; i <= 8; i++) {
      const t = ((Math.PI / 2) * i) / 8
      pts.push(new THREE.Vector2(R - rt + rt * Math.cos(t), y1 - rt + rt * Math.sin(t)))
    }
    pts.push(new THREE.Vector2(0, y1))
  }
  g = new THREE.LatheGeometry(pts, 48)
  podGeo.set(key, g)
  return g
}

/** Whether a color is light (on light top glass the colored wave uses normal blending instead of additive, else it washes out to white). */
const isLightHex = (hex: string) => {
  const n = parseInt(hex.replace('#', ''), 16)
  return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 150
}

/**
 * HomePod (Item.variant: mini or full) and its colors (Item.body). Fabric covered body with a touch glass surface on top.
 * While playing (media_player "playing") music notes rise from it (effects.tsx > MusicNotes; not when muted), two colored
 * waves spin in opposite directions on the surface and pulse with the volume; + and - signs appear. When paused the wave
 * stays faintly; off/idle the surface is dark.
 */
export function HomePod({ v }: P) {
  const mini = (v.opts.variant ?? 'mini') === 'mini'
  const color = v.opts.body ?? '#efeeea'
  const light = isLightHex(color)
  const playing = v.state === 'playing'
  const paused = v.state === 'paused'
  const muted = v.attrs.is_volume_muted === true
  const vol = Math.min(1, Math.max(0, Number(v.attrs.volume_level ?? 0.5)))
  const H = mini ? 0.084 : 0.168
  const rGlass = mini ? 0.027 : 0.043
  const level = playing ? (muted ? 0.4 : 0.6 + vol * 0.4) : paused ? 0.3 : 0
  const texA = useMemo(() => siriTexture(0), [])
  const texB = useMemo(() => siriTexture(1), [])
  const a = useRef<THREE.Mesh>(null)
  const b = useRef<THREE.Mesh>(null)
  const wave = useRef<THREE.Group>(null)
  const invalidate = useThree((s) => s.invalidate)
  useAmbient(playing)
  useEffect(() => invalidate(), [level, invalidate])
  useFrame(({ clock }) => {
    if (!playing || !a.current || !b.current || !wave.current) return
    const t = clock.elapsedTime
    a.current.rotation.z = t * 0.7
    b.current.rotation.z = -t * 1.05
    const amp = muted ? 0.015 : 0.03 + vol * 0.07
    wave.current.scale.setScalar(1 + amp * Math.sin(t * 2.3) + amp * 0.6 * Math.sin(t * 3.9 + 1.3))
  })
  const blend = light ? THREE.NormalBlending : THREE.AdditiveBlending
  // The top glass follows the body color, a bit darker and glossy (frosted white on white, black on midnight, blue on blue).
  const glassHex = useMemo(() => `#${new THREE.Color(color).multiplyScalar(light ? 0.86 : 0.6).getHexString()}`, [color, light])
  const glass = mat(v.unavailable ? DIM : glassHex, { roughness: 0.2 })
  return (
    <group>
      <mesh geometry={podBody(mini)} material={mat(v.unavailable ? DIM : color, { roughness: 0.95 })} castShadow receiveShadow />
      <MusicNotes active={playing && !muted} y={H + 0.05} size={mini ? 0.12 : 0.14} speed={0.8 + vol * 0.5} />
      <group position={[0, H + 0.0006, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <mesh material={glass} receiveShadow>
          <circleGeometry args={[rGlass, 40]} />
        </mesh>
        {level > 0 && (
          <group ref={wave} position={[0, 0, 0.0004]}>
            <mesh ref={a} renderOrder={11} userData={{ selectionAid: true }}>
              <circleGeometry args={[rGlass * 0.94, 40]} />
              <meshBasicMaterial map={texA} transparent opacity={level} depthWrite={false} blending={blend} toneMapped={false} />
            </mesh>
            <mesh ref={b} position={[0, 0, 0.0003]} renderOrder={12} userData={{ selectionAid: true }}>
              <circleGeometry args={[rGlass * 0.8, 40]} />
              <meshBasicMaterial map={texB} transparent opacity={level * 0.75} depthWrite={false} blending={blend} toneMapped={false} />
            </mesh>
          </group>
        )}
        {playing &&
          [-1, 1].map((side) => (
            <group key={side} position={[0, side * rGlass * 0.72, 0.0009]}>
              <mesh renderOrder={13} userData={{ selectionAid: true }}>
                <planeGeometry args={[rGlass * 0.22, rGlass * 0.05]} />
                <meshBasicMaterial color={light ? '#8a8b92' : '#e8e8ee'} toneMapped={false} />
              </mesh>
              {side > 0 && (
                <mesh renderOrder={13} userData={{ selectionAid: true }}>
                  <planeGeometry args={[rGlass * 0.05, rGlass * 0.22]} />
                  <meshBasicMaterial color={light ? '#8a8b92' : '#e8e8ee'} toneMapped={false} />
                </mesh>
              )}
            </group>
          ))}
      </group>
    </group>
  )
}

export function Plug({ v }: P) {
  const led = useLitMaterial('#8d93ae', v.on, C.ok, 1, 2.5)
  return (
    <group>
      <Box size={[0.13, 0.13, 0.025]} position={[0, 0.32, -0.05]} color={C.white} radius={0.015} />
      <Box size={[0.08, 0.08, 0.06]} position={[0, 0.32, -0.01]} color={C.offWhite} radius={0.02} />
      <Ball r={0.012} position={[0.035, 0.355, 0.025]} material={led} shadow={false} />
      {v.on && <Glow position={[0.035, 0.355, 0.05]} color={C.ok} opacity={v.night ? 0.8 : 0.4} size={0.18} />}
    </group>
  )
}

/** Power strip cable: leaves the right end and curls backward (same for every strip, built once). */
let cableGeo: THREE.TubeGeometry | null = null
function stripCable() {
  cableGeo ??= new THREE.TubeGeometry(
    new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.02, 0), new THREE.Vector3(0.06, 0.007, -0.01), new THREE.Vector3(0.12, 0.006, -0.08), new THREE.Vector3(0.14, 0.006, -0.22)]),
    16,
    0.0045,
    6,
  )
  return cableGeo
}

/**
 * Power strip (2-5 sockets, Item.variant): horizontal body, grounded sockets on top, lit master switch on the right, cable
 * going back. A small LED next to each socket: switch bindings map to socket 1, 2, ... in order (bindings.ts > socketLabel);
 * with a single switch bound all follow it, with none bound they follow the item state.
 */
export function PowerStrip({ v }: P) {
  const n = socketCount(v.opts)
  const W = stripWidth(n)
  const outs: boolean[] = []
  if (v.bound && SOCKET_DOMAINS.includes(v.domain)) outs.push(v.on)
  for (const e of v.related) if (isSocketEntity(e.entity_id)) outs.push(isActive(e))
  const socketOn = (i: number) => (outs.length === 0 ? v.on : outs.length === 1 ? outs[0] : Boolean(outs[i]))
  const anyOn = Array.from({ length: n }, (_, i) => socketOn(i)).some(Boolean)
  const ledOn = useLitMaterial('#8d93ae', true, C.ok, 1, 2.5)
  const ledOff = useLitMaterial('#8d93ae', false, C.ok)
  const rocker = useLitMaterial('#e3e5ef', anyOn, '#ff6a4a', 1, 1.4)
  const H = 0.042
  const x0 = -W / 2 + 0.02 + STRIP_PITCH / 2
  // On the wall (Item.mount 'wall'): body vertical, sockets face forward (+z), back on the wall (local z -0.04), center at
  // STRIP_WALL_Y above the floor (+ Item.y offset); the cable drops from the bottom right. Same parts as lying flat, turned 90° on x.
  const wall = v.opts.mount === 'wall'
  const off = wall ? (v.at?.y ?? 0) : 0
  const body = (
    <>
      <Box size={[W, H, 0.075]} position={[0, H / 2, 0]} color={C.white} radius={0.012} />
      {Array.from({ length: n }, (_, i) => (
        <group key={i} position={[x0 + i * STRIP_PITCH, H, 0]}>
          <Cyl r={0.024} h={0.004} position={[0, 0.001, -0.004]} color="#e6e8f2" segments={20} shadow={false} />
          <Cyl r={0.0045} h={0.003} position={[-0.0095, 0.002, -0.004]} color={C.ink} segments={8} shadow={false} />
          <Cyl r={0.0045} h={0.003} position={[0.0095, 0.002, -0.004]} color={C.ink} segments={8} shadow={false} />
          <Box size={[0.008, 0.002, 0.004]} position={[0, 0.003, -0.026]} color={C.steel} shadow={false} />
          <Box size={[0.008, 0.002, 0.004]} position={[0, 0.003, 0.018]} color={C.steel} shadow={false} />
          <Box size={[0.008, 0.003, 0.006]} position={[0.026, 0.002, 0.028]} material={socketOn(i) ? ledOn : ledOff} shadow={false} />
        </group>
      ))}
      <Box size={[0.032, 0.014, 0.042]} position={[W / 2 - 0.032, H + 0.006, 0]} material={rocker} radius={0.004} shadow={false} />
      {anyOn && v.night && <Glow position={[W / 2 - 0.032, H + 0.04, 0]} color="#ff6a4a" opacity={0.5} size={0.16} />}
    </>
  )
  if (wall) {
    const top = STRIP_WALL_Y - 0.03
    const len = top + off
    return (
      <group>
        <group position={[0, STRIP_WALL_Y, -0.04]} rotation-x={Math.PI / 2}>
          {body}
        </group>
        <Cyl r={0.0045} h={len} position={[W / 2 - 0.015, top - len / 2, -0.03]} color={C.white} segments={8} />
      </group>
    )
  }
  return (
    <group>
      {body}
      <mesh geometry={stripCable()} position={[W / 2, 0, 0]} castShadow>
        <meshStandardMaterial color={C.white} roughness={0.6} />
      </mesh>
    </group>
  )
}

export function WallSwitch({ v }: P) {
  const led = useLitMaterial('#8d93ae', v.on, C.sun, 1, 2.5)
  return (
    <group>
      <Box size={[0.1, 0.1, 0.02]} position={[0, 1.2, -0.06]} color={C.white} radius={0.01} />
      <Box size={[0.05, 0.06, 0.015]} position={[0, 1.2, -0.045]} rotation={[v.on ? -0.18 : 0.18, 0, 0]} color={C.offWhite} shadow={false} />
      <Ball r={0.008} position={[0, 1.24, -0.04]} material={led} shadow={false} />
    </group>
  )
}

export function Camera({ v }: P) {
  const ledRef = useRef<THREE.Mesh>(null)
  useAmbient(v.on)
  useFrame(({ clock }) => {
    if (ledRef.current) ledRef.current.visible = v.on && Math.sin(clock.elapsedTime * 4) > -0.2
  })
  return (
    <group position={[0, 2.3, 0]}>
      <Box size={[0.06, 0.06, 0.08]} position={[0, 0, -0.06]} color={C.white} shadow={false} />
      <group rotation={[0.45, 0, 0]}>
        <Box size={[0.13, 0.11, 0.18]} position={[0, -0.03, 0.04]} color={C.white} radius={0.03} />
        <Cyl r={0.035} h={0.02} position={[0, -0.03, 0.135]} rotation={[Math.PI / 2, 0, 0]} color={C.ink} shadow={false} />
        <mesh ref={ledRef} position={[0.045, 0.005, 0.135]}>
          <sphereGeometry args={[0.009, 8, 8]} />
          <meshBasicMaterial color={C.alarm} toneMapped={false} />
        </mesh>
      </group>
    </group>
  )
}

const DOCK = new THREE.Vector3(0, 0, 0.22)

export function RobotVacuum({ v }: P) {
  const body = useRef<THREE.Group>(null)
  const invalidate = useThree((s) => s.invalidate)
  useAmbient(v.on)
  useEffect(() => invalidate(), [v.on, invalidate])
  useFrame((state) => {
    const g = body.current
    if (!g) return
    if (v.on) {
      const t = state.clock.elapsedTime * 0.5
      g.position.set(Math.sin(t) * 0.8, 0, Math.cos(t * 0.7) * 0.6 + 0.6)
      g.rotation.y = t
      markShadows(1)
    } else if (g.position.distanceToSquared(DOCK) > 1e-5) {
      // Returning to the dock: request frames until it arrives.
      g.position.lerp(DOCK, 0.1)
      markShadows(1)
      state.invalidate()
    }
  })
  return (
    <group>
      <Box size={[0.36, 0.12, 0.12]} position={[0, 0.06, -0.06]} color={C.ink} radius={0.03} />
      <group ref={body} position={[0, 0, 0.22]}>
        <Cyl r={0.17} h={0.08} position={[0, 0.04, 0]} color={C.white} />
        <Cyl r={0.06} h={0.02} position={[0, 0.09, 0.02]} color={v.on ? C.ok : C.steel} shadow={false} />
      </group>
    </group>
  )
}

/** Battery and bolt shapes (charging badge): horizontal battery frame, its tip, three filled bars, a bolt. Built once. */
let chargeGeos: { frame: THREE.ShapeGeometry; bars: THREE.ShapeGeometry; bolt: THREE.ShapeGeometry } | null = null
function chargeGeometries() {
  if (chargeGeos) return chargeGeos
  const rect = (x0: number, y0: number, x1: number, y1: number) => new THREE.Shape().moveTo(x0, y0).lineTo(x1, y0).lineTo(x1, y1).lineTo(x0, y1).closePath()
  const outer = rect(-0.5, -0.28, 0.5, 0.28)
  outer.holes.push(rect(-0.43, -0.21, 0.43, 0.21))
  const bars = [0, 1, 2].map((i) => rect(-0.38 + i * 0.27, -0.16, -0.38 + i * 0.27 + 0.22, 0.16))
  const bolt = new THREE.Shape().moveTo(0.07, 0.34).lineTo(-0.16, -0.03).lineTo(-0.01, -0.03).lineTo(-0.08, -0.34).lineTo(0.16, 0.05).lineTo(0.01, 0.05).closePath()
  chargeGeos = { frame: new THREE.ShapeGeometry([outer, rect(0.5, -0.11, 0.58, 0.11)]), bars: new THREE.ShapeGeometry(bars), bolt: new THREE.ShapeGeometry(bolt) }
  return chargeGeos
}

/**
 * Charging badge: a green battery with filled bars and a white bolt above the item, facing the camera. Static (requests
 * no frames), excluded from the selection box.
 */
function ChargeBadge({ y }: { y: number }) {
  const g = chargeGeometries()
  return (
    <Billboard position={[0, y, 0]}>
      <group scale={0.17}>
        <mesh geometry={g.frame} renderOrder={12} userData={{ selectionAid: true }}>
          <meshBasicMaterial color="#2fbf71" toneMapped={false} />
        </mesh>
        <mesh geometry={g.bars} position-z={0.001} renderOrder={12} userData={{ selectionAid: true }}>
          <meshBasicMaterial color="#2fbf71" toneMapped={false} />
        </mesh>
        <mesh geometry={g.bolt} position-z={0.002} renderOrder={13} userData={{ selectionAid: true }}>
          <meshBasicMaterial color="#ffffff" toneMapped={false} />
        </mesh>
      </group>
    </Billboard>
  )
}

/**
 * Cordless stick vacuum on its floor dock (typically bound to the charger plug): base plate, post against the wall, hanger
 * on top; the vacuum hangs on it: floor head and brush, tube (Item.body color), clear dust bin and cyclone, motor head,
 * handle, battery. While charging (bound plug on, or the vacuum docked and charging) the hanger light is blue. While the
 * vacuum entity is cleaning, the vacuum is not shown on the dock. Back at -z (wall).
 */
export function StickVacuum({ v }: P) {
  const color = v.opts.body ?? '#c8323c'
  const vacState = v.domain === 'vacuum' ? v.state : (v.related.find((e) => domainOf(e.entity_id) === 'vacuum')?.state ?? '')
  const away = vacState === 'cleaning' || vacState === 'returning'
  const plug = v.domain === 'switch' ? v.on : v.related.some((e) => domainOf(e.entity_id) === 'switch' && isActive(e))
  const charging = !away && (plug || vacState === 'docked' || vacState === 'charging')
  const led = useLitMaterial('#5a5f70', charging, '#3d8bff', 1, 2.6)
  const dock = '#3a3d47'
  const dark = '#24262d'
  const nickel = '#b8bcc8'
  const bin = mat('#dbe4f0', { roughness: 0.08, opacity: 0.5 })
  return (
    <group>
      {/* dock */}
      <Box size={[0.26, 0.018, 0.24]} position={[0, 0.009, 0]} color={dock} radius={0.008} />
      <Box size={[0.06, 1.12, 0.035]} position={[0, 0.56, -0.115]} color={dock} radius={0.01} />
      <Box size={[0.11, 0.05, 0.09]} position={[0, 1.09, -0.075]} color={dock} radius={0.012} />
      <Cyl r={0.02} h={0.09} position={[0.055, 0.72, -0.1]} color={dark} segments={16} />
      <Ball r={0.0065} position={[0, 1.1, -0.029]} material={led} shadow={false} />
      {charging && <ChargeBadge y={1.32} />}
      {!away && (
        <group position={[0, 0, -0.01]}>
          {/* floor head and brush */}
          <Box size={[0.25, 0.045, 0.1]} position={[0, 0.042, 0.04]} color={dark} radius={0.018} />
          <Cyl r={0.024} h={0.23} position={[0, 0.036, 0.086]} rotation={[0, 0, Math.PI / 2]} color={color} segments={16} />
          <Box size={[0.05, 0.05, 0.05]} position={[0, 0.085, 0.0]} color={nickel} radius={0.012} />
          {/* tube */}
          <Cyl r={0.016} h={0.7} position={[0, 0.46, -0.012]} color={color} segments={16} />
          {/* bin, cyclone, motor */}
          <Cyl r={0.05} h={0.2} position={[0, 0.91, 0.01]} material={bin} segments={28} shadow={false} />
          <Cyl r={0.028} h={0.19} position={[0, 0.91, 0.01]} color={nickel} segments={20} />
          <Cyl r={0.044} h={0.09} position={[0, 1.055, 0.01]} color={nickel} segments={28} />
          <Cyl r={0.03} h={0.022} position={[0, 1.11, 0.01]} color={color} segments={24} />
          {/* handle and battery */}
          <Box size={[0.032, 0.17, 0.035]} position={[0, 0.99, -0.07]} rotation={[-0.25, 0, 0]} color={dark} radius={0.01} />
          <Box size={[0.055, 0.085, 0.05]} position={[0, 0.87, -0.065]} color={dark} radius={0.012} />
        </group>
      )}
    </group>
  )
}

export function AlarmPanel({ v }: P) {
  const color = v.state === 'disarmed' ? C.ok : v.state === 'triggered' ? C.alarm : v.state.startsWith('armed') ? C.alarm : C.warn
  const screen = useLitMaterial(C.screenOff, v.bound && !v.unavailable, color, 0.8, 1.5)
  return (
    <group>
      <Box size={[0.2, 0.28, 0.03]} position={[0, 1.45, -0.06]} color={C.white} radius={0.02} />
      <Box size={[0.15, 0.07, 0.01]} position={[0, 1.53, -0.04]} material={screen} shadow={false} />
      {[0, 1, 2].map((r) => [0, 1, 2].map((c) => <Box key={`${r}${c}`} size={[0.03, 0.025, 0.01]} position={[-0.045 + c * 0.045, 1.44 - r * 0.04, -0.04]} color={C.steel} shadow={false} />))}
      {v.state === 'triggered' && <Glow position={[0, 1.5, 0.1]} color={C.alarm} opacity={0.8} size={0.9} />}
    </group>
  )
}

/* ---------- sensors ---------- */

export function MotionSensor({ v }: P) {
  const lens = useLitMaterial(C.white, v.on, C.alarm, 0.6, 1.5)
  return (
    <group>
      <Box size={[0.08, 0.08, 0.05]} position={[0, 2.25, -0.06]} color={C.white} radius={0.02} />
      <Ball r={0.03} position={[0, 2.24, -0.02]} material={lens} shadow={false} />
      <Ripple active={v.on} color={C.brand} at={[0, 0.03, 1.1]} />
    </group>
  )
}

export function TempSensor({ v }: P) {
  const screen = useLitMaterial(C.screenOff, v.bound && !v.unavailable, '#b8c4ff', 0.4, 1)
  return (
    <group>
      <Box size={[0.09, 0.09, 0.025]} position={[0, 1.4, -0.065]} color={C.white} radius={0.015} />
      <Box size={[0.06, 0.04, 0.005]} position={[0, 1.41, -0.05]} material={screen} shadow={false} />
    </group>
  )
}

export function VibrationSensor({ v }: P) {
  const g = useRef<THREE.Group>(null)
  useAmbient(v.on)
  useFrame(({ clock }) => {
    if (g.current) g.current.rotation.z = v.on ? Math.sin(clock.elapsedTime * 40) * 0.12 : 0
  })
  return (
    <group ref={g}>
      <Cyl r={0.04} h={0.02} position={[0, 0.01, 0]} color={C.white} />
      <Ball r={0.008} position={[0, 0.025, 0]} color={v.on ? C.warn : C.steel} shadow={false} />
    </group>
  )
}

/* ---------- doors and windows: they sit inside the wall, the wall opens for them ---------- */

/*
 * Local layout (APERTURE_INSET = 0.21): the item origin is in front of the inner wall face;
 * the room edge (border between two rooms) is at z = -0.21; the wall is centered on it: -0.26..-0.16 (inner face -0.16).
 * The frame sits on the border and covers the wall from both sides.
 */
const EDGE_Z = -APERTURE_INSET
const FULL_H = 2.23
const _p = new THREE.Vector3()
const _d = new THREE.Vector3()

/** How tall the wall around a door/window is: low for interior walls and in plan view, cut on outer walls facing the camera. */
function useWallHeight(ref: React.RefObject<THREE.Group | null>, interior: boolean, apply: (h: number) => void) {
  const h = useRef(FULL_H)
  const invalidate = useThree((s) => s.invalidate)
  const innerFull = useView((s) => s.innerWalls === 'full')
  useEffect(() => invalidate(), [interior, innerFull, invalidate])
  useFrame((state, dt) => {
    const { camera } = state
    const g = ref.current
    if (!g) return
    let target = FULL_H
    // Full height in walk mode and while the roof is down (same as RoomMesh > Wall; otherwise the wall is full height but
    // the window stays at the cut height and disappears)
    if (useView.getState().fps || roofView.covered) target = FULL_H
    else if (useView.getState().plan) target = WALL_INNER_H
    else if (interior) target = innerFull ? FULL_H : WALL_INNER_H
    else {
      g.getWorldPosition(_p)
      g.getWorldDirection(_d) // local +z: into the room; the outer normal is the opposite
      const dx = camera.position.x - _p.x
      const dz = camera.position.z - _p.z
      if ((-_d.x * dx - _d.z * dz) / (Math.hypot(dx, dz) || 1) > 0.2) target = WALL_CUT_H
    }
    const d = target - h.current
    if (Math.abs(d) < 0.001) return
    h.current += d * Math.min(1, dt * 8)
    apply(h.current)
    // Request frames and shadows until the transition ends (on demand rendering).
    markShadows(1)
    state.invalidate()
  })
}

/**
 * Flips the leaf to its hinge side (x mirror) and swing direction (z mirror about the wall line).
 * three draws negative scale correctly (face winding and shadows fix themselves).
 */
function Mirror({ x, z, children }: { x: boolean; z: boolean; children: React.ReactNode }) {
  return (
    <group scale-x={x ? -1 : 1}>
      <group position-z={EDGE_Z} scale-z={z ? -1 : 1}>
        <group position-z={-EDGE_Z}>{children}</group>
      </group>
    </group>
  )
}

/**
 * Quarter circle on the floor from the hinge toward the swing direction (floor plan mark). Filled for doors;
 * outline only for windows, so it does not look like a door and stays visible when the wall is low.
 */
function SwingArc({ at, r, strong, outline = false }: { at: [number, number, number]; r: number; strong: boolean; outline?: boolean }) {
  return (
    <group position={at} rotation-x={-Math.PI / 2}>
      <mesh renderOrder={2} userData={{ selectionAid: true }}>
        <ringGeometry args={[r, r + (outline ? 0.018 : 0.025), 40, 1, -Math.PI / 2, Math.PI / 2]} />
        <meshBasicMaterial color={C.brand} transparent opacity={strong ? 0.6 : 0.45} depthWrite={false} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      {!outline && (
        <mesh renderOrder={1} userData={{ selectionAid: true }}>
          <circleGeometry args={[r, 40, -Math.PI / 2, Math.PI / 2]} />
          <meshBasicMaterial color={C.brand} transparent opacity={strong ? 0.12 : 0.07} depthWrite={false} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  )
}

/** Door state from the main and related entities: whether the door sensor / cover is open, lock state. */
function doorState(v: Visual) {
  const contacts = v.related.filter((e) => {
    const d = domainOf(e.entity_id)
    return d === 'cover' || (d === 'binary_sensor' && ['door', 'window', 'opening', 'garage_door'].includes(deviceClass(e)))
  })
  const mainContact = v.domain === 'binary_sensor' || v.domain === 'cover'
  const lock = v.domain === 'lock' ? v.state : v.related.find((e) => domainOf(e.entity_id) === 'lock')?.state
  const hasContact = mainContact || contacts.length > 0
  const sensedOpen = (mainContact && v.on) || contacts.some((e) => isActive(e))
  // Without a sensor: an interior door is drawn open (passage), an exterior door closed; closed when locked.
  const open = hasContact ? sensedOpen : lock === 'locked' ? false : v.interior
  return { open, sensedOpen, lock }
}

export function Door({ v }: P) {
  // No swing arc (floor plan mark) in walk mode
  const fps = useView((s) => s.fps)
  const root = useRef<THREE.Group>(null)
  const tall = useRef<THREE.Group>(null)
  const { open, sensedOpen, lock } = doorState(v)
  // A person, pet or the walk mode player passing by opens the door (scene/doorTraffic.ts; does not touch HA)
  const passing = useDoorTraffic((s) => (v.at ? Boolean(s.open[doorKey(v.at.x, v.at.z)]) : false))
  const leaf = useEased(open || passing ? -Math.PI / 2 + 0.08 : 0)
  const lockColor = lock ? (lock === 'locked' ? C.alarm : C.ok) : C.sun
  useWallHeight(root, v.interior, (h) => {
    if (tall.current) tall.current.scale.y = Math.max(0.02, h / FULL_H)
  })
  return (
    <group ref={root}>
      <group ref={tall}>
        <Box size={[0.08, 2.19, 0.24]} position={[-0.5, 1.095, EDGE_Z]} color={C.white} />
        <Box size={[0.08, 2.19, 0.24]} position={[0.5, 1.095, EDGE_Z]} color={C.white} />
        <Box size={[1.08, 0.08, 0.24]} position={[0, 2.19, EDGE_Z]} color={C.white} />
        <Mirror x={v.hingeRight} z={v.swingOut}>
          <group ref={leaf} position={[-0.46, 0, -0.12]}>
            <Box size={[0.92, 2.12, 0.045]} position={[0.46, 1.06, 0]} color={C.brand} radius={0.015} />
            <Box size={[0.66, 0.78, 0.01]} position={[0.46, 1.5, 0.026]} color={C.brandDark} shadow={false} />
            <Ball r={0.035} position={[0.82, 1.02, 0.05]} color={lockColor} />
          </group>
        </Mirror>
      </group>
      {/* threshold: between the floors of the two rooms */}
      <Box size={[0.92, 0.012, v.interior ? 0.42 : 0.22]} position={[0, 0.006, EDGE_Z]} color={C.woodFloor} shadow={false} />
      <Mirror x={v.hingeRight} z={v.swingOut}>
        {/* Swing arc (floor plan mark): always on interior doors, on all doors in edit mode. */}
        {(v.interior || v.edit) && !fps && <SwingArc at={[-0.46, 0.012, -0.12]} r={0.9} strong={v.edit} />}
        {sensedOpen && <Box size={[0.9, 0.01, 0.9]} position={[0, 0.008, 0.4]} material={mat(C.sun, { opacity: 0.25 })} shadow={false} />}
      </Mirror>
    </group>
  )
}

/** Window covering motor bound to the window (cover; main or related): opening % (current_position) and slat tilt % (current_tilt_position). */
function coverOf(v: Visual) {
  const e = v.domain === 'cover' ? { state: v.state, attributes: v.attrs } : v.related.find((x) => domainOf(x.entity_id) === 'cover')
  if (!e) return null
  const st = e.state
  const pos = num(e.attributes.current_position) ?? (st === 'open' || st === 'opening' ? 100 : st === 'closing' ? 50 : 0)
  return { pos: Math.min(100, Math.max(0, pos)), tilt: num(e.attributes.current_tilt_position) }
}

/** Whether the window sash is open: from a bound window/opening sensor (a cover motor does not open the sash). */
function sashOpen(v: Visual) {
  const contact = (dc: string) => dc === '' || ['window', 'opening', 'door'].includes(dc)
  if (v.domain === 'binary_sensor' && v.on && contact(String(v.attrs.device_class ?? ''))) return true
  return v.related.some((e) => domainOf(e.entity_id) === 'binary_sensor' && contact(deviceClass(e)) && isActive(e))
}

/** Eases toward a value and calls apply on each step (while a cover opens or closes); requests frames until done. */
function useFollow(target: number, apply: (v: number) => void, reset: unknown) {
  const cur = useRef<number | null>(null)
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    cur.current = null
    invalidate()
  }, [reset, invalidate])
  useEffect(() => invalidate(), [target, invalidate])
  useFrame((state, dt) => {
    if (cur.current === null) {
      cur.current = target
      apply(target)
      return
    }
    const d = target - cur.current
    if (Math.abs(d) < 0.002) {
      if (cur.current !== target) {
        cur.current = target
        apply(target)
      }
      return
    }
    cur.current += d * Math.min(1, dt * 4)
    apply(cur.current)
    markShadows(1)
    state.invalidate()
  })
}

/** Band pitch of a zebra blind (one opaque + sheer pair); slat pitch of venetian blinds */
const ZEBRA_PITCH = 0.1
const SLAT_PITCH = 0.07

/** Curtain panel: drawn 1 m wide and h tall; narrows and widens with the group scale; vertical folds as dark stripes. */
function CurtainPanel({ fabric, fold, h }: { fabric: string; fold: string; h: number }) {
  return (
    <>
      <Box size={[1, h, 0.04]} position={[0, 0, 0]} color={fabric} radius={0.015} />
      {[-0.3, 0, 0.3].map((x) => (
        <Box key={x} size={[0.06, h - 0.02, 0.045]} position={[x, 0, 0.002]} color={fold} shadow={false} />
      ))}
    </>
  )
}
const darker = (hex: string, k = 0.82) => `#${new THREE.Color(hex).multiplyScalar(k).getHexString()}`

/**
 * Window covering. Type from Item.variant: 'curtain' (gathers to both sides), 'roller' (comes down from the top), 'blinds'
 * venetian blinds (slats come down, their angle turns), 'none'. Opening from the bound cover motor's current_position (100
 * fully open); without one, the type's default. Color from Item.body.
 * 'zebra' zebra blind: comes down like a roller; opaque bands on a sheer base, current_tilt_position sets the band alignment
 * (100 aligned: bands half covered, the outside shows through the sheer gaps; 0: the bands cover the sheer).
 * Sizes from the window: width W, bottom edge B, top edge T; curtains do not touch the floor (height offset yoff).
 */
function Shade({ v, W, B, T, yoff }: P & { W: number; B: number; T: number; yoff: number }) {
  const type = v.opts.variant ?? 'curtain'
  const cover = coverOf(v)
  const fabric = v.opts.body ?? C.brandLight
  const fold = useMemo(() => darker(fabric), [fabric])
  const open = cover ? cover.pos / 100 : type === 'curtain' ? 0.9 : type === 'roller' ? 0.75 : 0
  const tilt = cover?.tilt != null ? cover.tilt / 100 : 1
  const left = useRef<THREE.Group>(null)
  const right = useRef<THREE.Group>(null)
  const roll = useRef<THREE.Group>(null)
  const bar = useRef<THREE.Mesh>(null)
  const slats = useRef<(THREE.Mesh | null)[]>([])
  const bands = useRef<(THREE.Mesh | null)[]>([])
  const IH = T - B - 0.07
  const nZebra = Math.max(1, Math.floor(IH / ZEBRA_PITCH))
  const nSlats = Math.max(4, Math.round(IH / SLAT_PITCH))
  const anchor = W / 2 + 0.1
  const reset = `${type}-${W}-${T - B}`

  useFollow(
    open,
    (f) => {
      if (type === 'curtain') {
        // Closed, the two panels meet in the middle; open, they gather at the sides (attached to the rod ends).
        const ow = 0.12 + 0.035 * W
        const w = ow + (1 - f) * (W / 2 + 0.12 - ow)
        if (left.current) {
          left.current.scale.x = w
          left.current.position.x = -anchor + w / 2
        }
        if (right.current) {
          right.current.scale.x = w
          right.current.position.x = anchor - w / 2
        }
      } else if (type === 'roller' || type === 'zebra') {
        const h = 0.05 + (1 - f) * (IH - 0.05)
        if (roll.current) {
          roll.current.scale.y = h
          roll.current.position.y = T - h / 2
        }
        if (bar.current) bar.current.position.y = T - h
        // Zebra: bands appear as the fabric comes down (the rolled up ones are hidden)
        bands.current.forEach((m, i) => {
          if (m) m.visible = (i + 1) * ZEBRA_PITCH <= h + 0.02
        })
      } else if (type === 'blinds') {
        // Open (100): slats stack at the top; closed: spread over the window height.
        slats.current.forEach((m, i) => {
          if (!m) return
          m.position.y = T - 0.02 - (i + 0.5) * (IH / nSlats) * (1 - f) - i * 0.005 * f
        })
      }
    },
    reset,
  )
  useFollow(
    tilt,
    (t) => {
      // Zebra: band thickness follows the alignment (half: sheer gaps open; full: closed)
      if (type === 'zebra') {
        bands.current.forEach((m) => {
          if (m) m.scale.y = 0.5 + 0.5 * (1 - t)
        })
        return
      }
      if (type !== 'blinds') return
      // HA tilt 100: slats horizontal (light passes); 0: vertical, closed.
      slats.current.forEach((m) => {
        if (m) m.rotation.x = (1 - t) * 1.35
      })
    },
    reset,
  )

  if (type === 'none') return null
  if (type === 'curtain') {
    // Rod 10 cm above the top edge; panels from below the rod to 23 cm below the sill (2 cm above the floor for a floor-to-ceiling window)
    const top = T + 0.07
    const bottom = Math.max(B - 0.23, 0.02 - yoff)
    const ph = top - bottom
    const cy = (top + bottom) / 2
    return (
      <group>
        <Box size={[W + 0.5, 0.03, 0.03]} position={[0, T + 0.1, 0.02]} color={C.kraftDark} shadow={false} />
        <group ref={left} position={[-anchor + 0.3, cy, 0]}>
          <CurtainPanel fabric={fabric} fold={fold} h={ph} />
        </group>
        <group ref={right} position={[anchor - 0.3, cy, 0]}>
          <CurtainPanel fabric={fabric} fold={fold} h={ph} />
        </group>
      </group>
    )
  }
  // Roller and blinds sit on the inner side of the glass, near the inner wall face (from above the glass is opaque, so outside they would not show).
  // They cast shadows: a closed roller blocks the sun, blind slats throw striped sunlight (walk mode).
  const z = EDGE_Z + WALL_IN + 0.025
  if (type === 'zebra')
    return (
      <group>
        <Cyl r={0.032} h={W + 0.04} position={[0, T + 0.02, z]} rotation={[0, 0, Math.PI / 2]} color={C.white} segments={14} shadow={false} />
        <group ref={roll} position={[0, T - 0.5, z]}>
          <mesh renderOrder={2}>
            <boxGeometry args={[W - 0.04, 1, 0.004]} />
            <meshStandardMaterial color="#ffffff" transparent opacity={0.4} depthWrite={false} roughness={0.8} />
          </mesh>
        </group>
        {Array.from({ length: nZebra }, (_, i) => (
          <mesh
            key={i}
            ref={(m) => {
              bands.current[i] = m
            }}
            position={[0, T - (i + 0.5) * ZEBRA_PITCH, z + 0.004]}
            castShadow
          >
            <boxGeometry args={[W - 0.04, ZEBRA_PITCH, 0.004]} />
            <meshStandardMaterial color={fabric} roughness={0.7} />
          </mesh>
        ))}
        <mesh ref={bar} position={[0, B + 0.05, z]}>
          <boxGeometry args={[W - 0.02, 0.025, 0.02]} />
          <meshStandardMaterial color={fold} roughness={0.5} />
        </mesh>
      </group>
    )
  if (type === 'roller')
    return (
      <group>
        <Cyl r={0.03} h={W + 0.02} position={[0, T + 0.02, z]} rotation={[0, 0, Math.PI / 2]} color={C.white} segments={14} shadow={false} />
        <group ref={roll} position={[0, T - 0.5, z]}>
          <Box size={[W - 0.04, 1, 0.006]} position={[0, 0, 0]} color={fabric} />
        </group>
        <mesh ref={bar} position={[0, B + 0.05, z]}>
          <boxGeometry args={[W - 0.02, 0.025, 0.02]} />
          <meshStandardMaterial color={fold} roughness={0.5} />
        </mesh>
      </group>
    )
  return (
    <group>
      <Box size={[W - 0.02, 0.035, 0.04]} position={[0, T - 0.01, z]} color={C.white} shadow={false} />
      {Array.from({ length: nSlats }, (_, i) => (
        <mesh
          key={i}
          ref={(m) => {
            slats.current[i] = m
          }}
          position={[0, T - 0.1, z]}
          castShadow
        >
          <boxGeometry args={[W - 0.08, 0.004, 0.05]} />
          <meshStandardMaterial color={fabric} roughness={0.45} />
        </mesh>
      ))}
    </group>
  )
}

/**
 * Window with adjustable size: width W (Item.len, default 1.2), height H (Item.len2, 1.2), bottom edge 0.9 m (moved up or
 * down by Item.y; 8 cm above the floor for a floor-to-ceiling window). The wall opening has the same size (geometry.ts >
 * apertureOf). A sill only when the bottom edge is more than 30 cm above the floor.
 */
export function Window({ v }: P) {
  const root = useRef<THREE.Group>(null)
  const full = useRef<THREE.Group>(null)
  const glyph = useRef<THREE.Mesh>(null)
  const { w: W, h: H } = windowSize(v.opts)
  const B = WINDOW_BOTTOM
  const T = B + H
  const yoff = v.at?.y ?? 0
  const gw = W - 0.06
  const gh = H - 0.06
  // The sash opens into the room by default (negative rotation toward local +z, into the room); only with a window sensor.
  const sash = useEased(sashOpen(v) ? -0.5 : 0)
  // With a low wall the window is hidden; a thin glass line on top of the low wall stands in for it (floor plan mark).
  useWallHeight(root, v.interior, (h) => {
    const low = h < 1.2
    if (full.current) full.current.visible = !low
    if (glyph.current) {
      glyph.current.visible = low
      glyph.current.position.y = h + 0.012 - yoff
    }
  })
  // Glass is transparent in walk mode: garden and sky show from inside (opaque light blue from above)
  const fps = useView((s) => s.fps)
  const glass = fps ? mat(C.glass, { opacity: 0.12, roughness: 0.05 }) : mat(C.glass, { emissive: '#9fc8ff', emissiveIntensity: 0.25, roughness: 0.2 })
  return (
    <group ref={root}>
      <group ref={full}>
        {/* frame: around the opening, inside the wall */}
        <Box size={[W + 0.04, 0.06, 0.22]} position={[0, B, EDGE_Z]} color={C.white} />
        <Box size={[W + 0.04, 0.06, 0.22]} position={[0, T, EDGE_Z]} color={C.white} />
        <Box size={[0.06, H, 0.22]} position={[-W / 2, B + H / 2, EDGE_Z]} color={C.white} />
        <Box size={[0.06, H, 0.22]} position={[W / 2, B + H / 2, EDGE_Z]} color={C.white} />
        <Mirror x={v.hingeRight} z={v.swingOut}>
          <group ref={sash} position={[-gw / 2, 0, EDGE_Z + 0.04]}>
            <Box size={[gw, gh, 0.025]} position={[gw / 2, B + H / 2, 0]} material={glass} shadow={false} />
            <Box size={[0.03, gh, 0.035]} position={[gw / 2, B + H / 2, 0]} color={C.white} shadow={false} />
          </group>
        </Mirror>
        {B + yoff > 0.3 && <Box size={[W + 0.3, 0.04, 0.2]} position={[0, B - 0.03, EDGE_Z + WALL_IN + 0.1]} color={C.white} />}
        <Shade v={v} W={W} B={B} T={T} yoff={yoff} />
      </group>
      {/* Sash swing direction in edit mode: outline arc on the floor (visible when the wall is low too) */}
      {v.edit && (
        <Mirror x={v.hingeRight} z={v.swingOut}>
          <SwingArc at={[-gw / 2, 0.014 - yoff, EDGE_Z + 0.04]} r={gw - 0.04} strong outline />
        </Mirror>
      )}
      <mesh ref={glyph} position={[0, WALL_INNER_H + 0.012 - yoff, EDGE_Z]} visible={false} material={glass}>
        <boxGeometry args={[W - 0.04, 0.024, 0.12]} />
      </mesh>
    </group>
  )
}
