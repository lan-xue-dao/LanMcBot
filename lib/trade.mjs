// 交易能力域（对标 MCC 村民交易）：归一化/选单/可支付判定为纯函数（零 bot 依赖，可单测），
// 运行期开市/下单由 bot.mjs 调 mineflayer villager API（openVillager / villager.trade）。
//
// mineflayer trade 对象关键字段：
//   inputItem1 {name,type,count,metadata}、hasItem2、inputItem2 同上、outputItem 同上、
//   realPrice（含 demand/声望修正后的单价）、maximumNbTradeUses、nbTradeUses。

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
