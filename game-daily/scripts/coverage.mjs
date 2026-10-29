import fs from 'node:fs'
import path from 'node:path'
const mod = process.argv[2]
const tplDir = path.join(mod, 'references', 'templates')
const daily = JSON.parse(fs.readFileSync(path.join(mod, 'references', 'hi-daily.json'), 'utf8'))
const ids = new Set()
const walk = (o) => { if (!o || typeof o !== 'object') return; for (const [k, v] of Object.entries(o)) { if (k === 'coord' && typeof v === 'string') ids.add(v); else walk(v) } }
walk(daily)
const idx = JSON.parse(fs.readFileSync(path.join(tplDir, 'index.json'), 'utf8'))
let anchors = {}
try { anchors = JSON.parse(fs.readFileSync(path.join(tplDir, 'anchors.json'), 'utf8')) } catch {}
const rows = []
for (const id of [...ids].sort()) {
  const cands = idx[id] || [`${id}.png`]
  const tpl = cands.find((f) => fs.existsSync(path.join(tplDir, f)))
  const anc = anchors[id]?.anchor
  const ancOk = anc && fs.existsSync(path.join(tplDir, anc))
  rows.push({ id, tpl: tpl || '', anchor: ancOk ? anc : '' , ok: !!(tpl || ancOk) })
}
const miss = rows.filter((r) => !r.ok)
for (const r of rows) console.log(`${r.ok ? 'OK  ' : 'MISS'} ${r.id.padEnd(24)} tpl=${r.tpl || '-'} anchor=${r.anchor || '-'}`)
console.log(`\n合计 ${rows.length} 个 coord id，缺 ${miss.length}`)
process.exit(miss.length ? 2 : 0)