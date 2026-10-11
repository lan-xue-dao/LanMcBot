// 容器（箱子/木桶）物品存取（P1 背包管理增强）：
//   决策/规划纯函数（槽位规划：先存什么、放哪格）+ 运行期 openChest/deposit/withdraw。

/**
 * 纯函数：规划把哪些背包物品存进箱子。
 * @param {Array<{name:string, count:number, slot:number}>} inventory 背包（不含热栏可自行过滤）
 * @param {{keep?:Set<string>, depositAll?:boolean}} o
 *   keep: 保留物品名集合（武器/食物/工具）；depositAll=true 忽略 keep 全存
 * @returns {Array<{name:string, count:number}>} 待存清单（按数量降序）
 */
export function planDeposit(inventory, { keep = new Set(), depositAll = false } = {}) {
  const out = []
  for (const it of inventory || []) {
    if (!it || !it.name) continue
    if (!depositAll && keep.has(it.name)) continue
    out.push({ name: it.name, count: it.count || 1 })
  }
  out.sort((a, b) => b.count - a.count)
  return out
}

/**
 * 纯函数：规划从箱子取什么。
 * @param {Array<{name:string, count:number}>} chestItems 箱内物品
 * @param {string} itemName 目标物品（归一化比较）
 * @param {number} count 目标数量
 * @returns {{name:string, count:number}|null} 实际可取数量（箱内不足则取全部）
 */
export function planWithdraw(chestItems, itemName, count = 1) {
  const n = String(itemName || '').toLowerCase().replace(/[-_\s]+/g, '')
  let available = 0
  for (const it of chestItems || []) {
    if (it && String(it.name).toLowerCase().replace(/[-_\s]+/g, '') === n) available += it.count || 0
  }
  if (available === 0) return null
  return { name: itemName, count: Math.min(count, available) }
}

/**
 * 纯函数：从物品列表里找最近的容器方块。
 * @param {Array<{name:string, position:{x,y,z,distanceTo}}>} blocks
 * @param {object} botPos
 * @param {number} maxDistance
 * @returns {{block:object, distance:number}|null}
 */
export function pickNearestContainer(blocks, botPos, maxDistance = 16) {
  const CONTAINERS = new Set(['chest', 'trapped_chest', 'barrel'])
  let best = null
  let bestD = Infinity
  for (const b of blocks || []) {
    if (!b || !b.name || !b.position) continue
    if (!CONTAINERS.has(b.name)) continue
    const d = b.position.distanceTo(botPos)
    if (d < bestD && d <= maxDistance) {
      bestD = d
      best = b
    }
  }
  return best ? { block: best, distance: bestD } : null
}
