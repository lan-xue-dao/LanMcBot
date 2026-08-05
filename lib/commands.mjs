import { spawn } from 'child_process'
import * as bot from './bot.mjs'
import { logRaw } from './logger.mjs'

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
