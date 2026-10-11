// 合成模块（P0-4 合成与背包）：
//   决策/匹配逻辑写成「零依赖纯函数」，输入是归一化配方与背包清单，便于 mocha 单测；
//   运行期的 mineflayer Recipe → 归一化结构的转换放在 bot.mjs（依赖 mcData）。
//
// 归一化配方结构：
//   { result: { name:string, count:number },
//     ingredients: Array<{ name:string, count:number }> }   // null 项已被过滤
// 背包清单结构：Array<{ name:string, count:number }>

/**
 * 纯函数：给定归一化配方、背包清单与期望数量，判断材料是否足够。
 * @returns {{ ok:boolean, missing:Array<{name:string, need:number, have:number}> }}
 */
export function canCraft(recipe, inventory, count = 1) {
  const need = ingredientsNeeded(recipe, count)
  const have = {}
  for (const it of inventory || []) {
    if (it && it.name) have[it.name] = (have[it.name] || 0) + (it.count || 0)
  }
  const missing = []
  for (const n of need) {
    const owned = have[n.name] || 0
    if (owned < n.count) missing.push({ name: n.name, need: n.count, have: owned })
  }
  return { ok: missing.length === 0, missing }
}

/**
 * 纯函数：按倍率展开某配方一次产出的材料需求。
 * 注意：mineflayer 1 次 craft 按配方 result.count 产出，故倍率 = ceil(count / result.count)。
 * @returns {Array<{name:string, count:number}>} 合并后每一项的总需求
 */
export function ingredientsNeeded(recipe, count = 1) {
  const per = Math.max(1, recipe?.result?.count || 1)
  const batches = Math.ceil(count / per)
  const merged = {}
  for (const ing of recipe?.ingredients || []) {
    if (!ing || !ing.name) continue
    merged[ing.name] = (merged[ing.name] || 0) + ing.count * batches
  }
  return Object.entries(merged).map(([name, c]) => ({ name, count: c }))
}

/**
 * 纯函数：在候选配方列表里按产物名（中/英，归一化比较）匹配。
 * @param {Array} recipes 归一化配方列表
 * @param {string} query 中/英文产物名
 * @param {(zh:string)=>string|null} [zhToId] 中文名→en name 的映射（如 i18n.blockIdFromZh）
 * @returns {object|null} 第一个匹配到的归一化配方，无则 null
 */
export function matchCraftableByName(recipes, query, zhToId) {
  const q = String(query || '').trim().toLowerCase().replace(/[-_\s]+/g, '')
  const targets = new Set([q])
  if (zhToId) { const en = zhToId(query); if (en) targets.add(String(en).toLowerCase().replace(/[-_\s]+/g, '')) }
  for (const r of recipes || []) {
    if (!r?.result?.name) continue
    const rn = String(r.result.name).toLowerCase().replace(/[-_\s]+/g, '')
    if (targets.has(rn)) return r
  }
  return null
}

/**
 * 纯函数：把背包清单归并成 {name:count}，并统计某物品数量。
 */
export function countItem(inventory, name) {
  const n = String(name || '').toLowerCase().replace(/[-_\s]+/g, '')
  let total = 0
  for (const it of inventory || []) {
    if (it && String(it.name).toLowerCase().replace(/[-_\s]+/g, '') === n) total += it.count || 0
  }
  return total
}
