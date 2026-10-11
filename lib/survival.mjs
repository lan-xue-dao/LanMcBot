// 自动进食（P0-4 生存支撑，P0-1 生存兜底延续）：
//   自研实现（评估结论：mineflayer-auto-eat 可用但引入额外依赖链，自写约 30 行更契合项目风格）。
//   与 combat 一样：决策纯函数可单测 + 注入式 controller；进食走副手（offhand）避免占用主手武器。
//
// 机制：低饥饿/低血量 → 从背包挑可食物品 → equip(off-hand) → bot.activateItem()。
//   注意：minecraft-data 的 foods 表不完整，这里用保守的食物名集合驱动。

// 常见可食物品（广义食物；names 与 mineflayer 物品名一致）
export const FOODS = new Set([
  'apple', 'golden_apple', 'enchanted_golden_apple', 'bread', 'cooked_porkchop', 'porkchop',
  'cooked_beef', 'beef', 'cooked_chicken', 'chicken', 'cooked_mutton', 'mutton',
  'cooked_rabbit', 'rabbit', 'cooked_cod', 'cod', 'cooked_salmon', 'salmon',
  'baked_potato', 'potato', 'poisonous_potato', 'carrot', 'golden_carrot',
  'beetroot', 'beetroot_soup', 'mushroom_stew', 'rabbit_stew', 'suspicious_stew',
  'pumpkin_pie', 'cookie', 'melon_slice', 'sweet_berries', 'glow_berries',
  'dried_kelp', 'rotten_flesh', 'spider_eye', 'honey_bottle', 'milk_bucket',
  'chorus_fruit', 'tropical_fish', 'pufferfish'
])

// 食物优先级（同营养下优先高品质：金苹果 > 熟食 > 生食 > 应急差食物）
const FOOD_RANK = {
  enchanted_golden_apple: 100, golden_apple: 90,
  cooked_beef: 70, cooked_porkchop: 70, cooked_mutton: 70, cooked_chicken: 65, cooked_salmon: 65, cooked_cod: 60, cooked_rabbit: 60,
  bread: 60, baked_potato: 60, pumpkin_pie: 55,
  beef: 45, porkchop: 45, mutton: 45, chicken: 42, salmon: 42, cod: 40, rabbit: 40,
  carrot: 40, potato: 35, beetroot: 35, beetroot_soup: 50, mushroom_stew: 50, rabbit_stew: 55, suspicious_stew: 45,
  melon_slice: 30, sweet_berries: 25, glow_berries: 25, cookie: 25, dried_kelp: 20,
  chorus_fruit: 25, honey_bottle: 40,
  rotten_flesh: 10, spider_eye: 5, poisonous_potato: 5, pufferfish: 2, tropical_fish: 30
}

/**
 * 纯函数：从背包挑一个最合适的食物。
 * @param {Array<{name:string, count:number}>} items 背包物品
 * @param {{minHunger?:number, hunger?:number, health?:number, avoidBad?:boolean}} o
 *   avoidBad=true 时排除 rotten_flesh/spider_eye/poisonous_potato/pufferfish（默认 true）
 * @returns {{name:string, count:number, rank:number}|null}
 */
export function pickFood(items, { hunger = 20, health = 20, avoidBad = true } = {}) {
  const BAD = avoidBad ? new Set(['rotten_flesh', 'spider_eye', 'poisonous_potato', 'pufferfish']) : new Set()
  let best = null
  for (const it of items || []) {
    if (!it || !it.name || !FOODS.has(it.name)) continue
    if (BAD.has(it.name)) continue
    const r = FOOD_RANK[it.name] || 1
    if (!best || r > best.rank) best = { name: it.name, count: it.count || 1, rank: r }
  }
  return best
}

/**
 * 纯函数：是否该吃（饥饿低于阈值或血量低于阈值且饥饿未满）。
 */
export function shouldEat({ hunger, health, minHunger = 14, minHealth = 10 }) {
  return hunger < minHunger || (health < minHealth && hunger < 20)
}

/**
 * 进食控制器：注入式，测试可手动 step。
 * @param {object} deps
 * @param {()=>object|null} deps.getBot
 * @param {(item:{name:string})=>Promise} deps.equipOffhand 把食物装到副手
 * @param {()=>Promise|void} deps.consume bot.activateItem()
 * @param {(type:string, payload?:any)=>void} [deps.onMessage]
 * @param {{minHunger?:number, minHealth?:number, tickMs?:number, avoidBad?:boolean}} [opts]
 */
export function createAutoEat({ getBot, equipOffhand, consume, onMessage, minHunger = 14, minHealth = 10, tickMs = 1000, avoidBad = true }) {
  let enabled = false
  let timer = null
  let eating = false

  async function step() {
    if (eating) return
    const b = getBot ? getBot() : null
    if (!b || !b.inventory || b.food == null) return
    if (!shouldEat({ hunger: b.food, health: b.health ?? 20, minHunger, minHealth })) return
    const items = b.inventory.items().map(i => ({ name: i.name, count: i.count }))
    const food = pickFood(items, { avoidBad })
    if (!food) {
      if (onMessage) onMessage('eat_no_food', {})
      return
    }
    eating = true
    try {
      const item = b.inventory.items().find(i => i.name === food.name)
      if (!item) return
      await equipOffhand(item)
      await consume()
      if (onMessage) onMessage('ate', { name: food.name })
    } catch (err) {
      if (onMessage) onMessage('eat_failed', { reason: err && err.message })
    } finally {
      eating = false
    }
  }

  function start() {
    if (enabled) return
    enabled = true
    if (onMessage) onMessage('autoeat_started', {})
    timer = setInterval(step, tickMs)
  }

  function stop() {
    if (!enabled) return
    enabled = false
    if (timer) { clearInterval(timer); timer = null }
    if (onMessage) onMessage('autoeat_stopped', {})
  }

  return {
    start, stop,
    isEnabled: () => enabled,
    step
  }
}
