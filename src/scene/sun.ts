import type { HassEntity } from '@/ha/types'

/*
 * Position of the sun in the sky, for realistic lighting in walk mode (the ceiling blocks sunlight from above, so it comes
 * in through windows and doors at the sun's angle). Pure helpers: HA's sun.sun entity (azimuth, elevation) or, without it,
 * an approximation from the clock; the sun direction in the scene from the plan orientation (Layout.up: compass direction
 * of the top of the plan); daylight level and sun color.
 */

export interface SunPos {
  /** Compass direction, degrees: 0 north, 90 east, 180 south, 270 west */
  azimuth: number
  /** Height above the horizon, degrees (negative below the horizon) */
  elevation: number
}

const RAD = Math.PI / 180

/**
 * Approximate sun from the clock when sun.sun is missing (or has no azimuth): latitude 40°, solar noon 12:30. Only for the
 * demo and old saves; a live HA always provides the real value.
 */
export function approxSun(now: number, lat = 40): SunPos {
  const d = new Date(now)
  const start = new Date(d.getFullYear(), 0, 0).getTime()
  const day = Math.floor((now - start) / 86_400_000)
  const decl = 23.44 * Math.sin(((2 * Math.PI) / 365) * (day - 81)) * RAD
  const hours = d.getHours() + d.getMinutes() / 60
  const h = (hours - 12.5) * 15 * RAD
  const phi = lat * RAD
  const elevation = Math.asin(Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(h)) / RAD
  const azimuth = (Math.atan2(Math.sin(h), Math.cos(h) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi)) / RAD + 180 + 360) % 360
  return { azimuth, elevation }
}

/** HA's sun; approximated from the clock when azimuth or elevation is missing (an existing elevation is kept). */
export function sunOf(e: HassEntity | undefined, now = Date.now()): SunPos {
  const az = Number(e?.attributes.azimuth)
  const el = Number(e?.attributes.elevation)
  const approx = approxSun(now)
  return { azimuth: Number.isFinite(az) ? az : approx.azimuth, elevation: Number.isFinite(el) ? el : approx.elevation }
}

/**
 * Unit direction towards the sun in the scene. The top of the plan (-z) is `up` degrees on the compass (0: north); east is
 * right of north (+x). Compass direction A maps to the plan direction rotated by (A - up) degrees: (sin, -cos).
 */
export function sunDirection(sun: SunPos, up = 0): [number, number, number] {
  const b = (sun.azimuth - up) * RAD
  const el = sun.elevation * RAD
  return [Math.sin(b) * Math.cos(el), Math.sin(el), -Math.cos(b) * Math.cos(el)]
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** Skylight level 0-1: fills up from civil twilight (-6°) towards noon. */
export const daylight = (elevation: number) => smooth(-6, 14, elevation)
/** Direct sun 0-1: fades out at the horizon (hills, trees, haze), full a few degrees higher. */
export const sunStrength = (elevation: number) => smooth(0, 7, elevation)
/** A low sun is orange and turns white as it rises (0: horizon color, 1: noon). */
export const sunWarmth = (elevation: number) => smooth(2, 32, elevation)

/** The sun in walk mode: position, direction in the scene, skylight level, strength and warmth of the direct sun. */
export interface RealSun {
  pos: SunPos
  dir: [number, number, number]
  level: number
  strength: number
  warmth: number
}

/**
 * Tests and debugging (window.__homescape.lighting; written by Scene > Lights and FogRange): direction to the sun,
 * intensities, walk mode and indoor blend, fog start and end depth (m).
 */
export const lightDebug = { sunDir: [0, 0, 0], sunI: 0, hemiI: 0, fps: 0, indoor: 0, fog: [0, 0] }
