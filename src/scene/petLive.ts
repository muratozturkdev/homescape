import { create } from 'zustand'

/*
 * Live pets (roaming as NPCs). In view mode Pets.tsx writes the positions of the cat and dog items on the active floor here;
 * the kit component of those items (kit/pets.tsx) then draws nothing and Pets.tsx draws and walks the animal. In edit mode,
 * in thumbnails, in the ghost and on inactive floors (Scene > Levels) the item is drawn as an animal sitting in place
 * (draggable).
 */

interface PetLiveState {
  /** Item positions of the live pets (petKey) */
  keys: string[]
  set: (keys: string[]) => void
}

export const usePetLive = create<PetLiveState>((set, get) => ({
  keys: [],
  set: (keys) => {
    const cur = get().keys
    if (cur.length === keys.length && cur.every((k, i) => k === keys[i])) return
    set({ keys })
  },
}))

/** Key from the item position (same as Visual.at) */
export const petKey = (at: { x: number; z: number }) => `${at.x.toFixed(3)},${at.z.toFixed(3)}`
