// 熔炉烧炼（P1 合成域补全）：燃料选择与熔炉动作决策为纯函数（零 bot 依赖，可单测），
// 运行期循环由 bot.mjs 调 mineflayer Furnace API（openFurnace/putInput/putFuel/takeOutput）。
//
// 意义：自动进食（survival.mjs）优先熟食，但熟食只能靠烧炼获得——打通「挖矿得煤 → 烧炼熟食 → 续航」闭环。

// 燃料燃烧时间（刻 ticks，整数近似；1 轮烧炼 = 200 刻）
export const FUEL_TICKS = {
  lava_bucket: 20000,
  coal_block: 16000,
  block_of_charcoal: 16000,
  blaze_rod: 2400,
  coal: 1600,
  charcoal: 1600
}

// 木制品族兜底（planks/log/wood/slab 等），避免逐一枚举
const WOOD_PREFIXES = ['oak_', 'spruce_', 'birch_', 'jungle_', 'acacia_', 'dark_oak_', 'mangrove_', 'cherry_', 'bamboo_']
const WOOD_SUFFIXES = ['planks', 'log', 'wood', 'slab', 'stairs', 'fence', 'fence_gate']
const STICK_TICKS = 100
const WOOD_TICKS = 300

/**
 * 纯函数：返回物品燃烧刻数；非燃料返回 0。
 * @param {string} name mineflayer 物品名（大小写不敏感）
 */
export function fuelTicks(name) {
  if (!name) return 0
  const n = String(name).trim().toLowerCase()
  if (typeof FUEL_TICKS[n] === 'number') return FUEL_TICKS[n]
  if (n === 'stick') return STICK_TICKS
  const prefix = n.split('_')[0] + '_'
  if (WOOD_PREFIXES.includes(prefix) && WOOD_SUFFIXES.some(s => n.endsWith('_' + s))) return WOOD_TICKS
  return 0
}

/**
 * 纯函数：从背包挑燃烧时间最长的燃料。
 * @param {Array<{name:string, count:number}>} items
 * @param {{exclude?: Set<string>}} o 排除物品名（如熔炉原料自身，避免烧掉要烧的东西）
 * @returns {{name:string, count:number, ticks:number}|null}
 */
export function pickFuel(items, { exclude = new Set() } = {}) {
  let best = null
  for (const it of items || []) {
    if (!it || !it.name || (it.count || 0) <= 0) continue
    if (exclude.has(it.name)) continue
    const t = fuelTicks(it.name)
    if (t <= 0) continue
    if (!best || t > best.ticks) best = { name: it.name, count: it.count || 1, ticks: t }
  }
  return best
}

/**
 * 纯函数：熔炉下一步动作（优先级：清产出 → 补燃料 → 补原料 → 等待）。
 * @param {{outputOccupied:boolean, needsFuel:boolean, inputEmpty:boolean}} s
 * @returns {'take_output'|'add_fuel'|'fill_input'|'wait'}
 */
export function nextFurnaceAction(s) {
  if (s.outputOccupied) return 'take_output'
  if (s.needsFuel) return 'add_fuel'
  if (s.inputEmpty) return 'fill_input'
  return 'wait'
}
