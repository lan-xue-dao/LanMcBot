// 挖掘模块（P0-3 建造/挖掘闭环）：
//   决策/选型写成「零依赖纯函数」（选最近可挖目标、按方块挑最佳工具、判定可挖性），
//   运行期编排（扫描→选目标→走近→换工具→挖 循环）抽为注入式 createMiner 工厂（假 bot 可测）。

// 可挖性：非 air/水/岩浆/基岩 即视为可挖（bot.dig 内部会再校验）
const UNDIGGABLE = new Set(['air', 'cave_air', 'void_air', 'water', 'lava', 'bedrock', 'barrier'])
export function diggableName (n) { return !UNDIGGABLE.has(n) }

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

/**
 * 挖掘编排工厂：把「扫描→选最近→走近→换工具→dig」循环抽成依赖注入的纯结构（假 bot 可测）。
 * 关键语义：候选必须是 blockAt 返回的【真 Block】——bot.dig 内部调 block.digTime() 等实例方法，
 * 传 {name,position} 剥皮对象会 TypeError（历史 bug：曾被退避 catch 吞掉、循环到超时，实机 !mine 全挂）。
 *
 * @param {object} deps
 * @param {()=>(object|null)} deps.getBot
 * @param {(opts:{matching:Function,maxDistance:number,count:number})=>Array} deps.findBlocks 收 Block 判 name、返回位置数组
 * @param {(pos:object)=>(object|null)} deps.blockAt 位置 → 真 Block
 * @param {(block:object)=>Promise} deps.dig
 * @param {()=>Array} deps.items 背包物品（选工具）
 * @param {(name:string)=>Promise} deps.equipItem 按名装备到手（内部找物，失败应自行吞）
 * @param {(name:string)=>(string|null)} deps.zhIdOf 中文名→英文 id
 * @param {(pos:object)=>Promise} deps.approachAndWait
 * @param {(ms:number)=>Promise} deps.sleep
 * @param {()=>number} [deps.now]
 * @param {(type:string,payload?:any)=>void} [deps.onMessage]
 */
export function createMiner (deps) {
  const {
    getBot, findBlocks, blockAt, dig, items, equipItem, zhIdOf,
    approachAndWait, sleep, now = Date.now, onMessage
  } = deps

  return async function mine (blockName, count = 1, { timeoutMs = 60000, maxDistance = 24 } = {}) {
    const bot = getBot ? getBot() : null
    if (!bot || !bot.entity) return { ok: false, dug: 0, reason: '未连接' }
    const zhId = zhIdOf(blockName)
    const targets = new Set([blockName, zhId, `minecraft:${blockName}`].filter(Boolean).map(s => String(s).toLowerCase()))
    const match = n => targets.has(String(n).toLowerCase())

    const startTime = now()
    let dug = 0

    while (dug < count) {
      if (now() - startTime > timeoutMs) {
        return { ok: dug > 0, dug, reason: dug > 0 ? `超时（已挖 ${dug}）` : '超时，未找到可挖目标' }
      }
      let found = null
      try {
        // findBlocks: matching 收 Block、返回位置数组；blockAt 拿【真 Block】直接进候选
        const positions = findBlocks({ matching: (b) => b && match(b.name), maxDistance, count: 32 }) || []
        const candidates = positions.map(p => blockAt(p)).filter(Boolean)
        found = pickMineTarget(candidates, bot.entity.position, { match, maxDistance, diggable: diggableName })
      } catch (e) {
        return { ok: dug > 0, dug, reason: `扫描失败: ${e.message}` }
      }
      if (!found) return dug > 0 ? { ok: true, dug } : { ok: false, dug: 0, reason: `附近没有可挖的 ${blockName}` }

      const targetPos = found.block.position
      const act = nextAction({
        dx: targetPos.x - bot.entity.position.x,
        dy: targetPos.y - bot.entity.position.y,
        dz: targetPos.z - bot.entity.position.z
      })
      if (act === 'walk') {
        await approachAndWait(targetPos)
        continue
      }
      // 触及距离内：换工具后挖
      const tool = pickBestTool(found.block.name, items())
      if (tool) await equipItem(tool.name)
      try {
        await dig(found.block)
        dug++
        if (onMessage) onMessage('block_dug', { name: found.block.name, count: dug })
      } catch {
        await sleep(300) // 单次失败小退避后重扫（方块已消失/不可达）
      }
    }
    return { ok: true, dug }
  }
}
