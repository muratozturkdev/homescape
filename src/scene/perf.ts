/*
 * Performance counters (for tests and diagnostics): frames drawn, draw calls and triangles of the last frame.
 * PerfProbe fills them every frame; window.__homescape.perf() reads them. Also scene state for tests: the position in the
 * day/night transition (skyBlend: 0 day, 1 night) and the number of outline shells added to the selected item (outlines).
 */
export const perf = {
  frames: 0,
  calls: 0,
  triangles: 0,
  geometries: 0,
  textures: 0,
  programs: 0,
  shadowUpdates: 0,
  ambient: 0,
  skyBlend: -1,
  outlines: 0,
}
