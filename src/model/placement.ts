import { create } from 'zustand'
import { t } from '@/i18n'
import { rectBounds } from './geometry'
import type { FloorMaterial, Item, ItemKind, Rect, RoomType } from './types'

/*
 * Placement (the "build" mode of a game): a card from the bottom bar is dragged or clicked, and a ghost follows the
 * cursor in the scene; green when valid, otherwise red with the reason. The Ghost component in the scene computes the
 * position every frame and writes the result here.
 */

export interface RoomPreset {
  /** Main rectangle (back-left corner at 0,0) */
  w: number
  d: number
  label: string
  /** Extra parts, relative to the main rectangle (L, T shape) */
  parts?: Rect[]
  /** Name given when placed (else "Room N") and floor */
  name?: string
  floor?: FloorMaterial
  /** Room type (garage, balcony, terrace, garden; room when not given) */
  type?: RoomType
  /** Rotating with R makes sense (long areas like a road or sidewalk): the card says "R rotates" */
  turn?: boolean
}

export const ROOM_PRESETS: RoomPreset[] = [
  { w: 3, d: 3, label: t('Small room') },
  { w: 4, d: 3.5, label: t('Medium room') },
  { w: 5, d: 4, label: t('Large room') },
  { w: 6.5, d: 5, label: t('Living room') },
  { w: 2.5, d: 2.5, label: t('Bathroom / entry') },
  // L shaped: R rotates by 90°; then the parts are resized from the Inspector or with the handles.
  { w: 4, d: 1.25, label: t('L hallway'), name: t('Hallway'), floor: 'concrete', parts: [{ x: 0, z: 1.25, w: 1.25, d: 2.75 }] },
  { w: 4.5, d: 3, label: t('L room'), parts: [{ x: 0, z: 3, w: 2.5, d: 2 }] },
  // Outdoor spaces and garage
  { w: 3.5, d: 6, label: t('Garage'), name: t('Garage'), floor: 'concrete', type: 'garage' },
  { w: 3.5, d: 1.5, label: t('Balcony'), name: t('Balcony'), floor: 'deck', type: 'balcony' },
  { w: 5, d: 4, label: t('Terrace'), name: t('Terrace'), floor: 'paving', type: 'terrace' },
  { w: 9, d: 6, label: t('Garden'), name: t('Garden'), floor: 'grass', type: 'garden' },
  // Front of the house and street: outdoor floors without walls. Road and parking markings run along the long side; the
  // crosswalk crosses the road (drawn between two road parts), R rotates by 90°.
  { w: 12, d: 7, label: t('Road'), name: t('Road'), floor: 'road', type: 'garden', turn: true },
  { w: 12, d: 2.5, label: t('Sidewalk'), name: t('Sidewalk'), floor: 'sidewalk', type: 'garden', turn: true },
  { w: 3, d: 7, label: t('Crosswalk'), name: t('Crosswalk'), floor: 'crosswalk', type: 'garden', turn: true },
  { w: 10, d: 5.5, label: t('Parking lot'), name: t('Parking lot'), floor: 'parking', type: 'garden', turn: true },
  { w: 3, d: 6, label: t('Driveway'), name: t('Driveway'), floor: 'concrete', type: 'garden', turn: true },
  { w: 1.2, d: 5, label: t('Gravel path'), name: t('Gravel path'), floor: 'gravel', type: 'garden', turn: true },
  { w: 4, d: 3, label: t('Pond'), name: t('Pond'), floor: 'water', type: 'garden' },
  { w: 6, d: 4, label: t('Lawn'), name: t('Lawn'), floor: 'grass', type: 'garden' },
  { w: 4, d: 4, label: t('Concrete area'), name: t('Concrete area'), floor: 'concrete', type: 'garden' },
]

/**
 * Rectangles of a room preset (main first), rotated in 90° steps with the back-left corner moved to (0, 0).
 * 90° rotation: (x, z) → (-z, x); rectangle {x: -(z + d), z: x, w: d, d: w}.
 */
export function presetRects(p: RoomPreset, rot: number): Rect[] {
  let rects: Rect[] = [{ x: 0, z: 0, w: p.w, d: p.d }, ...(p.parts ?? [])]
  const k = ((Math.round(rot / (Math.PI / 2)) % 4) + 4) % 4
  for (let i = 0; i < k; i++) rects = rects.map((r) => ({ x: -(r.z + r.d), z: r.x, w: r.d, d: r.w }))
  const b = rectBounds(rects)
  return rects.map((r) => ({ ...r, x: r.x - b.minX, z: r.z - b.minZ }))
}

export type PlaceTarget =
  | { type: 'item'; kind: ItemKind; entityId?: string | null; preset?: string; extra?: Partial<Pick<Item, 'len' | 'len2' | 'y' | 'variant' | 'name' | 'mount'>> }
  | { type: 'room'; preset: RoomPreset }

interface PlacementState {
  target: PlaceTarget | null
  /** 'drag': the card is being dragged while held; 'click': the card was clicked, a click in the scene places it */
  via: 'drag' | 'click'
  /** Rotation given by the user with R (picks the wall for wall items) */
  rot: number
  /** Screen position of the cursor and whether it is over the canvas */
  screen: { x: number; y: number } | null
  overCanvas: boolean
  /** Result computed by the Ghost */
  result: { x: number; z: number; rot: number; y?: number; ok: boolean; reason?: string } | null
  /** Validity while an existing item is dragged (for the spot marker) */
  moving: { id: string; ok: boolean; reason?: string } | null

  start: (target: PlaceTarget, via: 'drag' | 'click') => void
  pointer: (x: number, y: number, overCanvas: boolean) => void
  rotate: (dir?: 1 | -1) => void
  setResult: (r: PlacementState['result']) => void
  setMoving: (m: PlacementState['moving']) => void
  cancel: () => void
}

export const usePlacement = create<PlacementState>()((set, get) => ({
  target: null,
  via: 'click',
  rot: 0,
  screen: null,
  overCanvas: false,
  result: null,
  moving: null,

  start: (target, via) => set({ target, via, rot: 0, result: null }),
  pointer: (x, y, overCanvas) => set({ screen: { x, y }, overCanvas }),
  rotate: (dir = 1) => set({ rot: get().rot + (dir * Math.PI) / 2 }),
  setResult: (result) => {
    const prev = get().result
    if (prev && result && prev.x === result.x && prev.z === result.z && prev.rot === result.rot && prev.y === result.y && prev.ok === result.ok && prev.reason === result.reason) return
    set({ result })
  },
  setMoving: (moving) => {
    const prev = get().moving
    if (prev?.id === moving?.id && prev?.ok === moving?.ok && prev?.reason === moving?.reason) return
    set({ moving })
  },
  cancel: () => set({ target: null, result: null, screen: null }),
}))
