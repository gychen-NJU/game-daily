#!/usr/bin/env node
/**
 * layout.mjs — game-daily「锚点布局模型」（anchor + reference offset）
 *
 * 为什么需要它：绝对坐标只在录制它的那台机器、那个分辨率上成立。换分辨率就整体错位，
 * 而逐个分辨率再校准一遍不可维护。锚点偏移把每个元素描述成
 *     「贴哪条边/哪个角」+「距该锚点的偏移（单位：参考逻辑像素）」
 * 于是在任意 W×H 下都能算出它大致会出现在哪。
 *
 * ★ 本模型算出来的是「初始位置 / 视觉定位搜索区域的中心」，不是点击坐标。
 *   真正点击前，必须由视觉定位引擎在该位置附近找到模板/文字再点。见 engine/layout.md。
 *
 * 坐标轴约定：
 *   reference = 逻辑参考视口（1920×1080），offset 的单位是它的像素。
 *   base      = 这份布局被拟合出来的那个真实视口（崩3 是 2560×1600）。
 *   k         = scaleMode 决定的缩放：
 *                 width  → screen.w / reference.w        （★ 默认：面板/列表/贴边 UI 按宽度缩放）
 *                 height → screen.h / reference.h        （弹窗类：不遵守宽度律，只给搜索窗）
 *                 fixed  → 1                             （像素级固定的元素）
 *   x = anchorX + dx*k，y = anchorY + dy*k，最后 clamp 到 [0,W-1]×[0,H-1]。
 *
 * 尺度律（2026-10-30 1080p 实机校准，见 engine/layout.md §11）：
 *   同一元素 1600p→1080p 的中心与尺寸都满足 ×0.75（= 1920/2560 = 宽度比），
 *   不是高度比 0.675；顶部元素顶边锚定，贴底元素（dock/进度条）底边锚定。
 *   故主体用 width，弹窗（实测既不是 0.75 也不是 0.675）保留 height。
 *
 * 基准反算（fit）：offset = (baseAbsolute - anchorBase) / kBase
 *   kBase 用 base 视口代入同一个 scaleMode（width → base.w/reference.w = 1.3333）。
 *   所以任意 scaleMode 的条目在 base 分辨率下都必然精确复原（由 check 的基准反解校验把守）。
 *
 * 用法：
 *   node layout.mjs resolve --layout <json> --screen 1920x1080 --item <id> [--json]
 *   node layout.mjs resolve --layout <json> --screen 1920x1080 --all      [--json]
 *   node layout.mjs check   --layout <json> [--json]        # schema + 基准反解校验
 *   node layout.mjs export  --layout <json> --screen 2560x1600 --out <file>
 *   node layout.mjs fit     --layout <json> [--write]       # 维护用：按 derived 重算 offset
 *
 * 退出码：0 成功 / 1 check 未通过 / 2 用法·IO·schema 错误。
 * 依赖：仅 node 内置模块，不联网。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve as resolvePath } from 'node:path'
import { pathToFileURL } from 'node:url'

/** 逻辑参考视口。offset 的单位就是它的像素。 */
export const REFERENCE = { w: 1920, h: 1080 }
/** 合法锚点：第一个字母是纵向(t/m/b)，第二个字母是横向(l/c/r)。 */
export const ANCHORS = ['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br']
/** 合法缩放模式。 */
export const SCALE_MODES = ['height', 'width', 'fixed']

const EXIT_OK = 0
const EXIT_FAIL = 1
const EXIT_USAGE = 2

const round = (v, n = 2) => {
  const p = 10 ** n
  return Math.round(v * p) / p
}

/** 锚点在某视口下的屏幕坐标。 */
export function anchorPoint(anchor, w, h) {
  if (!ANCHORS.includes(anchor)) {
    throw new Error(`非法 anchor: ${JSON.stringify(anchor)}（合法值 ${ANCHORS.join(' / ')}）`)
  }
  const v = anchor[0]
  const hz = anchor[1]
  const x = hz === 'l' ? 0 : hz === 'c' ? w / 2 : w
  const y = v === 't' ? 0 : v === 'm' ? h / 2 : h
  return { x, y }
}

/** 缩放系数 k。height 模式 = 视口高 / 参考高。 */
export function kFor(scaleMode, w, h, ref = REFERENCE) {
  if (scaleMode === 'width') return w / ref.w
  if (scaleMode === 'fixed') return 1
  return h / ref.h
}

/** 布局的基准视口（offset 在这里被拟合出来）。缺 base 时退回 reference。 */
export function baseViewport(layout) {
  const b = layout && (layout.base || layout.reference)
  if (!b || !Number.isFinite(b.w) || !Number.isFinite(b.h)) {
    throw new Error('layout 缺少 base 或 reference 视口（{w,h}）')
  }
  return { w: b.w, h: b.h }
}

export function referenceOf(layout) {
  const r = layout && layout.reference
  if (!r || !Number.isFinite(r.w) || !Number.isFinite(r.h)) return { ...REFERENCE }
  return { w: r.w, h: r.h }
}

/** 该条目在基准视口里的 kBase（用于把 base 绝对坐标反算成 offset）。 */
export function kBaseFor(item, layout) {
  const b = baseViewport(layout)
  return kFor(item.scaleMode || 'height', b.w, b.h, referenceOf(layout))
}

/**
 * 基准反算：由 derived（基准视口下的绝对坐标）反推 offset。
 * offset = (absolute - anchorBase) / kBase
 */
export function fitOffset(item, layout) {
  if (!item || !item.derived || !Number.isFinite(item.derived.x) || !Number.isFinite(item.derived.y)) {
    throw new Error(`条目 ${item && item.id} 缺少 derived{x,y}，无法反算 offset`)
  }
  const b = baseViewport(layout)
  const a = anchorPoint(item.anchor, b.w, b.h)
  const k = kBaseFor(item, layout)
  return { dx: (item.derived.x - a.x) / k, dy: (item.derived.y - a.y) / k }
}

/**
 * 解析单个条目到目标屏幕。
 * opts.withRaw  额外输出未取整的 raw 坐标（校验用）
 * opts.withNote 额外输出 note
 */
export function resolveItem(item, screen, layout, opts = {}) {
  if (!screen || !Number.isFinite(screen.w) || !Number.isFinite(screen.h)) {
    throw new Error('screen 无效（需要 {w,h} 数值）')
  }
  const mode = item.scaleMode || 'height'
  if (!SCALE_MODES.includes(mode)) throw new Error(`条目 ${item.id} 的 scaleMode 非法: ${mode}`)
  const k = kFor(mode, screen.w, screen.h, referenceOf(layout))
  const a = anchorPoint(item.anchor, screen.w, screen.h)
  const off = item.offset || {}
  if (!Number.isFinite(off.dx) || !Number.isFinite(off.dy)) {
    throw new Error(`条目 ${item.id} 的 offset.dx/dy 不是数值`)
  }

  const rawX = a.x + off.dx * k
  const rawY = a.y + off.dy * k
  const maxX = screen.w - 1
  const maxY = screen.h - 1
  let x = rawX
  let y = rawY
  let clamped = false
  if (x < 0) {
    x = 0
    clamped = true
  } else if (x > maxX) {
    x = maxX
    clamped = true
  }
  if (y < 0) {
    y = 0
    clamped = true
  } else if (y > maxY) {
    y = maxY
    clamped = true
  }

  const out = {
    id: item.id,
    x: Math.round(x),
    y: Math.round(y),
    screen: { w: screen.w, h: screen.h },
    scale: round(k, 4),
    anchor: item.anchor,
    offset: { dx: off.dx, dy: off.dy },
    scaleMode: mode,
    clamped,
    desc: item.desc || '',
  }
  if (opts.withNote) out.note = item.note || ''
  if (opts.withRaw) out.raw = { x: round(rawX, 3), y: round(rawY, 3) }
  return out
}

/** 解析整份布局。 */
export function resolveAll(layout, screen, opts = {}) {
  const items = Array.isArray(layout && layout.items) ? layout.items : []
  return items.map((it) => resolveItem(it, screen, layout, opts))
}

/**
 * 校验布局：schema 合法性 + 基准反解自洽 + 可解析。
 * 返回 { ok, errors:[], warnings:[], stats:{...} }
 */
export function checkLayout(layout) {
  const errors = []
  const warnings = []
  const stats = {
    count: 0,
    byAnchor: {},
    byScaleMode: {},
    bySource: {},
    roundtrip: { checked: 0, missing: 0, maxDev: 0, maxDevId: null },
    clampedAtBase: [],
    clampedAtReference: [],
  }

  const items = layout && Array.isArray(layout.items) ? layout.items : null
  if (!items) {
    errors.push('items 不是数组')
    return { ok: false, errors, warnings, stats }
  }
  if (!items.length) errors.push('items 为空')

  const ref = layout.reference
  if (!ref || !Number.isFinite(ref.w) || !Number.isFinite(ref.h) || ref.w <= 0 || ref.h <= 0) {
    errors.push('reference{w,h} 缺失或非法')
  } else if (ref.w !== REFERENCE.w || ref.h !== REFERENCE.h) {
    warnings.push(`reference 不是 ${REFERENCE.w}×${REFERENCE.h}（实际 ${ref.w}×${ref.h}）；k 按此 reference 计算，请确认这是本意`)
  }
  for (const key of ['base', 'game', 'note']) {
    if (key === 'base' && layout[key] === undefined) {
      warnings.push('缺少 base（拟合视口）；fit/基准反解将退回 reference')
      continue
    }
    if (key === 'base' && (!Number.isFinite(layout.base?.w) || !Number.isFinite(layout.base?.h))) {
      errors.push('base{w,h} 非法')
    }
  }

  const seen = new Set()
  const base = (() => {
    try {
      return baseViewport(layout)
    } catch {
      return null
    }
  })()

  for (const it of items) {
    const label = `items[${it && it.id ? it.id : '?'}]`
    if (!it || typeof it !== 'object') {
      errors.push('items 里存在非对象项')
      continue
    }
    stats.count += 1
    if (typeof it.id !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(it.id)) {
      errors.push(`${label}: id 缺失或含非法字符（只允许 A-Za-z0-9_.-）`)
    } else if (seen.has(it.id)) {
      errors.push(`${label}: id 重复`)
    } else {
      seen.add(it.id)
    }

    if (!ANCHORS.includes(it.anchor)) errors.push(`${label}: anchor ${JSON.stringify(it.anchor)} 非法`)

    const mode = it.scaleMode
    if (!mode) {
      warnings.push(`${label}: 缺 scaleMode，解析时按 height 处理`)
    } else if (!SCALE_MODES.includes(mode)) {
      errors.push(`${label}: scaleMode ${JSON.stringify(mode)} 非法`)
    }

    if (!it.offset || !Number.isFinite(it.offset.dx) || !Number.isFinite(it.offset.dy)) {
      errors.push(`${label}: offset.dx / offset.dy 必须是数值`)
    }

    if (typeof it.desc !== 'string' || !it.desc.trim()) warnings.push(`${label}: 缺 desc`)

    stats.byAnchor[it.anchor] = (stats.byAnchor[it.anchor] || 0) + 1
    stats.byScaleMode[mode || 'height'] = (stats.byScaleMode[mode || 'height'] || 0) + 1

    if (!it.derived) {
      stats.roundtrip.missing += 1
      warnings.push(`${label}: 缺 derived，跳过基准反解校验`)
    } else if (!Number.isFinite(it.derived.x) || !Number.isFinite(it.derived.y)) {
      errors.push(`${label}: derived.x / derived.y 必须是数值`)
    } else {
      stats.bySource[it.derived.source || 'unknown'] = (stats.bySource[it.derived.source || 'unknown'] || 0) + 1
      try {
        const fit = fitOffset(it, layout)
        const k = kBaseFor(it, layout)
        const d = Math.hypot((fit.dx - it.offset.dx) * k, (fit.dy - it.offset.dy) * k)
        if (d > 0.01) {
          errors.push(`${label}: offset 与 derived 不一致（按 derived 反算偏移 ${d.toFixed(3)}px），跑 fit 修正`)
        }
        if (base) {
          const r = resolveItem(it, base, layout, { withRaw: true })
          const dev = Math.hypot(r.raw.x - it.derived.x, r.raw.y - it.derived.y)
          stats.roundtrip.checked += 1
          if (dev > stats.roundtrip.maxDev) {
            stats.roundtrip.maxDev = dev
            stats.roundtrip.maxDevId = it.id
          }
          if (dev > 0.5) errors.push(`${label}: 基准反解偏差 ${dev.toFixed(3)}px > 0.5px`)
          if (r.clamped) stats.clampedAtBase.push(it.id)
        }
      } catch (e) {
        errors.push(`${label}: 无法解析（${e.message}）`)
      }
    }
  }

  // 在 reference 视口下再解析一遍：确保任何条目都能解析、且落在界内
  try {
    for (const r of resolveAll(layout, referenceOf(layout))) {
      if (r.clamped) stats.clampedAtReference.push(r.id)
    }
  } catch (e) {
    errors.push(`在 reference 视口下解析失败：${e.message}`)
  }

  if (stats.clampedAtBase.length) errors.push(`基准视口下有 ${stats.clampedAtBase.length} 项被 clamp（不应发生）：${stats.clampedAtBase.join(', ')}`)

  stats.roundtrip.maxDev = round(stats.roundtrip.maxDev, 4)
  return { ok: errors.length === 0, errors, warnings, stats }
}

/** 解析 "--screen 1920x1080" / "1920×1080"。 */
export function parseScreen(s) {
  if (s == null) return null
  const m = String(s).trim().match(/^(\d{2,5})\s*[x×X*]\s*(\d{2,5})$/)
  if (!m) throw new Error(`--screen 格式非法: ${s}（应形如 1920x1080）`)
  const w = Number(m[1])
  const h = Number(m[2])
  if (w < 64 || h < 64) throw new Error(`--screen 太小: ${w}x${h}`)
  return { w, h }
}

export function loadLayout(file) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch (e) {
    throw new Error(`读不到布局文件 ${file}: ${e.message}`)
  }
  let data
  try {
    data = JSON.parse(text)
  } catch (e) {
    throw new Error(`布局文件不是合法 JSON（${file}）: ${e.message}`)
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`布局文件顶层必须是对象（${file}）`)
  return data
}

function parseArgs(argv) {
  const opts = { _: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const eq = a.indexOf('=')
      if (eq > 0) {
        opts[a.slice(2, eq)] = a.slice(eq + 1)
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        opts[a.slice(2)] = argv[++i]
      } else {
        opts[a.slice(2)] = true
      }
    } else {
      opts._.push(a)
    }
  }
  return opts
}

const HELP = `layout.mjs — 锚点布局模型（anchor + reference offset）

用法:
  node layout.mjs resolve --layout <json> --screen 1920x1080 --item <id> [--json]
  node layout.mjs resolve --layout <json> --screen 1920x1080 --all [--json]
  node layout.mjs check   --layout <json> [--json]
  node layout.mjs export  --layout <json> --screen 2560x1600 --out <file>
  node layout.mjs fit     --layout <json> [--write]

说明:
  resolve  把某个条目按目标屏幕解析成初始位置（视觉定位搜索区域中心，非点击坐标）
  check    schema 校验 + 基准反解自洽校验（offset 必须能精确复原 derived）
  export   解析全部条目并落一份 JSON，供视觉定位引擎/下游直接消费
  fit      维护用：按每条 derived 重算 offset（默认只报告，--write 才落盘）

选项:
  --screen WxH   目标视口；resolve/export 省略时用 layout.reference
  --json         机器可读输出；出错时输出 {"ok":false,"error":...} 并以非零码退出
`

function fail(msg, code, asJson) {
  if (asJson) process.stdout.write(JSON.stringify({ ok: false, error: msg }, null, 2) + '\n')
  process.stderr.write(`layout: ${msg}\n`)
  return code
}

function printJson(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n')
}

function table(rows, headers, aligns) {
  const widths = headers.map((h, i) => Math.max(String(h).length, ...rows.map((r) => String(r[i]).length)))
  const line = (cells) =>
    cells
      .map((c, i) => {
        const s = String(c)
        const w = widths[i]
        if (aligns[i] === 'r') return s.padStart(w)
        if (aligns[i] === 'c') {
          const pad = Math.max(0, w - s.length)
          return ' '.repeat(Math.floor(pad / 2)) + s + ' '.repeat(Math.ceil(pad / 2))
        }
        return s.padEnd(w)
      })
      .join('  ')
  return [line(headers), line(widths.map((w) => '-'.repeat(w))), ...rows.map(line)].join('\n')
}

export function main(argv) {
  const o = parseArgs(argv)
  const cmd = o._[0]
  const asJson = o.json === true || o.json === 'true' || o.json === ''

  if (!cmd || o.help || o.h) {
    process.stdout.write(HELP + '\n')
    return EXIT_OK
  }
  if (!['resolve', 'check', 'export', 'fit'].includes(cmd)) {
    return fail(`未知子命令: ${cmd}（可用 resolve / check / export / fit）`, EXIT_USAGE, asJson)
  }
  if (!o.layout || o.layout === true) return fail('缺少 --layout <布局 json 路径>', EXIT_USAGE, asJson)

  const layoutPath = resolvePath(String(o.layout))
  let layout
  try {
    layout = loadLayout(layoutPath)
  } catch (e) {
    return fail(e.message, EXIT_USAGE, asJson)
  }

  let screen = null
  try {
    screen = parseScreen(o.screen)
  } catch (e) {
    return fail(e.message, EXIT_USAGE, asJson)
  }
  if (!screen) screen = referenceOf(layout)
  const refView = referenceOf(layout)
  const kW = kFor('width', screen.w, screen.h, refView)
  const kH = kFor('height', screen.w, screen.h, refView)
  const modeCount = layout.items.reduce((acc, it) => {
    const m = it.scaleMode || 'height'
    acc[m] = (acc[m] || 0) + 1
    return acc
  }, {})
  const modeLabel = SCALE_MODES.filter((m) => modeCount[m]).map((m) => `${m}:${modeCount[m]}`).join(' ') || '-'

  if (cmd === 'resolve') {
    const wantItem = typeof o.item === 'string' ? o.item : null
    const wantAll = o.all === true || o.all === 'true' || o.all === ''
    if (wantItem && wantAll) return fail('--item 与 --all 只能用其一', EXIT_USAGE, asJson)
    if (!wantItem && !wantAll) return fail('需要 --item <id> 或 --all', EXIT_USAGE, asJson)
    let rows
    try {
      rows = wantItem
        ? [resolveItem(layout.items.find((it) => it.id === wantItem) || failUnknown(wantItem), screen, layout, { withNote: true })]
        : resolveAll(layout, screen, { withNote: true })
    } catch (e) {
      return fail(e.message, EXIT_USAGE, asJson)
    }

    if (asJson) {
      printJson(
        wantItem
          ? rows[0]
          : { ok: true, screen, count: rows.length, clamped: rows.filter((r) => r.clamped).map((r) => r.id), items: rows },
      )
      return EXIT_OK
    }
    if (wantItem) {
      const r = rows[0]
      process.stdout.write(`${r.id}  x=${r.x} y=${r.y}  screen=${r.screen.w}x${r.screen.h}  k=${r.scale}  anchor=${r.anchor}  scaleMode=${r.scaleMode}  clamped=${r.clamped}\n`)
      process.stdout.write(`  offset=(${r.offset.dx}, ${r.offset.dy})  desc=${r.desc}\n`)
      if (r.note) process.stdout.write(`  note=${r.note}\n`)
      return EXIT_OK
    }
    const clampedIds = rows.filter((r) => r.clamped).map((r) => r.id)
    process.stdout.write(
      `${String(layout.game || layoutPath)}  screen=${screen.w}x${screen.h}  k(width)=${round(kW, 4)}  k(height)=${round(kH, 4)}  scaleMode=${modeLabel}  items=${rows.length}  clamped=${clampedIds.length ? clampedIds.join(',') : 'none'}\n`,
    )
    const body = rows.map((r) => [r.id, r.x, r.y, r.x / screen.w, r.y / screen.h, r.anchor, r.clamped ? 'CLAMP' : '.', r.desc])
    process.stdout.write(
      table(body, ['ID', 'X', 'Y', 'X/W', 'Y/H', 'ANCHOR', 'CLAMP', 'DESC'], ['l', 'r', 'r', 'r', 'r', 'l', 'c', 'l']) + '\n',
    )
    return EXIT_OK
  }

  if (cmd === 'check') {
    const res = checkLayout(layout)
    if (asJson) {
      printJson({ ok: res.ok, layout: layoutPath, ...res })
      return res.ok ? EXIT_OK : EXIT_FAIL
    }
    const s = res.stats
    process.stdout.write(`layout   : ${layoutPath}\n`)
    process.stdout.write(
      `game     : ${layout.game || '-'}   items=${s.count}   reference=${(layout.reference || {}).w}x${(layout.reference || {}).h}   base=${(layout.base || {}).w}x${(layout.base || {}).h}\n`,
    )
    process.stdout.write(
      `anchors  : ${ANCHORS.map((a) => `${a}=${s.byAnchor[a] || 0}`).join(' ')}\n` +
        `scaleMode: ${SCALE_MODES.map((m) => `${m}=${s.byScaleMode[m] || 0}`).join(' ')}\n` +
        `source   : ${Object.entries(s.bySource).map(([k, v]) => `${k}=${v}`).join(' ') || '-'}\n`,
    )
    process.stdout.write(
      `roundtrip: ${s.roundtrip.checked} 项基准反解，最大偏差 ${s.roundtrip.maxDev.toFixed(4)}px（id: ${s.roundtrip.maxDevId || '-'}）` +
        `   clamped@base=${s.clampedAtBase.length}  clamped@reference=${s.clampedAtReference.length ? s.clampedAtReference.join(',') : 0}\n`,
    )
    if (res.warnings.length) {
      process.stdout.write(`warnings (${res.warnings.length}):\n`)
      for (const w of res.warnings) process.stdout.write(`  ! ${w}\n`)
    }
    if (res.errors.length) {
      process.stdout.write(`errors (${res.errors.length}):\n`)
      for (const e of res.errors) process.stdout.write(`  x ${e}\n`)
    }
    process.stdout.write(res.ok ? 'CHECK PASS\n' : 'CHECK FAIL\n')
    return res.ok ? EXIT_OK : EXIT_FAIL
  }

  if (cmd === 'export') {
    let rows
    try {
      rows = resolveAll(layout, screen, { withNote: true })
    } catch (e) {
      return fail(e.message, EXIT_USAGE, asJson)
    }
    const payload = {
      ok: true,
      layout: layoutPath,
      game: layout.game || null,
      reference: layout.reference || null,
      base: layout.base || null,
      screen,
      count: rows.length,
      generatedAt: new Date().toISOString(),
      clamped: rows.filter((r) => r.clamped).map((r) => r.id),
      items: rows,
    }
    if (!o.out || o.out === true) {
      printJson(payload)
      return EXIT_OK
    }
    const out = resolvePath(String(o.out))
    try {
      mkdirSync(dirname(out), { recursive: true })
      writeFileSync(out, JSON.stringify(payload, null, 2) + '\n', 'utf8')
    } catch (e) {
      return fail(`写不了输出文件 ${out}: ${e.message}`, EXIT_USAGE, asJson)
    }
    if (asJson) printJson({ ok: true, out, count: rows.length, screen, clamped: payload.clamped })
    else process.stdout.write(`exported ${rows.length} items → ${out}  (screen ${screen.w}x${screen.h}, clamped=${payload.clamped.length})\n`)
    return EXIT_OK
  }

  // fit
  const dry = !(o.write === true || o.write === 'true' || o.write === '')
  let changed = 0
  const rows = []
  try {
    for (const it of layout.items || []) {
      const fit = fitOffset(it, layout)
      const k = kBaseFor(it, layout)
      const d = it.offset && Number.isFinite(it.offset.dx) ? Math.hypot((fit.dx - it.offset.dx) * k, (fit.dy - it.offset.dy) * k) : Infinity
      const next = { dx: round(fit.dx, 6), dy: round(fit.dy, 6) }
      if (!it.offset || d > 1e-9) changed += 1
      rows.push([it.id, it.derived.x, it.derived.y, it.anchor, next.dx, next.dy, Number.isFinite(d) ? round(d, 4) : 'n/a'])
      if (dry) continue
      it.offset = next
    }
  } catch (e) {
    return fail(e.message, EXIT_USAGE, asJson)
  }

  if (dry) {
    if (asJson) {
      printJson({ ok: true, mode: 'dry-run', changed, items: rows.map((r) => ({ id: r[0], derived: { x: r[1], y: r[2] }, anchor: r[3], offset: { dx: r[4], dy: r[5] }, deviation: r[6] })) })
      return EXIT_OK
    }
    process.stdout.write(
      table(rows, ['ID', 'DERIVED X', 'DERIVED Y', 'ANCHOR', 'OFFSET DX', 'OFFSET DY', 'Δ(px)'], ['l', 'r', 'r', 'l', 'r', 'r', 'r']) + '\n',
    )
    process.stdout.write(`dry-run：${changed}/${rows.length} 项需要更新；加 --write 落盘到 ${layoutPath}\n`)
    return EXIT_OK
  }

  try {
    writeFileSync(layoutPath, JSON.stringify(layout, null, 2) + '\n', 'utf8')
  } catch (e) {
    return fail(`写不了布局文件 ${layoutPath}: ${e.message}`, EXIT_USAGE, asJson)
  }
  if (asJson) printJson({ ok: true, mode: 'write', changed, layout: layoutPath })
  else process.stdout.write(`fit: 更新 ${changed}/${rows.length} 项 → ${layoutPath}\n`)
  return EXIT_OK
}

function failUnknown(id) {
  throw new Error(`找不到条目 id: ${id}`)
}

const invokedDirectly =
  process.argv[1] && pathToFileURL(resolvePath(process.argv[1])).href === import.meta.url
if (invokedDirectly) {
  try {
    process.exitCode = main(process.argv.slice(2))
  } catch (e) {
    process.stderr.write(`layout: ${e && e.message ? e.message : e}\n`)
    process.exitCode = EXIT_USAGE
  }
}
