import { Box, BrickWall, CircleHelp, Hand, House, Map, Minus, PanelRightClose, PanelRightOpen, Plus, Rotate3d, RotateCcw, RotateCw, Users, Warehouse, X } from 'lucide-react'
import { useState } from 'react'
import { cameraApi, type StreetKinds, toggleRoof, useView } from '@/scene/camera'
import { usePeoplePlan } from '@/scene/People'
import { t, tn } from '@/i18n'
import { usePanel } from './panelState'

// Key names (Q, F, Esc, ...) stay untranslated
const KEYS: [string, string][] = [
  [t('Left click + drag'), t('Rotate (the hand button above switches it to pan)')],
  [t('Right or middle click + drag'), t('Pan')],
  [t('Space + drag'), t('Pan (even over an item)')],
  [t('⌥ or ⇧ + left drag'), t('Rotate (in hand mode)')],
  [t('Trackpad: two fingers sideways'), t('Rotate')],
  [t('Wheel / pinch'), t('Zoom (toward the cursor)')],
  [t('WASD / arrow keys'), t('Pan (faster with ⇧)')],
  ['Q / E', t('Rotate 45°')],
  ['+ / -', t('Zoom in / out')],
  [t('Double click'), t('Focus on a room or item')],
  ['F', t('Focus on the selected room or the home')],
  ['Esc', t('Leave placement, the tool or the selection')],
]

const EDIT_KEYS: [string, string][] = [
  [t('Drag a card from the bottom bar'), t('Place it (green fits, red does not)')],
  [t('Click a card, then the scene'), t('Click to place; several in a row with ⇧')],
  [t('Right click'), t('Cancel placement')],
  [t('Drag an item'), t('Move it (wall items stick to the wall)')],
  [t('Select a room, then drag'), t('Move the room with its contents')],
  [t('Arrow keys'), t('Nudge the selected item 5 cm (25 cm with ⇧); a wall item moves ← → along the wall, ↑ ↓ up / down')],
  ['R / ⇧R', t('Rotate 90° (the placement ghost or the selection)')],
  ['Page Up / Page Down', t('Move the selected wall item 5 cm up / down (25 cm with ⇧); you can also drag the arrow next to it')],
  ['Delete', t('Delete (a selected room goes with its contents)')],
  [t('Area select tool + drag'), t('Select the rooms and items in the area; Delete removes them all')],
  ['⌘Z / ⇧⌘Z', t('Undo / redo')],
]

function Help({ onClose }: { onClose: () => void }) {
  return (
    <div className="glass absolute right-[52px] top-0 w-[300px] rounded-2xl p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[13px] font-semibold">{t('Controls')}</p>
        <button type="button" onClick={onClose} className="grid size-7 place-items-center rounded-lg text-ink-3 hover:bg-surface-2" title={t('Close')}>
          <X size={15} />
        </button>
      </div>
      {[
        [t('Navigation'), KEYS],
        [t('In edit mode'), EDIT_KEYS],
      ].map(([title, rows]) => (
        <div key={title as string} className="mb-2.5 last:mb-0">
          <p className="mb-1 font-mono text-[10px] font-medium uppercase tracking-wider text-ink-3">{title as string}</p>
          <dl className="grid gap-1">
            {(rows as [string, string][]).map(([k, v]) => (
              <div key={k} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-2 text-[12px]">
                <dt className="font-semibold text-ink">{k}</dt>
                <dd className="m-0 text-ink-2">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  )
}

const MODE_LABEL = { home: t('At home'), sleep: t('Asleep'), away: t('Out') } as const

/** Kinds of street life that turn on and off separately (scene/StreetLife.tsx) */
const STREET_ROWS: [keyof StreetKinds, string][] = [
  ['cars', t('Passing cars')],
  ['walkers', t('Pedestrians and dog walkers')],
  ['kids', t('Children at the playground')],
]

/**
 * People in the home (scene/People.tsx, model/people.ts): show / hide, household size (people at home when there is no
 * motion) and the current state: mode, how many people, rooms with motion.
 */
function PeoplePanel({ onClose }: { onClose: () => void }) {
  const show = useView((s) => s.people)
  const setShow = useView((s) => s.setPeople)
  const residents = useView((s) => s.residents)
  const setResidents = useView((s) => s.setResidents)
  const street = useView((s) => s.street)
  const setStreet = useView((s) => s.setStreet)
  const { plan, level } = usePeoplePlan()
  const nameOf = (id: string) => level?.rooms.find((r) => r.id === id)?.name
  const names = (plan?.active ?? []).map((id) => nameOf(id) && (plan?.desk.includes(id) ? t('{room} (at the computer)', { room: nameOf(id)! }) : nameOf(id))).filter(Boolean)
  const litNames = (plan?.lit ?? []).map(nameOf).filter(Boolean)
  const seg = (on: boolean) => `min-h-9 flex-1 rounded-lg text-[12.5px] font-semibold ${on ? 'bg-brand text-white' : 'bg-surface-2 text-ink-2 hover:text-ink'}`
  return (
    <div className="glass absolute right-[52px] top-0 grid w-[280px] gap-3 rounded-2xl p-4" id="people-panel">
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-semibold">{t('People')}</p>
        <button type="button" onClick={onClose} className="grid size-7 place-items-center rounded-lg text-ink-3 hover:bg-surface-2" title={t('Close')}>
          <X size={15} />
        </button>
      </div>
      <div className="flex gap-1.5">
        <button type="button" className={seg(show)} onClick={() => setShow(true)}>
          {t('Show')}
        </button>
        <button type="button" className={seg(!show)} onClick={() => setShow(false)}>
          {t('Hide')}
        </button>
      </div>
      <div className="grid gap-1.5">
        <span className="text-[12px] font-semibold text-ink-2">{t('Household')}</span>
        <div className="flex gap-1.5">
          {[1, 2, 3, 4].map((n) => (
            <button key={n} type="button" className={seg(residents === n)} onClick={() => setResidents(n)}>
              {n}
            </button>
          ))}
        </div>
      </div>
      {plan && (
        <p className="rounded-xl bg-surface-2 px-3 py-2 text-[12px] leading-relaxed text-ink-2" id="people-status">
          <b className="text-ink">{MODE_LABEL[plan.mode]}</b> · {tn(plan.count, '{count} person', '{count} people')}
          {' · '}
          {names.length ? t('activity: {rooms}', { rooms: names.join(', ') }) : t('no activity right now')}
          {litNames.length ? ` · ${t('lights on: {rooms}', { rooms: litNames.join(', ') })}` : ''}
        </p>
      )}
      <p className="text-[11px] leading-relaxed text-ink-3">
        {t(
          'With the alarm set to Away everyone is out; set to Night (or with no motion between 23:00 and 07:00) everyone is in bed. Someone is in every room with motion or a light just turned on (20 min) and leaves when the light goes off. Someone sits at a computer that is on (Ping). With activity in more rooms at once the number of people grows up to 3. Shown in view mode.',
        )}
      </p>
      <div className="grid gap-2 border-t border-line pt-3" id="street-panel">
        <span className="text-[12px] font-semibold text-ink-2">{t('Outside')}</span>
        {STREET_ROWS.map(([k, label]) => (
          <div key={k} className="flex items-center justify-between gap-3">
            <span className={`text-[12.5px] ${street[k] ? 'text-ink' : 'text-ink-3'}`}>{label}</span>
            <button
              type="button"
              id={`street-${k}`}
              role="switch"
              aria-checked={street[k]}
              aria-label={label}
              onClick={() => setStreet(k, !street[k])}
              className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${street[k] ? 'bg-brand' : 'bg-line'}`}
            >
              <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-[left] ${street[k] ? 'left-[18px]' : 'left-0.5'}`} />
            </button>
          </div>
        ))}
        <p className="text-[11px] leading-relaxed text-ink-3">
          {t(
            'On a plan with a road a car passes now and then; pedestrians and people walking a dog on a leash use the sidewalk; children play at the playground during the day. Less at night, no children in the rain. What you turn off disappears at once.',
          )}
        </p>
      </div>
    </div>
  )
}

export default function MapControls() {
  const plan = useView((s) => s.plan)
  const setPlan = useView((s) => s.setPlan)
  const request = useView((s) => s.request)
  const [help, setHelp] = useState(false)
  const [people, setPeople] = useState(false)
  const leftDrag = useView((s) => s.leftDrag)
  const innerWalls = useView((s) => s.innerWalls)
  const roof = useView((s) => s.roof)
  const setInnerWalls = useView((s) => s.setInnerWalls)
  const setLeftDrag = useView((s) => s.setLeftDrag)
  const panelOpen = usePanel((s) => s.open)
  const btn = 'grid size-9 place-items-center text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink'
  const seg = (on: boolean) => `grid size-9 place-items-center transition-colors ${on ? 'bg-brand text-white' : 'text-ink-2 hover:bg-surface-2 hover:text-ink'}`
  return (
    // Left of the right panel; moves with it when the panel closes or narrows (ui/panelState.ts, --panel)
    <div className="pointer-events-auto absolute right-4 top-4 z-30 hidden transition-[right] duration-200 ease-out lg:right-(--panel) lg:block">
      {/* Two columns on short screens (so it does not end up behind the bottom bar) */}
      <div className="glass flex flex-col overflow-hidden rounded-xl [@media(max-height:820px)]:grid [@media(max-height:820px)]:grid-cols-2">
        {/* Close / open the right panel (P) */}
        <button
          type="button"
          id="panel-toggle"
          className={`${btn} ${panelOpen ? '' : 'text-brand'}`}
          onClick={() => usePanel.getState().toggle()}
          title={panelOpen ? t('Close the right panel (P); drag its edge to make it narrower or wider') : t('Open the right panel (P)')}
          aria-pressed={panelOpen}
        >
          {panelOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
        </button>
        <div className="mx-2 h-px bg-line [@media(max-height:820px)]:hidden" />
        {/* What a left drag does: pan or rotate (remembered) */}
        <button type="button" className={seg(leftDrag === 'rotate')} onClick={() => setLeftDrag('rotate')} title={t('Left drag: rotate (to pan, drag with the right button or with Space held)')} aria-pressed={leftDrag === 'rotate'}>
          <Rotate3d size={16} />
        </button>
        <button type="button" className={seg(leftDrag === 'pan')} onClick={() => setLeftDrag('pan')} title={t('Left drag: pan (to rotate, use the right button or ⌥ / ⇧)')} aria-pressed={leftDrag === 'pan'}>
          <Hand size={16} />
        </button>
        <div className="mx-2 h-px bg-line [@media(max-height:820px)]:hidden" />
        <button type="button" className={btn} onClick={cameraApi.zoomIn} title={t('Zoom in (+)')}>
          <Plus size={17} />
        </button>
        <button type="button" className={btn} onClick={cameraApi.zoomOut} title={t('Zoom out (-)')}>
          <Minus size={17} />
        </button>
        <button type="button" className={btn} onClick={() => cameraApi.rotate(45)} title={t('Rotate left (Q)')}>
          <RotateCcw size={16} />
        </button>
        <button type="button" className={btn} onClick={() => cameraApi.rotate(-45)} title={t('Rotate right (E)')}>
          <RotateCw size={16} />
        </button>
        <div className="mx-2 h-px bg-line [@media(max-height:820px)]:hidden" />
        <button type="button" className={`${btn} ${plan ? 'text-brand' : ''}`} onClick={() => setPlan(!plan)} title={plan ? t('3D view') : t("Plan view (bird's-eye)")}>
          {plan ? <Box size={16} /> : <Map size={16} />}
        </button>
        <button
          type="button"
          className={`${btn} ${innerWalls === 'low' ? 'text-brand' : ''}`}
          onClick={() => setInnerWalls(innerWalls === 'full' ? 'low' : 'full')}
          title={innerWalls === 'full' ? t('Inner walls at full height (they hide what is behind). Click: low, like a sketch') : t('Inner walls low (sketch). Click: full height')}
          aria-pressed={innerWalls === 'low'}
        >
          <BrickWall size={16} />
        </button>
        <button type="button" className={btn} onClick={() => request({ kind: 'house' })} title={t('Whole home (F)')}>
          <House size={16} />
        </button>
        {/* Roof: hide / show with one click (scene/roof.ts > toggleRoof); Automatic is in the floor menu */}
        <button
          type="button"
          id="roof-toggle"
          className={`${btn} ${roof === 'off' ? 'text-ink-3' : 'text-brand'}`}
          onClick={() => toggleRoof()}
          title={roof === 'off' ? t('Roof removed. Click to bring it back (visible from afar, lifts as you come closer) (T)') : t('Remove the roof completely (T)')}
          aria-pressed={roof !== 'off'}
        >
          <Warehouse size={16} />
        </button>
        <div className="mx-2 h-px bg-line [@media(max-height:820px)]:hidden" />
        <button type="button" className={`${btn} ${people ? 'text-brand' : ''}`} onClick={() => (setPeople((v) => !v), setHelp(false))} title={t('People: at home and outside (cars, pedestrians)')} aria-pressed={people}>
          <Users size={16} />
        </button>
        <button type="button" className={`${btn} ${help ? 'text-brand' : ''}`} onClick={() => (setHelp((h) => !h), setPeople(false))} title={t('Controls and shortcuts')}>
          <CircleHelp size={16} />
        </button>
      </div>
      {help && <Help onClose={() => setHelp(false)} />}
      {people && <PeoplePanel onClose={() => setPeople(false)} />}
    </div>
  )
}
