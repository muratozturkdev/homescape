import type { Auth, Connection } from 'home-assistant-js-websocket'

/*
 * Running inside Home Assistant. Homescape can live in Home Assistant's sidebar in two ways (docs/home-assistant.md): as an
 * add-on with an ingress panel, or as a Webpage dashboard pointing at the built files in /config/www/homescape. Both load
 * the app in a same-origin iframe of the Home Assistant frontend, so the app reuses the frontend's own authenticated
 * connection (window.parent.hassConnection): no second login and no token stored by the app. When the built files are
 * opened from Home Assistant's address without the frontend around them, the app signs in through Home Assistant's own
 * login page at that address.
 */

interface HostWindow extends Window {
  hassConnection?: Promise<{ auth: Auth; conn: Connection }>
}

/** The Home Assistant frontend's connection when Homescape is shown inside it, else null */
export function hostConnection(): Promise<{ auth: Auth; conn: Connection }> | null {
  try {
    if (window.parent === window) return null
    return (window.parent as HostWindow).hassConnection ?? null
  } catch {
    // A cross-origin parent (for example another site embedding Homescape) is not Home Assistant
    return null
  }
}

/** Homescape is served by Home Assistant itself (/local/..., an add-on's ingress path or HACS files) */
export const servedByHomeAssistant = () => /^\/(local|api\/hassio_ingress|hacsfiles)\//.test(location.pathname)
