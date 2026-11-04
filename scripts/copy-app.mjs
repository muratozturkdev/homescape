// Copies the production build (dist/) into the Home Assistant app folder (homescape/www/), so the app can be installed
// locally without building the web app on the Home Assistant machine. Run with: npm run build:app
import { cpSync, existsSync, rmSync } from 'node:fs'

if (!existsSync('dist/index.html')) {
  console.error('dist/index.html is missing: run npm run build first')
  process.exit(1)
}
rmSync('homescape/www', { recursive: true, force: true })
cpSync('dist', 'homescape/www', { recursive: true })
console.log('Copied dist/ to homescape/www/. Copy the homescape/ folder to /addons/homescape on your Home Assistant machine.')
