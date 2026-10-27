/** 3D colors. UI tokens live in index.css; the mapping between them is in DESIGN.md. */
export const C = {
  sky: '#e9ebf8',
  skyNight: '#10142b',
  ground: '#dde1f3',
  groundNight: '#161b36',
  wall: '#f7f7fd',
  wallTop: '#d9ddf2',
  woodFloor: '#ecdcc4',
  woodLine: '#dcc6a6',
  tile: '#f4f5fb',
  tileLine: '#dfe2f0',
  carpet: '#e4e2f4',
  concrete: '#e6e7ee',

  brand: '#3f56e0',
  brandDark: '#2f42b8',
  brandLight: '#8f9ef0',
  brandPale: '#dfe4ff',

  white: '#ffffff',
  offWhite: '#f3f4fb',
  ink: '#1f2440',
  inkSoft: '#3a3f5c',
  steel: '#c3c8dc',
  screenOff: '#1b2036',

  sun: '#f5c04a',
  sunPale: '#ffe7b3',
  kraft: '#d9a86c',
  kraftDark: '#a87a45',
  coral: '#ff8a7a',
  terracotta: '#e98b6d',
  mint: '#8fd8bd',
  leaf: '#5cbf8f',
  leafDark: '#3e9e72',
  glass: '#cfe6ff',

  ok: '#2fbf71',
  warn: '#f0a63a',
  alarm: '#e2564b',
  cool: '#7cc7ff',
  heat: '#ffa36b',
} as const

/** Color of a street lamp that lights up by itself at night: warm white LED (kit/street.tsx, roomLights.ts) */
export const STREET_LAMP_AUTO = '#ffdcae'

export const BOOK_COLORS = [C.brand, C.coral, C.sun, C.mint, C.brandLight, C.kraft, C.terracotta, C.leafDark]
