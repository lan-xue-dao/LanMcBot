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
