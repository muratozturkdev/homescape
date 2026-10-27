import { Billboard, Line, useCursor } from '@react-three/drei'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import * as THREE from 'three'
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { useHa } from '@/ha/store'
import { t } from '@/i18n'
import { useLayout } from '@/model/layoutStore'
import { usePlacement } from '@/model/placement'
import { isWallMounted, localFootprints, mountRange } from '@/model/rules'
import { checkMount, mountY } from '@/ui/mount'
import { cameraApi, cameraKey } from './camera'
import type { Item } from '@/model/types'
import { C } from './kit/palette'
import { perf } from './perf'

/*
 * Selection display: the collision box and the outline of the selected object must be clearly visible.
 * - Outline: every solid mesh of the item gets a back-face shell inflated along its normals with a constant screen
 *   thickness (inverted hull). It is pushed behind the body, so the silhouette shows rather than the inner edges of the
 *   parts. Only for a single selection and for an invalid move (then in alarm red). (drei Outlines could not get the
 *   screen size inside a portal and drew a huge blot over the scene, hence our own shell.)
 * - Collision box: the item's real 3D bounding box in thick lines, in front of everything (no depth test).
 * - Footprint: the rectangle(s) the rules use (two parts for an L counter) as a translucent fill and line at the bottom of
 *   the box.
 * On hover only a faint footprint shows. Everything lives in the item's own frame (it rotates with the item).
 */

export type SelectMode = 'single' | 'multi' | 'hover' | 'none'

const visible = (o: THREE.Object3D | null): boolean => !o || (o.visible && visible(o.parent))

/** Meshes that count for the selection: halos, light cones, very transparent effects and lines excluded. */
function solidMeshes(root: THREE.Object3D) {
  const out: THREE.Mesh[] = []
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh || !visible(m) || m.userData.selectionAid) return
    const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.Material
    if (!mat || mat.blending === THREE.AdditiveBlending || (mat.transparent && mat.opacity < 0.3) || mat.type === 'ShaderMaterial') return
    out.push(m)
  })
  return out
}

/** Bounding box of the meshes in local coordinates of the given frame (the item group). */
function boxIn(meshes: THREE.Mesh[], frame: THREE.Object3D) {
  frame.updateWorldMatrix(true, true)
  const inv = frame.matrixWorld.clone().invert()
  const box = new THREE.Box3()
  const tmp = new THREE.Box3()
  const m = new THREE.Matrix4()
  for (const mesh of meshes) {
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
    tmp.copy(mesh.geometry.boundingBox!).applyMatrix4(m.multiplyMatrices(inv, mesh.matrixWorld))
    box.union(tmp)
  }
  return box.isEmpty() ? null : box
}

/** Shell geometry: normals are smoothed so it does not split at hard corners; once per source geometry. */
const hullGeos = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>()
function hullGeometry(g: THREE.BufferGeometry) {
  let h = hullGeos.get(g)
  if (!h) {
    h = toCreasedNormals(g, Math.PI)
    hullGeos.set(g, h)
  }
  return h
}

/** Outline thickness per unit of depth (shared by all shells; updated from the camera every frame). */
const OUTLINE_SCALE = { value: 0.003 }

/** Outline material: pushes vertices along the normal in view space, proportional to depth (constant on screen). */
function outlineMaterial(color: string) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uPx: OUTLINE_SCALE },
    vertexShader: /* glsl */ `
      uniform float uPx;
      void main() {
        vec4 mv = modelViewMatrix * vec4( position, 1.0 );
        vec3 n = normalize( normalMatrix * normal );
        mv.xyz += n * uPx * max( -mv.z, 0.1 );
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      void main() { gl_FragColor = vec4( uColor, 1.0 ); }`,
    side: THREE.BackSide,
    polygonOffset: true,
    polygonOffsetFactor: 6,
    polygonOffsetUnits: 6,
  })
}
const OUTLINE_PX = 3.5

/** The 12 edges of the box (pairs of line segment points). */
function boxEdges(b: THREE.Box3): [number, number, number][] {
  const { min: a, max: z } = b
  const p = (x: number, y: number, w: number): [number, number, number] => [x, y, w]
  const c = [p(a.x, a.y, a.z), p(z.x, a.y, a.z), p(z.x, a.y, z.z), p(a.x, a.y, z.z), p(a.x, z.y, a.z), p(z.x, z.y, a.z), p(z.x, z.y, z.z), p(a.x, z.y, z.z)]
  const e = [0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7]
  return e.map((i) => c[i])
}

const _hit = new THREE.Vector3()
/** Arrow head of the handle: base at y = 0, tip up (the down arrow is rotated by 180°). */
const ARROW = new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(-0.032, 0), new THREE.Vector2(0.032, 0), new THREE.Vector2(0, 0.04)]))

/**
 * Up/down handle next to a selected wall mounted item (edit mode, single selection): dragging moves the item up and down
 * in the wall plane (the ray is intersected with the wall plane). Limited by mountRange; if it also collides in height
 * with another item on the wall it turns red and goes back on release. Undo is one step (checkpoint at the start).
 */
function MountHandle({ item, side, mid, front }: { item: Item; side: number; mid: number; front: number }) {
  const drag = useRef<{ plane: THREE.Plane; start: number; y0: number } | null>(null)
  const [hot, setHot] = useState(false)
  const [active, setActive] = useState(false)
  const g = useRef<THREE.Group>(null)
  const holder = useRef<THREE.Group>(null)
  useCursor(hot || active, 'ns-resize')
  // At least ~28 px on screen so it can be grabbed from afar too (a frame is drawn anyway when the camera moves). As it
  // grows it moves away from the item: the grab area (0.32 m × scale) always stays outside the item's edge, so a small
  // item (a power strip on the wall) does not end up under the handle and become impossible to move.
  useFrame(({ camera, size }) => {
    const grp = g.current
    const cam = camera as THREE.PerspectiveCamera
    if (!grp || !holder.current || !cam.isPerspectiveCamera) return
    grp.getWorldPosition(_hit)
    const world = (14 * 2 * Math.tan((cam.fov * Math.PI) / 360) * cam.position.distanceTo(_hit)) / Math.max(1, size.height)
    const k = Math.max(1, world / 0.085)
    grp.scale.setScalar(k * (hot || active ? 1.15 : 1))
    holder.current.position.x = side + 0.04 + 0.17 * k
  })
  const color = active ? C.brandDark : C.brand

  const onDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0 || cameraKey()) return
    e.stopPropagation()
    const normal = new THREE.Vector3(Math.sin(item.rot), 0, Math.cos(item.rot))
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, new THREE.Vector3(item.x, 0, item.z))
    if (!e.ray.intersectPlane(plane, _hit)) return
    ;(e.target as unknown as Element).setPointerCapture(e.pointerId)
    cameraApi.setEnabled(false)
    useLayout.getState().checkpoint()
    drag.current = { plane, start: _hit.y, y0: mountY(item) }
    setActive(true)
  }
  const onMove = (e: ThreeEvent<PointerEvent>) => {
    const d = drag.current
    if (!d) return
    e.stopPropagation()
    if (!e.ray.intersectPlane(d.plane, _hit)) return
    const { min, max } = mountRange(item.kind, item.variant, item.len2)
    const y = Math.round(Math.min(max, Math.max(min, d.y0 + _hit.y - d.start)) * 100) / 100
    if (y === mountY(item)) return
    const chk = checkMount(item, y)
    usePlacement.getState().setMoving({ id: item.id, ok: chk.ok, reason: chk.reason })
    useLayout.getState().updateItem(item.id, { y }, false)
  }
  const onUp = (e: ThreeEvent<PointerEvent>) => {
    if (!drag.current) return
    drag.current = null
    setActive(false)
    ;(e.target as unknown as Element).releasePointerCapture(e.pointerId)
    cameraApi.setEnabled(true)
    const m = usePlacement.getState().moving
    if (m?.id === item.id && !m.ok) {
      useLayout.getState().revertCheckpoint()
      useHa.setState({
        notice: t('Not possible at this height: {reason}. The item went back to its previous height.', { reason: m.reason ?? t('invalid') }),
      })
    }
    usePlacement.getState().setMoving(null)
  }

  return (
    // On the item's right side, level with its middle: does not clash with the label and the action bubble above. x every frame (above).
    <group ref={holder} position={[side + 0.21, mid, front + 0.04]}>
      <Billboard>
        <group ref={g}>
          <mesh renderOrder={30} userData={{ selectionAid: true }}>
            <circleGeometry args={[0.085, 28]} />
            <meshBasicMaterial color={color} depthTest={false} transparent opacity={0.95} toneMapped={false} />
          </mesh>
          {[1, -1].map((dir) => (
            <mesh key={dir} geometry={ARROW} position={[0, dir * 0.012, 0.001]} rotation-z={dir > 0 ? 0 : Math.PI} renderOrder={31} userData={{ selectionAid: true }}>
              <meshBasicMaterial color="#ffffff" depthTest={false} transparent toneMapped={false} />
            </mesh>
          ))}
          {/* Invisible, larger grab area so it is easy to hold */}
          <mesh
            userData={{ selectionAid: true }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerOver={(e) => {
              e.stopPropagation()
              setHot(true)
            }}
            onPointerOut={() => setHot(false)}
          >
            <planeGeometry args={[0.32, 0.32]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
        </group>
      </Billboard>
    </group>
  )
}

export function ItemSelection({ item, mode, bad, target, frame }: { item: Item; mode: SelectMode; bad: boolean; target: RefObject<THREE.Object3D | null>; frame: RefObject<THREE.Object3D | null> }) {
  const invalidate = useThree((s) => s.invalidate)
  const show = mode !== 'none' || bad
  const strong = mode === 'single' || mode === 'multi' || bad
  const [data, setData] = useState<{
    meshes: THREE.Mesh[]
    box: THREE.Box3
  } | null>(null)
  const measure = useRef(false)

  // When the item changes (size, kind, color) measure again in the next frame: meshes are built and matrices up to date by then.
  useEffect(() => {
    measure.current = true
    invalidate()
  }, [show, mode, item, invalidate])
  useFrame(() => {
    if (!measure.current) return
    measure.current = false
    if (!show || !target.current || !frame.current) return setData(null)
    const meshes = solidMeshes(target.current)
    const box = boxIn(meshes, frame.current)
    setData(box ? { meshes, box } : null)
  })

  const color = bad ? C.alarm : C.brand
  const outline = mode === 'single' || bad
  const handles = useLayout((s) => s.mode === 'edit' && s.tool === 'select') && mode === 'single' && isWallMounted(item.kind, item.variant, item.mount)
  const mat = useMemo(() => outlineMaterial(color), [color])
  useEffect(() => () => mat.dispose(), [mat])

  // Add the shells as children of the selected meshes; remove them when the selection ends.
  useEffect(() => {
    if (!outline || !data) return
    const hulls = data.meshes
      .filter((m) => m.geometry.getAttribute('normal') && m.geometry.getAttribute('position'))
      .map((m) => {
        const h = new THREE.Mesh(hullGeometry(m.geometry), mat)
        h.userData.selectionAid = true
        h.raycast = () => {}
        h.renderOrder = -1
        m.add(h)
        return h
      })
    perf.outlines += hulls.length
    invalidate()
    return () => {
      for (const h of hulls) h.removeFromParent()
      perf.outlines -= hulls.length
      invalidate()
    }
  }, [outline, data, mat, invalidate])

  // Thickness is constant in pixels: world size per unit of depth from the field of view and the canvas height.
  useFrame(({ camera, size }) => {
    const cam = camera as THREE.PerspectiveCamera
    if (cam.isPerspectiveCamera) OUTLINE_SCALE.value = (OUTLINE_PX * 2 * Math.tan((cam.fov * Math.PI) / 360)) / Math.max(1, size.height)
  })
  const rects = useMemo(() => localFootprints(item), [item])
  if (!show || !data) return null
  const baseY = Math.max(0.012, data.box.min.y + 0.012)
  return (
    <group>
      {/* footprint: the rules' collision rectangles */}
      {rects.map((r, i) => (
        <group key={i} position={[r.cx, baseY, r.cz]}>
          <mesh rotation-x={-Math.PI / 2} renderOrder={18} userData={{ selectionAid: true }}>
            <planeGeometry args={[r.w, r.d]} />
            <meshBasicMaterial color={color} transparent opacity={strong ? 0.2 : 0.1} depthWrite={false} depthTest={false} toneMapped={false} />
          </mesh>
          <Line
            points={[
              [-r.w / 2, 0, -r.d / 2],
              [r.w / 2, 0, -r.d / 2],
              [r.w / 2, 0, r.d / 2],
              [-r.w / 2, 0, r.d / 2],
              [-r.w / 2, 0, -r.d / 2],
            ]}
            color={color}
            lineWidth={strong ? 2.5 : 1.5}
            transparent
            opacity={strong ? 0.95 : 0.5}
            depthTest={false}
            renderOrder={19}
            userData={{ selectionAid: true }}
          />
        </group>
      ))}
      {handles && <MountHandle item={item} side={data.box.max.x} mid={(data.box.min.y + data.box.max.y) / 2} front={data.box.max.z} />}
      {strong && (
        <Line
          points={boxEdges(data.box)}
          segments
          color={color}
          lineWidth={2}
          dashed={!bad && mode === 'multi'}
          dashSize={0.08}
          gapSize={0.05}
          transparent
          opacity={0.9}
          depthTest={false}
          renderOrder={20}
          userData={{ selectionAid: true }}
        />
      )}
    </group>
  )
}
