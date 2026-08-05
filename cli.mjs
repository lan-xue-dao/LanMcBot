import readline from 'readline'
import * as bot from './lib/bot.mjs'
import { logRaw } from './lib/logger.mjs'
import { handleCommand } from './lib/commands.mjs'
import { startPassivePerception, stopPassivePerception } from './lib/perception/index.mjs'
import { translateEntity, translateMessage } from './lib/i18n.mjs'

console.log(`
  _   _                    ____        _
 | \\ | |   __ _    __ _   | __ )      | |   ___
 |  \\| |  / _\` |  / _\` |  |  _ \\   _  | |  / _ \\
 | |\\  | | (_| | | (_| |  | |_) | |_| | | |  __/
 |_| \\_|  \\__,_|  \\__, |  |____/   \\__,_|  \\___ |
                  |___/                     |_/
 启动成功! 输入 !help 查看可用命令，输入消息直接发送到游戏
`)

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
})

function addMessage(msg) {
  console.log(msg)
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
  rl.close()
  process.exit(0)
}

bot.createBot((event, data) => {
  switch (event) {
    case 'spawn':
      addMessage(logRaw('Bot 已进入游戏'))
      startPassivePerception((ev) => {
        switch (ev.type) {
          case 'damage':
            addMessage(logRaw(`⚠ 受到伤害 - 生命值: ${ev.data.health} (-${ev.data.damage})`))
            break
          case 'entity_attack':
            addMessage(logRaw(`⚠ ${translateEntity(ev.data.name)} 在攻击你! (${ev.data.distance}m)`))
            break
          case 'entity_approach':
            addMessage(logRaw(`📍 ${translateEntity(ev.data.name)} 接近中 (${ev.data.distance}m)`))
            break
          case 'entity_leave':
            addMessage(logRaw(`📍 ${translateEntity(ev.data.name)} 离开了`))
            break
        }
      })
      break
    case 'chat':
      break
    case 'messagestr':
      addMessage(logRaw('[消息] ' + translateMessage(data.msg)))
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
  }
})

rl.on('line', (input) => {
  const cmd = input.trim()
  if (!cmd) return

  const handled = handleCommand(cmd, { addMessage, exit })
  if (!handled) {
    bot.chat(cmd)
  }
})

rl.on('close', () => {
  bot.destroyBot()
  process.exit(0)
})
