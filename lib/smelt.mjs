/*
熔炉烧炼（P1 合成域补全）：燃料选择与熔炉动作决策为纯函数（零 bot 依赖，可单测），
运行期循环由 createSmelter 编排（bot.mjs 注入 mineflayer Furnace API）。

调用示例：
  import { fuelTicks, pickFuel, nextFurnaceAction, createSmelter } from './lib/smelt.mjs'

  fuelTicks('coal')                       // → 1600（刻）；非燃料 0
  pickFuel(items, { exclude })            // → {name, count, ticks} 燃烧最长者；exclude 排除正在烧的原料
  nextFurnaceAction({ outputOccupied, needsFuel, inputEmpty })  // → 'take_output'|'add_fuel'|'fill_input'|'wait'

  // 编排（bot.mjs 已包装为 smeltItem；测试用假熔炉注入）：
  const smelt = createSmelter({ getBot, findFurnaceBlock, openFurnace, items, zhIdOf, sleep, onMessage })
  const r = await smelt('raw_beef', 2)    // → { ok, smelted } 或 { ok:false, reason }

意义：自动进食（survival.mjs）优先熟食，但熟食只能靠烧炼获得——打通「挖矿得煤 → 烧炼熟食 → 续航」闭环。
 Furnace API：putInput/putFuel 收 (typeId, metadata, count)，槽位 0=料 1=燃 2=出。
*/

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

/**
 * 烧炼编排工厂：把「找熔炉→开炉→循环(取产出/补燃料/补原料)→关炉」抽为依赖注入的纯结构（假 bot 可测）。
 * 修复历史 bug：燃料选择现排除【正在烧的原料本身】——旧代码不传 exclude，
 * 烧木板/烧生食时会把同类原料当燃料吃掉（燃料槽选了原料物品），行为错误但纯函数测不到。
 *
 * @param {object} deps
 * @param {()=>(object|null)} deps.getBot
 * @param {()=>(object|null)} deps.findFurnaceBlock 位置→熔炉方块（内部 findBlocks+blockAt）
 * @param {(block:object)=>Promise<object>} deps.openFurnace → 炉对象 {inputItem,fuelItem,outputItem,putInput,putFuel,takeOutput,close}
 * @param {()=>Array} deps.items 背包物品（选原料/燃料，含 type/metadata/count/name）
 * @param {(name:string)=>(string|null)} deps.zhIdOf
 * @param {(ms:number)=>Promise} deps.sleep
 * @param {()=>number} [deps.now]
 * @param {(type:string,payload?:any)=>void} [deps.onMessage]
 * @param {(want:number)=>number} [deps.deadlineFor] 依数量给超时预算
 */
export function createSmelter (deps) {
  const {
    getBot, findFurnaceBlock, openFurnace, items, zhIdOf,
    sleep, now = Date.now, onMessage,
    deadlineFor = (want) => 30000 + want * 15000
  } = deps

  return async function smelt (itemName, count = 1) {
    const bot = getBot ? getBot() : null
    if (!bot || !bot.entity) return { ok: false, smelted: 0, reason: '未连接' }
    const want = Math.max(1, parseInt(count, 10) || 1)
    const zhId = zhIdOf(itemName)
    const targets = new Set([itemName, zhId, `minecraft:${itemName}`].filter(Boolean).map(s => String(s).toLowerCase()))
    const norm = (n) => String(n).toLowerCase()
    const findRaw = () => (items() || []).find(i => targets.has(norm(i.name)))
    if (!findRaw()) return { ok: false, smelted: 0, reason: `背包里没有原料: ${itemName}` }

    const furnaceBlock = findFurnaceBlock()
    if (!furnaceBlock) return { ok: false, smelted: 0, reason: '附近 16 格内没有熔炉' }

    let f
    try {
      f = await openFurnace(furnaceBlock)
    } catch (err) {
      return { ok: false, smelted: 0, reason: `打开熔炉失败: ${err.message || err}` }
    }

    let smelted = 0
    const deadline = now() + deadlineFor(want)
    try {
      while (smelted < want && now() < deadline) {
        const state = {
          outputOccupied: !!f.outputItem(),
          needsFuel: !f.fuelItem(),
          inputEmpty: !f.inputItem()
        }
        const act = nextFurnaceAction(state)
        if (act === 'take_output') {
          const out = f.outputItem()
          await f.takeOutput()
          smelted += out ? out.count : 1
          if (onMessage) onMessage('smelt_progress', { name: itemName, total: smelted, want })
          continue
        }
        if (act === 'add_fuel') {
          // 修复：不选「正在烧的原料」当燃料
          const pick = pickFuel(items(), { exclude: targets })
          if (!pick) return { ok: smelted > 0, smelted, reason: '没有燃料（煤/木板/木棍）' }
          const fuelItem = items().find(i => i.name === pick.name)
          await f.putFuel(fuelItem.type, fuelItem.metadata, 1)
          continue
        }
        if (act === 'fill_input') {
          const raw = findRaw()
          if (!raw) return smelted > 0 ? { ok: true, smelted } : { ok: false, smelted: 0, reason: `原料不足: ${itemName}` }
          await f.putInput(raw.type, raw.metadata, Math.min(1, want - smelted))
          continue
        }
        await sleep(1000) // wait：烧炼中
      }
      if (smelted >= want) return { ok: true, smelted }
      return { ok: smelted > 0, smelted, reason: smelted > 0 ? `超时（已烧 ${smelted}/${want}）` : '超时，未完成任何一轮烧炼' }
    } catch (err) {
      return { ok: smelted > 0, smelted, reason: err.message || '烧炼出错' }
    } finally {
      try { f.close() } catch { /* 已关则忽略 */ }
    }
  }
}
