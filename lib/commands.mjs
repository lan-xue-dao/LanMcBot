import { spawn } from 'child_process'
import * as bot from './bot.mjs'
import { logRaw } from './logger.mjs'
import {
  scanEntities,
  scanPlayers,
  scanBlocks,
  findBlock,
  getDangerLevel,
  threatReport
} from './perception/index.mjs'
import { translateEntity, translateBlock, blockIdFromZh } from './i18n.mjs'
import { FOODS } from './survival.mjs'

// !chest 存 的默认保留集合：工具/武器/弓 + 食物（存杂物，留保命物资）
const TOOL_PREFIXES = ['wooden_', 'stone_', 'golden_', 'iron_', 'diamond_', 'netherite_']
const TOOL_SUFFIXES = ['_pickaxe', '_axe', '_shovel', '_hoe', '_sword']
const DEFAULT_KEEP = [
  'bow', 'crossbow', 'arrow', 'shield', 'elytra',
  ...TOOL_PREFIXES.flatMap(p => TOOL_SUFFIXES.map(s => p + s)),
  ...FOODS
]

let mcpProcess = null
let mcpTransport = 'stdio'

export function getMcpStatus() {
  return {
    running: !!mcpProcess,
    transport: mcpTransport
  }
}

export function handleCommand(cmd, callbacks) {
  const { addMessage, exit } = callbacks
  // 去掉命令前缀后的参数串（!recipes 物品 → "物品"）；兼容全角前缀
  const rest = cmd.replace(/^[!！]+\s*/, '').replace(/^(recipes|craft|mine|chest|count|find|move|build|rule|smelt)\b\s*/i, '').trim()

  if (cmd === '！help' || cmd === '!help') {
    addMessage(logRaw('可用命令：'))
    addMessage(logRaw('  ！help      - 显示帮助'))
    addMessage(logRaw('  ！exit      - 退出'))
    addMessage(logRaw('  ！quit      - 退出'))
    addMessage(logRaw('  ！restart   - 重启'))
    addMessage(logRaw('  ！connect   - 连接服务器'))
    addMessage(logRaw('  ！reconnect - 手动重连服务器'))
    addMessage(logRaw('  ！scan      - 扫描周围环境'))
    addMessage(logRaw('  ！players   - 扫描附近玩家'))
    addMessage(logRaw('  ！entities  - 扫描附近实体'))
    addMessage(logRaw('  ！blocks    - 扫描周围方块'))
    addMessage(logRaw('  ！find <名> - 查找特定方块'))
    addMessage(logRaw('  ！inv      - 查看背包'))
    addMessage(logRaw('  ！count <物> - 查询物品数量'))
    addMessage(logRaw('  ！place <方块> <x> <y> <z> [px py pz] - 放置方块(可指定站位)'))
    addMessage(logRaw('  ！danger    - 评估危险等级'))
    addMessage(logRaw('  ！threat    - 威胁排序（血量/朝向/手持/距离加权）'))
    addMessage(logRaw('  ！mcp       - 开关MCP服务器'))
    addMessage(logRaw('  ！mcp-stdio - 设置MCP传输为stdio'))
    addMessage(logRaw('  ！mcp-sse   - 设置MCP传输为sse'))
    addMessage(logRaw('  ！f/前     - 前进'))
    addMessage(logRaw('  ！b/后     - 后退'))
    addMessage(logRaw('  ！l/左     - 左移'))
    addMessage(logRaw('  ！r/右     - 右移'))
    addMessage(logRaw('  ！jump     - 跳跃'))
    addMessage(logRaw('  ！sneak    - 潜行(再按取消)'))
    addMessage(logRaw('  ！stop     - 停止移动'))
    addMessage(logRaw('  ！move <x> <y> <z> - 寻路移动到坐标'))
    addMessage(logRaw('  ！attack   - 攻击最近的敌对生物'))
    addMessage(logRaw('  ！combat   - 开启自动战斗（持续攻击 + 受击反击）'))
    addMessage(logRaw('  ！combat-off - 关闭自动战斗'))
    addMessage(logRaw('  ！pvp / ！pvp-off - 开关 PvP（玩家成为攻击目标，默认关）'))
    addMessage(logRaw('  ！recipes <物品> - 查看合成配方与材料'))
    addMessage(logRaw('  ！craft <物品> [数量] - 合成物品'))
    addMessage(logRaw('  ！gear     - 自动装备最佳武器与护甲'))
    addMessage(logRaw('  ！smelt <物品> [数量] - 熔炉烧炼（自动补料/燃料/取产出）'))
    addMessage(logRaw('  ！eat      - 开启自动进食（默认已开启）'))
    addMessage(logRaw('  ！eat-off  - 关闭自动进食'))
    addMessage(logRaw('  ！mine <方块> [数量] - 挖掘指定方块'))
    addMessage(logRaw('  ！build <wall|floor|box|pillar> <方块> <x1 y1 z1 x2 y2 z2> - 蓝图建造'))
    addMessage(logRaw('  ！chest 存 [保留物品] - 存入最近容器（默认保留工具/武器/食物）'))
    addMessage(logRaw('  ！chest 取 <物品> [数量] - 从最近容器取出'))
    addMessage(logRaw('  ！rule add/list/del - 触发规则管理（when 事件 匹配 then 动作）'))
    addMessage(logRaw('  ！use      - 使用手中的物品'))
    addMessage(logRaw('  ！sleep    - 睡觉(找附近的床)'))
    addMessage(logRaw('  ！wake     - 起床'))
    return true
  }

  if (cmd === '！exit' || cmd === '!exit' || cmd === '！quit' || cmd === '!quit') {
    bot.destroyBot()
    exit()
    return true
  }

  if (cmd === '！restart' || cmd === '!restart') {
    bot.destroyBot()
    // 优化重启逻辑
    const child = spawn(process.execPath, process.argv.slice(1), {
      detached: true,
      stdio: 'inherit',
      windowsHide: true  // Windows 上隐藏控制台窗口
    })

    let spawnSuccess = false
    child.once('spawn', () => {
      spawnSuccess = true
      child.unref()
      addMessage(logRaw('正在重启...'))
      // 增加延迟确保子进程完全启动
      setTimeout(() => {
        addMessage(logRaw('子进程已启动，父进程退出'))
        exit()
      }, 1000)
    })

    child.once('error', (e) => {
      if (!spawnSuccess) {
        addMessage(logRaw(`重启失败: ${e.message}`))
        setTimeout(() => exit(), 250)
      }
    })

    // 超时保护
    setTimeout(() => {
      if (!spawnSuccess) {
        addMessage(logRaw('重启超时，正在退出'))
        exit()
      }
    }, 5000)

    return true
  }

  if (cmd === '！connect' || cmd === '!connect') {
    if (bot.getBot()) {
      addMessage(logRaw('已连接到服务器'))
    } else {
      bot.connect()
      addMessage(logRaw('正在连接服务器...'))
    }
    return true
  }

  if (cmd === '！reconnect' || cmd === '!reconnect') {
    bot.reconnect()
    addMessage(logRaw('正在重连服务器...'))
    return true
  }

  if (cmd === '！scan' || cmd === '!scan') {
    const entities = scanEntities(8)
    const players = scanPlayers(8)
    const blocks = scanBlocks(8)
    addMessage(logRaw('=== 环境扫描 ==='))
    addMessage(logRaw(`玩家: ${players.success ? players.count : 0}人`))
    addMessage(logRaw(`实体: ${entities.success ? entities.count : 0}个`))
    if (blocks.success) {
      addMessage(logRaw(`方块 (${blocks.blocks.length}种):`))
      blocks.blocks.forEach(b => {
        addMessage(logRaw(`  ${translateBlock(b.name)} × ${b.count}`))
      })
    }
    return true
  }

  if (cmd === '！players' || cmd === '!players') {
    const result = scanPlayers(8)
    if (!result.success) {
      addMessage(logRaw('无法获取玩家列表'))
    } else if (result.count === 0) {
      addMessage(logRaw('附近没有其他玩家'))
    } else {
      addMessage(logRaw(`附近玩家 (${result.count}人):`))
      result.players.forEach(p => {
        addMessage(logRaw(`  ${p.name} - ${p.distance}m (ping: ${p.ping})`))
      })
    }
    return true
  }

  if (cmd === '！entities' || cmd === '!entities') {
    const result = scanEntities(8)
    if (!result.success) {
      addMessage(logRaw('无法获取实体列表'))
    } else if (result.count === 0) {
      addMessage(logRaw('附近没有实体'))
    } else {
      addMessage(logRaw(`附近实体 (${result.count}个):`))
      result.entities.forEach(e => {
        addMessage(logRaw(`  ${translateEntity(e.name)} (${e.type}) - ${e.distance}m`))
      })
    }
    return true
  }

  if (cmd === '！blocks' || cmd === '!blocks') {
    const result = scanBlocks(8)
    if (!result.success) {
      addMessage(logRaw('无法获取方块'))
    } else if (result.blocks.length === 0) {
      addMessage(logRaw('附近没有方块'))
    } else {
      addMessage(logRaw('周围方块统计:'))
      result.blocks.forEach(b => {
        addMessage(logRaw(`  ${translateBlock(b.name)} × ${b.count}`))
      })
    }
    return true
  }

  if (cmd.startsWith('！find ') || cmd.startsWith('!find ')) {
    const input = cmd.slice(6).trim()
    const blockName = blockIdFromZh(input) || input
    if (!blockName) {
      addMessage(logRaw('用法: !find <方块名>'))
      return true
    }
    const result = findBlock(blockName, 8)
    if (!result.success) {
      addMessage(logRaw('无法查找方块'))
    } else if (result.count === 0) {
      addMessage(logRaw(`未找到 ${translateBlock(blockName)}`))
    } else {
      addMessage(logRaw(`找到 ${translateBlock(blockName)} (${result.count}个):`))
      result.blocks.forEach(b => {
        addMessage(logRaw(`  (${b.position.x}, ${b.position.y}, ${b.position.z}) - ${b.distance}m`))
      })
    }
    return true
  }

  if (cmd === '！inventory' || cmd === '!inventory' || cmd === '！inv' || cmd === '!inv') {
    const result = bot.getInventory()
    if (!result.ok) {
      addMessage(logRaw(`无法获取背包: ${result.reason}`))
    } else if (result.count === 0) {
      addMessage(logRaw('背包是空的'))
    } else {
      addMessage(logRaw(`背包 (${result.count}种):`))
      result.items.forEach(i => {
        addMessage(logRaw(`  ${translateBlock(i.name)} × ${i.count}`))
      })
    }
    return true
  }

  if (cmd.startsWith('！count ') || cmd.startsWith('!count ')) {
    const itemName = rest
    if (!itemName) {
      addMessage(logRaw('用法: !count <物品名>'))
      return true
    }
    const result = bot.getItemCount(itemName)
    if (!result.ok) {
      addMessage(logRaw(`无法获取物品数量: ${result.reason}`))
    } else {
      addMessage(logRaw(`${translateBlock(result.name)} × ${result.count}`))
    }
    return true
  }

  if (cmd.startsWith('！place ') || cmd.startsWith('!place ')) {
    const parts = cmd.slice(7).trim().split(/\s+/)
    const hasStand = parts.length === 7
    const need = hasStand ? 7 : 4
    if (parts.length < need || parts.slice(1, need).some(p => isNaN(parseFloat(p)))) {
      addMessage(logRaw('用法: !place <方块名> <x> <y> <z> [px py pz]'))
      return true
    }
    const blockName = blockIdFromZh(parts[0]) || parts[0]
    const [x, y, z] = parts.slice(1, 4).map(Number)
    const [px, py, pz] = hasStand ? parts.slice(4, 7).map(Number) : [null, null, null]

    if (hasStand) {
      addMessage(logRaw(`🧭 正在走到 (${px}, ${py}, ${pz}) 放置 ${translateBlock(blockName)}...`))
    } else {
      addMessage(logRaw(`正在放置 ${translateBlock(blockName)} 到 (${Math.floor(x)}, ${Math.floor(y)}, ${Math.floor(z)})...`))
    }

    bot.placeBlock(blockName, x, y, z, px, py, pz)
      .then(result => {
        if (result.ok) {
          addMessage(logRaw(`🧱 已放置 ${translateBlock(blockName)} 到 (${Math.floor(x)}, ${Math.floor(y)}, ${Math.floor(z)})`))
        } else {
          addMessage(logRaw(`⚠ 无法放置: ${result.reason}`))
        }
      })
      .catch(err => {
        addMessage(logRaw(`⚠ 放置失败: ${err.message || err}`))
      })

    return true
  }

  if (cmd === '！danger' || cmd === '!danger') {
    const result = getDangerLevel()
    addMessage(logRaw(`=== 危险评估 ===`))
    addMessage(logRaw(`等级: ${'█'.repeat(result.level)}${'░'.repeat(10 - result.level)} ${result.level}/10`))
    if (result.threats.length === 0) {
      addMessage(logRaw('威胁: 无'))
    } else {
      result.threats.forEach(t => {
        if (t.type === 'low_health') addMessage(logRaw(`⚠ 生命值过低: ${t.value}`))
        if (t.type === 'low_food') addMessage(logRaw(`⚠ 饥饿度过低: ${t.value}`))
        if (t.type === 'hostile_mobs') addMessage(logRaw(`⚠ 敌对生物: ${t.count}个`))
        if (t.type === 'nearby_players') addMessage(logRaw(`⚠ 附近玩家: ${t.count}人`))
      })
    }
    return true
  }

  if (cmd === '！threat' || cmd === '!threat') {
    const result = threatReport(16)
    if (!result.success) { addMessage(logRaw(`⚠ ${result.error}`)); return true }
    addMessage(logRaw('=== 威胁排序（距离加权）==='))
    if (result.count === 0) { addMessage(logRaw('附近无威胁目标')); return true }
    for (const e of result.entities) {
      const hp = e.health != null ? ` 血:${e.health}` : ''
      const held = e.heldItem ? ` 手持:${translateBlock(e.heldItem)}` : ''
      addMessage(logRaw(`${'█'.repeat(Math.min(5, Math.max(1, Math.round(e.threat / 4))))} ${translateEntity(e.name)} 距${e.distance}m${hp}${held} 评分${e.threat}`))
    }
    return true
  }

  if (['！f', '!f', '！前', '!前'].includes(cmd)) {
    bot.setControl('forward', true)
    addMessage(logRaw('▶ 前进中 (!stop 停止)'))
    return true
  }

  if (['！b', '!b', '！后', '!后'].includes(cmd)) {
    bot.setControl('back', true)
    addMessage(logRaw('◀ 后退中 (!stop 停止)'))
    return true
  }

  if (['！l', '!l', '！左', '!左'].includes(cmd)) {
    bot.setControl('left', true)
    addMessage(logRaw('◀ 左移中 (!stop 停止)'))
    return true
  }

  if (['！r', '!r', '！右', '!右'].includes(cmd)) {
    bot.setControl('right', true)
    addMessage(logRaw('▶ 右移中 (!stop 停止)'))
    return true
  }

  if (cmd === '！jump' || cmd === '!jump') {
    bot.setControl('jump', true)
    const timer = setTimeout(() => {
      if (bot.getBot()) bot.setControl('jump', false)
    }, 500)
    timer.unref()
    addMessage(logRaw('⬆ 跳跃'))
    return true
  }

  if (cmd === '！sneak' || cmd === '!sneak') {
    if (bot.isSneaking()) {
      bot.setControl('sneak', false)
      addMessage(logRaw('已取消潜行'))
    } else {
      bot.setControl('sneak', true)
      addMessage(logRaw('潜行中 (!sneak 取消)'))
    }
    return true
  }

  if (cmd === '！stop' || cmd === '!stop') {
    bot.clearControls()
    bot.stopMove()
    addMessage(logRaw('■ 停止移动'))
    return true
  }

  if (cmd.startsWith('！move ') || cmd.startsWith('!move ')) {
    const parts = cmd.slice(6).trim().split(/\s+/)
    if (parts.length !== 3 || parts.some(p => isNaN(parseFloat(p)))) {
      addMessage(logRaw('用法: !move <x> <y> <z>'))
      return true
    }
    const [x, y, z] = parts.map(Number)
    bot.moveTo(x, y, z)
    addMessage(logRaw(`🧭 正在移动到 (${Math.floor(x)}, ${Math.floor(y)}, ${Math.floor(z)})...`))
    return true
  }

  if (cmd === '！attack' || cmd === '!attack') {
    const target = bot.attackTarget()
    if (target) {
      addMessage(logRaw(`⚔ 攻击 ${target}`))
    } else {
      addMessage(logRaw('附近没有敌对生物'))
    }
    return true
  }

  if (cmd === '！combat' || cmd === '!combat') {
    const on = bot.startCombat()
    addMessage(logRaw(on ? '⚔ 自动战斗已开启（持续攻击 + 受击反击）' : '⚔ 自动战斗开启失败（未连接）'))
    return true
  }

  if (cmd === '！combat-off' || cmd === '!combat-off') {
    bot.stopCombat()
    addMessage(logRaw('⚔ 自动战斗已关闭'))
    return true
  }

  if (cmd === '！pvp' || cmd === '!pvp') {
    const on = bot.setPvp(true)
    addMessage(logRaw(on ? '⚔ PvP 已开启（玩家也会成为攻击目标）' : '⚠ PvP 开启失败（未连接）'))
    return true
  }

  if (cmd === '！pvp-off' || cmd === '!pvp-off') {
    bot.setPvp(false)
    addMessage(logRaw('⚔ PvP 已关闭'))
    return true
  }

  if (cmd.startsWith('！recipes') || cmd.startsWith('!recipes')) {
    const parts = rest.split(/\s+/).filter(Boolean)
    if (parts.length === 0) {
      addMessage(logRaw('用法: !recipes <物品>'))
      return true
    }
    const r = bot.getRecipes(parts[0], 1)
    if (!r.ok) {
      addMessage(logRaw(`⚠ ${r.reason}`))
      return true
    }
    for (const rec of r.recipes.slice(0, 3)) {
      const ings = rec.ingredients.map(i => `${translateBlock(i.name)}×${i.count}`).join(', ')
      const mark = rec.craftable ? '✅' : '❌'
      addMessage(logRaw(`${mark} ${translateBlock(rec.result.name)}×${rec.result.count} ← ${ings}`))
      if (!rec.craftable && rec.missing && rec.missing.length) {
        addMessage(logRaw(`   缺: ${rec.missing.map(m => `${translateBlock(m.name)}(${m.have}/${m.need})`).join(', ')}`))
      }
    }
    return true
  }

  if (cmd.startsWith('！craft') || cmd.startsWith('!craft')) {
    const parts = rest.split(/\s+/).filter(Boolean)
    if (parts.length === 0) {
      addMessage(logRaw('用法: !craft <物品> [数量]'))
      return true
    }
    const count = Number(parts[1]) || 1
    addMessage(logRaw(`🔨 正在合成 ${translateBlock(parts[0])} ×${count}...`))
    bot.craftItem(parts[0], count).then(r => {
      if (r.ok) addMessage(logRaw(`🔨 已合成 ${translateBlock(r.name)} ×${r.count}`))
      else if (r.missing && r.missing.length) {
        addMessage(logRaw(`⚠ 材料不足: ${r.missing.map(m => `${translateBlock(m.name)}(${m.have}/${m.need})`).join(', ')}`))
      } else addMessage(logRaw(`⚠ 合成失败: ${r.reason}`))
    })
    return true
  }

  if (cmd.startsWith('！smelt') || cmd.startsWith('!smelt')) {
    const parts = rest.split(/\s+/).filter(Boolean)
    if (parts.length === 0) {
      addMessage(logRaw('用法: !smelt <物品> [数量]'))
      return true
    }
    const count = Number(parts[1]) || 1
    addMessage(logRaw(`🔥 正在烧炼 ${translateBlock(parts[0])} ×${count}（需背包有原料与燃料，附近有熔炉）...`))
    bot.smeltItem(parts[0], count).then(r => {
      if (r.ok && r.smelted >= count) addMessage(logRaw(`🔥 烧炼完成 ${translateBlock(parts[0])} ×${r.smelted}`))
      else if (r.ok) addMessage(logRaw(`🔥 部分完成: 已烧 ${r.smelted}/${count}${r.reason ? ' (' + r.reason + ')' : ''}`))
      else addMessage(logRaw(`⚠ 烧炼失败: ${r.reason}`))
    })
    return true
  }

  if (cmd === '！gear' || cmd === '!gear') {
    addMessage(logRaw('🛡 正在装备最佳武器与护甲...'))
    bot.equipBestGear().then(r => {
      if (!r.ok) { addMessage(logRaw(`⚠ ${r.reason}`)); return }
      if (!r.equipped.length) { addMessage(logRaw('背包里没有可装备的物品')); return }
      addMessage(logRaw(`🛡 已装备: ${r.equipped.map(e => `${translateBlock(e.name)}→${e.slot}`).join(', ')}`))
    })
    return true
  }

  // 触发规则：!rule add "when <事件> <匹配式> then <动作> [参数]" / !rule list / !rule del <序号>
  const ruleMatch = rest.match(/^(add|list|del|删除|列表)\s*(.*)$/i)
  if (cmd.startsWith('！rule') || cmd.startsWith('!rule')) {
    if (!ruleMatch) {
      addMessage(logRaw('用法: !rule add when <事件> <匹配式> then <动作> [参数] | !rule list | !rule del <序号>'))
      addMessage(logRaw('示例: !rule add "when chat contains:签到 then say 签到成功！"'))
      return true
    }
    const sub = ruleMatch[1].toLowerCase()
    if (sub === 'list' || sub === '列表') {
      const r = bot.listRules()
      if (!r.ok) { addMessage(logRaw(`⚠ ${r.reason}`)); return true }
      if (!r.rules.length) { addMessage(logRaw('暂无规则')); return true }
      for (const item of r.rules) {
        addMessage(logRaw(`#${item.index} [${item.event}] ${item.match} → ${item.action} ${item.args}`))
      }
      return true
    }
    if (sub === 'del' || sub === '删除') {
      const idx = Number(ruleMatch[2])
      const r = bot.removeRule(idx)
      addMessage(logRaw(r.ok ? `已删除规则 #${idx}` : `⚠ ${r.reason}`))
      return true
    }
    // add
    const ruleText = ruleMatch[2].replace(/^["“']|["”']$/g, '').trim()
    const r = bot.addRule(ruleText)
    addMessage(logRaw(r.ok ? `✅ 规则已注册 (#${r.index})` : `⚠ ${r.reason}`))
    return true
  }

  if (cmd === '！eat' || cmd === '!eat') {
    const on = bot.setAutoEat(true)
    addMessage(logRaw(on ? '🍔 自动进食已开启' : '🍔 自动进食开启失败（未连接）'))
    return true
  }

  if (cmd.startsWith('！mine') || cmd.startsWith('!mine')) {
    const parts = rest.split(/\s+/).filter(Boolean)
    if (parts.length === 0) {
      addMessage(logRaw('用法: !mine <方块名> [数量]'))
      return true
    }
    const count = Number(parts[1]) || 1
    addMessage(logRaw(`⛏ 开始挖掘 ${translateBlock(parts[0])} ×${count}...`))
    bot.mineBlock(parts[0], count).then(r => {
      if (r.ok && r.dug >= count) addMessage(logRaw(`⛏ 已挖掘 ${translateBlock(parts[0])} ×${r.dug}`))
      else if (r.ok) addMessage(logRaw(`⛏ 部分完成: 挖了 ${r.dug}/${count} (${r.reason || '目标耗尽'})`))
      else addMessage(logRaw(`⚠ 挖掘失败: ${r.reason}`))
    })
    return true
  }

  // 建造蓝图：!build <模板> <方块名> <x1 y1 z1 x2 y2 z2>
  if (cmd.startsWith('！build') || cmd.startsWith('!build')) {
    const parts = rest.split(/\s+/).filter(Boolean)
    const TYPE_ALIAS = { 墙: 'wall', 地板: 'floor', 面板: 'floor', 盒子: 'box', 屋: 'box', 柱子: 'pillar', 柱: 'pillar' }
    if (parts.length < 8) {
      addMessage(logRaw('用法: !build <wall|floor|box|pillar|墙|地板|盒子|柱子> <方块名> <x1 y1 z1 x2 y2 z2>'))
      return true
    }
    const type = TYPE_ALIAS[parts[0]] || parts[0].toLowerCase()
    const blockName = parts[1]
    const nums = parts.slice(2).map(Number)
    if (nums.some(n => Number.isNaN(n))) {
      addMessage(logRaw('⚠ 坐标必须是数字'))
      return true
    }
    const from = { x: nums[0], y: nums[1], z: nums[2] }
    const to = { x: nums[3], y: nums[4], z: nums[5] }
    addMessage(logRaw(`🧱 建造 ${type}（${translateBlock(blockName)}）: (${from.x},${from.y},${from.z})→(${to.x},${to.y},${to.z})...`))
    bot.buildBlueprint(type, blockName, from, to).then(r => {
      if (r.ok) addMessage(logRaw(`🧱 建造完成: 放置 ${r.placed}/${r.total}（跳过 ${r.skipped}）`))
      else addMessage(logRaw(`⚠ 建造失败: ${r.reason}`))
    })
    return true
  }

  // 容器存取：!chest 存 [保留物品名...] / !chest 取 <物品> [数量]
  const chestMatch = rest.match(/^(存|取)\s*(.*)$/)
  if (cmd.startsWith('！chest') || cmd.startsWith('!chest')) {
    if (!chestMatch) {
      addMessage(logRaw('用法: !chest 存 [保留物品名...] 或 !chest 取 <物品> [数量]'))
      return true
    }
    if (chestMatch[1] === '存') {
      const keepList = chestMatch[2].split(/\s+/).filter(Boolean)
      const keep = new Set([
        ...(keepList || []),
        ...DEFAULT_KEEP.map(p => p)
      ])
      addMessage(logRaw('📦 正在存入最近容器...'))
      bot.depositToChest([...keep]).then(r => {
        if (!r.ok) { addMessage(logRaw(`⚠ ${r.reason}`)); return }
        addMessage(logRaw(`📦 已存入: ${r.deposited.map(d => `${translateBlock(d.name)}×${d.count}`).join(', ')}`))
      })
      return true
    }
    // 取
    const parts = chestMatch[2].split(/\s+/).filter(Boolean)
    if (parts.length === 0) {
      addMessage(logRaw('用法: !chest 取 <物品> [数量]'))
      return true
    }
    const count = Number(parts[1]) || 1
    addMessage(logRaw(`📦 正在从最近容器取出 ${translateBlock(parts[0])} ×${count}...`))
    bot.withdrawFromChest(parts[0], count).then(r => {
      if (r.ok) addMessage(logRaw(`📦 已取出 ${translateBlock(r.name)} ×${r.count}`))
      else addMessage(logRaw(`⚠ ${r.reason}`))
    })
    return true
  }

  if (cmd === '！eat-off' || cmd === '!eat-off') {
    bot.setAutoEat(false)
    addMessage(logRaw('🍔 自动进食已关闭'))
    return true
  }

  if (cmd === '！use' || cmd === '!use') {
    bot.useHand()
    addMessage(logRaw('✋ 使用物品'))
    return true
  }

  if (cmd === '！sleep' || cmd === '!sleep') {
    addMessage(logRaw('🛏 正在躺下睡觉...'))

    bot.sleep()
      .then(() => {
        addMessage(logRaw('🛏 已进入睡眠'))
      })
      .catch(err => {
        if (err.message?.includes('已经在睡觉')) {
          addMessage(logRaw('已经在睡觉了'))
        } else if (err.message?.includes('没有床')) {
          addMessage(logRaw('附近 (8格内) 没有找到床'))
        } else {
          addMessage(logRaw(`⚠ 睡眠失败: ${err.message}`))
        }
      })

    return true
  }

  if (cmd === '！wake' || cmd === '!wake') {
    if (bot.wake()) {
      addMessage(logRaw('☀ 起床了'))
    } else {
      addMessage(logRaw('当前没有在睡觉'))
    }
    return true
  }

  if (cmd === '！mcp' || cmd === '!mcp') {
    if (mcpProcess) {
      mcpProcess.kill()
      mcpProcess = null
      addMessage(logRaw('MCP 服务器已停止'))
    } else {
      mcpProcess = spawn('node', ['mcp-server.mjs', '--transport', mcpTransport], {
        stdio: 'ignore',
        detached: true
      })
      mcpProcess.unref()
      mcpProcess.on('error', () => { mcpProcess = null })
      mcpProcess.on('exit', () => { mcpProcess = null })
      addMessage(logRaw(`MCP 服务器已启动 (transport: ${mcpTransport})`))
    }
    return true
  }

  if (cmd === '！mcp-stdio' || cmd === '!mcp-stdio') {
    mcpTransport = 'stdio'
    addMessage(logRaw('MCP 传输模式切换为: stdio'))
    return true
  }

  if (cmd === '！mcp-sse' || cmd === '!mcp-sse') {
    mcpTransport = 'sse'
    addMessage(logRaw('MCP 传输模式切换为: sse'))
    return true
  }

  return false
}
