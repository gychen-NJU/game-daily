/**
 * resolution.mjs — 分辨率指纹缓存（"分辨率没变就按上次的经验来"）。
 *
 * 规则：
 *  - 每次开始跑，先用当前客户区尺寸算一个指纹（如 1920x1080）。
 *  - 指纹与上次一致 → 复用该分辨率下**上一次命中的位置**当搜索先验，搜索窗收窄
 *    （更快、误配更少）。注意：先验只是搜索窗，**仍然必须模板命中且过阈值**，
 *    绝不直接拿缓存坐标去点。
 *  - 指纹变化 → 旧分辨率的先验一律不使用（保留存档），所有目标重新按模板定位。
 *
 * 状态文件：<stateDir>/resolution.json
 * ```
 * { "schemaVersion": 1,
 *   "current": { "w":1920, "h":1080, "clientX":320, "clientY":277, "seenAt":"..." },
 *   "profiles": { "1920x1080": { "firstSeenAt":"...", "lastSeenAt":"...", "runs":3,
 *                               "hits": { "tasks.open": { "cx":120,"cy":182,"score":0.9999,"scale":1,"via":"template","at":"..." } } } } }
 * ```
 */
import fs from 'node:fs'
import path from 'node:path'

const FILE = 'resolution.json'

function fileFor(stateDir) {
  return path.join(stateDir, FILE)
}

function readAll(stateDir) {
  try {
    return JSON.parse(fs.readFileSync(fileFor(stateDir), 'utf8'))
  } catch {
    return null
  }
}

function blank() {
  return { schemaVersion: 1, current: null, profiles: {} }
}

function save(stateDir, data) {
  fs.mkdirSync(stateDir, { recursive: true })
  fs.writeFileSync(fileFor(stateDir), JSON.stringify(data, null, 2) + '\n', 'utf8')
}

export function keyOf(client) {
  return `${client.w}x${client.h}`
}

/** 登记一次开场：返回指纹是否变化、该分辨率下已有多少条历史命中。 */
export function noticeResolution(stateDir, client) {
  const data = readAll(stateDir) || blank()
  const key = keyOf(client)
  const prev = data.current ? keyOf(data.current) : null
  const p = data.profiles[key] || (data.profiles[key] = { firstSeenAt: new Date().toISOString(), hits: {} })
  p.lastSeenAt = new Date().toISOString()
  p.runs = (p.runs || 0) + 1
  data.current = { w: client.w, h: client.h, clientX: client.x, clientY: client.y, seenAt: p.lastSeenAt }
  save(stateDir, data)
  const hits = Object.keys(p.hits || {}).length
  return { key, prev, changed: prev !== null && prev !== key, hits, runs: p.runs, priorsUsable: prev === key && hits > 0 }
}

/** 取某目标在该分辨率下的上次命中（分辨率不一致、没跑过、或该目标没命中过 → null）。 */
export function priorsFor(stateDir, client, id) {
  const data = readAll(stateDir)
  if (!data || !data.current) return null
  const key = keyOf(client)
  if (keyOf(data.current) !== key) return null
  const hit = (((data.profiles || {})[key] || {}).hits || {})[id]
  return hit && typeof hit.cx === 'number' ? hit : null
}

/** 记一次成功命中（只记 ok 的，失败不写，避免把坏先验存下来）。 */
export function rememberHit(stateDir, client, id, info) {
  const data = readAll(stateDir) || blank()
  const key = keyOf(client)
  const p = data.profiles[key] || (data.profiles[key] = { firstSeenAt: new Date().toISOString(), hits: {} })
  p.hits = p.hits || {}
  p.hits[id] = {
    cx: Math.round(info.cx),
    cy: Math.round(info.cy),
    score: Number(info.score) || 0,
    scale: Number(info.scale) || 1,
    via: info.via || 'template',
    at: new Date().toISOString(),
  }
  save(stateDir, data)
}
