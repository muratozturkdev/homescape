import * as THREE from 'three'
import { deviceClass, isActive, lightColor, lightLevel } from '@/ha/derive'
import type { HassEntity } from '@/ha/types'
import { bindingsOf, ledOf, ledSource } from '@/model/bindings'
import { BEAM } from '@/model/catalog'
import { apertureOf, doorSides, isOutdoor, rectsOf, roomAt, WALL_H, WALL_T } from '@/model/geometry'
import type { Item, ItemKind, Level, Rect } from '@/model/types'
import { STREET_LAMP_AUTO } from './kit/palette'
import { DEFAULT_Y } from './kit/registry'

/*
 * Room lights: light must not pass through walls, and a light in the hallway should light a large area. three.js point
 * lights know nothing about walls (an unshadowed light also lights the other side of a wall) and many of them are
 * expensive. Instead every MeshStandardMaterial gets a small addition:
 * - Each lamp only lights surfaces inside the rectangles of ITS OWN ROOM (room mask). Walls stand inside the room
 *   (geometry.ts > wallRuns); their outer faces lie exactly on the room boundary, so they stay outside the mask.
 * - The falloff is soft: a ceiling lamp (chandelier) takes its range from the room's diagonal and fills the whole room.
 * - Kinds: 0 point (chandelier, floor lamp, sconce...), 1 recessed spot (downward cone), 2 ceiling strip (room sized, top
 *   down: upper walls brighter, floor even), 3 line (LED strip: light comes from the strip's NEAREST point to the surface,
 *   so a long strip lights evenly along its length).
 * - Light passes through an open interior door into the next room: a second entry per door with the same source (same
 *   position, color, falloff) but only in the neighboring room and only where seen from the source THROUGH THE DOOR
 *   OPENING (the ray must cross the door plane inside the opening; edges 6 cm soft). A door-shaped patch of light falls
 *   in the next room. Not when the door sensor reports closed or the door is locked; an interior door without a sensor
 *   counts as open (same rule as Door).
 * - At most HS_MAX lights; no shadows, no extra draws, just a short loop in the fragment shader.
 * - Kind 4, daylight (first person walk mode only; the ceiling blocks the sun from above, so it comes through windows and
 *   doors): every window facing outside and every open exterior door gives the room skylight. The source is the point of
 *   the opening's rectangle nearest to the surface and the light spreads into the room (along the opening's normal):
 *   bright near the window, fading deeper in the room. Curtains, roller blinds and venetian blinds reduce it as they
 *   close. When the sun hits that window, the bounce of the sun patch on the floor is added. Direct sun (the patches)
 *   comes from the shadowed sun light in Scene > Lights.
 * In daylight lamps contribute little (DAY_FACTOR; more in walk mode where the inside is dimmer); at night they are the
 * main light source.
 */

export const HS_MAX = 24
const HS_RECTS = 4
const DAY_FACTOR = 0.3
const FPS_DAY_FACTOR = 0.65
/** Daylight (kind 4): noon power of an open 1.2 x 1.2 m window; color of the sky and of the sun falling inside */
const WINDOW_POWER = 2.3
const SKY_TINT = new THREE.Color('#d4e2ff')
const SUN_TINT = new THREE.Color('#fff0d8')

const hsUniforms = {
  hsCount: { value: 0 },
  hsPos: { value: Array.from({ length: HS_MAX }, () => new THREE.Vector4()) },
  hsCol: { value: Array.from({ length: HS_MAX }, () => new THREE.Vector4()) },
  hsRect: { value: Array.from({ length: HS_MAX * HS_RECTS }, () => new THREE.Vector4(1, 1, 0, 0)) },
  /**
   * Opening for light through a door: (plane, span start, span end, 0 none | 1 horizontal wall z=plane | 2 vertical wall x=plane).
   * For daylight (kind 4) the opening's normal facing the room and minus half its height: (nx, ny, nz, -h).
   */
  hsPortal: { value: Array.from({ length: HS_MAX }, () => new THREE.Vector4()) },
  /** Line light: direction of the strip (unit) and half its length */
  hsAxis: { value: Array.from({ length: HS_MAX }, () => new THREE.Vector4()) },
  /** Height range of the light (low, high): an indoor light stays between its floor and its ceiling */
  hsY: { value: Array.from({ length: HS_MAX }, () => new THREE.Vector2(-1e5, 1e5)) },
}

const VERT_DECL = /* glsl */ `
varying vec3 vHsWorld;`

const VERT_MAIN = /* glsl */ `
{
  vec4 hsW = vec4( transformed, 1.0 );
  #ifdef USE_BATCHING
    hsW = batchingMatrix * hsW;
  #endif
  #ifdef USE_INSTANCING
    hsW = instanceMatrix * hsW;
  #endif
  vHsWorld = ( modelMatrix * hsW ).xyz;
}`

const FRAG_DECL = /* glsl */ `
uniform int hsCount;
uniform vec4 hsPos[ ${HS_MAX} ];
uniform vec4 hsCol[ ${HS_MAX} ];
uniform vec4 hsRect[ ${HS_MAX * HS_RECTS} ];
uniform vec4 hsPortal[ ${HS_MAX} ];
uniform vec4 hsAxis[ ${HS_MAX} ];
uniform vec2 hsY[ ${HS_MAX} ];
varying vec3 vHsWorld;`

const FRAG_MAIN = /* glsl */ `
if ( hsCount > 0 ) {
  vec3 hsN = inverseTransformDirection( normal, viewMatrix );
  vec3 hsIrr = vec3( 0.0 );
  for ( int i = 0; i < ${HS_MAX}; i ++ ) {
    if ( i >= hsCount ) break;
    bool hsIn = false;
    int hsParts = 0;
    for ( int r = 0; r < ${HS_RECTS}; r ++ ) {
      vec4 rc = hsRect[ i * ${HS_RECTS} + r ];
      if ( rc.x < rc.z ) hsParts ++;
      if ( vHsWorld.x > rc.x && vHsWorld.x < rc.z && vHsWorld.z > rc.y && vHsWorld.z < rc.w ) hsIn = true;
    }
    if ( ! hsIn ) continue;
    // Within the floor in height too: does not light the roof or the floors above and below
    if ( vHsWorld.y < hsY[ i ].x || vHsWorld.y > hsY[ i ].y ) continue;
    vec4 P = hsPos[ i ];
    vec4 Cl = hsCol[ i ];
    // Light through a door: the ray from the source to the surface must cross the door plane inside the opening.
    vec4 Pt = hsPortal[ i ];
    float vis = 1.0;
    if ( Pt.w > 0.5 ) {
      bool hz = Pt.w < 1.5;
      float pa = hz ? P.z : P.x;
      float fa = hz ? vHsWorld.z : vHsWorld.x;
      if ( abs( fa - pa ) < 1e-4 ) continue;
      float t = ( Pt.x - pa ) / ( fa - pa );
      if ( t <= 0.0 || t >= 1.0 ) continue;
      vec3 X = P.xyz + t * ( vHsWorld - P.xyz );
      float al = hz ? X.x : X.z;
      vis = smoothstep( Pt.y, Pt.y + 0.06, al ) * ( 1.0 - smoothstep( Pt.z - 0.06, Pt.z, al ) ) * ( 1.0 - smoothstep( 2.1, 2.2, X.y ) );
      if ( vis <= 0.0 ) continue;
    }
    // Kind: 0 point, 1 spot, 2 ceiling strip; +10 for light through a door (no in-room bounce term)
    float sp = step( 9.5, Cl.w );
    float ty = Cl.w - 10.0 * sp;
    // For a line light the source is the strip's point nearest to the surface; for daylight within the opening's rectangle (in height too)
    vec3 Ps = P.xyz;
    if ( ty > 2.5 ) {
      vec4 ax = hsAxis[ i ];
      Ps = P.xyz + ax.xyz * clamp( dot( vHsWorld - P.xyz, ax.xyz ), - ax.w, ax.w );
      if ( ty > 3.5 ) Ps.y = P.y + clamp( vHsWorld.y - P.y, Pt.w, - Pt.w );
    }
    // In a multi-part (L, T, U) room light cannot turn a corner (otherwise the other arm of an L is as bright as the part
    // with the lamp). The segment from the source to the surface is intersected with the part boxes (per box the span
    // of the segment inside it); the part that starts at the source and stays inside without a break is found. The
    // shadow darkens smoothly with the length behind the corner; at its darkest only the bounce remains (20%).
    // Not for door spill and ceiling strips.
    if ( hsParts > 1 && sp < 0.5 && ( ty < 1.5 || ty > 2.5 ) ) {
      vec2 o = Ps.xz;
      vec2 dv = vHsWorld.xz - o;
      vec2 dd = vec2( abs( dv.x ) < 1e-5 ? 1e-5 : dv.x, abs( dv.y ) < 1e-5 ? 1e-5 : dv.y );
      float ta[ ${HS_RECTS} ];
      float tb[ ${HS_RECTS} ];
      for ( int r = 0; r < ${HS_RECTS}; r ++ ) {
        vec4 rc = hsRect[ i * ${HS_RECTS} + r ] + vec4( -0.03, -0.03, 0.03, 0.03 );
        vec2 t0 = ( rc.xy - o ) / dd;
        vec2 t1 = ( rc.zw - o ) / dd;
        vec2 lo = min( t0, t1 );
        vec2 hi = max( t0, t1 );
        ta[ r ] = rc.x < rc.z ? max( max( lo.x, lo.y ), 0.0 ) : 2.0;
        tb[ r ] = rc.x < rc.z ? min( min( hi.x, hi.y ), 1.0 ) : -1.0;
      }
      float reach = 0.0;
      for ( int pass = 0; pass < ${HS_RECTS}; pass ++ ) {
        for ( int r = 0; r < ${HS_RECTS}; r ++ ) {
          if ( ta[ r ] <= reach + 1e-3 && tb[ r ] > reach ) reach = tb[ r ];
        }
      }
      float hidden = ( 1.0 - clamp( reach, 0.0, 1.0 ) ) * length( dv );
      vis *= mix( 1.0, 0.2, smoothstep( 0.0, 0.6, hidden ) );
    }
    vec3 Lv = Ps - vHsWorld;
    float d = length( Lv );
    vec3 l = Lv / max( d, 1e-4 );
    float win = pow( clamp( 1.0 - pow( d / P.w, 4.0 ), 0.0, 1.0 ), 2.0 );
    float k;
    if ( ty > 3.5 ) {
      // daylight: spreads from the opening into the room (normal hsPortal.xyz); bright in front, fading deeper, a little even bounce
      float emit = clamp( dot( Pt.xyz, - l ), 0.0, 1.0 );
      float facing = 0.2 + 0.8 * clamp( dot( hsN, l ), 0.0, 1.0 );
      k = win * ( 0.1 + emit * facing * ( 0.9 / ( 1.0 + 0.3 * d * d ) + 0.8 / ( 1.0 + 4.0 * d * d ) ) );
    } else if ( ty < 0.5 || ty > 2.5 ) {
      // point and line: a bright pool around the source (near field, ~1 m) + a soft falloff spreading into the room + a
      // little even bounce. The light looks like it comes from the source, and the room still fills.
      float facing = 0.25 * ( 1.0 - sp ) + 0.75 * clamp( dot( hsN, l ), 0.0, 1.0 );
      k = win * ( 0.11 * ( 1.0 - sp ) + facing * ( 0.62 / ( 1.0 + 0.12 * d * d ) + 1.1 / ( 1.0 + 3.0 * d * d ) ) );
    } else if ( ty < 1.5 ) {
      // recessed spot: downward cone; cosines of the outer and inner edge in hsAxis.xy (Item.beam, spotCone) and a little bounce
      vec4 ax = hsAxis[ i ];
      float cone = smoothstep( ax.x, ax.y, l.y );
      k = win / ( 1.0 + 0.2 * d * d ) * ( cone * clamp( dot( hsN, l ), 0.0, 1.0 ) + 0.1 );
    } else {
      // ceiling strip: room sized, top down; upper walls bright, upward faces (floor, table) even
      float up = clamp( hsN.y, 0.0, 1.0 );
      float wall = 1.0 - abs( hsN.y );
      float h = clamp( vHsWorld.y / 2.5, 0.0, 1.0 );
      k = 0.22 + 0.5 * up + wall * ( 0.15 + 0.85 * h * h );
    }
    hsIrr += Cl.rgb * k * vis;
  }
  reflectedLight.directDiffuse += hsIrr * BRDF_Lambert( material.diffuseColor );
}`

/**
 * Adds room lights to all standard materials (once, when the module loads). The uniforms are shared objects: every
 * material sees the same arrays; when lights change only the arrays are updated.
 */
THREE.MeshStandardMaterial.prototype.onBeforeCompile = function (shader) {
  Object.assign(shader.uniforms, hsUniforms)
  shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>${VERT_DECL}`).replace('#include <worldpos_vertex>', `#include <worldpos_vertex>${VERT_MAIN}`)
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>${FRAG_DECL}`).replace('#include <lights_fragment_end>', `#include <lights_fragment_end>${FRAG_MAIN}`)
}

/** Room lights are turned off while drawing thumbnails (objects at the origin could fall inside a room). */
export function withoutRoomLights(fn: () => void) {
  const n = hsUniforms.hsCount.value
  hsUniforms.hsCount.value = 0
  try {
    fn()
  } finally {
    hsUniforms.hsCount.value = n
  }
}

export interface RoomLight {
  pos: [number, number, number]
  range: number
  color: THREE.Color
  /** 0 point, 1 recessed spot, 2 ceiling strip, 3 line (LED strip), 4 daylight (window, exterior door) */
  type: 0 | 1 | 2 | 3 | 4
  /** Area the light is confined to (the room's rectangles); unlimited when empty */
  rects: Rect[]
  /** Light passing through a door into the next room: the door opening (plane and span) */
  portal?: { horizontal: boolean; line: number; a0: number; a1: number }
  /** Line light (kind 3) and daylight (kind 4): world direction and half length of the strip / opening */
  axis?: [number, number, number, number]
  /** Daylight (kind 4): the opening's normal facing the room and half its height */
  normal?: [number, number, number]
  halfH?: number
  /** Alarm light (red in every room while the alarm is triggered; AlarmFlash pulses it) */
  alarm?: boolean
  /**
   * Height range (local to the active floor): an indoor light stays between floor and ceiling (clipped only horizontally,
   * a room light would also light the roof above the room, the upper floor in walk mode and the lower floor in view
   * mode). Unlimited when missing.
   */
  y?: [number, number]
}

/** Whether the door is open: by its door sensor or curtain if there is one, else open unless locked (an interior door is a passage). */
function doorOpen(door: Item, entities: Record<string, HassEntity>) {
  const bound = bindingsOf(door)
    .map((id) => entities[id])
    .filter((e): e is HassEntity => Boolean(e))
  const contacts = bound.filter((e) => e.entity_id.startsWith('cover.') || (e.entity_id.startsWith('binary_sensor.') && ['door', 'window', 'opening', 'garage_door'].includes(deviceClass(e))))
  if (contacts.length) return contacts.some((e) => isActive(e))
  return !bound.some((e) => e.entity_id.startsWith('lock.') && e.state === 'locked')
}

/** Light source of each lamp kind: local position on the item, range ('room': room diagonal), power, kind. */
const SPEC: Partial<Record<ItemKind, { at: [number, number, number]; range: number | 'room'; power: number; type: 0 | 1 | 2 | 3; half?: number }>> = {
  pendant: { at: [0, 1.85, 0], range: 'room', power: 3.6, type: 0 },
  // Floor lamps and sconces light the room more
  floorLamp: { at: [0, 1.5, 0], range: 8, power: 4.6, type: 0 },
  deskLamp: { at: [0, 0.27, 0.1], range: 2.6, power: 1.3, type: 0 },
  wallLight: { at: [0, 1.98, 0.2], range: 8, power: 5, type: 0 },
  // LED strips are stronger (otherwise counter and bedroom LEDs look far too dim)
  ledStrip: { at: [0, 0, 0.05], range: 4, power: 2.4, type: 3, half: 1 },
  mirrorLight: { at: [0, 1.9, 0.15], range: 3.5, power: 1.8, type: 0 },
  downlight: { at: [0, 2.55, 0], range: 4.2, power: 3.4, type: 1 },
  ceilingStrip: { at: [0, 2.5, 0], range: 99, power: 1.6, type: 2 },
  // A ceiling light lights the whole room like a chandelier, a track spot its surroundings, a table lamp what is near (kit/smart.tsx)
  ceilingLight: { at: [0, 2.45, 0], range: 'room', power: 3.6, type: 0 },
  trackLight: { at: [0, 2.3, 0.1], range: 5, power: 3, type: 0 },
  tableLamp: { at: [0, 0.4, 0], range: 3, power: 1.6, type: 0 },
  // A garden lamp lights its surroundings (kit/outdoor.tsx)
  gardenLight: { at: [0, 0.95, 0], range: 6, power: 2.6, type: 0 },
  // Street lamp (kit/street.tsx): high up, wide; position per model in STREET_LAMP
  streetLamp: { at: [0, 3.84, 1.02], range: 11, power: 9, type: 0 },
}

/**
 * Local positions of the street lamp lenses (same as kit/street.tsx > STREET_LAMP_LIGHTS): single arm, double arm,
 * classic lantern. The light falls on the room below the lens (the arm reaches over the road); if the pole stands in a
 * different room, that room gets a weaker light too.
 */
const STREET_LAMP: Record<string, [number, number, number][]> = {
  single: [[0, 3.84, 1.02]],
  double: [
    [0, 3.84, 1.02],
    [0, 3.84, -1.02],
  ],
  classic: [[0, 3.25, 0]],
}

const _c = new THREE.Color()

/**
 * Cone of a recessed spot (the beam spread is adjustable): Item.beam is the full cone angle (degrees, default 90). The
 * outer edge is half the angle, the inner (fully bright) edge 55% of that; their cosines go to the shader (hsAxis.xy).
 */
export function spotCone(beam = BEAM.def): [number, number, number, number] {
  const outer = (Math.min(BEAM.max, Math.max(BEAM.min, beam)) / 2) * (Math.PI / 180)
  return [Math.cos(outer), Math.cos(outer * 0.55), 0, 0]
}

/** Sky in walk mode: daylight level (0-1), direction towards the sun and strength of the direct sun (0-1; scene/sun.ts). */
export interface SkyLight {
  level: number
  sun: [number, number, number]
  strength: number
}

/** Light passing the window covering (0-1): covering type in Item.variant, openness from the linked shade motor (kit/devices.tsx > Shade). */
function shadePass(win: Item, entities: Record<string, HassEntity>) {
  const type = win.variant ?? 'curtain'
  if (type === 'none') return 1
  const cover = bindingsOf(win)
    .map((id) => entities[id])
    .find((e) => e?.entity_id.startsWith('cover.'))
  const at = Number(cover?.attributes.current_position)
  const pos = cover ? (Number.isFinite(at) ? at : cover.state === 'open' ? 100 : 0) / 100 : type === 'curtain' ? 0.9 : type === 'roller' ? 0.75 : 0
  const t = Number(cover?.attributes.current_tilt_position)
  const tilt = Number.isFinite(t) ? t / 100 : 1
  if (type === 'curtain') return 0.12 + 0.88 * pos
  if (type === 'roller') return 0.08 + 0.92 * pos
  // venetian blind: passes between horizontal slats; zebra blind: through the sheer stripes
  if (type === 'blinds') return pos + (1 - pos) * (0.05 + 0.7 * tilt)
  return pos + (1 - pos) * (0.3 + 0.4 * tilt)
}

/** Whether an exterior door or garage door is open: by its door sensor / cover if any; else closed (like kit/devices.tsx > doorState). */
function outerOpen(door: Item, entities: Record<string, HassEntity>) {
  return bindingsOf(door)
    .map((id) => entities[id])
    .some((e) => Boolean(e) && (e!.entity_id.startsWith('cover.') || (e!.entity_id.startsWith('binary_sensor.') && ['door', 'window', 'opening', 'garage_door'].includes(deviceClass(e)))) && isActive(e!))
}

/** Room diagonal + 1 m (at least 5): range of lights that fill the room */
function roomReach(rects: Rect[]) {
  const xs = rects.flatMap((q) => [q.x, q.x + q.w])
  const zs = rects.flatMap((q) => [q.z, q.z + q.d])
  return Math.max(5, Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) + 1)
}

/**
 * Daylight (kind 4, walk mode): windows facing outside (no room or an outdoor area) and open exterior doors, into the
 * indoor room. Power: sky level x opening area x what passes the covering; when the sun hits that side, the bounce of the
 * patch falling inside is added.
 */
function daylightLights(level: Level, entities: Record<string, HassEntity>, sky: SkyLight): (RoomLight & { power: number })[] {
  const out: (RoomLight & { power: number })[] = []
  for (const it of level.items) {
    if (it.kind !== 'window' && it.kind !== 'door' && it.kind !== 'garageDoor') continue
    const a = apertureOf(it)
    const { front, back } = doorSides(it, level.rooms)
    if (!a || !front || isOutdoor(front) || (back && !isOutdoor(back))) continue
    const pass = it.kind === 'window' ? shadePass(it, entities) : outerOpen(it, entities) ? 1 : 0
    if (pass <= 0) continue
    // Towards the room: the item's front (local +z)
    const inX = a.horizontal ? 0 : Math.sign(Math.sin(it.rot))
    const inZ = a.horizontal ? Math.sign(Math.cos(it.rot)) : 0
    const hh = (a.y1 - a.y0) / 2
    const face = WALL_T / 2 + 0.02
    const pos: [number, number, number] = a.horizontal ? [a.along, a.y0 + hh, a.line + inZ * face] : [a.line + inX * face, a.y0 + hh, a.along]
    const rects = rectsOf(front)
    const area = Math.max(0.5, Math.min(2.6, (2 * a.half * (a.y1 - a.y0)) / 1.44))
    // If the sun is on the outer side of this wall a sun patch falls inside: its bounce lights the room as well (warm color)
    const sunIn = Math.max(0, -(sky.sun[0] * inX + sky.sun[2] * inZ)) * sky.strength
    const base = WINDOW_POWER * sky.level * area * pass
    const color = SKY_TINT.clone().multiplyScalar(base).add(SUN_TINT.clone().multiplyScalar(base * 1.8 * sunIn))
    out.push({ pos, range: roomReach(rects), type: 4, rects, axis: a.horizontal ? [1, 0, 0, a.half] : [0, 0, 1, a.half], normal: [inX, 0, inZ], halfH: hh, color, power: color.r + color.g + color.b })
  }
  return out
}

/**
 * Area of an outdoor light: outside there are no walls, so the light falls on all open areas within its range (road,
 * crosswalk, sidewalk, grass, garden), not just the one the lamp stands on; the inside of the house stays behind its
 * walls. The intersection of the open areas with the range square is merged into the largest rectangles on a small grid
 * (the shader takes HS_RECTS rectangles per light; the largest ones).
 */
function outdoorRegion(level: Level, cx: number, cz: number, range: number): Rect[] {
  const x0 = cx - range
  const x1 = cx + range
  const z0 = cz - range
  const z1 = cz + range
  const parts = level.rooms
    .filter((r) => isOutdoor(r))
    .flatMap(rectsOf)
    .map((q) => ({ a: Math.max(q.x, x0), b: Math.min(q.x + q.w, x1), c: Math.max(q.z, z0), d: Math.min(q.z + q.d, z1) }))
    .filter((q) => q.b - q.a > 0.05 && q.d - q.c > 0.05)
  if (!parts.length) return []
  const xs = [...new Set(parts.flatMap((q) => [q.a, q.b]))].sort((a, b) => a - b)
  const zs = [...new Set(parts.flatMap((q) => [q.c, q.d]))].sort((a, b) => a - b)
  const nx = xs.length - 1
  const nz = zs.length - 1
  const inside = (i: number, j: number) => {
    const x = (xs[i] + xs[i + 1]) / 2
    const z = (zs[j] + zs[j + 1]) / 2
    return parts.some((q) => x > q.a && x < q.b && z > q.c && z < q.d)
  }
  const used = new Uint8Array(nx * nz)
  const free = (i: number, j: number) => i < nx && j < nz && !used[j * nx + i] && inside(i, j)
  const out: Rect[] = []
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      if (!free(i, j)) continue
      let i2 = i
      while (free(i2 + 1, j)) i2++
      let j2 = j
      while (j2 + 1 < nz && Array.from({ length: i2 - i + 1 }, (_, k) => free(i + k, j2 + 1)).every(Boolean)) j2++
      for (let jj = j; jj <= j2; jj++) for (let ii = i; ii <= i2; ii++) used[jj * nx + ii] = 1
      out.push({ x: xs[i], z: zs[j], w: xs[i2 + 1] - xs[i], d: zs[j2 + 1] - zs[j] })
    }
  return out.sort((p, q) => q.w * q.d - p.w * p.d).slice(0, HS_RECTS)
}

/**
 * Room light list from the plan's lamps that are on (the HS_MAX brightest). With sky (walk mode, daytime) windows and open
 * exterior doors give daylight.
 */
export function computeRoomLights(level: Level, entities: Record<string, HassEntity>, night: boolean, sky?: SkyLight): RoomLight[] {
  const out: (RoomLight & { power: number })[] = []
  const f = night ? 1 : sky ? FPS_DAY_FACTOR : DAY_FACTOR
  const place = (it: Item, at: [number, number, number]): [number, number, number] => {
    const c = Math.cos(it.rot)
    const s = Math.sin(it.rot)
    const y = it.y ?? DEFAULT_Y[it.kind] ?? 0
    return [it.x + at[0] * c + at[2] * s, y + at[1], it.z - at[0] * s + at[2] * c]
  }
  const roomOf = (x: number, z: number) => roomAt(level.rooms, x, z)
  const push = (it: Item, at: [number, number, number], range: number | 'room', power: number, type: 0 | 1 | 2 | 3, color: THREE.Color, half = 0) => {
    const pos = place(it, at)
    // A line light runs along the item's local x axis; for a spot the cone edges (beam angle)
    const axis: [number, number, number, number] | undefined = type === 3 ? [Math.cos(it.rot), 0, -Math.sin(it.rot), half] : type === 1 ? spotCone(it.beam) : undefined
    const room = roomOf(type === 2 ? it.x : pos[0], type === 2 ? it.z : pos[2])
    let rects = room ? rectsOf(room) : []
    let r = typeof range === 'number' ? range : 6
    if (range === 'room' && room) r = roomReach(rects)
    // Outdoors: all open areas within range (road, crosswalk, sidewalk...). If the fixture is above no room (a lamp whose
    // arm points away from the road) the open area the item stands on decides; otherwise the light would leak into the house.
    const base = room ?? roomOf(it.x, it.z)
    if (base && isOutdoor(base)) rects = outdoorRegion(level, pos[0], pos[2], r)
    // The item's light intensity factor (Item.intensity, 10%-300% on the card)
    const p = power * (it.intensity ?? 1)
    out.push({ pos, range: r, type, rects, axis, color: color.clone().multiplyScalar(p * f), power: p * color.r + p * color.g + p * color.b })
  }

  for (const it of level.items) {
    const e = it.entityId ? entities[it.entityId] : undefined
    const spec = SPEC[it.kind]
    if (spec) {
      // A street lamp without a linked entity turns on by itself at night
      const auto = it.kind === 'streetLamp' && !it.entityId && night
      if (!auto && (!e || !isActive(e))) continue
      const level = auto ? 1 : lightLevel(e)
      if (level <= 0) continue
      // A recessed spot set to all directions (Item.variant 'omni') lights the whole room like a chandelier
      if (it.kind === 'downlight' && it.variant === 'omni') push(it, [0, 2.5, 0], 'room', 3.2, 0, _c.set(lightColor(e)).multiplyScalar(level))
      else if (it.kind === 'streetLamp') {
        _c.set(auto ? STREET_LAMP_AUTO : lightColor(e)).multiplyScalar(level)
        // One light per fixture lens; it lights all open areas within range (the pole's sidewalk, the road, the crosswalk)
        const heads = STREET_LAMP[it.variant ?? 'single'] ?? STREET_LAMP.single
        for (const at of heads) push(it, at, spec.range, spec.power, 0, _c)
      } else push(it, spec.at, spec.range, spec.power, spec.type, _c.set(lightColor(e)).multiplyScalar(level), spec.half)
      continue
    }
    // Under-counter LED: onto the front of the counter, from below the wall cabinets (source chosen on the card, or the main entity)
    if (it.kind === 'kitchenCounter' && it.led && it.led !== 'none') {
      const id = ledSource(it)
      const src = id ? entities[id] : undefined
      if (src && isActive(src)) push(it, it.led === 'under' ? [0, 1.6, 0.02] : [0, 0.05, 0.3], 3.2, 2.3, 3, _c.set(lightColor(src)).multiplyScalar(Math.max(0.4, lightLevel(src) || 1)), (it.len ?? 2) / 2 - 0.02)
      continue
    }
    // Bottom strip of the mirror cabinet: a line light towards the sink
    if (it.kind === 'mirrorCabinet' && e && isActive(e) && (e.entity_id.startsWith('light.') || e.entity_id.startsWith('switch.'))) {
      push(it, [0, 1.12, 0.06], 2, 0.9, 3, _c.set(lightColor(e)).multiplyScalar(Math.max(0.4, lightLevel(e) || 1)), 0.28)
      continue
    }
    // Headboard light: the strip in front of the headboard washes the wall behind
    if (it.kind === 'bed') {
      const mode = ledOf(it)
      const id = mode === 'strip' || mode === 'back' ? ledSource(it) : undefined
      const src = id ? entities[id] : undefined
      if (src && isActive(src)) {
        const strip = mode === 'strip'
        push(it, strip ? [0, 0.9, -0.88] : [0, 1.0, -1.0], strip ? 3.8 : 3.2, strip ? 2.5 : 2.3, 3, _c.set(lightColor(src)).multiplyScalar(Math.max(0.35, lightLevel(src))), strip ? 0.78 : 0.75)
      }
      continue
    }
    // Ring light of the diffuser: soft colored light from the base of the body onto its surroundings (table, side table, floor)
    if (it.kind === 'diffuser' && ledOf(it) === 'strip') {
      const id = ledSource(it)
      const src = id ? entities[id] : undefined
      if (src && isActive(src)) push(it, [0, 0.066, 0], 2.2, 0.7, 0, _c.set(lightColor(src)).multiplyScalar(Math.max(0.35, lightLevel(src))))
      continue
    }
    // Decorative string lights: a line light at 2.05 m between two poles (length Item.len)
    if (it.kind === 'stringLights') {
      if (e && isActive(e)) push(it, [0, 2.05, 0], 4, 2.2, 3, _c.set(lightColor(e)).multiplyScalar(Math.max(0.35, lightLevel(e))), (it.len ?? 3) / 2)
      continue
    }
    // Light kit of the ceiling fan: from below the motor into the whole room, like a chandelier
    if (it.kind === 'ceilingFan') {
      const id = ledOf(it) === 'under' ? ledSource(it) : undefined
      const src = id ? entities[id] : undefined
      if (src && isActive(src)) push(it, [0, 2.15, 0], 'room', 3.4, 0, _c.set(lightColor(src)).multiplyScalar(Math.max(0.35, lightLevel(src))))
      continue
    }
    // TV backlight: the linked light (or the TV when on) gently lights the wall and its surroundings
    if (it.kind === 'tv' && ledOf(it) === 'back') {
      const id = ledSource(it)
      const light = id ? entities[id] : undefined
      const panelY = it.variant === 'wall' ? 1.3 : 0.56
      if (light ? isActive(light) : e && isActive(e)) push(it, [0, panelY, -0.05], 2.2, 0.9, 0, _c.set(light ? lightColor(light) : '#8f7cff'))
    }
  }
  // Through open interior doors into the next room: same source, the neighbor's rectangles, the door opening. Lights from
  // the same room through the same door are merged into one (three hallway spots pass the door as one light): the list stays short.
  const spills = new Map<string, RoomLight & { power: number }>()
  const doors = level.items.filter((d) => d.kind === 'door')
  for (const l of out) {
    if (!l.rects.length) continue
    const home = roomAt(level.rooms, l.rects[0].x + l.rects[0].w / 2, l.rects[0].z + l.rects[0].d / 2)
    if (!home) continue
    for (const d of doors) {
      const sides = doorSides(d, level.rooms)
      if (!sides.front || !sides.back) continue
      const other = sides.front.id === home.id ? sides.back : sides.back.id === home.id ? sides.front : null
      const a = apertureOf(d)
      if (!other || !a || !doorOpen(d, entities)) continue
      // A ceiling strip (room sized) passes the door like a point light from the room's ceiling.
      const fill = l.type === 2
      const s: RoomLight & { power: number } = {
        ...l,
        type: fill || l.type === 3 ? 0 : l.type,
        // a spot passes the door with its own cone too
        axis: l.type === 1 ? l.axis : undefined,
        range: fill ? 7 : Math.max(l.range, 4),
        color: fill ? l.color.clone().multiplyScalar(1.4) : l.color,
        rects: rectsOf(other),
        portal: { horizontal: a.horizontal, line: a.line, a0: a.along - 0.46, a1: a.along + 0.46 },
        power: l.power * 0.5,
      }
      const key = `${d.id}>${other.id}`
      const prev = spills.get(key)
      if (!prev) {
        spills.set(key, s)
        continue
      }
      // Power weighted average position, colors summed (a new color, the source's color untouched), the longest range.
      const w = prev.power + s.power
      prev.pos = [0, 1, 2].map((k) => (prev.pos[k] * prev.power + s.pos[k] * s.power) / w) as [number, number, number]
      prev.color = prev.color.clone().add(s.color)
      prev.range = Math.max(prev.range, s.range)
      if (prev.type !== s.type) {
        prev.type = 0
        prev.axis = undefined
      }
      prev.power = w
    }
  }
  /*
   * The shader takes at most HS_MAX lights. First the rooms' own lights (strongest first), door spill fills the remaining
   * slots. With one list sorted by power, three hallway spots spilling through doors pushed a desk lamp (power 1.3) off the
   * list: the bulb looked lit but no light fell on the desk.
   */
  // Alarm triggered (a visible alarm all over the house): a room sized red light in every room, first in the list (lamps
  // and spill take the remaining slots). The pulse is in AlarmFlash (pulseAlarmLights).
  const alarm: RoomLight[] = alarmTriggered(entities)
    ? level.rooms.slice(0, HS_MAX).map((room) => {
        const rects = rectsOf(room)
        const c = rects.reduce((a, q) => [a[0] + q.x + q.w / 2, a[1] + q.z + q.d / 2], [0, 0]).map((v) => v / rects.length)
        return { pos: [c[0], 2.4, c[1]] as [number, number, number], range: 99, type: 2 as const, rects, color: new THREE.Color(ALARM_RED).multiplyScalar(2.2), alarm: true }
      })
    : []
  const own = out.sort((a, b) => b.power - a.power).slice(0, HS_MAX - alarm.length)
  // Daylight after the lamps, before door spill
  const day = (sky && !night && sky.level > 0.01 ? daylightLights(level, entities, sky) : []).sort((a, b) => b.power - a.power).slice(0, HS_MAX - alarm.length - own.length)
  const through = [...spills.values()].sort((a, b) => b.power - a.power).slice(0, HS_MAX - alarm.length - own.length - day.length)
  // Indoor light stays within its floor; outdoor light (street lamp, garden) is unlimited upwards (it falls on the roof)
  const all = [...alarm, ...own, ...day, ...through]
  for (const l of all) {
    const r = roomOf(l.pos[0], l.pos[2])
    const indoor = l.type === 4 || l.alarm || (r ? !isOutdoor(r) : false)
    l.y = indoor ? [-0.05, WALL_H + 0.05] : [-0.6, 1e5]
  }
  return all
}

const ALARM_RED = '#ff2a2a'
/** Whether an alarm in the home is triggered (alarm_control_panel 'triggered'). */
export const alarmTriggered = (entities: Record<string, HassEntity>) => Object.values(entities).some((e) => e.entity_id.startsWith('alarm_control_panel.') && e.state === 'triggered')

/** Base colors of the alarm lights (written by setRoomLights); pulseAlarmLights multiplies them by k. */
let alarmBase: { i: number; c: THREE.Color }[] = []
/** Pulses the alarm lights: k 0-1 (AlarmFlash, every frame). */
export function pulseAlarmLights(k: number) {
  for (const { i, c } of alarmBase) hsUniforms.hsCol.value[i].set(c.r * k, c.g * k, c.b * k, hsUniforms.hsCol.value[i].w)
}

/** Last written light list (tests and debugging: window.__homescape.roomLights()). */
let last: RoomLight[] = []
// energy: unclipped channel sum of the color (the hex color clips at 1; for comparing light intensity)
export const lastRoomLights = () =>
  last.map((l) => ({ pos: l.pos, range: l.range, type: l.type, color: l.color.getHexString(), energy: +(l.color.r + l.color.g + l.color.b).toFixed(4), cone: l.type === 1 && l.axis ? [l.axis[0], l.axis[1]] : null, alarm: Boolean(l.alarm), rects: l.rects, portal: l.portal ?? null, y: l.y ?? null }))

/**
 * Whether the outside of this edge of the part is another part of the same room (L, T, U union). The room mask is pulled
 * 1 cm in from the edges (so the outer face of the wall stays unlit); pulled in at a joint edge too, it would leave an
 * unlit 2 cm strip between two parts, a line across the floor, ceiling and walls in the middle of an L hallway.
 */
function joined(rects: Rect[], q: Rect, side: 'l' | 'r' | 't' | 'b') {
  return rects.some((o) => {
    if (o === q) return false
    if (side === 'l' || side === 'r') {
      const x = side === 'l' ? q.x - 0.02 : q.x + q.w + 0.02
      return x > o.x && x < o.x + o.w && Math.min(q.z + q.d, o.z + o.d) - Math.max(q.z, o.z) > 0.05
    }
    const z = side === 't' ? q.z - 0.02 : q.z + q.d + 0.02
    return z > o.z && z < o.z + o.d && Math.min(q.x + q.w, o.x + o.w) - Math.max(q.x, o.x) > 0.05
  })
}

/** Writes the light list into the shader's shared arrays. */
export function setRoomLights(list: RoomLight[]) {
  last = list
  alarmBase = list.flatMap((l, i) => (l.alarm ? [{ i, c: l.color.clone() }] : []))
  const u = hsUniforms
  u.hsCount.value = list.length
  list.forEach((l, i) => {
    u.hsPos.value[i].set(l.pos[0], l.pos[1], l.pos[2], l.range)
    u.hsCol.value[i].set(l.color.r, l.color.g, l.color.b, l.type + (l.portal ? 10 : 0))
    const pt = l.portal
    if (l.type === 4 && l.normal) u.hsPortal.value[i].set(l.normal[0], l.normal[1], l.normal[2], -(l.halfH ?? 0.6))
    else u.hsPortal.value[i].set(pt?.line ?? 0, pt?.a0 ?? 0, pt?.a1 ?? 0, pt ? (pt.horizontal ? 1 : 2) : 0)
    u.hsAxis.value[i].set(...(l.axis ?? ([1, 0, 0, 0] as [number, number, number, number])))
    u.hsY.value[i].set(l.y?.[0] ?? -1e5, l.y?.[1] ?? 1e5)
    for (let r = 0; r < HS_RECTS; r++) {
      const q = l.rects[r]
      const v = u.hsRect.value[i * HS_RECTS + r]
      // 1 cm in from the room boundary: the outer faces of the walls (exactly on the boundary) stay unlit. On an edge
      // adjoining another part of the same room it is not pulled in but extends 5 mm: parts overlap at the joint, no unlit line.
      const pad = (side: 'l' | 'r' | 't' | 'b') => (q && joined(l.rects, q, side) ? -0.005 : 0.01)
      if (q) v.set(q.x + pad('l'), q.z + pad('t'), q.x + q.w - pad('r'), q.z + q.d - pad('b'))
      else if (r === 0 && !l.rects.length) v.set(-1e5, -1e5, 1e5, 1e5)
      else v.set(1, 1, 0, 0)
    }
  })
}
