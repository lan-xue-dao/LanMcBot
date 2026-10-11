// 挖掘模块（P0-3 建造/挖掘闭环）：
//   决策/选型写成「零依赖纯函数」（选最近可挖目标、按方块挑最佳工具、判定可挖性），
//   运行期动作（走近/挖/换手）由注入式 controller 驱动，复用自研 nav 移动。

/**
 * 纯函数：在方块列表里挑最近的、可挖的、名字匹配的目标。
 * @param {Array<{name:string, position:{x,y,z,distanceTo}}>} blocks
 * @param {{x,y,z,distanceTo}} botPos
 * @param {{match:(name:string)=>boolean, maxDistance?:number, diggable:(name:string)=>boolean}} o
 * @returns {{block:object, distance:number}|null}
 */
export function pickMineTarget(blocks, botPos, { match, maxDistance = 32, diggable = () => true }) {
  let best = null
  let bestD = Infinity
  for (const b of blocks || []) {
    if (!b || !b.name || !b.position) continue
    if (!match(b.name)) continue
    if (!diggable(b.name)) continue
    const d = b.position.distanceTo(botPos)
    if (d < bestD && d <= maxDistance) {
      bestD = d
      best = b
    }
  }
  return best ? { block: best, distance: bestD } : null
}

// 常见方块 → 最佳工具类型（简化表：镐/斧/锹/剪/剑）
const TOOL_FOR = {
  stone: 'pickaxe', cobblestone: 'pickaxe', cobblestone_wall: 'pickaxe',
  deepslate: 'pickaxe', cobbled_deepslate: 'pickaxe', blackstone: 'pickaxe',
  coal_ore: 'pickaxe', iron_ore: 'pickaxe', copper_ore: 'pickaxe', gold_ore: 'pickaxe',
  redstone_ore: 'dig',  // 无镐也能挖但慢；这里仅占位
  diamond_ore: 'pickaxe', emerald_ore: 'pickaxe', lapis_ore: 'pickaxe',
  netherrack: 'pickaxe', end_stone: 'pickaxe', sandstone: 'pickaxe',
  nether_quartz_ore: 'pickaxe', ancient_debris: 'pickaxe',
  oak_log: 'axe', spruce_log: 'axe', birch_log: 'axe', jungle_log: 'axe', acacia_log: 'axe', dark_oak_log: 'axe', mangrove_log: 'axe',
  oak_planks: 'axe', spruce_planks: 'axe', birch_planks: 'axe',
  oak_leaves: 'hoe', spruce_leaves: 'hoe',
  dirt: 'shovel', grass_block: 'shovel', sand: 'shovel', gravel: 'shovel',
  clay: 'shovel', snow: 'shovel', snow_block: 'shovel', soul_sand: 'shovel', soul_soil: 'shovel'
}

// 工具材质等级（决定 pickBestTool 的比较）
const TIER_RANK = { wooden: 1, stone: 2, golden: 3, iron: 4, diamond: 5, netherite: 6 }

/**
 * 纯函数：按目标方块名从背包挑最佳工具（返回 null 表示空手也能挖/无合适工具）。
 * @param {string} blockName
 * @param {Array<{name:string}>} items
 * @returns {{name:string, tier:number}|null}
 */
export function pickBestTool(blockName, items) {
  const kind = TOOL_FOR[blockName]
  if (!kind || kind === 'dig') return null
  const suffix = `_${kind}`
  let best = null
  for (const it of items || []) {
    if (!it || !it.name) continue
    if (!it.name.endsWith(suffix)) continue
    const tier = TIER_RANK[it.name.split('_')[0]] || 0
    if (!best || tier > best.tier) best = { name: it.name, tier }
  }
  return best
}

/**
 * 纯函数：根据 bot 与目标的位置关系给下一步动作。
 * @param {{dx:number, dy:number, dz:number, reach:number}} s
 * @returns {'walk'|'dig'}
 */
export function nextAction({ dx, dy, dz, reach = 4.5 }) {
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
  return d <= reach ? 'dig' : 'walk'
}
