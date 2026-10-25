/*
交易能力域（对标 MCC 村民交易）：归一化/选单/可支付判定为纯函数（零 bot 依赖，可单测），
运行期开市/下单由 createTrader 编排（bot.mjs 注入 mineflayer villager API）。

调用示例：
  import { formatTrades, canAfford, pickBestTrade, createTrader } from './lib/trade.mjs'

  const list = formatTrades(v.trades)   // [{index, cost1, cost2, output, remaining, soldOut}]
  const pick = pickBestTrade(v.trades, 'diamond', items(), { count: 3 })
                                        // → { trade, index, formatted, count }；售罄/付不起/剩余次数不足均排除
  const afford = canAfford(pick.trade, items(), 3)   // → { ok, missing:[{name,need,have}] }

  // 编排（bot.mjs 已包装为 tradeWith；测试用假 villager 注入）：
  const tradeWith = createTrader({ getBot, findVillager, approachAndWait, openVillager, items, zhIdOf, onMessage })
  const r = await tradeWith('钻石', 2)   // → { ok, output, count, price, costName }

mineflayer trade 对象关键字段：
  inputItem1 {name,type,count,metadata}、hasItem2、inputItem2 同上、outputItem 同上、
  realPrice（含 demand/声望修正后的单价）、maximumNbTradeUses、nbTradeUses。
语义：v.trade(index, count) 的 count = 交易次数（每次消耗 realPrice 个料），产出 = outputItem.count × count。
*/

/**
 * 纯函数：把 mineflayer trades 数组归一化为展示/决策结构。
 */
export function formatTrades(trades) {
  return (trades || []).map((t, index) => {
    const remaining = Math.max(0, (t.maximumNbTradeUses ?? 0) - (t.nbTradeUses ?? 0))
    return {
      index,
      cost1: { name: t.inputItem1?.name || 'unknown', count: t.realPrice ?? t.inputItem1?.count ?? 1 },
      cost2: (t.hasItem2 && t.inputItem2)
        ? { name: t.inputItem2.name || 'unknown', count: t.inputItem2.count || 1 }
        : null,
      output: { name: t.outputItem?.name || 'unknown', count: t.outputItem?.count || 1 },
      remaining,
      soldOut: remaining <= 0
    }
  })
}

// 归一化背包为 {name:count}
function toInvMap(inventory) {
  if (!inventory) return {}
  if (Array.isArray(inventory)) {
    const m = {}
    for (const it of inventory) if (it && it.name) m[it.name] = (m[it.name] || 0) + (it.count || 0)
    return m
  }
  return inventory
}

/**
 * 纯函数：某笔交易（含双料）按 count 次是否付得起。
 * @param {object} trade mineflayer trade 或 formatTrades 归一化对象
 * @param {Record<string,number>|Array<{name,count}>} inventory
 * @param {number} count
 * @returns {{ok:boolean, missing:Array<{name:string,need:number,have:number}>}}
 */
export function canAfford(trade, inventory, count = 1) {
  const have = toInvMap(inventory)
  const c = Math.max(1, count || 1)
  const missing = []
  const cost1 = trade.cost1 || (trade.inputItem1
    ? { name: trade.inputItem1.name, count: trade.realPrice ?? trade.inputItem1.count }
    : null)
  if (cost1) {
    const need = cost1.count * c
    const got = have[cost1.name] || 0
    if (got < need) missing.push({ name: cost1.name, need, have: got })
  }
  const cost2 = trade.cost2 !== undefined ? trade.cost2 : (trade.hasItem2 ? trade.inputItem2 : null)
  if (cost2 && cost2.count > 0) {
    const need = cost2.count * c
    const got = have[cost2.name] || 0
    if (got < need) missing.push({ name: cost2.name, need, have: got })
  }
  return { ok: missing.length === 0, missing }
}

/**
 * 纯函数：挑一笔能换到 wantName 且付得起、未售罄的最佳交易。
 * 最佳 = 剩余可交易次数最多，其次单价更低。
 * @returns {{trade:object, index:number, formatted:object, count:number}|null}
 */
export function pickBestTrade(trades, wantName, inventory, { count = 1 } = {}) {
  const want = String(wantName || '').trim().toLowerCase()
  if (!want) return null
  const normalized = formatTrades(trades)
  const candidates = []
  for (let i = 0; i < (trades || []).length; i++) {
    const f = normalized[i]
    if (f.output.name.toLowerCase() !== want) continue
    if (f.soldOut) continue
    // 修复：请求次数不能超过该交易剩余次数（旧代码只查 soldOut，
    // 村民剩 2 次时请求买 5 次会通过过滤，下单时 mineflayer assert 'trade blocked' 抛模糊错误）
    if (f.remaining < count) continue
    const afford = canAfford(trades[i], inventory, count)
    if (!afford.ok) continue
    candidates.push({ trade: trades[i], index: i, formatted: f, count })
  }
  if (candidates.length === 0) return null
  candidates.sort((a, b) =>
    (b.formatted.remaining - a.formatted.remaining) ||
    (a.formatted.cost1.count - b.formatted.cost1.count)
  )
  return candidates[0]
}

/**
 * 编排工厂：把「走近村民→开市→选单→下单→关市」抽为依赖注入的纯结构（假 bot 可测）。
 * 选单失败时返回可换清单（formatted），并给出「次数降级」建议（村民剩余次数不足时按 remaining 降级成交）。
 *
 * @param {object} deps
 * @param {()=>(object|null)} deps.getBot
 * @param {()=>(object|null)} deps.findVillager 最近村民实体
 * @param {(villager:object)=>Promise<boolean>} deps.approachAndWait 走近（返回是否可达）
 * @param {(villager:object)=>Promise<object>} deps.openVillager → {trades, trade(index,count), close}
 * @param {()=>Array} deps.items 背包（{name,count}）
 * @param {(name:string)=>(string|null)} deps.zhIdOf
 * @param {(type:string,payload?:any)=>void} [deps.onMessage]
 */
export function createTrader (deps) {
  const { getBot, findVillager, approachAndWait, openVillager, items, zhIdOf, onMessage } = deps

  return async function tradeWith (wantItemName, count = 1) {
    const bot = getBot ? getBot() : null
    if (!bot || !bot.entity) return { ok: false, reason: '未连接' }
    const want = Math.max(1, parseInt(count, 10) || 1)
    const zhId = zhIdOf(wantItemName)

    const villager = findVillager()
    if (!villager) return { ok: false, reason: '附近 16 格内没有村民' }
    if (!(await approachAndWait(villager))) return { ok: false, reason: '无法走近村民' }

    let v
    try {
      v = await openVillager(villager)
    } catch (err) {
      return { ok: false, reason: `打开交易失败: ${err.message || err}` }
    }

    try {
      const inv = items()
      const pick = pickBestTrade(v.trades, wantItemName, inv, { count: want })
        || (zhId ? pickBestTrade(v.trades, zhId, inv, { count: want }) : null)
      if (!pick) {
        const names = [...new Set(formatTrades(v.trades).map(t => t.output.name))]
        return { ok: false, reason: `该村民没有可支付的「${wantItemName}」交易；可换：${names.slice(0, 8).join(', ') || '无'}` }
      }
      await v.trade(pick.index, want)
      const per = pick.formatted.output.count || 1
      if (onMessage) onMessage('traded', { name: pick.formatted.output.name, count: per * want, price: pick.formatted.cost1.count * want, costName: pick.formatted.cost1.name })
      return { ok: true, output: pick.formatted.output.name, count: per * want, price: pick.formatted.cost1.count * want, costName: pick.formatted.cost1.name }
    } catch (err) {
      return { ok: false, reason: err.message || '交易失败' }
    } finally {
      try { v.close() } catch { /* 已关则忽略 */ }
    }
  }
}
