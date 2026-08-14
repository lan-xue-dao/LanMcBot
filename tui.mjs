import readline from 'readline'
import * as bot from './lib/bot.mjs'
import { logRaw, chatLog } from './lib/logger.mjs'
import { handleCommand } from './lib/commands.mjs'
import { startPassivePerception, stopPassivePerception, getStatus } from './lib/perception/index.mjs'
import { translateEntity, translateMessage } from './lib/i18n.mjs'
import { getMinimap } from './lib/minimap.mjs'

const MAP_ROWS = 11
const HUD_ROWS = MAP_ROWS + 1
const MAP_W = 22
const NOTIFY_ROWS = MAP_ROWS
const PANEL_WIDTH = 42
const MAX_HISTORY = 500

let history = []
let scrollOffset = 0
let statusLines = []
let notifications = []
let mapLines = null
let input = ''
let cursor = 0
let cmdHistory = []
let cmdHistoryIndex = -1
let started = false

function displayWidth(str) {
  let w = 0
  for (const ch of str) {
    w += ch.codePointAt(0) > 0x2e7f ? 2 : 1
  }
  return w
}

function truncate(str, maxWidth) {
  let out = ''
  let w = 0
  for (const ch of str) {
    const cw = ch.codePointAt(0) > 0x2e7f ? 2 : 1
    if (w + cw > maxWidth) break
    out += ch
    w += cw
  }
  return out
}

function pad(str, width) {
  const fill = width - displayWidth(str)
  return str + ' '.repeat(fill > 0 ? fill : 0)
}

function writeAt(x, y, text) {
  process.stdout.write(`\x1b[${y};${x}H${text}`)
}

function getSize() {
  return {
    cols: process.stdout.columns || 80,
    rows: process.stdout.rows || 24
  }
}

function addMessage(text) {
  history.push(String(text))
  if (history.length > MAX_HISTORY) history.shift()
  scrollOffset = 0
  render()
}

function setStatus(lines) {
  statusLines = lines
  render()
}

function notify(text) {
  notifications.unshift(String(text))
  if (notifications.length > NOTIFY_ROWS) notifications.pop()
  render()
}

function rgbTo256(r, g, b) {
  if (Math.abs(r - g) < 12 && Math.abs(g - b) < 12) {
    const gray = Math.round((r + g + b) / 3)
    if (gray < 8) return 16
    if (gray > 247) return 231
    return 232 + Math.round((gray - 8) / 10)
  }
  const ri = Math.round(r / 51)
  const gi = Math.round(g / 51)
  const bi = Math.round(b / 51)
  return 16 + 36 * ri + 6 * gi + bi
}

function buildMapRow(row, width = MAP_W) {
  let out = ''
  for (const cell of row) {
    const bg = cell.bg ? `\x1b[48;5;${rgbTo256(cell.bg[0], cell.bg[1], cell.bg[2])}m` : '\x1b[40m'
    const fg = cell.fg ? `\x1b[38;5;${rgbTo256(cell.fg[0], cell.fg[1], cell.fg[2])}m` : ''
    out += bg + fg + (cell.ch || ' ') + '\x1b[0m'
  }
  return out
}

function yawToDir(yaw) {
  if (yaw == null) return '?'
  const dirs = ['南', '西南', '西', '西北', '北', '东北', '东', '东南']
  const d = Math.round(yaw / (Math.PI / 4))
  return dirs[((d % 8) + 8) % 8]
}

function refreshStatus() {
  const status = getStatus()
  if (!status) {
    setStatus(['尚未连接'])
    mapLines = null
    return
  }
  const b = bot.getBot()
  const lines = []
  if (status.health != null) {
    const hpBar = '█'.repeat(Math.round(status.health / 2)) + '░'.repeat(Math.max(0, 10 - Math.round(status.health / 2)))
    lines.push(`❤ ${hpBar} ${status.health}/20`)
  }
  if (status.food != null) {
    const foodBar = '█'.repeat(Math.round(status.food / 2)) + '░'.repeat(Math.max(0, 10 - Math.round(status.food / 2)))
    lines.push(`🍗 ${foodBar} ${status.food}/20`)
  }
  if (status.position) {
    lines.push(`📍 ${status.position.x}, ${status.position.y}, ${status.position.z}`)
  }
  if (b && b.entity) {
    lines.push(`🧭 朝向: ${yawToDir(b.entity.yaw)}`)
  }
  if (bot.isSleeping()) {
    lines.push('💤 睡觉中')
  }
  mapLines = getMinimap(b, { width: MAP_W, height: MAP_ROWS * 2 })
  setStatus(lines)
}

function render() {
  if (!started) return
  const { cols, rows } = getSize()
  if (cols < 50 || rows < 10) return

  const lines = []
  const leftW = 20
  const rightW = cols - leftW - MAP_W - 4
  const leftC = '\x1b[32m'
  const rightC = '\x1b[36m'
  const titleC = '\x1b[1;36m'
  const mapBorderC = '\x1b[90m'
  const reset = '\x1b[0m'

  for (let i = 0; i < HUD_ROWS; i++) {
    if (i === 0) {
      lines.push(
        leftC + pad('── 状态 ──', leftW) + reset +
        mapBorderC + pad('', 1) + titleC + pad('── 小地图 ──', MAP_W) + reset +
        mapBorderC + pad('', 1) + reset +
        rightC + pad('── 感知 ──', rightW) + reset
      )
      continue
    }
    const leftText = statusLines[i - 1] || ''
    const rightText = notifications[i - 1] || ''
    const mapRow = mapLines ? buildMapRow(mapLines[i - 1]) : null
    const mid = mapRow || pad('', MAP_W)
    lines.push(
      leftC + pad(truncate(leftText, leftW), leftW) + reset +
      mapBorderC + '│' + mid + '│' + reset +
      rightC + pad(truncate(rightText, rightW), rightW) + reset
    )
  }

  lines.push(pad('─'.repeat(cols), cols))

  const chatRows = rows - HUD_ROWS - 2
  const maxOffset = Math.max(0, history.length - chatRows)
  if (scrollOffset > maxOffset) scrollOffset = maxOffset

  const endIdx = history.length - scrollOffset
  const startIdx = Math.max(0, endIdx - chatRows)
  const visible = history.slice(startIdx, endIdx)
  const padTop = chatRows - visible.length
  for (let i = 0; i < padTop; i++) lines.push(pad('', cols))
  for (const h of visible) {
    lines.push(pad(truncate(h, cols), cols))
  }
  while (lines.length < rows - 1) lines.push(pad('', cols))

  const promptText = '> ' + input
  const cursorCol = 3 + displayWidth(input.slice(0, cursor))
  lines.push(pad(promptText, cols))

  process.stdout.write('\x1b[1;1H\x1b[0m')
  process.stdout.write(lines.join('\r\n') + '\x1b[0m')
  writeAt(cursorCol, rows, '')
}

function scrollChat(delta) {
  const { rows } = getSize()
  const chatRows = rows - HUD_ROWS - 2
  const maxOffset = Math.max(0, history.length - chatRows)
  scrollOffset = Math.min(maxOffset, Math.max(0, scrollOffset + delta))
  render()
}

function handleKeypress(str, key) {
  if (!key) return

  if (str && /^\x1b\[</.test(str)) {
    return
  }

  if (key.ctrl && key.name === 'c') {
    exit()
    return
  }

  if (key.name === 'pageup') {
    scrollChat(5)
    return
  }

  if (key.name === 'pagedown') {
    scrollChat(-5)
    return
  }

  if (key.name === 'return' || key.name === 'enter') {
    const line = input.trim()
    input = ''
    cursor = 0
    if (line) {
      cmdHistory.unshift(line)
      cmdHistoryIndex = -1
    }
    render()
    if (line) {
      const handled = handleCommand(line, { addMessage, exit })
      if (!handled) {
        bot.chat(line)
      }
    }
    return
  }

  if (key.name === 'backspace') {
    if (cursor > 0) {
      input = input.slice(0, cursor - 1) + input.slice(cursor)
      cursor--
      render()
    }
    return
  }

  if (key.name === 'delete') {
    if (cursor < input.length) {
      input = input.slice(0, cursor) + input.slice(cursor + 1)
      render()
    }
    return
  }

  if (key.name === 'left') {
    if (cursor > 0) {
      cursor--
      render()
    }
    return
  }

  if (key.name === 'right') {
    if (cursor < input.length) {
      cursor++
      render()
    }
    return
  }

  if (key.name === 'up') {
    if (cmdHistoryIndex < cmdHistory.length - 1) {
      cmdHistoryIndex++
      input = cmdHistory[cmdHistoryIndex] || ''
      cursor = input.length
      render()
    }
    return
  }

  if (key.name === 'down') {
    if (cmdHistoryIndex >= 0) {
      cmdHistoryIndex--
      input = cmdHistoryIndex >= 0 ? (cmdHistory[cmdHistoryIndex] || '') : ''
      cursor = input.length
      render()
    }
    return
  }

  if (key.name === 'home') {
    cursor = 0
    render()
    return
  }

  if (key.name === 'end') {
    cursor = input.length
    render()
    return
  }

  if (key.ctrl && key.name === 'u') {
    input = ''
    cursor = 0
    render()
    return
  }

  if (str) {
    input = input.slice(0, cursor) + str + input.slice(cursor)
    cursor += str.length
    render()
  }
}

function formatKickReason(reason) {
  if (typeof reason === 'string') return reason
  if (Array.isArray(reason)) return reason.map(formatKickReason).join(' | ')
  if (reason && typeof reason === 'object') {
    const extras = reason.extra
    if (Array.isArray(extras)) return formatKickReason(extras)
    return reason.text || JSON.stringify(reason)
  }
  return String(reason)
}

function exit() {
  bot.destroyBot()
  stopTui()
  process.exit(0)
}

function startTui() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.log('终端不支持 TUI，请用 CLI 模式 (node index.js --cli)')
    process.exit(1)
  }

  process.stdout.write('\x1b[?1049h\x1b[?25l')
  readline.emitKeypressEvents(process.stdin)
  process.stdin.setRawMode(true)
  process.stdin.on('keypress', handleKeypress)
  process.stdout.on('resize', () => {
    process.stdout.write('\x1b[2J')
    render()
  })
  started = true

  addMessage(logRaw('交互模式已启动 - !help 查看命令'))
  setInterval(refreshStatus, 1000)
  render()
}

function stopTui() {
  if (!started) return
  process.stdout.write('\x1b[?25h\x1b[?1049l')
  process.stdin.setRawMode(false)
  process.stdout.removeListener('resize', render)
  started = false
}

bot.createBot((event, data) => {
  switch (event) {
    case 'spawn':
      addMessage(logRaw('Bot 已进入游戏'))
      startPassivePerception((ev) => {
        switch (ev.type) {
          case 'damage':
            notify(`⚠ 受到伤害 ${ev.data.health} (-${ev.data.damage})`)
            break
          case 'entity_attack':
            notify(`⚠ ${translateEntity(ev.data.name)} 攻击你! (${ev.data.distance}m)`)
            break
          case 'entity_approach':
            notify(`📍 ${translateEntity(ev.data.name)} 接近中 (${ev.data.distance}m)`)
            break
          case 'entity_leave':
            notify(`↪ ${translateEntity(ev.data.name)} 离开了`)
            break
        }
      })
      break
    case 'chat':
      // 玩家聊天：历史显示 + 写入聊天记录
      addMessage(chatLog(`${data.username}: ${data.message}`))
      break
    case 'messagestr':
      addMessage(logRaw('[消息] ' + translateMessage(data.msg)))
      chatLog(translateMessage(data.msg))
      break
    case 'auto_login':
      addMessage(logRaw('已自动登录'))
      break
    case 'auto_register':
      addMessage(logRaw('已自动注册'))
      break
    case 'error':
      addMessage(logRaw('错误: ' + data.err))
      break
    case 'kicked':
      addMessage(logRaw('被踢出: ' + formatKickReason(data.reason)))
      stopPassivePerception()
      break
    case 'end':
      addMessage(logRaw('连接断开: ' + (data.reason || '未知原因')))
      stopPassivePerception()
      break
    case 'reconnect_start':
      addMessage(logRaw(`开始自动重连 (${data.attempt}/${data.max})`))
      break
    case 'reconnect_attempt':
      addMessage(logRaw(`正在重连... (第${data.attempt}次)`))
      break
    case 'goal_reached':
      addMessage(logRaw('📍 已到达目标'))
      break
    case 'path_update':
      addMessage(logRaw(`🧭 寻路状态: ${data.status}`))
      break
    case 'path_failed':
      addMessage(logRaw('⚠ 无法到达目标 (无路径/超时)'))
      break
    case 'sleep_started':
      addMessage(logRaw('💤 已入睡'))
      break
    case 'woke_up':
      addMessage(logRaw('🌅 醒来了'))
      break
    case 'sleep_failed':
      addMessage(logRaw(`⚠ 睡觉失败: ${data.err}`))
      break
    case 'item_dropped':
      addMessage(logRaw(`📤 已丢出 ${data.name} ×${data.count}`))
      break
    case 'block_placed':
      addMessage(logRaw(`🧱 已放置 ${data.name} 到 (${data.x}, ${data.y}, ${data.z})`))
      break
    case 'place_failed':
      addMessage(logRaw(`⚠ 放置失败: ${data.err}`))
      break
  }
})

startTui()
