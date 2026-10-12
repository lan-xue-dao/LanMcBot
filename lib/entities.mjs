// 实体分类单一数据源：避免敌对生物表在 bot.mjs 与 perception 间双份硬编码、口径不一致。
// 名单覆盖 1.20.x 常见「主动攻击玩家」的敌对生物（不含中立/被动）。
// 实体名使用 mineflayer 的小写 snake_case（与 bot.entities[e].name 一致）。

export const HOSTILE_MOBS = [
  'zombie',
  'skeleton',
  'spider',
  'creeper',
  'enderman',
  'drowned',
  'phantom',
  'guardian',
  'witch',
  'slime',
  'magma_cube',
  'husk',
  'stray',
  'blaze',
  'pillager',
  'vindicator',
  'evoker',
  'vex',
  'silverfish',
  'endermite',
  'elder_guardian',
  'zoglin',
  'hoglin'
]

const HOSTILE_SET = new Set(HOSTILE_MOBS)

// 纯函数：判断一个实体名是否属敌对（大小写/前后空格不敏感）
export function isHostile(name) {
  if (!name) return false
  return HOSTILE_SET.has(String(name).trim().toLowerCase())
}

// PvP（PvE 之外的战斗另一半）：
//   玩家实体的 name 是 'player'，displayName/username 才是玩家名。
//   白名单/黑名单由调用方维护，这里提供纯判定与过滤函数（可单测）。

/**
 * 纯函数：判断实体是否是可攻击的玩家目标。
 * @param {object} entity mineflayer 实体（{name, username, ...}）
 * @param {{whitelist?:string[], blacklist?:string[], selfUsername?:string}} o
 *   whitelist 非空时只允许名单内玩家；blacklist 永远排除（管理员/队友）
 * @returns {boolean}
 */
export function isPvpTarget(entity, { whitelist = null, blacklist = [], selfUsername = '' } = {}) {
  if (!entity || entity.name !== 'player') return false
  const name = String(entity.username || '').trim().toLowerCase()
  if (!name) return false
  if (selfUsername && name === String(selfUsername).trim().toLowerCase()) return false
  const bl = new Set((blacklist || []).map(s => String(s).trim().toLowerCase()))
  if (bl.has(name)) return false
  if (whitelist && whitelist.length > 0) {
    const wl = new Set(whitelist.map(s => String(s).trim().toLowerCase()))
    if (!wl.has(name)) return false
  }
  return true
}

/**
 * 纯函数：从实体表里挑最近的 PvP 目标（与 combat.findNearestHostile 同风格）。
 */
export function findNearestPlayer(entities, botPos, { maxDistance = 16, selfUsername = '', whitelist = null, blacklist = [] } = {}) {
  let best = null
  let bestD = Infinity
  for (const e of Object.values(entities || {})) {
    if (!e || !e.position || typeof e.position.distanceTo !== 'function') continue
    if (!isPvpTarget(e, { whitelist, blacklist, selfUsername })) continue
    const d = e.position.distanceTo(botPos)
    if (d < bestD && d <= maxDistance) {
      bestD = d
      best = e
    }
  }
  return best ? { entity: best, distance: bestD } : null
}
