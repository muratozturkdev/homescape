// Copies the production build (dist/) into the add-on folder (addon/www/), so the add-on can be installed locally without
// building the app on the Home Assistant machine. Run with: npm run build:addon
import { cpSync, existsSync, rmSync } from 'node:fs'

if (!existsSync('dist/index.html')) {
  console.error('dist/index.html is missing: run npm run build first')
  process.exit(1)
}
rmSync('addon/www', { recursive: true, force: true })
cpSync('dist', 'addon/www', { recursive: true })
console.log('Copied dist/ to addon/www/. Copy the addon/ folder to /addons/homescape on your Home Assistant machine.')
