import { CloudSun, EllipsisVertical, Eye, Feather, House, Languages, LayoutDashboard, Maximize, Minimize, Moon, Pencil, PersonStanding, Search, Sun, SunMoon, Wifi, WifiOff } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useHa } from '@/ha/store'
import { useLayout, type Theme } from '@/model/layoutStore'
import { useView } from '@/scene/camera'
import { useSound } from '@/audio/engine'
import { fullscreenButton, isStandalone, useFullscreen } from './fullscreen'
import { FloorSwitcher, HomeSwitcher } from './HomeMenus'
import { SoundButton, SoundIcon } from './SoundMenu'
import { WeatherPicker } from './WeatherTile'
import { skyLabel, useWeather } from '@/ha/weather'
import { currentLang, LANGUAGES, t } from '@/i18n'
import { LanguageButton, LanguageList } from './LanguageMenu'

const THEMES: { id: Theme; label: string; Icon: typeof Sun }[] = [
  { id: 'auto', label: t('Automatic (follows the sun)'), Icon: SunMoon },
  { id: 'day', label: t('Day'), Icon: Sun },
  { id: 'night', label: t('Night'), Icon: Moon },
]

function ConnectionPill({ onOpen }: { onOpen: () => void }) {
  const status = useHa((s) => s.status)
  const source = useHa((s) => s.source)
  const live = source?.kind === 'live'
  const dot = status === 'connected' ? (live ? 'bg-ok' : 'bg-sun') : status === 'connecting' ? 'bg-sun animate-pulse' : 'bg-miss'
  const text =
    status === 'connecting' ? t('Connecting') : status === 'error' ? t('Connection error') : live ? t('Connected · {name}', { name: source?.label ?? '' }) : t('Demo mode')
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex h-9 items-center gap-2 rounded-xl border border-line bg-surface px-3 text-[12px] font-semibold text-ink-2 hover:text-ink"
      title={t('Home Assistant connection')}
    >
      <span className={`size-2 rounded-full ${dot}`} />
      {live ? <Wifi size={14} /> : <WifiOff size={14} />}
      <span className="hidden max-w-44 truncate xl:inline">{text}</span>
    </button>
  )
}

/** Lite mode, theme and connection on narrow screens */
function MoreMenu({ onConnect }: { onConnect: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const theme = useLayout((s) => s.theme)
  const lite = useView((s) => s.lite)
  const sound = useSound((s) => s.on)
  const status = useHa((s) => s.status)
  const source = useHa((s) => s.source)
  // Weather picker (on wide screens it is in the "Weather" tile at the top)
  const [sky, setSky] = useState(false)
  const weather = useWeather()
  // Language list (on wide screens it is the language button of the top bar)
  const [lang, setLangOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setSky(false)
        setLangOpen(false)
      }
    }
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [open])
  const next = THEMES[(THEMES.findIndex((th) => th.id === theme) + 1) % THEMES.length]
  const row = 'flex min-h-11 w-full items-center gap-2.5 rounded-xl px-3 text-left text-[13px] text-ink hover:bg-surface-2'
  return (
    <div ref={ref} className="relative lg:hidden">
      <button
        type="button"
        id="more-menu"
        onClick={() => {
          setOpen((o) => !o)
          setSky(false)
          setLangOpen(false)
        }} aria-expanded={open} className="grid size-9 place-items-center rounded-xl border border-line bg-surface text-ink-2" title={t('More')}>
        <EllipsisVertical size={16} />
      </button>
      {open && (
        <div className={`glass absolute right-0 top-[calc(100%+8px)] z-50 grid max-h-[calc(100dvh-90px)] gap-1 overflow-y-auto rounded-2xl p-2 ${sky || lang ? 'w-72' : 'w-60'}`}>
          <button
            type="button"
            className={row}
            onClick={() => {
              useView.getState().setLite(!lite)
              setOpen(false)
            }}
          >
            <Feather size={16} className={lite ? 'text-ok' : 'text-ink-3'} />
            {lite ? t('Lite mode: on') : t('Lite mode: off')}
          </button>
          <button type="button" id="sound-toggle-mobile" className={row} onClick={() => useSound.getState().setOn(!sound)}>
            <span className={sound ? 'text-brand' : 'text-ink-3'}>
              <SoundIcon />
            </span>
            {sound ? t('Sound: on') : t('Sound: off')}
          </button>
          <button type="button" className={row} onClick={() => useLayout.getState().setTheme(next.id)}>
            <SunMoon size={16} className="text-ink-3" />
            {t('Theme: {name}', { name: THEMES.find((th) => th.id === theme)!.label })}
          </button>
          <button type="button" id="weather-menu" className={row} aria-expanded={sky} onClick={() => setSky((v) => !v)}>
            <CloudSun size={16} className={weather.preview ? 'text-brand' : 'text-ink-3'} />
            {weather.preview
              ? t('Weather: {sky} (preview)', { sky: skyLabel(weather.sky) })
              : weather.temperature != null
                ? t('Weather: {sky} · {temperature}', { sky: skyLabel(weather.sky), temperature: `${Math.round(weather.temperature)}${weather.unit}` })
                : t('Weather: {sky}', { sky: skyLabel(weather.sky) })}
          </button>
          {sky && (
            <div className="px-1 pb-1">
              <WeatherPicker />
            </div>
          )}
          <button type="button" id="language-menu-mobile" className={row} aria-expanded={lang} onClick={() => setLangOpen((v) => !v)}>
            <Languages size={16} className="text-ink-3" />
            {t('Language: {name}', { name: LANGUAGES.find((l) => l.code === currentLang())?.name ?? currentLang() })}
          </button>
          {lang && (
            <div className="px-1 pb-1">
              <LanguageList />
            </div>
          )}
          <button
            type="button"
            className={row}
            onClick={() => {
              setOpen(false)
              onConnect()
            }}
          >
            <span className={`size-2 rounded-full ${status === 'connected' ? (source?.kind === 'live' ? 'bg-ok' : 'bg-sun') : 'bg-miss'}`} />
            {source?.kind === 'live' ? t('Connected · {name}', { name: source.label }) : t('Demo mode')}
          </button>
        </div>
      )}
    </div>
  )
}

/** Fullscreen (ui/fullscreen.ts); on iPad it opens the "Add to Home Screen" guide */
function FullscreenButton() {
  const on = useFullscreen()
  // Opened from the home screen it is already like fullscreen (no address bar)
  if (isStandalone()) return null
  return (
    <button
      type="button"
      id="fullscreen-toggle"
      onClick={fullscreenButton}
      aria-pressed={on}
      className="grid size-9 touch-manipulation place-items-center rounded-xl border border-line bg-surface text-ink-2 hover:text-ink"
      title={on ? t('Exit fullscreen') : t('Fullscreen')}
    >
      {on ? <Minimize size={16} /> : <Maximize size={16} />}
    </button>
  )
}

export default function TopBar({ onConnect }: { onConnect: () => void }) {
  const mode = useLayout((s) => s.mode)
  const setMode = useLayout((s) => s.setMode)
  const theme = useLayout((s) => s.theme)
  const setTheme = useLayout((s) => s.setTheme)
  const next = THEMES[(THEMES.findIndex((th) => th.id === theme) + 1) % THEMES.length]
  const current = THEMES.find((th) => th.id === theme)!
  const Current = current.Icon
  const lite = useView((s) => s.lite)
  const setLite = useView((s) => s.setLite)
  const dashboard = useView((s) => s.dashboard)
  const fps = useView((s) => s.fps)
  // Tabs: View, Dashboard (control panel; opens in view mode), Edit
  const tab = mode === 'edit' ? 'edit' : dashboard ? 'dashboard' : 'view'
  const pick = (id: 'view' | 'dashboard' | 'edit') => {
    useView.getState().setDashboard(id === 'dashboard')
    if (id === 'dashboard' && fps) useView.getState().setFps(false)
    setMode(id === 'edit' ? 'edit' : 'view')
  }

  return (
    // On phones the logo and the home and floor names are hidden so the bar fits; below 1024 px (portrait tablets too) lite
    // mode, theme and connection move into the "More" menu
    <header className="glass pointer-events-auto relative z-40 flex h-16 items-center gap-1.5 rounded-none border-x-0 border-t-0 px-2 sm:gap-3 sm:px-4">
      <div className="flex items-center gap-1.5 sm:gap-2.5">
        <div className="hidden size-9 place-items-center sm:grid rounded-xl bg-gradient-to-br from-[#3f56e0] to-[#3346c4] text-white shadow-md shadow-[#3f56e0]/30">
          <House size={19} strokeWidth={2.2} />
        </div>
        <div className="hidden shrink-0 whitespace-nowrap leading-tight xl:block">
          <p className="text-[17px] font-bold tracking-tight">Homescape</p>
          <p className="text-[11px] text-ink-3">Home Assistant 3D</p>
        </div>
        <HomeSwitcher />
        <FloorSwitcher />
      </div>

      <div className="mx-auto flex rounded-xl bg-surface-2 p-1" role="tablist" aria-label={t('Mode')}>
        {(
          [
            ['view', t('View'), Eye],
            ['dashboard', t('Dashboard'), LayoutDashboard],
            ['edit', t('Edit'), Pencil],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            aria-label={label}
            onClick={() => pick(id)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors ${
              tab === id ? 'bg-surface text-brand shadow-sm' : 'text-ink-2 hover:text-ink'
            }`}
          >
            <Icon size={15} />
            {/* Between phone and laptop widths only the active tab is labelled (longer languages fit the bar) */}
            <span className={tab === id ? 'hidden sm:inline' : 'hidden lg:inline'}>{label}</span>
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1.5 sm:gap-2">
        <button
          type="button"
          id="search-open"
          onClick={() => window.dispatchEvent(new Event('homescape:search'))}
          className="grid size-9 place-items-center rounded-xl border border-line bg-surface text-ink-2 hover:text-ink"
          title={t('Search items and rooms (⌘K or /)')}
        >
          <Search size={16} />
        </button>
        <FullscreenButton />
        <button
          type="button"
          id="fps-toggle"
          onClick={() => {
            const on = !fps
            if (on) {
              setMode('view')
              useView.getState().setDashboard(false)
            }
            useView.getState().setFps(on)
          }}
          aria-pressed={fps}
          className={`flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border px-2.5 text-[12.5px] font-semibold ${fps ? 'border-brand bg-brand text-white' : 'border-line bg-surface text-ink-2 hover:text-ink'}`}
          title={fps ? t('Exit first-person walk (Esc)') : t('First-person walk: explore the home through the eyes of a person and control devices')}
        >
          <PersonStanding size={16} />
          <span className="hidden xl:inline">{fps ? t('Exit walk') : t('Walk')}</span>
        </button>
        <SoundButton />
        <button
          type="button"
          onClick={() => {
            setLite(!lite)
            useHa.setState({
              notice: lite
                ? t('Lite mode off: shadows and animations are back.')
                : t('Lite mode on: no shadows, no continuous animation, lower resolution. Easier on the computer.'),
            })
          }}
          aria-pressed={lite}
          className={`hidden size-9 place-items-center rounded-xl border lg:grid ${lite ? 'border-ok bg-ok-50 text-ok' : 'border-line bg-surface text-ink-2 hover:text-ink'}`}
          title={lite ? t('Lite mode is on (click to turn off)') : t('Lite mode: turns off shadows and animations for less powerful computers')}
        >
          <Feather size={16} />
        </button>
        <button
          type="button"
          onClick={() => setTheme(next.id)}
          className="hidden size-9 place-items-center rounded-xl border border-line bg-surface text-ink-2 hover:text-ink lg:grid"
          title={t('Theme: {name}. Click for: {next}', { name: current.label, next: next.label })}
        >
          <Current size={16} />
        </button>
        <LanguageButton />
        <div className="hidden lg:block">
          <ConnectionPill onOpen={onConnect} />
        </div>
        <MoreMenu onConnect={onConnect} />
      </div>
    </header>
  )
}
