import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js'
import { createBot, getBot, destroyBot, sendChat, getRecipes, craftItem, equipBestGear, attackTarget, mineBlock, buildBlueprint, smeltItem, enchantItem, listTrades, tradeWith, tidyInventory, depositToChest, withdrawFromChest, moveTo, stopMove, setFollow, stopFollow, getFollowTarget, findFollowPlayer, isLoggedIn } from './lib/bot.mjs'
import { threatReport } from './lib/perception/index.mjs'

let globalBot = null
let globalNav = null
let mcpStarted = false

// 优雅关闭
function mcpShutdown() {
  if (mcpStarted && globalBot) {
    console.error('[MCP] Shutting down...')
    if (globalNav) {
      globalNav.destroy()
      globalNav = null
    }
    if (globalBot) {
      globalBot = null
    }
    mcpStarted = false
  }
}

process.on('SIGINT', mcpShutdown)
process.on('SIGTERM', mcpShutdown)

// 确保机器人实例存在
function ensureBot() {
  if (!globalBot) {
    globalBot = createBot((event, data) => {
      console.error(`[MCP] Event:`, event, data)
    })
    globalNav = null
  }
  return globalBot
}

const server = new Server(
  { name: 'mcbot', version: '1.0.0' },
  { capabilities: { tools: {} } }
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'send_chat',
      description: '发送聊天消息到Minecraft服务器',
      inputSchema: {
        type: 'object',
        properties: { message: { type: 'string', description: '要发送的消息' } },
        required: ['message']
      }
    },
    {
      name: 'get_status',
      description: '获取机器人状态',
      inputSchema: { type: 'object', properties: {} }
    },
    {
      name: 'get_players',
      description: '获取在线玩家列表',
      inputSchema: { type: 'object', properties: {} }
    },
    {
      name: 'get_position',
      description: '获取机器人位置',
      inputSchema: { type: 'object', properties: {} }
    },
    {
      name: 'get_inventory',
      description: '获取机器人背包物品',
      inputSchema: { type: 'object', properties: {} }
    },
    {
      name: 'tidy_inventory',
      description: '一键整理背包：合并同类散堆（仅主背包，不开窗口/不碰装备副手）',
      inputSchema: { type: 'object', properties: {} }
    },
    {
      name: 'get_recipes',
      description: '查询某物品的合成配方与材料缺口',
      inputSchema: {
        type: 'object',
        properties: {
          item: { type: 'string', description: '物品名（中/英文）' },
          count: { type: 'number', description: '期望合成数量，默认 1' }
        },
        required: ['item']
      }
    },
    {
      name: 'craft_item',
      description: '合成物品（自动匹配配方与材料检查，需材料在背包）',
      inputSchema: {
        type: 'object',
        properties: {
          item: { type: 'string', description: '物品名（中/英文）' },
          count: { type: 'number', description: '合成数量，默认 1' }
        },
        required: ['item']
      }
    },
    {
      name: 'equip_gear',
      description: '自动装备背包中最佳的武器与护甲',
      inputSchema: { type: 'object', properties: {} }
    },
    {
      name: 'attack_nearest',
      description: '攻击最近的敌对生物（单次）',
      inputSchema: { type: 'object', properties: {} }
    },
    {
      name: 'smelt_item',
      description: '熔炉烧炼物品（自动补原料/燃料并取回产出；需背包有原料、附近有熔炉）',
      inputSchema: {
        type: 'object',
        properties: {
          item: { type: 'string', description: '原料名（中/英文，如 生牛肉/raw_beef）' },
          count: { type: 'number', description: '烧炼数量，默认 1' }
        },
        required: ['item']
      }
    },
    {
      name: 'enchant_item',
      description: '附魔台附魔背包物品（自动走近台子/放料/择优档；需附近有附魔台、背包有青金石与足够经验）',
      inputSchema: {
        type: 'object',
        properties: {
          item: { type: 'string', description: '目标物品名（中/英文）' },
          count: { type: 'number', description: '附魔次数，默认 1' },
          prefer: { type: 'string', enum: ['best', 'cheap'], description: '选档偏好：best 最高档（默认）/ cheap 省经验' }
        },
        required: ['item']
      }
    },
    {
      name: 'list_trades',
      description: '查看最近村民的交易报价（归一化，含售罄/剩余次数）',
      inputSchema: { type: 'object', properties: {} }
    },
    {
      name: 'trade_with',
      description: '与最近村民交易指定产物（自动走近/选最佳可支付交易/下单，支持中英文名）',
      inputSchema: {
        type: 'object',
        properties: {
          item: { type: 'string', description: '目标产物名（中/英文，如 diamond/钻石）' },
          count: { type: 'number', description: '交易次数，默认 1' }
        },
        required: ['item']
      }
    },
    {
      name: 'threat_report',
      description: '威胁排序报告（血量/朝向/手持/距离加权评分，按威胁降序）',
      inputSchema: {
        type: 'object',
        properties: { radius: { type: 'number', description: '感知半径，默认 16' } }
      }
    },
    {
      name: 'mine_block',
      description: '挖掘指定方块（自动走近/换工具，最多 24 格范围）',
      inputSchema: {
        type: 'object',
        properties: {
          block: { type: 'string', description: '方块名（中/英文）' },
          count: { type: 'number', description: '挖掘数量，默认 1' }
        },
        required: ['block']
      }
    },
    {
      name: 'build_blueprint',
      description: '按蓝图模板批量建造（墙/地板/空心盒/立柱，两角点，上限 512 格，失败格跳过）',
      inputSchema: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['wall', 'floor', 'box', 'pillar'], description: '模板类型' },
          block: { type: 'string', description: '方块名（中/英文）' },
          from: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } }, required: ['x', 'y', 'z'], description: '角点1' },
          to: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } }, required: ['x', 'y', 'z'], description: '角点2' }
        },
        required: ['type', 'block', 'from', 'to']
      }
    },
    {
      name: 'chest_deposit',
      description: '把背包物品存入最近的箱子/木桶',
      inputSchema: {
        type: 'object',
        properties: {
          keep: { type: 'array', items: { type: 'string' }, description: '保留物品名列表（不存入）' }
        }
      }
    },
    {
      name: 'chest_withdraw',
      description: '从最近的箱子/木桶取出物品',
      inputSchema: {
        type: 'object',
        properties: {
          item: { type: 'string', description: '物品名（中/英文）' },
          count: { type: 'number', description: '数量，默认 1' }
        },
        required: ['item']
      }
    },
    {
      name: 'move_to',
      description: '寻路移动到指定坐标（自研 nav，含开门/绕障）',
      inputSchema: {
        type: 'object',
        properties: {
          x: { type: 'number', description: '目标 X' },
          y: { type: 'number', description: '目标 Y' },
          z: { type: 'number', description: '目标 Z' }
        },
        required: ['x', 'y', 'z']
      }
    },
    {
      name: 'stop_move',
      description: '停止移动',
      inputSchema: { type: 'object', properties: {} }
    },
    {
      name: 'follow_player',
      description: '跟随指定玩家（需在机器人视野内；距离超过 5 格自动用 nav 靠近，战斗开启时自动让出移动控制权）',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '目标玩家用户名（大小写不敏感）' }
        },
        required: ['name']
      }
    },
    {
      name: 'unfollow',
      description: '停止跟随并清掉跟随驱动的导航移动',
      inputSchema: { type: 'object', properties: {} }
    },
    {
      name: 'connect',
      description: '连接到Minecraft服务器',
      inputSchema: { type: 'object', properties: {} }
    },
    {
      name: 'disconnect',
      description: '断开与Minecraft服务器的连接',
      inputSchema: { type: 'object', properties: {} }
    }
  ]
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  try {
    switch (name) {
      case 'send_chat': {
        const b = ensureBot()
        if (!b) return { content: [{ type: 'text', text: '未连接' }], isError: true }
        sendChat(args.message)
        return { content: [{ type: 'text', text: `已发送: ${args.message}` }] }
      }

      case 'get_status': {
        const b = getBot()
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              connected: !!b,
              username: b?.username || null,
              health: b?.health || null,
              food: b?.food || null
            }, null, 2)
          }]
        }
      }

      case 'get_players': {
        const b = getBot()
        if (!b) return { content: [{ type: 'text', text: '未连接' }], isError: true }
        if (!b?.players) return { content: [{ type: 'text', text: '无法获取玩家列表' }], isError: true }
        const players = Object.values(b.players).map(p => ({
          name: p.username,
          ping: p.ping
        }))
        return { content: [{ type: 'text', text: JSON.stringify(players, null, 2) }] }
      }

      case 'get_position': {
        const b = getBot()
        if (!b) return { content: [{ type: 'text', text: '未连接' }], isError: true }
        if (!b?.entity?.position) return { content: [{ type: 'text', text: '无法获取位置' }], isError: true }
        const pos = b.entity.position
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ x: pos.x.toFixed(1), y: pos.y.toFixed(1), z: pos.z.toFixed(1) })
          }]
        }
      }

      case 'get_inventory': {
        const b = getBot()
        if (!b) return { content: [{ type: 'text', text: '未连接' }], isError: true }
        if (!b?.inventory) return { content: [{ type: 'text', text: '无法获取背包' }], isError: true }
        const items = b.inventory.items().map(i => ({
          name: i.name,
          count: i.count,
          slot: i.slot
        }))
        return { content: [{ type: 'text', text: JSON.stringify(items, null, 2) }] }
      }

      case 'tidy_inventory': {
        if (!getBot()) return { content: [{ type: 'text', text: '未连接' }], isError: true }
        const r = await tidyInventory()
        return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }], isError: !r.ok }
      }

      case 'get_recipes': {
        if (!getBot()) return { content: [{ type: 'text', text: '未连接' }], isError: true }
        const r = getRecipes(args.item, args.count || 1)
        return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }], isError: !r.ok }
      }

      case 'craft_item': {
        if (!getBot()) return { content: [{ type: 'text', text: '未连接' }], isError: true }
        const r = await craftItem(args.item, args.count || 1)
        return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }], isError: !r.ok }
      }

      case 'equip_gear': {
        if (!getBot()) return { content: [{ type: 'text', text: '未连接' }], isError: true }
        const r = await equipBestGear()
        return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }], isError: !r.ok }
      }

      case 'attack_nearest': {
        const b = getBot()
        if (!b) return { content: [{ type: 'text', text: '未连接' }], isError: true }
        const r = attackTarget()
        if (!r) return { content: [{ type: 'text', text: '附近没有敌对生物' }], isError: true }
        return { content: [{ type: 'text', text: `已攻击: ${r}` }] }
      }

      case 'mine_block': {
        if (!getBot()) return { content: [{ type: 'text', text: '未连接' }], isError: true }
        const r = await mineBlock(args.block, args.count || 1)
        return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }], isError: !r.ok }
      }

      case 'build_blueprint': {
        if (!getBot()) return { content: [{ type: 'text', text: '未连接' }], isError: true }
        const r = await buildBlueprint(args.type, args.block, args.from, args.to)
        return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }], isError: !r.ok }
      }

      case 'smelt_item': {
        if (!getBot()) return { content: [{ type: 'text', text: '未连接' }], isError: true }
        const r = await smeltItem(args.item, args.count || 1)
        return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }], isError: !r.ok }
      }

      case 'enchant_item': {
        if (!getBot()) return { content: [{ type: 'text', text: '未连接' }], isError: true }
        const r = await enchantItem(args.item, args.count || 1, { prefer: args.prefer === 'cheap' ? 'cheap' : 'best' })
        return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }], isError: !r.ok }
      }

      case 'list_trades': {
        if (!getBot()) return { content: [{ type: 'text', text: '未连接' }], isError: true }
        const r = await listTrades()
        return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }], isError: !r.ok }
      }

      case 'trade_with': {
        if (!getBot()) return { content: [{ type: 'text', text: '未连接' }], isError: true }
        const r = await tradeWith(args.item, args.count || 1)
        return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }], isError: !r.ok }
      }

      case 'threat_report': {
        if (!getBot()) return { content: [{ type: 'text', text: '未连接' }], isError: true }
        const r = threatReport(args.radius || 16)
        return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }], isError: !r.success }
      }

      case 'chest_deposit': {
        if (!getBot()) return { content: [{ type: 'text', text: '未连接' }], isError: true }
        const r = await depositToChest(args.keep || [])
        return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }], isError: !r.ok }
      }

      case 'chest_withdraw': {
        if (!getBot()) return { content: [{ type: 'text', text: '未连接' }], isError: true }
        const r = await withdrawFromChest(args.item, args.count || 1)
        return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }], isError: !r.ok }
      }

      case 'move_to': {
        const b = getBot()
        if (!b) return { content: [{ type: 'text', text: '未连接' }], isError: true }
        const ok = moveTo(Number(args.x), Number(args.y), Number(args.z))
        return { content: [{ type: 'text', text: ok ? `正在移动到 (${args.x}, ${args.y}, ${args.z})` : '移动失败（nav 未初始化）' }], isError: !ok }
      }

      case 'stop_move': {
        const ok = stopMove()
        return { content: [{ type: 'text', text: ok ? '已停止移动' : '停止失败（nav 未初始化）' }], isError: !ok }
      }

      case 'follow_player': {
        const b = getBot()
        if (!b || !isLoggedIn()) {
          return { content: [{ type: 'text', text: '未连接' }], isError: true }
        }
        const who = String(args.name || '').trim()
        if (!who) {
          return { content: [{ type: 'text', text: '缺少参数 name（目标玩家名）' }], isError: true }
        }
        const ent = findFollowPlayer(who)
        if (!ent) {
          return { content: [{ type: 'text', text: `找不到玩家「${who}」（需在视野内）` }], isError: true }
        }
        const ok = setFollow(who)
        const d = b.entity && ent.position
          ? Math.round(ent.position.distanceTo(b.entity.position) * 10) / 10
          : null
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok, target: ok ? who : null, distance: d }, null, 2) }],
          isError: !ok
        }
      }

      case 'unfollow': {
        const was = stopFollow()
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: true, stopped: was, target: getFollowTarget() }, null, 2) }]
        }
      }

      case 'connect': {
        const b = ensureBot()
        if (b) {
          return { content: [{ type: 'text', text: '机器人已连接' }] }
        } else {
          return { content: [{ type: 'text', text: '正在连接...' }], isError: true }
        }
      }

      case 'disconnect': {
        if (globalBot) {
          destroyBot()
          globalBot = null
          globalNav = null
        }
        return { content: [{ type: 'text', text: '已断开' }] }
      }

      default:
        return { content: [{ type: 'text', text: `未知工具: ${name}` }], isError: true }
    }
  } catch (err) {
    console.error('[MCP] Tool error:', err)
    return { content: [{ type: 'text', text: `错误: ${err.message}` }], isError: true }
  }
})

async function main() {
  mcpStarted = true
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('MCP Server running on stdio')
}

main().catch(err => {
  console.error('Failed to start MCP server:', err)
  process.exit(1)
})
