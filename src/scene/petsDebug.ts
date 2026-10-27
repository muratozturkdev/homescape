import type { PetAction, PetMode, PetNeeds, Species, VisitorKind } from '@/model/pets'

/*
 * Test and debug state of the pets (window.__homescape.pets()): Pets.tsx writes it every frame and binds the test commands
 * (call a visitor, give a task, pet, change the hour). Kept apart from the component file (fast refresh only works in files
 * that export components only).
 */

/** Position, task and needs of the pets; the visitor; test commands. */
export const petsDebug: {
  pets: { id: string; species: Species; variant: string; x: number; z: number; y: number; roomId: string | null; action: PetAction | null; label: string; pose: string; moving: boolean; react: string | null; bubble: string | null; needs: PetNeeds; heading: number }[]
  mode: PetMode
  /** Number of live (NPC) pets; 0 in edit mode */
  live: number
  /** Number of pets requesting a frame every frame (click reaction; walking in light mode) and the requested ambient rate */
  busy: number
  ambient: 'none' | 'slow' | 'full'
  /** Room changes through a wall (not through a door): must always be 0 */
  wallCross: number
  visitor: { kind: VisitorKind; label: string; x: number; y: number; z: number; act: string; t: number; total: number; count: number } | null
  visitorsSeen: number
  /** Test: change the hour (null: real time) */
  setHour: (h: number | null) => void
  /** Test: call a visitor now (speed: time multiplier) */
  forceVisitor: (kind?: VisitorKind, speed?: number, side?: 'front' | 'back' | 'left' | 'right') => boolean
  /** Test: give a pet a task (walk somewhere, sit, sleep) */
  command: (id: string, action: PetAction, x?: number, z?: number) => boolean
  /** Test: pet the animal (like a click) */
  poke: (id: string) => string | null
} = {
  pets: [],
  mode: 'home',
  live: 0,
  busy: 0,
  ambient: 'none',
  wallCross: 0,
  visitor: null,
  visitorsSeen: 0,
  setHour: () => {},
  forceVisitor: () => false,
  command: () => false,
  poke: () => null,
}

