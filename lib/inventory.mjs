// 背包主动整理（对标 MCC 一键整理）：把同类物品的散落堆合并成尽量少的满堆。
// 规划为纯函数（零 bot 依赖，可单测）；运行期逐调用 bot.moveSlotItem（左键拿起→放目标→
// 剩余自动归位，等价于 min(目标剩余容量, 源数量) 的部分转移）。

/**
 * 纯函数：规划同类合并步骤。
 * @param {Array<{slot:number, name:string, count:number, stackSize?:number}>} items
 * @param {number} defaultStack stackSize 缺省值（默认 64）
 * @returns {{moves:Array<{from:number,to:number,name:string,amount:number}>, result:Array<{slot:number,name:string,count:number}>}}
 *   moves 按执行顺序；result 为应用全部 moves 后的非零堆形态（低槽优先装满）
 */
export function planStackMerge(items, defaultStack = 64) {
  const stacks = (items || [])
    .filter(i => i && i.slot != null && (i.count || 0) > 0)
    .map(i => ({ slot: i.slot, name: i.name, count: i.count, stackSize: i.stackSize || defaultStack }))

  const byName = new Map()
  for (const s of stacks) {
    if (!byName.has(s.name)) byName.set(s.name, [])
    byName.get(s.name).push(s)
  }

  const moves = []
  for (const g of byName.values()) {
    if (g.length < 2) continue
    g.sort((a, b) => a.slot - b.slot) // 低槽作目标，高槽作源
    let t = 0
    let sIdx = g.length - 1
    // 安全上限：合并次数不会超过堆数×2，防死循环
    let guard = g.length * 2 + 2
    while (t < sIdx && guard-- > 0) {
      if (g[t].count >= g[t].stackSize) { t++; continue }
      if (g[sIdx].count <= 0) { sIdx--; continue }
      const transfer = Math.min(g[t].stackSize - g[t].count, g[sIdx].count)
      if (transfer <= 0) { sIdx--; continue }
      moves.push({ from: g[sIdx].slot, to: g[t].slot, name: g[t].name, amount: transfer })
      g[t].count += transfer
      g[sIdx].count -= transfer
      if (g[sIdx].count <= 0) sIdx--
      if (g[t].count >= g[t].stackSize) t++
    }
  }

  const result = stacks
    .filter(s => s.count > 0)
    .map(s => ({ slot: s.slot, name: s.name, count: s.count }))
  return { moves, result }
}

/**
 * 纯函数：统计同类散堆碎片数（用于展示「整理前 N 个同类散堆」）。
 * @param {Array<{name:string, count:number}>} items
 * @returns {number} 数量 > 1 且未占满的堆所在组的碎片堆总数（越小越整齐）
 */
export function countFragments(items) {
  const byName = new Map()
  for (const i of items || []) {
    if (!i || !i.name || (i.count || 0) <= 0) continue
    if (!byName.has(i.name)) byName.set(i.name, 0)
    byName.set(i.name, byName.get(i.name) + 1)
  }
  let frags = 0
  for (const n of byName.values()) if (n > 1) frags += n - 1
  return frags
}
