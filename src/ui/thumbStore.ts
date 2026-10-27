import { create } from 'zustand'

/** 3D thumbnails of the bottom bar cards (made by scene/Thumbs.tsx). No three.js dependency, so it stays in the main bundle. */
interface ThumbState {
  urls: Record<string, string>
  done: boolean
  set: (key: string, url: string) => void
  finish: () => void
}

export const useThumbs = create<ThumbState>()((set, get) => ({
  urls: {},
  done: false,
  set: (key, url) => set({ urls: { ...get().urls, [key]: url } }),
  finish: () => set({ done: true }),
}))
