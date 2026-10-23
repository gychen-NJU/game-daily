#!/usr/bin/env node
/**
 * coords.mjs — 坐标解析 / 校验 / 校准记录。
 *
 * 数据来源（优先级从高到低）：
 *   1. <module>/state/coords.local.json   ← 本机校准值（每台机器自己的）
 *   2. <module>/references/<game>-coords.json ← 出厂相对坐标（随技能分发）
 *
 * 用法：
 *   node coords.mjs resolve guide.task_claim --game sr
 *   node coords.mjs list --game sr
 *   node coords.mjs check --game sr            # 流程里引用的 id 是否都存在
 *   node coords.mjs calibrate --game sr        # 还差哪些没校准
 *   node coords.mjs set guide.task_claim 540 1182 --game sr --note "指南第1张卡"
 *   node coords.mjs export --game sr --json    # 导出全部解析结果
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SKILLS_ROOT = join(__dirname, '..', '..')

const argv = process.argv.slice(2)
const asJson = argv.includes('--json')
const cmd = argv[0]
const game = valOf('--game') || 'sr'
const note = valOf('--note') || ''
const screenArg = valOf('--screen') // "2560x1600"

function valOf(flag) {
  const i = argv.indexOf(flag)
  return i >= 0 ? argv[i + 1] : null
}

const MODULE = `game-daily-${game}`
const moduleDir = join(SKILLS_ROOT, MODULE)
const refsFile = join(moduleDir, 'references', `${game}-coords.json`)
const dailyFile = join(moduleDir, 'references', `${game}-daily.json`)
const stateDir = join(moduleDir, 'state')
const localFile = join(stateDir, 'coords.local.json')

function die(msg) {
  process.stderr.write(`coords: ${msg}\n`)
  process.exit(2)
}

function readJson(p, fallback = null) {
  if (!existsSync(p)) return fallback
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch (e) {
    die(`解析失败 ${p}: ${e.message}`)
  }
}

const refs = readJson(refsFile)
if (!refs || !Array.isArray(refs.items)) die(`缺少坐标文件：${refsFile}`)

const local = readJson(localFile, { base: null, items: {} })
if (!local.items) local.items = {}

const base = refs.base || { w: 2560, h: 1600 }

function currentScreen() {
  if (screenArg && /^\d+x\d+$/.test(screenArg)) {
    const [w, h] = screenArg.split('x').map(Number)
    return { w, h }
  }
  if (local.base && local.base.w && local.base.h) return { w: local.base.w, h: local.base.h }
  return { w: base.w, h: base.h }
}

function findItem(id) {
  return refs.items.find((it) => it.id === id) || null
}

function resolve(id) {
  const loc = local.items[id]
  if (loc && Number.isFinite(loc.x) && Number.isFinite(loc.y)) {
    return { id, x: loc.x, y: loc.y, source: 'local', note: loc.note || '' }
  }
  const it = findItem(id)
  if (!it) return null
  const screen = currentScreen()
  if (!it.relative) {
    if (it.absolute) return { id, x: it.absolute.x, y: it.absolute.y, source: 'absolute(legacy)', note: it.note || '' }
    return null
  }
  return {
    id,
    x: Math.round(it.relative.rx * screen.w),
    y: Math.round(it.relative.ry * screen.h),
    source: 'relative',
    screen,
    note: it.note || '',
  }
}

function saveLocal() {
  if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true })
  const screen = currentScreen()
  const payload = {
    base: { w: screen.w, h: screen.h },
    calibratedAt: new Date().toISOString(),
    items: local.items,
  }
  writeFileSync(localFile, JSON.stringify(payload, null, 2) + '\n', 'utf8')
}

function allIds() {
  return refs.items.map((it) => it.id)
}

function idsReferencedByDaily() {
  const daily = readJson(dailyFile, null)
  if (!daily) return null
  const ids = new Set()
  for (const st of daily.steps || []) {
    for (const a of st.actions || []) if (a.coord) ids.add(a.coord)
  }
  return { daily, ids: [...ids] }
}

function print(obj) {
  if (asJson) return process.stdout.write(JSON.stringify(obj, null, 2) + '\n')
  if (typeof obj === 'string') return process.stdout.write(obj + '\n')
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n')
}

switch (cmd) {
  case 'resolve': {
    const id = argv[1]
    if (!id) die('用法: resolve <id>')
    const r = resolve(id)
    if (!r) die(`找不到坐标 id：${id}（既未校准，也不在 ${game}-coords.json）`)
    print(r)
    break
  }
  case 'list': {
    const rows = allIds().map((id) => {
      const r = resolve(id)
      const loc = !!local.items[id]
      return { id, x: r ? r.x : null, y: r ? r.y : null, source: r ? r.source : 'missing', calibrated: loc, note: (findItem(id) || {}).note || '' }
    })
    if (asJson) print(rows)
    else {
      const head = 'ID'.padEnd(26) + 'X'.padStart(6) + 'Y'.padStart(7) + '  SOURCE'.padEnd(18) + 'CAL  NOTE'
      process.stdout.write(head + '\n' + '-'.repeat(head.length + 10) + '\n')
      for (const r of rows) {
        process.stdout.write(
          String(r.id).padEnd(26) + String(r.x ?? '-').padStart(6) + String(r.y ?? '-').padStart(7) + '  ' + String(r.source).padEnd(16) + (r.calibrated ? 'Y' : '.') + '    ' + r.note + '\n',
        )
      }
    }
    break
  }
  case 'check': {
    const ref = idsReferencedByDaily()
    if (!ref) die(`缺少流程文件：${dailyFile}（先写 ${game}-daily.json）`)
    const missing = ref.ids.filter((id) => !findItem(id) && !local.items[id])
    const uncalibrated = ref.ids.filter((id) => !local.items[id])
    const out = {
      game,
      dailySteps: ref.daily.steps.length,
      referenced: ref.ids.length,
      missingIds: missing,
      uncalibratedCount: uncalibrated.length,
      screen: currentScreen(),
      base,
      screenMatchesBase: currentScreen().w === base.w && currentScreen().h === base.h,
    }
    if (asJson) print(out)
    else {
      process.stdout.write(`game=${game} steps=${out.dailySteps} referenced=${out.referenced} missing=${missing.length} uncalibrated=${out.uncalibratedCount}\n`)
      process.stdout.write(`screen=${out.screen.w}x${out.screen.h} base=${base.w}x${base.h} matches=${out.screenMatchesBase}\n`)
      if (missing.length) process.stdout.write('MISSING: ' + missing.join(', ') + '\n')
      if (uncalibrated.length) process.stdout.write('未校准: ' + uncalibrated.join(', ') + '\n')
    }
    process.exit(missing.length ? 1 : 0)
  }
  case 'calibrate': {
    const ids = allIds().filter((id) => !local.items[id])
    const out = { game, screen: currentScreen(), pending: ids, hint: '对每个 id：截图 → 看图定位 → coords.mjs set <id> <x> <y> --game ' + game }
    if (asJson) print(out)
    else {
      process.stdout.write(`待校准 ${ids.length}/${allIds().length}（screen ${out.screen.w}x${out.screen.h}）\n`)
      for (const id of ids) process.stdout.write('  - ' + id + '\n')
      process.stdout.write(out.hint + '\n')
    }
    break
  }
  case 'set': {
    const [, id, xs, ys] = argv
    const x = Number(xs)
    const y = Number(ys)
    if (!id || !Number.isFinite(x) || !Number.isFinite(y)) die('用法: set <id> <x> <y> [--note ...]')
    if (!findItem(id) && !local.items[id]) {
      process.stderr.write(`coords: 警告：${id} 不在 ${game}-coords.json 里，仍写入 local（确认 id 拼写）\n`)
    }
    local.items[id] = { x, y, note: note || local.items[id]?.note || '' }
    saveLocal()
    print({ ok: true, id, x, y, file: localFile })
    break
  }
  case 'export': {
    const rows = allIds().map((id) => resolve(id)).filter(Boolean)
    print(rows)
    break
  }
  default:
    process.stdout.write(`game-daily coords.mjs
用法:
  node coords.mjs resolve <id> --game ${game}
  node coords.mjs list --game ${game}
  node coords.mjs check --game ${game}
  node coords.mjs calibrate --game ${game}
  node coords.mjs set <id> <x> <y> [--note "说明"] --game ${game}
  node coords.mjs export --game ${game} --json
选项: --screen 2560x1600 覆盖屏幕尺寸；--json 机器可读
`)
}
