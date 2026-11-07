import { create } from 'zustand'

/*
 * Open state of the demo site's intro card (ui/SiteIntro.tsx, src/site.ts): open by itself on the first visit, again
 * from the "Get Homescape" button in the top bar.
 */
const SEEN = 'homescape-site-intro'

function firstVisit() {
  try {
    return localStorage.getItem(SEEN) !== '1'
  } catch {
    return true
  }
}

export const useSiteIntro = create<{ open: boolean }>(() => ({ open: firstVisit() }))

export function openSiteIntro() {
  useSiteIntro.setState({ open: true })
}

export function closeSiteIntro() {
  try {
    localStorage.setItem(SEEN, '1')
  } catch {
    /* storage unavailable: the card shows again next time */
  }
  useSiteIntro.setState({ open: false })
}
