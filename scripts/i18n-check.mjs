// Collects every translatable text in src/ (string literals passed to t(), tc(), tn() and msg()) and checks each locale file in
// src/i18n/locales/: missing keys, keys no longer used, and placeholders ({name}) that do not match the English text.
// Also lists t() calls whose first argument is not a literal, so dynamic keys can be reviewed.
//   node scripts/i18n-check.mjs            check (exit code 1 on missing keys or placeholder mismatches)
//   node scripts/i18n-check.mjs --keys     print every key with one source location (and plural: true for tn keys) as JSON
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

const SRC = 'src'
const LOCALES = 'src/i18n/locales'
const files = []
const walk = (dir) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) walk(p)
    else if (/\.(ts|tsx)$/.test(f) && !p.startsWith(join(SRC, 'i18n'))) files.push(p)
  }
}
walk(SRC)

const keys = new Map()
/** Keys of counted phrases (tn): translations give one form per plural category */
const plural = new Set()
const dynamic = []
const literal = (n) => (n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : null)
for (const file of files) {
  const text = readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const name = node.expression.text
      const where = () => `${file}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`
      if (name === 't' || name === 'msg') {
        const k = literal(node.arguments[0])
        if (k != null) keys.set(k, keys.get(k) ?? where())
        else if (name === 't' && node.arguments.length) dynamic.push(`${where()}  t(${node.arguments[0].getText(sf).slice(0, 60)})`)
      }
      if (name === 'tc') {
        const c = literal(node.arguments[0])
        const k = literal(node.arguments[1])
        if (c != null && k != null) keys.set(`${c}|${k}`, keys.get(`${c}|${k}`) ?? where())
        else dynamic.push(`${where()}  tc(${node.arguments.map((a) => a.getText(sf)).join(', ').slice(0, 60)})`)
      }
      if (name === 'tn') {
        const k = literal(node.arguments[2])
        if (k != null) {
          keys.set(k, keys.get(k) ?? where())
          plural.add(k)
        }
        else dynamic.push(`${where()}  tn(..., ${node.arguments[2]?.getText(sf).slice(0, 60)})`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
}

if (process.argv.includes('--keys')) {
  const out = [...keys].sort(([a], [b]) => a.localeCompare(b)).map(([k, at]) => [k, plural.has(k) ? { at, plural: true } : { at }])
  // process.exit would cut a long output that goes to a pipe; write it and let the process end by itself
  process.stdout.write(`${JSON.stringify(Object.fromEntries(out), null, 1)}\n`)
} else check()

function check() {
  const holes = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')
  let bad = 0
  console.log(`${keys.size} texts in ${files.length} files`)
  for (const f of readdirSync(LOCALES).filter((f) => f.endsWith('.json')).sort()) {
    const dict = JSON.parse(readFileSync(join(LOCALES, f), 'utf8'))
    const missing = [...keys.keys()].filter((k) => !(k in dict))
    const unused = Object.keys(dict).filter((k) => !keys.has(k))
    const mismatch = Object.entries(dict).filter(([k, v]) => keys.has(k) && [v].flat().flatMap((x) => (typeof x === 'string' ? [x] : Object.values(x))).some((x) => holes(x) !== holes(k)))
    bad += missing.length + mismatch.length
    console.log(`${f}: ${missing.length} missing, ${unused.length} unused, ${mismatch.length} placeholder mismatches`)
    for (const k of missing.slice(0, 10)) console.log(`  missing: ${JSON.stringify(k)} (${keys.get(k)})`)
    for (const [k] of mismatch.slice(0, 10)) console.log(`  placeholders differ: ${JSON.stringify(k)}`)
  }
  if (dynamic.length) {
    console.log(`\n${dynamic.length} calls with a non-literal text (keys must be registered with msg()):`)
    for (const d of dynamic) console.log(`  ${d}`)
  }
  process.exitCode = bad ? 1 : 0
}
