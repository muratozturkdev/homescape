import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { useHa } from '@/ha/store'
import { t } from '@/i18n'

/*
 * Fullscreen. On desktop: the browser's fullscreen UI (Fullscreen API). On iPad (and iPhone) the OS always shows the status
 * bar and its own X button on a fullscreen page and the page cannot hide them, so the button opens the "Add to Home Screen"
 * guide (ui/HomeScreenGuide.tsx); Homescape opened from the home screen icon runs without the address bar, tabs and X, and
 * the status bar takes the app's color (index.html, public/manifest.webmanifest, App > theme-color). The guide also offers
 * "Fullscreen anyway". When opened from the home screen the button is hidden.
 */

type FsDoc = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void; webkitFullscreenEnabled?: boolean }
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => void }

const doc = () => document as FsDoc

export const isFullscreen = () => Boolean(document.fullscreenElement || doc().webkitFullscreenElement)

/** Whether it was opened from the home screen as a web app (no address bar) */
export const isStandalone = () =>
  matchMedia('(display-mode: fullscreen)').matches || matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true

const HINT = t(
  'This browser cannot open the page in fullscreen. On iPad: tap the share icon in the address bar and choose "Add to Home Screen"; opened with the Homescape icon on the home screen, it runs fullscreen without the address bar.',
)

/** iPad / iPhone (also the iPad's desktop identity: it looks like a Mac but has touch) */
export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 0)

/** Whether the "Add to Home Screen" guide is open */
export const useFsGuide = create<{ open: boolean }>(() => ({ open: false }))

/** Button: the guide on iPad, elsewhere enter / leave fullscreen */
export function fullscreenButton() {
  if (isIOS() && !isFullscreen() && !isStandalone()) return useFsGuide.setState({ open: true })
  void toggleFullscreen()
}

export async function toggleFullscreen() {
  const d = doc()
  if (isFullscreen()) {
    if (d.exitFullscreen) await d.exitFullscreen().catch(() => {})
    else d.webkitExitFullscreen?.()
    return
  }
  const el = document.documentElement as FsEl
  try {
    if (el.requestFullscreen && (d.fullscreenEnabled ?? true)) await el.requestFullscreen({ navigationUI: 'hide' })
    else if (el.webkitRequestFullscreen && d.webkitFullscreenEnabled !== false) el.webkitRequestFullscreen()
    else throw new Error('unsupported')
  } catch {
    useHa.setState({ notice: isStandalone() ? t('Homescape is already open from the home screen, without the address bar.') : HINT })
    return
  }
  // Some browsers fail without an error: if it is still not fullscreen a moment later, the notice explains how to do it
  setTimeout(() => {
    if (!isFullscreen() && !isStandalone()) useHa.setState({ notice: HINT })
  }, 600)
}

/** Whether it is fullscreen (for the button icon) */
export function useFullscreen() {
  const [on, setOn] = useState(isFullscreen)
  useEffect(() => {
    const sync = () => setOn(isFullscreen())
    document.addEventListener('fullscreenchange', sync)
    document.addEventListener('webkitfullscreenchange', sync)
    return () => {
      document.removeEventListener('fullscreenchange', sync)
      document.removeEventListener('webkitfullscreenchange', sync)
    }
  }, [])
  return on
}
