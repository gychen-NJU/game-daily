#!/usr/bin/env node
/**
 * peek.mjs — 看运行记录 / 校准状态（只读）。
 *
 * 用法：
 *   node peek.mjs --game sr
 *   node peek.mjs --game sr --json
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SKILLS_ROOT = join(__dirname, '..', '..')
const argv = process.argv.slice(2)
const flag = (f) => argv.includes(f)
const valOf = (f) => {
  const i = argv.indexOf(f)
  return i >= 0 ? argv[i + 1] : null
}
const game = valOf('--game') || 'sr'
const asJson = flag('--json')

const moduleDir = join(SKILLS_ROOT, `game-daily-${game}`)
const stateDir = join(moduleDir, 'state')
const runsDir = join(stateDir, 'runs')
const localFile = join(stateDir, 'coords.local.json')
const coordsFile = join(moduleDir, 'references', `${game}-coords.json`)

const out = { game, stateDir, runs: [], coords: {}, helper: {} }

if (existsSync(runsDir)) {
  const files = readdirSync(runsDir).filter((f) => f.endsWith('.json')).sort()
  for (const f of files) {
    try {
      const list = JSON.parse(readFileSync(join(runsDir, f), 'utf8'))
      for (const r of list) out.runs.push({ day: f.replace('.json', ''), ...r })
    } catch {}
  }
}

if (existsSync(localFile)) {
  const loc = JSON.parse(readFileSync(localFile, 'utf8'))
  out.coords.localCount = Object.keys(loc.items || {}).length
  out.coords.base = loc.base
  out.coords.calibratedAt = loc.calibratedAt
} else {
  out.coords.localCount = 0
  out.coords.base = null
}
if (existsSync(coordsFile)) {
  const c = JSON.parse(readFileSync(coordsFile, 'utf8'))
  out.coords.refCount = c.items.length
  out.coords.refBase = c.base
}

for (const [f, k] of [['helper.pid', 'pid'], ['heartbeat.txt', 'heartbeatAgeSec']]) {
  const p = join(stateDir, f)
  if (existsSync(p)) {
    if (f === 'helper.pid') out.helper.pid = Number(readFileSync(p, 'utf8').trim())
    else out.helper.heartbeatAgeSec = Math.round((Date.now() - statSync(p).mtimeMs) / 1000)
  }
}
out.helper.running = Number.isFinite(out.helper.heartbeatAgeSec) && out.helper.heartbeatAgeSec <= 5

if (asJson) {
  process.stdout.write(JSON.stringify(out, null, 2) + '\n')
} else {
  process.stdout.write(`game=${game}\n`)
  process.stdout.write(`坐标：local ${out.coords.localCount}/${out.coords.refCount ?? '?'} 已校准` + (out.coords.base ? `  base ${out.coords.base.w}x${out.coords.base.h}` : '') + '\n')
  const age = out.coords.calibratedAt ? Math.round((Date.now() - Date.parse(out.coords.calibratedAt)) / 3600000) : null
  if (age !== null) process.stdout.write(`校准时间：${out.coords.calibratedAt}（${age} 小时前）\n`)
  process.stdout.write(`提权助手：${out.helper.running ? '存活 pid ' + out.helper.pid : '未运行'}\n`)
  if (!out.runs.length) {
    process.stdout.write('还没有运行记录。\n')
  } else {
    const head = 'DAY'.padEnd(12) + 'STEP'.padStart(5) + '  ADAPTER'.padEnd(12) + 'FAIL' .padStart(5) + '  NAME'
    process.stdout.write('\n' + head + '\n' + '-'.repeat(head.length + 20) + '\n')
    for (const r of out.runs.slice(-40)) {
      const fail = r.result && typeof r.result.failed === 'number' ? r.result.failed : '-'
      process.stdout.write(String(r.day).padEnd(12) + String(r.step ?? '').padStart(5) + '  ' + String(r.adapter ?? '').padEnd(10) + String(fail).padStart(5) + '  ' + (r.name ?? '') + '\n')
    }
  }
}
