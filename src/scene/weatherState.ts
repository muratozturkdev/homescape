/*
 * Current weather values in the scene (scene/Weather.tsx writes them smoothly every frame, so a change in Home Assistant
 * blends in over 2-3 s). Readers: Scene > Lights (clouds dim the sun, the sky turns grey, lightning flashes), Scene >
 * FogRange (fog closes in), EditLayer > Ground (wet ground darkens, snow whitens it), Roofs (snow whitens the roofs).
 * No three.js here.
 */
export const weatherLight = {
  /** Clouds (0-1): the sun dims, the sky turns grey */
  cloud: 0,
  /** Fog (0-1): the fog closes in */
  fog: 0,
  /** Lightning flash (0-1, short) */
  flash: 0,
  /** Snow cover on the ground and the roofs (0-1; builds up while it snows, melts when it stops) */
  snow: 0,
  /** Wetness (0-1; the ground darkens in the rain and dries when it stops) */
  wet: 0,
}

/** Test hook (window.__homescape.weather): weather, preview, drawn drops, wind, lightning count */
export const weatherDebug = {
  sky: 'clear',
  preview: false,
  rain: 0,
  snow: 0,
  hail: 0,
  wind: 0,
  /** Wind drift of the precipitation (m/s; x, z) */
  windVec: [0, 0] as [number, number],
  flashes: 0,
  /** Precipitation is being drawn (not in lite mode) */
  drawn: false,
}
