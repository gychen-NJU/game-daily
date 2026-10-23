#!/usr/bin/env node
/**
 * run-step.mjs — 把流程文件里的某一步翻译成"可执行的动作计划"。
 *
 * 默认只打印计划（dry-run）。加 --ps 时通过提权助手真正执行机械动作
 * （仅 ps-helper 适配器；wincu / native 请由 agent 直接调用工具）。
 *
 * 用法：
 *   node run-step.mjs --game sr --step 2
 *   node run-step.mjs --game sr --all
 *   node run-step.mjs --game sr --step 3 --ps          # 真执行（会动鼠标）
 *   node run-step.mjs --game sr --step 3 --ps --no-fg  # 不抢前台
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs'
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
const stepArg = valOf('--step')
const all = flag('--all')
const execute = flag('--ps')
const noFg = flag('--no-fg')
const asJson = flag('--json')

const moduleDir = join(SKILLS_ROOT, `game-daily-${game}`)
const dailyFile = join(moduleDir, 'references', `${game}-daily.json`)
const coordsFile = join(moduleDir, 'references', `${game}-coords.json`)
const stateDir = join(moduleDir, 'state')
const localFile = join(stateDir, 'coords.local.json')
const runsDir = join(stateDir, 'runs')
const shotsDir = join(stateDir, 'shots')

// 游戏进程名（用于找 hwnd）
const GAME_PROC = { sr: 'StarRail', zzz: 'ZenlessZoneZero', hi: 'BH3', gi: 'YuanShen' }

function die(msg) {
  process.stderr.write(`run-step: ${msg}\n`)
  process.exit(2)
}
const readJson = (p, fb = null) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : fb)

if (!existsSync(dailyFile)) die(`缺少流程文件：${dailyFile}`)
const daily = readJson(dailyFile)
const coords = readJson(coordsFile)
const local = readJson(localFile, { items: {}, base: null })
if (!coords || !Array.isArray(coords.items)) die(`缺少坐标文件：${coordsFile}`)

const base = coords.base || { w: 2560, h: 1600 }
const screenOverride = valOf('--screen')
const screen = (() => {
  if (screenOverride && /^\d+x\d+$/.test(screenOverride)) {
    const [w, h] = screenOverride.split('x').map(Number)
    return { w, h }
  }
  if (local.base && local.base.w) return { w: local.base.w, h: local.base.h }
  return { w: base.w, h: base.h }
})()

function resolveCoord(id) {
  const loc = (local.items || {})[id]
  if (loc && Number.isFinite(loc.x)) return { id, x: loc.x, y: loc.y, source: 'local' }
  const it = coords.items.find((i) => i.id === id)
  if (!it) return null
  if (it.relative) return { id, x: Math.round(it.relative.rx * screen.w), y: Math.round(it.relative.ry * screen.h), source: 'relative' }
  if (it.absolute) return { id, x: it.absolute.x, y: it.absolute.y, source: 'absolute(legacy)' }
  return null
}

function planStep(step) {
  const actions = []
  for (const a of step.actions || []) {
    const row = { do: a.do }
    if (a.coord) {
      const r = resolveCoord(a.coord)
      if (!r) die(`步骤 ${step.id} 引用了不存在的坐标 id：${a.coord}（先补 ${game}-coords.json 或 coords.mjs set）`)
      Object.assign(row, { coord: a.coord, x: r.x, y: r.y, source: r.source })
    }
    if (a.x !== undefined) Object.assign(row, { x: a.x, y: a.y })
    if (a.vk !== undefined) row.vk = a.vk
    if (a.ms !== undefined) row.ms = a.ms
    if (a.name) row.name = a.name
    if (a.target) row.target = a.target
    actions.push(row)
  }
  return {
    id: step.id,
    name: step.name,
    optional: !!step.optional,
    onMismatch: step.onMismatch || 'stop',
    expect: step.expect || null,
    verify: step.verify || null,
    actions,
    note: step.note || '',
  }
}

function printPlan(p) {
  if (asJson) return
  process.stdout.write(`\n[步骤 ${p.id}] ${p.name}${p.optional ? '  (可选：没有就跳过)' : ''}\n`)
  if (p.expect) {
    const all = p.expect.all ? `all=[${p.expect.all.join(' | ')}]` : ''
    const any = p.expect.any ? `any=[${p.expect.any.join(' | ')}]` : ''
    process.stdout.write(`  认屏: ${[all, any].filter(Boolean).join(' ')}\n`)
  }
  for (const a of p.actions) {
    let line = `  → ${a.do}`
    if (a.coord) line += ` ${a.coord} => (${a.x}, ${a.y}) [${a.source}]`
    if (a.vk !== undefined) line += ` vk=${a.vk}`
    if (a.ms !== undefined) line += ` ${a.ms}ms`
    if (a.name) line += ` name=${a.name}`
    if (a.target) line += ` target=${a.target}`
    process.stdout.write(line + '\n')
  }
  if (p.verify) {
    const all = p.verify.all ? `all=[${p.verify.all.join(' | ')}]` : ''
    const any = p.verify.any ? `any=[${p.verify.any.join(' | ')}]` : ''
    process.stdout.write(`  复检: ${[all, any].filter(Boolean).join(' ')}\n`)
  }
  if (p.note) process.stdout.write(`  备注: ${p.note}\n`)
}

function psJson(script) {
  const out = join(stateDir, `.ps-out-${process.pid}.json`)
  const full = `$ErrorActionPreference='Stop'\n$out='${out.replace(/'/g, "''")}'\n${script}\n[IO.File]::WriteAllText($out, ($r | ConvertTo-Json -Compress), (New-Object System.Text.UTF8Encoding($false)))`
  const b64 = Buffer.from(full, 'utf16le').toString('base64')
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', b64], { stdio: 'pipe', windowsHide: true })
  const txt = readFileSync(out, 'utf8')
  try { unlinkSync(out) } catch {}
  return JSON.parse(txt)
}

function gameWindow() {
  const proc = GAME_PROC[game] || 'StarRail'
  const script = `
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices; using System.Text;
public class GDWin {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
}
'@
[void][GDWin]::SetProcessDPIAware()
$p = Get-Process -Name '${proc}' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
$sb = New-Object System.Text.StringBuilder 512
[void][GDWin]::GetWindowTextW([GDWin]::GetForegroundWindow(), $sb, 512)
$r = [ordered]@{ hwnd = if ($p) { [int64]$p.MainWindowHandle } else { 0 }; title = if ($p) { $p.MainWindowTitle } else { '' }; foreground = $sb.ToString() }
`
  return psJson(script)
}

function helperAlive() {
  const pidFile = join(stateDir, 'helper.pid')
  const hb = join(stateDir, 'heartbeat.txt')
  if (!existsSync(pidFile)) return { alive: false, reason: 'helper.pid 不存在' }
  if (!existsSync(hb)) return { alive: false, reason: 'heartbeat.txt 不存在（助手可能已退出）' }
  const ageMs = Date.now() - statSync(hb).mtimeMs
  return { alive: ageMs < 5000, ageSec: Math.round(ageMs / 1000), pid: Number(readFileSync(pidFile, 'utf8').trim()) }
}

function runViaHelper(plan, win) {
  const cmdFile = join(stateDir, 'cmd.txt')
  const outFile = join(stateDir, 'out.jsonl')
  const before = existsSync(outFile) ? readFileSync(outFile, 'utf8').split(/\r?\n/).filter(Boolean).length : 0

  const cmds = []
  if (!noFg) {
    cmds.push('key 18', 'sleep 200', `activate ${win.hwnd}`, 'sleep 700')
  }
  for (const a of plan.actions) {
    if (a.do === 'click') cmds.push(`move ${a.x} ${a.y}`, 'sleep 150', `click ${a.x} ${a.y}`, 'sleep 450')
    else if (a.do === 'move') cmds.push(`move ${a.x} ${a.y}`, 'sleep 150')
    else if (a.do === 'key') cmds.push(`key ${a.vk}`, 'sleep 250')
    else if (a.do === 'wait') cmds.push(`sleep ${a.ms || 500}`)
    else if (a.do === 'fg') cmds.push(`activate ${win.hwnd}`, 'sleep 500')
    else if (a.do === 'shot') {
      const out = join(shotsDir, `${a.name || 'shot'}.png`)
      try {
        execFileSync('powershell.exe', ['-NoProfile', '-File', join(__dirname, 'shot.ps1'), '-Out', out], { stdio: 'pipe', windowsHide: true })
      } catch (e) {
        process.stderr.write(`shot 失败：${e.message}\n`)
      }
    }
  }
  cmds.push('sleep 400')

  const body = `#${new Date().toISOString()}\r\n` + cmds.join('\r\n') + '\r\n'
  writeFileSync(cmdFile, body, 'utf8')

  const deadline = Date.now() + 60000
  const expectLines = cmds.filter((c) => !c.startsWith('sleep')).length
  let got = []
  while (Date.now() < deadline) {
    const lines = existsSync(outFile) ? readFileSync(outFile, 'utf8').split(/\r?\n/).filter(Boolean) : []
    got = lines.slice(before)
    if (got.length >= expectLines) break
    execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Start-Sleep -Milliseconds 150'], { stdio: 'ignore' })
  }
  const parsed = got.map((l) => {
    try { return JSON.parse(l) } catch { return { raw: l, ok: false } }
  })
  return parsed
}

function record(plan, result, adapter) {
  if (!existsSync(runsDir)) mkdirSync(runsDir, { recursive: true })
  const day = new Date().toISOString().slice(0, 10)
  const file = join(runsDir, `${day}.json`)
  const list = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : []
  list.push({
    step: plan.id,
    name: plan.name,
    ts: new Date().toISOString(),
    adapter,
    resolved: plan.actions.filter((a) => a.coord).map((a) => ({ id: a.coord, x: a.x, y: a.y, source: a.source })),
    result,
  })
  writeFileSync(file, JSON.stringify(list, null, 2) + '\n', 'utf8')
  return file
}

function main() {
  const steps = all ? daily.steps : daily.steps.filter((s) => String(s.id) === String(stepArg))
  if (!steps.length) die(`找不到步骤：${stepArg}（可用：${daily.steps.map((s) => s.id).join(', ')}）`)

  const plans = steps.map(planStep)
  if (asJson) process.stdout.write(JSON.stringify(plans, null, 2) + '\n')
  else {
    process.stdout.write(`game=${game} screen=${screen.w}x${screen.h} daily=${daily.steps.length} steps\n`)
    for (const p of plans) printPlan(p)
  }

  if (!execute) {
    if (!asJson) process.stdout.write('\n(dry-run：没有动鼠标。要真正执行请加 --ps，且确保提权助手在跑)\n')
    return
  }

  const h = helperAlive()
  if (!h.alive) die(`提权助手不可用：${h.reason}。先执行 Start-Process powershell -Verb RunAs -File "${join(__dirname, 'helper.ps1')}" -ArgumentList "-StateDir","${stateDir}"`)
  const win = gameWindow()
  if (!win.hwnd) die(`没找到游戏窗口（进程 ${GAME_PROC[game] || 'StarRail'} 未运行或没有主窗口）`)
  if (!noFg && win.foreground && !win.foreground.includes('星穹铁道') && game === 'sr' && !flag('--force')) {
    die(`当前前台是「${win.foreground}」，不是游戏。先切到游戏，或加 --force 用抢前台序列`)
  }

  process.stdout.write(`\n执行中（adapter=ps-helper, hwnd=${win.hwnd}, foreground=${win.foreground}）...\n`)
  const results = []
  for (const p of plans) {
    const r = runViaHelper(p, win)
    const failed = r.filter((x) => x.ok === false)
    process.stdout.write(`[步骤 ${p.id}] ${p.name} → ${failed.length ? '有失败项: ' + JSON.stringify(failed) : '全部动作已发送'}\n`)
    const file = record(p, { sent: r.length, failed: failed.length }, 'ps-helper')
    process.stdout.write(`  记录: ${file}\n`)
    results.push({ step: p.id, failed: failed.length })
  }
  process.stdout.write('\n提醒：动作发完不代表成功。请 now 截图复检（shot.ps1 或适配器截图），核对 verify 后的文案。\n')
  process.exit(results.some((r) => r.failed) ? 1 : 0)
}

main()
