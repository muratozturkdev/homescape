# Running Homescape inside Home Assistant

Homescape can open from Home Assistant's sidebar. Inside Home Assistant it reuses the frontend's own login: there is no
second sign-in and Homescape never stores a token. Pick one of the two ways below.

| | Add-on (ingress) | Files in `/config/www` + Webpage dashboard |
| --- | --- | --- |
| Works on | Home Assistant OS, Supervised | Every installation (also Container and Core) |
| Updates | From the add-on store | Copy the new build over the old one |
| Sidebar entry | Automatic ("Homescape") | You add a Webpage dashboard |

## Option 1: add-on

1. In Home Assistant open **Settings > Add-ons > Add-on store**, then the menu (three dots) **> Repositories**.
2. Add `https://github.com/muratozturk5/homescape` and close the dialog.
3. Find **Homescape** in the store, install it and start it. Turn on **Show in sidebar**.
4. Open **Homescape** from the sidebar.

The add-on builds the web app from the repository on first install (this takes a few minutes on a Raspberry Pi). To
install a local build instead (for example while developing):

```bash
npm install
npm run build:addon   # builds and copies dist/ to addon/www/
```

Copy the `addon/` folder to `/addons/homescape/` on the Home Assistant machine (Samba or SSH add-on), then in the add-on
store use the menu **> Check for updates**; the add-on appears under **Local add-ons**. With `addon/www/` present the
add-on uses those files and does not build anything.

## Option 2: files in /config/www and a Webpage dashboard

1. Build the app: `npm install && npm run build` (or download the build from a release).
2. Copy the contents of `dist/` to `/config/www/homescape/` on the Home Assistant machine, so that
   `/config/www/homescape/index.html` exists. (Create the `www` folder if it is missing and restart Home Assistant once,
   so it starts serving `/local/`.)
3. Open **Settings > Dashboards > Add dashboard > Webpage**, enter `/local/homescape/index.html`, give it a title
   (Homescape) and an icon (`mdi:home-variant-outline`), and save. It appears in the sidebar.

Files under `/config/www` are served without authentication: anyone who can reach your Home Assistant can download the
app's code, but not your data. Your entities, areas and plan are only loaded over the authenticated connection.

## How the connection works

- **Inside the Home Assistant frontend** (add-on panel or Webpage dashboard), Homescape runs in a same-origin iframe and
  uses the frontend's connection (`window.parent.hassConnection`). The language follows your Home Assistant profile
  unless you pick another one in Homescape's language menu.
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

## Where the plan is stored

Your house plan is kept in the browser (localStorage) and, when connected to Home Assistant, synced to your Home Assistant
user's frontend storage (key `homescape-plan`), so every device you sign in with shows the same plan. Homescape only reads
your Home Assistant state and calls the services you trigger from its controls; it does not change your configuration.
