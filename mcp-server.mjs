import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js'
import { createBot, getBot, destroyBot, sendChat } from './lib/bot.mjs'

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
