import { spawn } from 'child_process'
import * as bot from './bot.mjs'
import { logRaw } from './logger.mjs'
import {
  scanEntities,
  scanPlayers,
  scanBlocks,
  findBlock,
  getDangerLevel
} from './perception/index.mjs'
import { translateEntity, translateBlock, blockIdFromZh } from './i18n.mjs'

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
    addMessage(logRaw('  ！danger    - 评估危险等级'))
    addMessage(logRaw('  ！mcp       - 开关MCP服务器'))
    addMessage(logRaw('  ！mcp-stdio - 设置MCP传输为stdio'))
    addMessage(logRaw('  ！mcp-sse   - 设置MCP传输为sse'))
    return true
  }

  if (cmd === '！exit' || cmd === '!exit' || cmd === '！quit' || cmd === '!quit') {
    bot.destroyBot()
    exit()
    return true
  }

  if (cmd === '！restart' || cmd === '!restart') {
    bot.destroyBot()
    const child = spawn(process.argv[0], process.argv.slice(1), {
      detached: true,
      stdio: 'inherit'
    })
    child.unref()
    exit()
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
    const entities = scanEntities(16)
    const players = scanPlayers(16)
    const blocks = scanBlocks(4)
    addMessage(logRaw('=== 环境扫描 ==='))
    addMessage(logRaw(`玩家: ${players.success ? players.count : 0}人`))
    addMessage(logRaw(`实体: ${entities.success ? entities.count : 0}个`))
    if (blocks.success) {
      const top3 = blocks.blocks.slice(0, 3)
      addMessage(logRaw(`方块: ${top3.map(b => `${translateBlock(b.name)}×${b.count}`).join(', ')}`))
    }
    return true
  }

  if (cmd === '！players' || cmd === '!players') {
    const result = scanPlayers(16)
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
    const result = scanEntities(16)
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
    const result = scanBlocks(4)
    if (!result.success) {
      addMessage(logRaw('无法获取方块'))
    } else if (result.blocks.length === 0) {
      addMessage(logRaw('附近没有方块'))
    } else {
      addMessage(logRaw('周围方块统计:'))
      result.blocks.slice(0, 10).forEach(b => {
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
    const result = findBlock(blockName, 16)
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
