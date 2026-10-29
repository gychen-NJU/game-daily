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
 *   node run-step.mjs --game hi --step 2 --ps --locate   # 先定位后点击（推荐，R3）
 *   node run-step.mjs --game sr --step 3 --ps            # 盲点（违反 R3，仅排障用）
 *   node run-step.mjs --game sr --step 3 --ps --no-fg    # 不抢前台
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { noticeResolution, priorsFor, rememberHit } from './resolution.mjs'

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
const execute = flag('--ps') || flag('--probe')
const noFg = flag('--no-fg')
const asJson = flag('--json')
const locateMode = flag('--locate')
const threshold = Number(valOf('--threshold') || 0.72)
const stopOnMiss = !flag('--keep-going')

const moduleDir = join(SKILLS_ROOT, `game-daily-${game}`)
const dailyFile = join(moduleDir, 'references', `${game}-daily.json`)
const coordsFile = join(moduleDir, 'references', `${game}-coords.json`)
const stateDir = join(moduleDir, 'state')
const localFile = join(stateDir, 'coords.local.json')
const runsDir = join(stateDir, 'runs')
const shotsDir = join(stateDir, 'shots')
const evidenceDir = join(shotsDir, 'evidence')
const templateDir = valOf('--template-dir') || join(moduleDir, 'references', 'templates')
const LOCATE_PS = join(__dirname, 'locate.mjs')
const LAYOUT_MJS = join(__dirname, 'layout.mjs')
const layoutFile = valOf('--layout') || join(moduleDir, 'references', `${game}-layout.json`)

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
public struct RECT { public int Left, Top, Right, Bottom; }
public struct POINT { public int X, Y; }
public class GDWin {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
}
'@
[void][GDWin]::SetProcessDPIAware()
$p = Get-Process -Name '${proc}' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
$sb = New-Object System.Text.StringBuilder 512
[void][GDWin]::GetWindowTextW([GDWin]::GetForegroundWindow(), $sb, 512)
$rect = New-Object RECT
$origin = New-Object POINT
$client = [ordered]@{ x = 0; y = 0; w = 0; h = 0 }
if ($p) {
  $h = $p.MainWindowHandle
  if ([GDWin]::GetClientRect($h, [ref]$rect)) {
    $origin.X = 0; $origin.Y = 0
    [void][GDWin]::ClientToScreen($h, [ref]$origin)
    $client = [ordered]@{ x = [int]$origin.X; y = [int]$origin.Y; w = [int]($rect.Right - $rect.Left); h = [int]($rect.Bottom - $rect.Top) }
  }
}
$r = [ordered]@{ hwnd = if ($p) { [int64]$p.MainWindowHandle } else { 0 }; title = if ($p) { $p.MainWindowTitle } else { '' }; foreground = $sb.ToString(); client = $client }
`
  return psJson(script)
}

/** 抓客户区截图（R1：任何点击前先有截图证据）。 */
function captureClient(win, name) {
  if (!existsSync(evidenceDir)) mkdirSync(evidenceDir, { recursive: true })
  const out = join(evidenceDir, `${name}.png`)
  const c = win.client || {}
  if (!c.w || !c.h) throw new Error('窗口客户区尺寸取不到，拒绝继续（R8）')
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
    join(__dirname, 'shot.ps1'), '-Out', out, '-X', String(c.x), '-Y', String(c.y),
    '-W', String(c.w), '-H', String(c.h)], { stdio: 'pipe', windowsHide: true })
  return out
}

/** 调用视觉定位引擎；返回 {found,score,scale,cx,cy,...} 或抛出。fail-closed 的判定在调用方。 */
/** 模板候选：支持 references/templates/index.json 给一个 id 配多个外观变体（按分数取最好）。 */
function templateCandidates(id) {
  const idx = join(templateDir, 'index.json')
  if (existsSync(idx)) {
    try {
      const map = JSON.parse(readFileSync(idx, 'utf8'))
      const list = map && map[id]
      if (Array.isArray(list) && list.length) return list.map((n) => join(templateDir, n))
    } catch { /* 坏索引就当没有 */ }
  }
  return [join(templateDir, `${id}.png`)]
}

function locateOne(shot, tpl, region) {
  const args = [LOCATE_PS, '--image', shot, '--template', tpl, '--threshold', String(threshold), '--json']
  if (region) args.push('--region', region)
  let out = ''
  let code = 0
  try {
    out = execFileSync(process.execPath, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) {
    code = e.status === undefined ? 1 : e.status
    out = String(e.stdout || '')
  }
  let json = null
  for (const line of out.split(/\r?\n/)) {
    if (line.trim().startsWith('{')) {
      try { json = JSON.parse(line) } catch { /* next */ }
    }
  }
  if (!json) return { ok: false, found: false, reason: '定位引擎无 JSON 输出', exit: code, template: tpl }
  return { ...json, template: tpl, exit: code }
}

/** 锚点+偏移（R9）：references/templates/anchors.json 里给同形按钮配"唯一锚点 + 偏移"。 */
function anchorSpec(id) {
  const f = join(templateDir, 'anchors.json')
  if (!existsSync(f)) return null
  try {
    const map = JSON.parse(readFileSync(f, 'utf8'))
    const spec = map && map[id]
    if (spec && spec.anchor && Number.isFinite(spec.dx) && Number.isFinite(spec.dy)) return spec
  } catch { /* 坏表就当没有 */ }
  return null
}

function locateTarget(shot, id, region) {
  const cands = templateCandidates(id)
  const present = flag('--anchor-only') ? [] : cands.filter((p) => existsSync(p))
  if (!present.length) {
    const spec = anchorSpec(id)
    if (!spec) {
      return { id, ok: false, found: false, reason: `模板缺失：${cands.join(', ')}（按 R3 停手，先补模板；同形按钮应先配 anchors.json）`, template: cands[0] }
    }
  }
  const tried = present.map((tpl) => locateOne(shot, tpl, region))
  const hits = tried.filter((r) => r.found)
  if (hits.length) {
    const best = hits.reduce((a, b) => (b.score > a.score ? b : a))
    return { id, ...best, via: 'template', alternatives: tried.map((r) => ({ template: r.template.split(/[\\/]/).pop(), found: r.found, score: r.score, cx: r.cx, cy: r.cy })) }
  }
  const spec = anchorSpec(id)
  if (spec) {
    const anchorPath = join(templateDir, spec.anchor)
    if (existsSync(anchorPath)) {
      // 锚点文字离目标按钮 dx 远（作战任务页是 +402px），用目标先验窗会把它切掉 →
      // 锚点一律全屏找：文字模板本身够独特，且行位置本来就随当日内容漂移。
      const a = locateOne(shot, anchorPath, null)
      if (a.found) {
        const k = a.scale || 1
        const cx = Math.round(a.cx + spec.dx * k)
        const cy = Math.round(a.cy + spec.dy * k)
        return {
          id, ok: true, found: true, via: 'anchor', score: a.score, scale: a.scale, cx, cy,
          anchor: { template: spec.anchor, cx: a.cx, cy: a.cy, score: a.score, scale: a.scale },
          offset: { dx: spec.dx, dy: spec.dy },
          alternatives: tried.map((r) => ({ template: r.template.split(/[\\/]/).pop(), found: r.found, score: r.score })),
        }
      }
      return { id, ok: false, found: false, reason: `直接模板与锚点都没命中（anchor score=${a.score}）`, template: anchorPath, anchor: a, alternatives: tried.map((r) => ({ template: r.template.split(/[\\/]/).pop(), found: r.found, score: r.score })) }
    }
  }
  const best = tried.reduce((a, b) => ((b.score || 0) > (a.score || 0) ? b : a), tried[0] || {})
  return { id, ...best, via: 'template', alternatives: tried.map((r) => ({ template: r.template.split(/[\\/]/).pop(), found: r.found, score: r.score, cx: r.cx, cy: r.cy })) }
}

/** 区域先验：用布局模型给定位引擎一个搜索窗（找不到仍然失败，不降级成盲点）。 */
function layoutRegion(id, win) {
  if (!existsSync(LAYOUT_MJS)) return null
  try {
    const out = execFileSync(process.execPath, [LAYOUT_MJS, 'resolve', '--layout', layoutFile, '--item', id,
      '--screen', `${win.client.w}x${win.client.h}`, '--json'], { encoding: 'utf8' })
    const j = JSON.parse(out)
    if (!j || j.ok === false) return null
    let padX = 320
    let padY = 320
    // 分辨率指纹：同一分辨率下复用上次命中 → 搜索窗收窄（更快、误配更少）。
    // 注意这只影响"去哪儿找"，找到仍需模板命中且过阈值；分辨率变了先验自动失效。
    if (!flag('--no-priors')) {
      try {
        const prior = priorsFor(stateDir, win.client, id)
        if (prior) {
          // 先验窗随分辨率等比放大：1080p 用 ±170，1600p 约 ±252，避免紧窗把
          // 跨分辨率（模板被放大 1.33 倍）的命中挤到边缘掉分
          const k = Math.max(1, win.client.h / 1080)
          padX = Math.round(170 * k)
          padY = Math.round(170 * k)
        }
      } catch { /* 坏表忽略 */ }
    }
    // 每 id 可覆盖搜索窗半宽：同页多行同形按钮（如远征页 4~5 行「完成远征」）靠紧窗消歧
    const rp = join(templateDir, 'regions.json')
    if (existsSync(rp)) {
      try {
        const spec = (JSON.parse(readFileSync(rp, 'utf8')) || {})[id]
        if (spec && Array.isArray(spec.pad) && spec.pad.length === 2) {
          padX = Number(spec.pad[0]) || padX
          padY = Number(spec.pad[1]) || padY
        }
      } catch { /* 坏表忽略 */ }
    }
    const x = Math.max(0, j.x - padX)
    const y = Math.max(0, j.y - padY)
    const w = Math.min(win.client.w - x, padX * 2)
    const h = Math.min(win.client.h - y, padY * 2)
    return `${x},${y},${w},${h}`
  } catch {
    return null
  }
}

function helperAlive() {
  const pidFile = join(stateDir, 'helper.pid')
  const hb = join(stateDir, 'heartbeat.txt')
  if (!existsSync(pidFile)) return { alive: false, reason: 'helper.pid 不存在' }
  if (!existsSync(hb)) return { alive: false, reason: 'heartbeat.txt 不存在（助手可能已退出）' }
  const ageMs = Date.now() - statSync(hb).mtimeMs
  return { alive: ageMs < 5000, ageSec: Math.round(ageMs / 1000), pid: Number(readFileSync(pidFile, 'utf8').trim()) }
}

function runCmds(cmds, expectCount) {
  const cmdFile = join(stateDir, 'cmd.txt')
  const outFile = join(stateDir, 'out.jsonl')
  const before = existsSync(outFile) ? readFileSync(outFile, 'utf8').split(/\r?\n/).filter(Boolean).length : 0
  const body = `#${new Date().toISOString()}-${process.pid}\r\n` + cmds.join('\r\n') + '\r\n'
  writeFileSync(cmdFile, body, 'utf8')
  const expectLines = expectCount !== undefined ? expectCount : cmds.filter((c) => !c.startsWith('sleep')).length
  const deadline = Date.now() + 60000
  let got = []
  while (Date.now() < deadline) {
    const lines = existsSync(outFile) ? readFileSync(outFile, 'utf8').split(/\r?\n/).filter(Boolean) : []
    got = lines.slice(before)
    if (got.length >= expectLines) break
    execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Start-Sleep -Milliseconds 150'], { stdio: 'ignore' })
  }
  return got.map((l) => {
    try { return JSON.parse(l) } catch { return { raw: l, ok: false } }
  })
}

function runViaHelper(plan, win) {
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
  return runCmds(cmds)
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

function runLocated(plans, win, probe) {
  const results = []
  for (const p of plans) {
    const evidence = []
    let pending = []
    let failure = null
    if (!noFg) {
      const fg = runCmds(['key 18', 'sleep 120', `activate ${win.hwnd}`, 'sleep 350'])
      const bad = fg.filter((x) => x.ok === false)
      if (bad.length) process.stderr.write(`  抢前台有问题：${JSON.stringify(bad)}（截图可能拍到别的窗口）\n`)
    }
    const flush = () => {
      if (!pending.length) return
      const sent = runCmds(pending)
      const bad = sent.filter((x) => x.ok === false)
      if (bad.length) process.stderr.write(`  附带动作有失败：${JSON.stringify(bad)}\n`)
      pending = []
    }
    for (const a of p.actions) {
      if (a.do === 'click') {
        if (!a.coord) {
          failure = { step: p.id, failure: '--locate 要求 click 必须用 coord id 指向模板，裸 x/y 会被拒绝（R3/R4）' }
          break
        }
        flush()
        const shot = captureClient(win, `s${p.id}-${String(a.coord).replace(/[^a-zA-Z0-9]+/g, '_')}-${Date.now()}`)
        const region = layoutRegion(a.coord, win)
        const loc = locateTarget(shot, a.coord, region)
        const rec = { step: p.id, id: a.coord, shot, region, locate: loc }
        if (!loc.ok || !loc.found) {
          rec.failure = loc.reason || `未定位到（score=${loc.score}, threshold=${threshold}）`
          evidence.push(rec)
          failure = rec
          break
        }
        const sx = win.client.x + loc.cx
        const sy = win.client.y + loc.cy
        // 记下这次命中当同分辨率的下一轮先验（只记已命中的，失败不写）
        try {
          rememberHit(stateDir, win.client, a.coord, { cx: loc.cx, cy: loc.cy, score: loc.score, scale: loc.scale, via: loc.via })
        } catch { /* 缓存失败不影响执行 */ }
        if (probe) {
          rec.click = { screenX: sx, screenY: sy, clientX: loc.cx, clientY: loc.cy, dryRun: true }
          evidence.push(rec)
        } else {
          const sent = runCmds(['key 18', 'sleep 120', `activate ${win.hwnd}`, 'sleep 250',
            `move ${sx} ${sy}`, 'sleep 120', `click ${sx} ${sy}`, 'sleep 450'])
          const bad = sent.filter((x) => x.ok === false)
          rec.click = { screenX: sx, screenY: sy, clientX: loc.cx, clientY: loc.cy, failed: bad.length }
          evidence.push(rec)
          if (bad.length) {
            failure = { ...rec, failure: '输入发送失败（UIPI/提权？）' }
            break
          }
        }
      } else if (a.do === 'wait') pending.push(`sleep ${a.ms || 500}`)
      else if (a.do === 'key') pending.push(`key ${a.vk}`)
      else if (a.do === 'fg') pending.push(`activate ${win.hwnd}`)
      else if (a.do === 'move') pending.push(`move ${a.x} ${a.y}`)
    }
    if (!failure) flush()
    const file = probe ? null : record(p, { mode: 'locate', threshold, evidence, failure: failure ? failure.failure : null }, 'ps-helper+locate')
    results.push({ step: p.id, failed: failure ? 1 : 0, failure: failure ? failure.failure : null })
    process.stdout.write(`[步骤 ${p.id}] ${p.name} → ${failure ? '停手：' + failure.failure : (probe ? '定位自检通过（未点击）' : '已定位并点击')}\n`)
    for (const e of evidence) {
      const l = e.locate || {}
      process.stdout.write(`  · ${e.id}: via=${l.via || '-'} score=${l.score} scale=${l.scale} client=(${l.cx},${l.cy}) region=${e.region || 'full'} shot=${e.shot}\n`)
    }
    if (file) process.stdout.write(`  记录: ${file}\n`)
    if (failure && stopOnMiss) {
      process.stdout.write('fail-closed：已停手（R3/R7）。修好模板或界面状态后重跑。\n')
      break
    }
  }
  if (probe) return results
  process.exit(results.some((r) => r.failed) ? 3 : 0)
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
  // 分辨率指纹：没变就复用上次先验（更快），变了就作废旧先验并强制重新定位
  try {
    const res = noticeResolution(stateDir, win.client)
    const tag = res.changed
      ? `分辨率变了：${res.prev} → ${res.key} → 旧先验作废，本轮全部重新定位`
      : res.priorsUsable
        ? `分辨率未变（${res.key}）→ 复用 ${res.hits} 条历史命中先验（只收窄搜索窗，仍需模板命中过阈值）`
        : `分辨率 ${res.key}（首次/无历史命中）→ 用默认搜索窗`
    process.stdout.write(`\n[分辨率指纹] ${tag}\n`)
  } catch (e) {
    process.stdout.write(`\n[分辨率指纹] 读取失败（忽略，退回默认）：${e.message}\n`)
  }
  if (!noFg && win.foreground && !win.foreground.includes('星穹铁道') && game === 'sr' && !flag('--force')) {
    die(`当前前台是「${win.foreground}」，不是游戏。先切到游戏，或加 --force 用抢前台序列`)
  }

  const probeMode = flag('--probe')
  if (probeMode) {
    process.stdout.write(`\n定位自检（不点击）：hwnd=${win.hwnd}, client=${win.client.w}x${win.client.h}@${win.client.x},${win.client.y}, threshold=${threshold}\n`)
    const failed = runLocated(plans, win, true)
    const miss = failed.filter((r) => r.failed).length
    process.stdout.write(`\n自检结果：${failed.length - miss}/${failed.length} 步全部目标可定位${miss ? `，${miss} 步不可定位` : ''}\n`)
    process.exit(miss ? 2 : 0)
  }

  if (!locateMode) {
    process.stdout.write('\n⚠ 未加 --locate：将按坐标盲点，违反 R3/R4（仅供排障）。正常流程请用 --locate。\n')
  }
  process.stdout.write(`\n执行中（adapter=ps-helper${locateMode ? '+locate' : ''}, hwnd=${win.hwnd}, foreground=${win.foreground}, client=${win.client.w}x${win.client.h}@${win.client.x},${win.client.y}）...\n`)
  if (locateMode) {
    runLocated(plans, win)
    return
  }
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
