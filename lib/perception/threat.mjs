// 感知增强（对标 MCC 实体感知）：把 mineflayer 原始实体/方块映射为展示字段，
// 并提供「距离加权威胁评分 + 排序」纯函数。全部零 bot 依赖，可直接单测。
//
// 设计边界：不改变现有 scan.mjs 的对外行为，只是把「实体→展示对象」「威胁打分」
// 抽成可复用纯函数，供 scan.mjs 与其它上层调用。

import { isHostile } from '../entities.mjs'

// 中立/被动生物（会主动攻击玩家但不主动寻仇），威胁低于敌对
const NEUTRAL_MOBS = new Set([
  'piglin', 'piglin_brute', 'enderman', 'iron_golem', 'snow_golem',
  'wolf', 'bee', 'dolphin', 'polar_bear', 'llama', 'cave_spider'
])

/**
 * 纯函数：原始实体 → 展示对象（血量/护甲/朝向/是否着地/手持）。
 * 缺失字段安全降级（不抛异常）。
 * @param {object} e mineflayer 实体
 * @param {{x,y,z}} center 参照点
 * @returns {{name:string,type:number,distance:string,health:(number|null),onGround:boolean,facing:string,heldItem:(string|null)}}
 */
export function formatEntity(e, center) {
  // 玩家实体 name 恒为 'player'，展示优先用 username
  const displayName = (e && (e.username || (e.name !== 'player' ? e.name : null))) || (e && (e.name || e.username)) || 'unknown'
  if (!e || !e.position || !center) {
    return { name: displayName, type: e?.type ?? -1, distance: '?', health: null, onGround: false, facing: 'unknown', heldItem: null }
  }
  const dist = e.position.distanceTo(center)
  const health = (typeof e.health === 'number') ? e.health : null
  // 朝向：用 yaw（弧度）折算八个方位名，无则 unknown
  let facing = 'unknown'
  if (typeof e.yaw === 'number') {
    const deg = ((e.yaw * 180 / Math.PI) % 360 + 360) % 360
    const dirs = ['south', 'west', 'north', 'east']
    facing = dirs[Math.round(deg / 90) % 4]
  }
  let heldItem = null
  try {
    if (e.heldItem && e.heldItem.name) heldItem = e.heldItem.name
  } catch { /* 忽略 */ }
  return {
    name: displayName,
    type: e.type ?? -1,
    distance: dist.toFixed(1),
    health,
    onGround: !!e.onGround,
    facing,
    heldItem
  }
}

/**
 * 纯函数：单个实体的威胁分（距离越近、越敌对越高）。
 * @param {object} e mineflayer 实体
 * @param {{x,y,z}} center
 * @param {{range?:number}} o 生效半径（超出计 0）
 * @returns {number} 0..~20
 */
export function threatScore(e, center, { range = 16 } = {}) {
  if (!e || !e.position || !center) return 0
  const d = e.position.distanceTo(center)
  if (d > range) return 0
  const proximity = 1 - d / range // 0..1，越近越大
  const isP = e.name === 'player' || !!e.username
  let base
  if (isP) base = 8            // 玩家威胁（PvP 场景）
  else if (isHostile(e.name)) base = 10
  else if (NEUTRAL_MOBS.has(e.name)) base = 4
  else return 0                // 被动生物不计威胁
  // 手持武器/低血对手略微加权
  let held = 0
  try {
    if (e.heldItem && /sword|axe|bow/.test(e.heldItem.name || '')) held = 2
  } catch {}
  return Math.round((base + held) * (0.4 + 0.6 * proximity) * 10) / 10
}

/**
 * 纯函数：按威胁分降序排实体，附带格式化字段。
 * @param {Array<object>} entities
 * @param {{x,y,z}} center
 * @param {object} o 透传给 threatScore
 * @returns {Array<object>} formatEntity 输出 + threat（分数）
 */
export function rankThreats(entities, center, o = {}) {
  return (entities || [])
    .map(e => ({ ...formatEntity(e, center), threat: threatScore(e, center, o) }))
    .sort((a, b) => b.threat - a.threat)
}
