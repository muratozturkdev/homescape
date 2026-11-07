# Running Homescape inside Home Assistant

Homescape can open from Home Assistant's sidebar. Inside Home Assistant it reuses the frontend's own login: there is no
second sign-in and Homescape never stores a token. Pick one of the two ways below.

| | App (ingress) | Files in `/config/www` + Webpage dashboard |
| --- | --- | --- |
| Works on | Home Assistant OS, Supervised | Every installation (also Container and Core) |
| Updates | From the Apps page | Copy the new build over the old one |
| Sidebar entry | Automatic ("Homescape"), for every user | You add a Webpage dashboard |

Apps were called add-ons before Home Assistant 2026.2.

## Option 1: app

[![Open your Home Assistant instance and show the add app repository dialog with the Homescape repository pre-filled](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fmuratozturkdev%2Fhomescape)

The button opens your Home Assistant with the repository ready to add (then continue with step 3). By hand:

1. In Home Assistant go to **Settings > Apps** and select **Install app**.
2. In the top-right menu select **Repositories**, add `https://github.com/muratozturkdev/homescape` and close the dialog.
3. Find **Homescape**, install it and start it. Turn on **Show in sidebar**.
4. Open **Homescape** from the sidebar.

The app builds the web page from the repository on first install (this takes a few minutes on a Raspberry Pi). To
install a local build instead (for example while developing):

```bash
npm install
npm run build:app   # builds and copies dist/ to homescape/www/
```

Copy the `homescape/` folder to `/addons/homescape/` on the Home Assistant machine (Samba or SSH app), then check for updates
on the Install app page; the app appears under **Local apps**. With `homescape/www/` present the app uses those files and
does not build anything.

## Option 2: files in /config/www and a Webpage dashboard

1. Download `homescape-<version>-www.zip` from the [latest release](https://github.com/muratozturkdev/homescape/releases/latest)
   and unzip it, or build the app yourself: `npm install && npm run build` (the files are in `dist/`).
2. Copy the files (the contents of the zip, or of `dist/`) to `/config/www/homescape/` on the Home Assistant machine, so that
   `/config/www/homescape/index.html` exists. (Create the `www` folder if it is missing and restart Home Assistant once,
   so it starts serving `/local/`.)
3. Open **Settings > Dashboards > Add dashboard > Webpage**, enter `/local/homescape/index.html`, give it a title
   (Homescape) and an icon (`mdi:home-variant-outline`), and save. It appears in the sidebar.

Files under `/config/www` are served without authentication: anyone who can reach your Home Assistant can download the
app's code, but not your data. Your entities, areas and plan are only loaded over the authenticated connection.

## How the connection works

- **Inside the Home Assistant frontend** (app panel or Webpage dashboard), Homescape runs in a same-origin iframe and uses
  the frontend's connection (`window.parent.hassConnection`). The language follows your Home Assistant profile unless you
  pick another one in Homescape's language menu.
- **Opened directly from Home Assistant's address** (for example `http://homeassistant.local:8123/local/homescape/index.html`
  in a new tab), Homescape signs in through Home Assistant's own login page at that address.
- **Anywhere else** (the development server, your own web server), use the connect dialog in the top right: sign in with
  Home Assistant (OAuth, recommended) or paste a long-lived access token. When the app is served from another origin,
  allow it in Home Assistant's `configuration.yaml`:

  ```yaml
  http:
    cors_allowed_origins:
      - https://homescape.example.com
  ```

  The development server (`npm run dev` with `HA_URL` in `.env.local`) proxies Home Assistant, so no CORS setting is
  needed there.

## Where your data lives

Homescape has no server and no account, and nothing leaves your network.

| What | Where | Who can see it |
| --- | --- | --- |
| Your homes and plans | Home Assistant, in your user's frontend storage (`/config/.storage/frontend.user_data_<user id>`, key `homescape-plan`) | Your Home Assistant user |
| Previous versions of the plan | The same place, key `homescape-plan-backups` (up to 3) | Your Home Assistant user |
| A working copy and up to 5 replaced versions | This browser's local storage | This browser |
| Settings of this device (sound, panel, language, connection) | This browser's local storage | This browser |

- **No internet needed.** Homescape makes no requests outside your Home Assistant: no cloud, no account, no tracking.
  Once installed it keeps working on your home network when the internet is down. (Installing or updating the app
  downloads it from GitHub, so that step needs a connection.)
- **The app stores nothing.** Updating, stopping or uninstalling the Homescape app, or deleting the files in `/config/www`,
  does not touch your plan.
- **Backups:** Home Assistant backups include your plan, because they include `/config/.storage`.
- **Each Home Assistant user has their own plan.** Someone signing in with another user starts with their own. To share a
  home, sign in with the same user on those devices, or use **Plan history > Download all homes** and open the file in
  **Edit**.
- **The demo connection and the sample home are not saved to Home Assistant.** Edits made there stay in that browser.
- **Removing a Home Assistant user** removes that user's frontend storage, and with it their plan.

### What Homescape does to Home Assistant

It reads states, areas, devices and entities, reads and writes the two storage keys above (plus
`homescape-plan-unreadable` if you choose to replace a plan it cannot read), and calls a service only when you press a
control. It does not change your configuration, entities, dashboards or automations.

### How your plan is protected

- Nothing is written unless the plan in Home Assistant was read first; a failed read changes nothing.
- A plan Homescape cannot read, or one saved by a newer version, is never overwritten. Sync stops and your edits stay on
  that device until you update.
- Only your edits are written. A plan generated automatically never replaces the one in Home Assistant, so a device that
  lost its browser data gets your plan back.
- Before a plan is replaced, a copy is kept. Open the home menu and choose **Plan history** to see the copies, restore one
  or download all homes as a file.
- Plans saved by older versions are upgraded when they load, both from the browser and from Home Assistant.
