// 耕种/收获能力域（对标 MCC 自动农场）：成熟判定与补种映射为纯函数（零 bot 依赖，可单测），
// 运行期扫描成熟作物 → bot.dig 收获 → 尽力补种由 bot.mjs 组装（复用 findBlocks / placeBlock）。
//
// 作物数据基于 minecraft-data 1.20.4：block state `age`。
//   ripeAge = 视为成熟可收的最低 age；replant = 收获后原地补种的种子物品名（null 表示无需/不可补种）。

// 作物方块名 → 收获参数
export const CROPS = {
  wheat:          { ripeAge: 7, replant: 'wheat_seeds',    produce: 'wheat' },
  carrots:        { ripeAge: 7, replant: 'carrot',         produce: 'carrot' },
  potatoes:       { ripeAge: 7, replant: 'potato',         produce: 'potato' },
  beetroots:      { ripeAge: 7, replant: 'beetroot_seeds', produce: 'beetroot' },
  cocoa:          { ripeAge: 2, replant: 'cocoa_beans',    produce: 'cocoa_beans' },
  nether_wart:    { ripeAge: 3, replant: 'nether_wart',    produce: 'nether_wart' },
  sweet_berry_bush: { ripeAge: 2, replant: null,           produce: 'sweet_berries' }
}

/**
 * 纯函数：取作物收获参数（非作物返回 null）。大小写不敏感。
 */
export function getCropInfo(name) {
  if (!name) return null
  const n = String(name).trim().toLowerCase()
  return CROPS[n] || null
}

/**
 * 纯函数：某作物在给定 age 下是否成熟可收。非作物 / age 缺失返回 false。
 */
export function isRipe(name, age) {
  const info = getCropInfo(name)
  if (!info) return false
  return typeof age === 'number' && age >= info.ripeAge
}

/**
 * 纯函数：从候选作物（含 name + age）里筛出成熟项。
 * @param {Array<{name:string, age:number}>} blocks
 * @returns {Array<object>} 原对象引用，成熟且属于已知作物
 */
export function selectRipeCrops(blocks) {
  return (blocks || []).filter(b => b && isRipe(b.name, b.age))
}

/**
 * 纯函数：该作物收获后应补种的种子名（无则 null）。
 */
export function replantSeed(name) {
  const info = getCropInfo(name)
  return info ? info.replant : null
}
