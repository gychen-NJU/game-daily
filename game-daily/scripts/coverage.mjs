// 覆盖率自检：扫 <模块>/references/*-daily.json 里所有 coord 字段，
// 逐个检查 references/templates/ 里是否有模板、变体（index.json）或锚点（anchors.json）。
// 用法：node coverage.mjs <技能模块目录>；缺一个 exit 2。
import fs from 'node:fs'
import path from 'node:path'

const mod = process.argv[2]
if (!mod || !fs.existsSync(mod)) {
  console.error(`用法：node coverage.mjs <技能模块目录>（目录不存在：${mod || '(空)'}）`)
  process.exit(2)
}

const refs = path.join(mod, 'references')
const tplDir = path.join(refs, 'templates')

function pickDaily() {
  let files = []
  try {
    files = fs.readdirSync(refs).filter((f) => /-daily\.json$/i.test(f))
  } catch {
    return ''
  }
  if (!files.length) return ''
  const suffix = path.basename(mod).replace(/^game-daily-/, '')
  const exact = files.find((f) => f.startsWith(`${suffix}-`))
  return path.join(refs, exact || files[0])
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

const dailyFile = pickDaily()
if (!dailyFile) {
  console.error(`没找到 ${path.join(refs, '*-daily.json')}`)
  process.exit(2)
}

const daily = readJson(dailyFile)
if (!daily) {
  console.error(`解析失败：${dailyFile}`)
  process.exit(2)
}

const ids = new Set()
const walk = (o) => {
  if (!o || typeof o !== 'object') return
  for (const [k, v] of Object.entries(o)) {
    if (k === 'coord' && typeof v === 'string') ids.add(v)
    else walk(v)
  }
}
walk(daily)

const idx = readJson(path.join(tplDir, 'index.json')) || {}
const anchors = readJson(path.join(tplDir, 'anchors.json')) || {}

const rows = []
for (const id of [...ids].sort()) {
  const cands = Array.isArray(idx[id]) ? idx[id] : [`${id}.png`]
  const tpl = cands.find((f) => fs.existsSync(path.join(tplDir, f))) || ''
  const spec = anchors[id]
  const anc = typeof spec === 'string' ? spec : spec && spec.anchor
  const ancOk = anc && fs.existsSync(path.join(tplDir, anc))
  rows.push({ id, tpl, anchor: ancOk ? anc : '', ok: !!(tpl || ancOk) })
}

const miss = rows.filter((r) => !r.ok)
console.log(`模块 ${path.basename(mod)}：${ids.size} 个 coord id（${path.basename(dailyFile)}，模板目录 ${fs.existsSync(tplDir) ? '有' : '缺'}）`)
for (const r of rows) {
  console.log(`${r.ok ? 'OK  ' : 'MISS'} ${r.id.padEnd(24)} tpl=${r.tpl || '-'} anchor=${r.anchor || '-'}`)
}
console.log(`\n合计 ${rows.length} 个 coord id，缺 ${miss.length}`)
process.exit(miss.length ? 2 : 0)
