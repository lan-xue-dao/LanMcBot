// 战斗模块（P0-2 战斗基线）：自研轻量实现，不引入会接管控制状态的第三方插件，
// 以免与自研 nav（lib/nav，同样使用 setControlState）互搏。
//
// 设计原则（与 lifecycle/entities 一致）：
//   1) 决策/选择逻辑写成「无 bot 依赖」的纯函数，便于 mocha 单测；
//   2) controller 通过注入依赖工作，真实寻路/攻击动作由调用方提供；
//   3) 自动战斗默认关闭，由 !combat on 显式开启，避免干扰导航。

import { isHostile } from './entities.mjs'

// 武器粗略伤害排序（越高越优先）；含剑与斧。用于自动选装。
const WEAPON_RANK = {
  netherite_sword: 9, diamond_sword: 8, iron_sword: 6, stone_sword: 5,
  golden_sword: 4, wooden_sword: 4,
  netherite_axe: 10, diamond_axe: 9, iron_axe: 7, stone_axe: 6,
  golden_axe: 5, wooden_axe: 4
}

const HELMET_RANK = { netherite_helmet: 7, diamond_helmet: 6, iron_helmet: 5, chainmail_helmet: 4, golden_helmet: 4, leather_helmet: 3, turtle_helmet: 4 }
const CHEST_RANK = { netherite_chestplate: 8, diamond_chestplate: 7, iron_chestplate: 6, chainmail_chestplate: 5, golden_chestplate: 5, leather_chestplate: 4 }
const LEGS_RANK = { netherite_leggings: 7, diamond_leggings: 6, iron_leggings: 5, chainmail_leggings: 4, golden_leggings: 4, leather_leggings: 3 }
const BOOTS_RANK = { netherite_boots: 4, diamond_boots: 4, iron_boots: 4, chainmail_boots: 3, golden_boots: 3, leather_boots: 2 }

function rankOf(name, table) {
  return name && table[name] ? table[name] : 0
}

/**
 * 纯函数：从实体表里挑最近的敌对目标。
 * @param {object} entities mineflayer bot.entities（{id: entity}）
 * @param {{distanceTo:Function}} botPos 当前 bot 位置（含 distanceTo）
 * @param {{maxDistance?:number, isHostileFn?:Function}} opts
 * @returns {{entity:object, distance:number}|null}
 */
export function findNearestHostile(entities, botPos, { maxDistance = 32, isHostileFn = isHostile } = {}) {
  let nearest = null
  let best = Infinity
  for (const e of Object.values(entities || {})) {
    if (!e || !e.position || typeof e.position.distanceTo !== 'function') continue
    if (!isHostileFn(e.name)) continue
    const d = e.position.distanceTo(botPos)
    if (d < best && d <= maxDistance) {
      best = d
      nearest = e
    }
  }
  return nearest ? { entity: nearest, distance: best } : null
}

/**
 * 纯函数：从物品清单里挑伤害最高的武器（无则返回 null）。
 * @param {Array<{name:string}>} items
 * @returns {{name:string, rank:number}|null}
 */
export function pickWeapon(items) {
  let best = null
  let bestRank = 0
  for (const it of items || []) {
    const r = rankOf(it && it.name, WEAPON_RANK)
    if (r > bestRank) {
      bestRank = r
      best = { name: it.name, rank: r }
    }
  }
  return best
}

/**
 * 纯函数：从物品清单里挑每个护甲槽位最好的（返回待装备清单）。
 * @param {Array<{name:string}>} items
 * @returns {Array<{name:string, slot:string}>}
 */
export function pickArmor(items) {
  const out = []
  const consider = (table, slot) => {
    let best = null
    let bestRank = 0
    for (const it of items || []) {
      const r = rankOf(it && it.name, table)
      if (r > bestRank) {
        bestRank = r
        best = { name: it.name, slot }
      }
    }
    if (best) out.push(best)
  }
  consider(HELMET_RANK, 'head')
  consider(CHEST_RANK, 'torso')
  consider(LEGS_RANK, 'legs')
  consider(BOOTS_RANK, 'feet')
  return out
}

/**
 * 纯函数：战斗决策。
 * @param {{health:number, distance:number, retreatHealth?:number, engageRange?:number, weaponReach?:number}} s
 * @returns {'attack'|'retreat'|'approach'}
 */
export function decideAction({ health, distance, retreatHealth = 6, engageRange = 4, weaponReach = 3 }) {
  if (health <= retreatHealth) return 'retreat'
  // weaponReach 内直接攻击，否则靠近；engageRange 用于更早进入战斗姿态
  if (distance <= Math.max(weaponReach, engageRange)) return 'attack'
  return 'approach'
}

/**
 * 战斗控制器：注入式，不依赖 setInterval（测试可手动 step）。
 * @param {object} deps
 * @param {()=>(object|null)} deps.getBot 取当前 bot（断线返回 null 即自动停）
 * @param {(entity:object)=>void} deps.onAttack 攻击动作（一般 bot.lookAt + bot.attack）
 * @param {(entity:object)=>void} [deps.onApproach] 靠近动作
 * @param {()=>void} [deps.onRetreat] 撤退动作
 * @param {(type:string, payload?:any)=>void} [deps.onMessage] 事件回调
 * @param {number} [deps.maxDistance] 索敌半径（默认 16）
 * @param {number} [deps.tickMs] 自动 tick 间隔（默认 500）
 */
export function createCombatController({
  getBot,
  onAttack,
  onApproach,
  onRetreat,
  onMessage,
  maxDistance = 16,
  tickMs = 500
}) {
  let enabled = false
  let timer = null
  let targetId = null

  function step() {
    const bot = getBot ? getBot() : null
    if (!bot || !enabled || !bot.entity || !bot.entity.position) return
    const found = findNearestHostile(bot.entities, bot.entity.position, { maxDistance })
    if (!found) {
      targetId = null
      return
    }
    targetId = found.entity.id
    const act = decideAction({ health: bot.health ?? 20, distance: found.distance })
    if (act === 'attack') {
      if (onMessage) onMessage('combat_attack', { name: found.entity.name, distance: Math.round(found.distance * 10) / 10 })
      if (onAttack) onAttack(found.entity)
    } else if (act === 'retreat') {
      if (onMessage) onMessage('combat_retreat', { name: found.entity.name, health: bot.health })
      if (onRetreat) onRetreat()
    } else {
      if (onApproach) onApproach(found.entity)
    }
  }

  function start() {
    if (enabled) return
    enabled = true
    if (onMessage) onMessage('combat_started', {})
    timer = setInterval(step, tickMs)
  }

  function stop() {
    if (!enabled) return
    enabled = false
    if (timer) { clearInterval(timer); timer = null }
    targetId = null
    if (onMessage) onMessage('combat_stopped', {})
  }

  function setEnabled(v) {
    if (v) start()
    else stop()
  }

  return {
    start,
    stop,
    setEnabled,
    isEnabled: () => enabled,
    step,
    getTargetId: () => targetId
  }
}
