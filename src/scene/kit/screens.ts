import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useAmbient } from './effects'

/*
 * Moving picture on a screen that is on: it only has to look alive, not real. No video or texture: a small shader
 * produces a moving image:
 * - kind 1, monitor: light desktop, scrolling colored lines in a dark editor window, a browser window beside it;
 * - kind 2, vertical monitor: scrolling document (title, paragraph lines, image box).
 * The TV plays a film (kit/film.ts).
 * Time is shared by all screens (screenClock); a screen that is on requests frames at ambient rate (useAmbient; stops in lite mode).
 */

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`

const FRAG = /* glsl */ `
uniform float uTime;
uniform float uSeed;
uniform float uKind;
uniform float uLevel;
varying vec2 vUv;
float hash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
vec3 hsv( float h, float s, float v ) {
  vec3 k = clamp( abs( mod( h * 6.0 + vec3( 0.0, 4.0, 2.0 ), 6.0 ) - 3.0 ) - 1.0, 0.0, 1.0 );
  return v * mix( vec3( 1.0 ), k, s );
}
float box( vec2 uv, vec2 a, vec2 b, float soft ) {
  return smoothstep( a.x, a.x + soft, uv.x ) * ( 1.0 - smoothstep( b.x - soft, b.x, uv.x ) ) * smoothstep( a.y, a.y + soft, uv.y ) * ( 1.0 - smoothstep( b.y - soft, b.y, uv.y ) );
}
void main() {
  vec2 uv = vUv;
  float t = uTime + uSeed * 37.0;
  vec3 col;
  if ( uKind < 1.5 ) {
    col = vec3( 0.84, 0.88, 0.95 );
    col = mix( col, vec3( 0.22, 0.26, 0.36 ), smoothstep( 0.92, 0.94, uv.y ) );
    // editor: dark window, scrolling colored lines
    float w1 = box( uv, vec2( 0.05, 0.1 ), vec2( 0.6, 0.86 ), 0.02 );
    float row = ( uv.y + t * 0.02 ) * 20.0;
    float ln = fract( row );
    float len = hash( vec2( floor( row ), uSeed ) );
    float ind = 0.07 + 0.05 * floor( hash( vec2( floor( row ), 7.0 ) ) * 3.0 );
    float txt = smoothstep( 0.3, 0.45, ln ) * ( 1.0 - smoothstep( 0.6, 0.75, ln ) ) * step( ind, uv.x ) * step( uv.x, ind + 0.04 + len * 0.42 );
    vec3 ink = mix( vec3( 0.48, 0.72, 1.0 ), vec3( 1.0, 0.72, 0.42 ), step( 0.6, hash( vec2( floor( row ), 3.0 ) ) ) );
    col = mix( col, vec3( 0.15, 0.17, 0.23 ) + txt * ink * 0.6, w1 );
    // blinking cursor
    col += w1 * step( 0.5, fract( t * 1.2 ) ) * box( uv, vec2( 0.3, 0.42 ), vec2( 0.305, 0.46 ), 0.002 ) * 0.7;
    // browser: title bar, image box, gray lines
    float w2 = box( uv, vec2( 0.64, 0.18 ), vec2( 0.96, 0.82 ), 0.02 );
    vec3 page = vec3( 0.97 );
    page = mix( page, vec3( 0.36, 0.52, 0.92 ), box( uv, vec2( 0.64, 0.76 ), vec2( 0.96, 0.82 ), 0.01 ) );
    page = mix( page, hsv( fract( 0.55 + 0.1 * sin( t * 0.2 ) ), 0.35, 0.85 ), box( uv, vec2( 0.67, 0.5 ), vec2( 0.93, 0.72 ), 0.02 ) );
    float g = smoothstep( 0.35, 0.5, fract( uv.y * 30.0 ) ) * ( 1.0 - smoothstep( 0.6, 0.75, fract( uv.y * 30.0 ) ) ) * step( uv.y, 0.46 ) * step( 0.22, uv.y );
    page = mix( page, vec3( 0.7 ), g * box( uv, vec2( 0.67, 0.0 ), vec2( 0.9, 1.0 ), 0.01 ) );
    col = mix( col, page, w2 );
  } else {
    col = vec3( 0.96, 0.96, 0.98 );
    float row = ( uv.y + t * 0.015 ) * 34.0;
    float ln = fract( row );
    float len = 0.55 + 0.4 * hash( vec2( floor( row ), uSeed ) );
    float txt = smoothstep( 0.3, 0.45, ln ) * ( 1.0 - smoothstep( 0.6, 0.75, ln ) ) * step( 0.1, uv.x ) * step( uv.x, 0.1 + len * 0.8 );
    // paragraph gaps and an image in between
    float para = step( 0.75, hash( vec2( floor( row / 6.0 ), 2.0 ) ) );
    col = mix( col, vec3( 0.55, 0.57, 0.62 ), txt * ( 1.0 - para ) );
    col = mix( col, hsv( 0.58, 0.3, 0.8 ), para * step( 0.1, uv.x ) * step( uv.x, 0.9 ) * 0.8 );
    col = mix( col, vec3( 0.25, 0.3, 0.42 ), smoothstep( 0.93, 0.95, uv.y ) );
  }
  gl_FragColor = vec4( col * uLevel, 1.0 );
}`

/** Shared time: all screens read the same clock */
const screenClock = { value: 0 }

export type ScreenKind = 1 | 2

/** Screen material: moving image when on, the given (dark glass) material when off. seed (item position): screens do not show the same thing at once. */
export function useScreen(on: boolean, kind: ScreenKind, off: THREE.Material, seed = 0, level = 1) {
  const m = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: { uTime: screenClock, uSeed: { value: seed % 10 }, uKind: { value: kind }, uLevel: { value: level } },
      }),
    [kind, level, seed],
  )
  useEffect(() => () => m.dispose(), [m])
  useAmbient(on)
  useFrame(({ clock }) => {
    if (on) screenClock.value = clock.elapsedTime
  })
  return on ? m : off
}
