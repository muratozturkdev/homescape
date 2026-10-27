import { roomAt } from '@/model/geometry'
import { footprints } from '@/model/rules'
import type { FloorMaterial, Level } from '@/model/types'
import { stairHeight } from '@/scene/fps'
import { type Bus, play } from './engine'

/*
 * Floor under a footstep (audio/shots.ts > step): soft on rugs, dull on stairs, else the room's floor (wood, tile, grass,
 * gravel, water...), grass outside the house.
 */

const MATERIAL: Record<FloorMaterial, string> = {
  wood: 'wood',
  tile: 'hard',
  carpet: 'soft',
  concrete: 'hard',
  grass: 'grass',
  deck: 'deck',
  paving: 'hard',
  road: 'hard',
  sidewalk: 'hard',
  crosswalk: 'hard',
  parking: 'hard',
  gravel: 'gravel',
  water: 'water',
}

export function floorAt(level: Level, x: number, z: number): string {
  for (const it of level.items) {
    if (it.kind === 'stairs' && stairHeight(it, x, z) != null) return 'stairs'
    if ((it.kind === 'rug' || it.kind === 'doormat') && footprints({ kind: it.kind, x: it.x, z: it.z, rot: it.rot, len: it.len, len2: it.len2, variant: it.variant }).some((b) => x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ)) return 'soft'
  }
  const room = roomAt(level.rooms, x, z)
  return room ? (MATERIAL[room.floor] ?? 'hard') : 'grass'
}

/** One step: sound by floor, at foot height */
export function stepAt(level: Level, x: number, z: number, opt: { gain?: number; bus?: Bus; y?: number } = {}) {
  play('step', { x, y: opt.y ?? 0.05, z }, { v: floorAt(level, x, z), gain: opt.gain ?? 1, bus: opt.bus ?? 'people', ref: 1.2 })
}
