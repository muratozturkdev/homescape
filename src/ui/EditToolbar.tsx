import { DoorOpen, Download, Eraser, MousePointer2, Redo2, SquareDashed, SquareDashedMousePointer, Undo2, Upload, WandSparkles } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useHa } from '@/ha/store'
import { connectRooms } from '@/model/doors'
import { activeLevel, exportLayout, importLayout, useLayout } from '@/model/layoutStore'
import { useView } from '@/scene/camera'
import { t, tn } from '@/i18n'
import { regenerateFromHa } from './regenerate'
import ResetDialog from './ResetDialog'

export default function EditToolbar() {
  const tool = useLayout((s) => s.tool)
  const setTool = useLayout((s) => s.setTool)
  const canUndo = useLayout((s) => s.past.length > 0)
  const canRedo = useLayout((s) => s.future.length > 0)
  const undo = useLayout((s) => s.undo)
  const redo = useLayout((s) => s.redo)
  const [armed, setArmed] = useState(false)
  const [reset, setReset] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  const notice = (text: string) => useHa.setState({ notice: text })

  useEffect(() => {
    if (!armed) return
    const timer = setTimeout(() => setArmed(false), 3500)
    return () => clearTimeout(timer)
  }, [armed])

  const btn = (active = false) =>
    `grid size-10 place-items-center rounded-xl transition-colors disabled:opacity-35 ${active ? 'bg-brand text-white' : 'text-ink-2 hover:bg-surface-2 hover:text-ink'}`

  return (
    <div className="pointer-events-auto absolute left-4 top-4 z-30">
      {/* Two columns on short screens (laptops, 600-800 px high) so it does not end up behind the build bar at the bottom */}
      <div className="glass flex flex-col gap-1 rounded-2xl p-1.5 [@media(max-height:820px)]:grid [@media(max-height:820px)]:grid-cols-2">
        <button type="button" className={btn(tool === 'select')} onClick={() => setTool('select')} title={t('Select and move (drag)')}>
          <MousePointer2 size={18} />
        </button>
        <button type="button" className={btn(tool === 'room')} onClick={() => setTool(tool === 'room' ? 'select' : 'room')} title={t('Draw a free room: drag on the ground')}>
          <SquareDashed size={18} />
        </button>
        <button type="button" className={btn(tool === 'area')} onClick={() => setTool(tool === 'area' ? 'select' : 'area')} title={t('Select an area: frame it on the ground, delete everything inside at once')}>
          <SquareDashedMousePointer size={18} />
        </button>
        <button
          type="button"
          className={btn()}
          onClick={() => {
            const level = activeLevel(useLayout.getState())
            const doors = level ? connectRooms(level) : []
            if (!doors.length) return notice(t('Every room can already be reached through a door.'))
            useLayout.getState().addItems(doors)
            notice(tn(doors.length, '{count} inner door added. ⌘Z undoes it.', '{count} inner doors added. ⌘Z undoes it.'))
          }}
          title={t('Complete the inner doors: every room becomes reachable through a door')}
        >
          <DoorOpen size={18} />
        </button>
        <div className="mx-2 my-0.5 h-px bg-line [@media(max-height:820px)]:hidden" />
        <button type="button" className={btn()} onClick={undo} disabled={!canUndo} title={t('Undo (⌘Z)')}>
          <Undo2 size={18} />
        </button>
        <button type="button" className={btn()} onClick={redo} disabled={!canRedo} title={t('Redo (⇧⌘Z)')}>
          <Redo2 size={18} />
        </button>
        <div className="mx-2 my-0.5 h-px bg-line [@media(max-height:820px)]:hidden" />
        <button
          type="button"
          className={`${btn()} ${armed ? 'bg-warn-50 text-warn' : ''}`}
          onClick={() => {
            if (!armed) return setArmed(true)
            setArmed(false)
            regenerateFromHa()
            notice(t('Plan rebuilt from the Home Assistant areas. ⌘Z undoes it.'))
          }}
          title={armed ? t('Are you sure? Click again') : t('Rebuild from Home Assistant')}
        >
          <WandSparkles size={18} />
        </button>
        <button type="button" className={`${btn()} hover:!text-miss`} onClick={() => setReset(true)} title={t('Start from scratch: clear the plan, draw the home again')}>
          <Eraser size={18} />
        </button>
        <button type="button" className={btn()} onClick={exportLayout} title={t('Export the plan (JSON)')}>
          <Download size={18} />
        </button>
        <button type="button" className={btn()} onClick={() => file.current?.click()} title={t('Import a plan (JSON)')}>
          <Upload size={18} />
        </button>
        <input
          ref={file}
          id="layout-import"
          type="file"
          accept="application/json"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (!f) return
            try {
              await importLayout(f)
              useView.getState().request({ kind: 'house' })
              notice(t('Plan imported.'))
            } catch (err) {
              notice(err instanceof Error ? err.message : t('Could not read the file.'))
            }
          }}
        />
      </div>
      {reset && <ResetDialog onClose={() => setReset(false)} />}
      {tool === 'area' && (
        <div className="glass absolute left-[60px] top-0 whitespace-nowrap [@media(max-height:820px)]:left-[108px] rounded-xl px-3 py-2 text-[12px] font-medium text-ink-2">
          {t('Drag on the ground to frame an area: the rooms and items inside are selected')}
          <span className="ml-2 text-ink-3">{t('Esc: cancel')}</span>
        </div>
      )}
      {tool === 'part' && (
        <div className="glass absolute left-[60px] top-0 whitespace-nowrap [@media(max-height:820px)]:left-[108px] rounded-xl px-3 py-2 text-[12px] font-medium text-ink-2">
          {t('Start at an edge of the selected room and drag on the ground: a part is added to the room (L, T, U)')}
          <span className="ml-2 text-ink-3">{t('Esc: cancel')}</span>
        </div>
      )}
      {tool === 'room' && (
        <div className="glass absolute left-[60px] top-0 whitespace-nowrap [@media(max-height:820px)]:left-[108px] rounded-xl px-3 py-2 text-[12px] font-medium text-ink-2">
          {t('Drag on the ground to draw a room; the edges snap to neighboring rooms')}
          <span className="ml-2 text-ink-3">{t('Esc: cancel')}</span>
        </div>
      )}
    </div>
  )
}
