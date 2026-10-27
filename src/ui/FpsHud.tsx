import { Footprints, LogOut, MousePointerClick } from 'lucide-react'
import { useRef, useState } from 'react'
import { useHa } from '@/ha/store'
import { activeLevel, levelName, useLayout } from '@/model/layoutStore'
import { useView } from '@/scene/camera'
import { touchInput, useFps } from '@/scene/fps'
import { kick } from '@/scene/frame'
import { t } from '@/i18n'
import { itemStateLabel } from './Bindings'

/*
 * First-person walk overlay (scene/FpsControls.tsx): a crosshair in the middle; name, state and keys of the aimed device;
 * a "click to start" card while the mouse is not locked; on touch screens a walking joystick and a run button at the
 * bottom left; floor and exit at the top right.
 */

const coarse = () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches

/** Translated text with <b>...</b> marks (key names) drawn bold */
const bold = (text: string) => text.split(/<b>(.*?)<\/b>/).map((part, i) => (i % 2 ? <b key={i}>{part}</b> : part))

/** Virtual joystick: the distance from the center gives direction and speed (up to the radius) */
function Joystick() {
  const base = useRef<HTMLDivElement>(null)
  const [knob, setKnob] = useState({ x: 0, y: 0 })
  const R = 52
  const move = (e: React.PointerEvent) => {
    const b = base.current?.getBoundingClientRect()
    if (!b) return
    let x = e.clientX - (b.left + b.width / 2)
    let y = e.clientY - (b.top + b.height / 2)
    const d = Math.hypot(x, y)
    if (d > R) {
      x = (x / d) * R
      y = (y / d) * R
    }
    setKnob({ x, y })
    touchInput.side = x / R
    touchInput.fwd = -y / R
    kick()
  }
  const end = () => {
    setKnob({ x: 0, y: 0 })
    touchInput.side = 0
    touchInput.fwd = 0
  }
  return (
    <div
      ref={base}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        move(e)
      }}
      onPointerMove={(e) => e.buttons && move(e)}
      onPointerUp={end}
      onPointerCancel={end}
      className="pointer-events-auto absolute bottom-8 left-8 grid size-36 touch-none place-items-center rounded-full border border-white/40 bg-black/20 backdrop-blur"
      aria-label={t('Walk joystick')}
    >
      <span className="size-14 rounded-full bg-white/80 shadow-lg" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
    </div>
  )
}

export default function FpsHud() {
  const aim = useFps((s) => s.aim)
  const locked = useFps((s) => s.locked)
  const level = useLayout((s) => activeLevel(s))
  const selection = useLayout((s) => s.selection)
  // Live state of the aimed item (changes right after a toggle)
  const live = useHa((s) => {
    if (!aim) return null
    const it = activeLevel(useLayout.getState())?.items.find((i) => i.id === aim.itemId)
    const e = it?.entityId ? s.entities[it.entityId] : undefined
    return it && e ? itemStateLabel(it, e) : null
  })
  const [run, setRun] = useState(false)
  const touch = coarse()

  return (
    <div className="pointer-events-none absolute inset-0 z-30" id="fps-hud">
      {/* Crosshair */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <span className={`block rounded-full border-2 transition-all ${aim ? 'size-5 border-sun bg-sun/25' : 'size-2.5 border-white bg-white/70'} shadow-[0_0_6px_rgba(0,0,0,0.5)]`} />
      </div>

      {/* Aimed device */}
      {aim && (
        <div className="absolute inset-x-0 bottom-28 flex justify-center px-4">
          <div className="glass flex items-center gap-3 rounded-2xl px-4 py-2.5" data-fps-aim={aim.itemId}>
            <span className="min-w-0">
              <span className="block truncate text-[14px] font-semibold text-ink">{aim.name}</span>
              <span className="block text-[12px] text-ink-2">{live ?? aim.state}</span>
            </span>
            {!touch && (
              <span className="flex items-center gap-1.5 border-l border-line pl-3 text-[11.5px] text-ink-2">
                <kbd className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-ink">{t('Click')}</kbd>
                {aim.toggle ? t('on / off') : t('details')}
                <kbd className="ml-1 rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-ink">F</kbd>
                {t('details')}
              </span>
            )}
            {touch && <span className="border-l border-line pl-3 text-[11.5px] text-ink-2">{aim.toggle ? t('Tap: on / off') : t('Tap: details')}</span>}
          </div>
        </div>
      )}

      {/* Start card: while the mouse is not locked (desktop) */}
      {!touch && !locked && !selection && (
        <div className="absolute inset-x-0 top-[22%] flex justify-center px-4">
          <div className="glass grid max-w-[460px] gap-2 rounded-2xl px-5 py-4 text-center">
            <p className="flex items-center justify-center gap-2 text-[15px] font-semibold text-ink">
              <MousePointerClick size={18} className="text-brand" />
              {t('Click the scene to start walking')}
            </p>
            <p className="text-[12.5px] leading-relaxed text-ink-2">
              {bold(
                t(
                  '<b>WASD</b> or the arrow keys walk, <b>⇧</b> runs, the mouse looks around. Aim the crosshair at a device: <b>click</b> or <b>E</b> turns it on / off, <b>F</b> shows details. Walking on the stairs changes the floor. <b>Esc</b> releases the mouse, <b>Esc</b> again ends the walk.',
                ),
              )}
            </p>
          </div>
        </div>
      )}

      {/* Floor and exit */}
      <div className="pointer-events-auto absolute right-4 top-4 flex items-center gap-2">
        {level && (
          <span className="glass flex h-9 items-center gap-1.5 rounded-xl px-3 text-[12.5px] font-semibold text-ink">
            <Footprints size={14} className="text-brand" />
            {levelName(level)}
          </span>
        )}
        <button type="button" onClick={() => useView.getState().setFps(false)} className="glass flex h-9 items-center gap-1.5 rounded-xl px-3 text-[12.5px] font-semibold text-ink hover:text-brand">
          <LogOut size={14} />
          {t('Exit')}
        </button>
      </div>

      {touch && (
        <>
          <Joystick />
          <button
            type="button"
            onClick={() => {
              touchInput.run = !run
              setRun(!run)
            }}
            className={`pointer-events-auto absolute bottom-12 left-48 h-12 rounded-2xl px-4 text-[13px] font-semibold ${run ? 'bg-brand text-white' : 'glass text-ink'}`}
          >
            {t('Sprint')}
          </button>
          <p className="absolute inset-x-0 top-16 text-center text-[12px] font-medium text-white drop-shadow">{t('Drag on the right to look · Tap a device to turn it on / off')}</p>
        </>
      )}
    </div>
  )
}
