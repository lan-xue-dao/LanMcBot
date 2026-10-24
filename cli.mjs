import readline from 'readline'
import * as bot from './lib/bot.mjs'
import { logRaw, chatLog } from './lib/logger.mjs'
import { handleCommand } from './lib/commands.mjs'
import { startPassivePerception, stopPassivePerception } from './lib/perception/index.mjs'
import { translateEntity, translateMessage, translateBlock } from './lib/i18n.mjs'
import { formatKickReason } from './lib/utils.mjs'

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
      // 玩家聊天：控制台展示 + 写入聊天记录
      addMessage(chatLog(`${data.username}: ${data.message}`))
      break
    case 'bot_chat':
      // 本 bot 发出/执行的聊天命令
      addMessage(chatLog(`我: ${data.text}`))
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
    case 'combat_started':
      addMessage(logRaw('⚔ 自动战斗已开启'))
      break
    case 'combat_stopped':
      addMessage(logRaw('⚔ 自动战斗已关闭'))
      break
    case 'combat_attack':
      addMessage(logRaw(`⚔ 攻击 ${data.name} (${data.distance}m)`))
      break
    case 'combat_retreat':
      addMessage(logRaw(`🏃 低血量撤退 (${translateEntity(data.name)}) 生命: ${data.health}`))
      break
    case 'combat_pvp':
      addMessage(logRaw(data.enabled ? '⚔ PvP 已开启' : '⚔ PvP 已关闭'))
      break
    case 'follow_started':
      addMessage(logRaw(`🚶 开始跟随 ${data.name}`))
      break
    case 'follow_stopped':
      addMessage(logRaw(`🚶 已停止跟随 ${data.name}`))
      break
    case 'follow_lost':
      addMessage(logRaw(`🚶 跟丢了 ${data.name}（不在视野内）`))
      break
    case 'follow_move':
      addMessage(logRaw(`🚶 向 ${data.name} 靠近 (${data.distance}m)`))
      break
    case 'build_done':
      addMessage(logRaw(`🧱 建造 ${data.type}: 放置 ${data.placed}/${data.total}（跳过 ${data.skipped}）`))
      break
    case 'smelt_progress':
      addMessage(logRaw(`🔥 烧炼进度 ${translateBlock(data.name)}: ${data.total}/${data.want}`))
      break
    case 'block_dug':
      addMessage(logRaw(`⛏ 已挖 ${translateBlock(data.name)}（累计 ${data.count}）`))
      break
    case 'rule_added':
      addMessage(logRaw(`📜 规则 #${data.index} 已注册 [${data.event}]`))
      break
    case 'rule_removed':
      addMessage(logRaw(`📜 规则 #${data.index} 已删除`))
      break
    case 'rules_loaded':
      addMessage(logRaw(`📜 已从 rules.json 恢复 ${data.count} 条规则`))
      break
    case 'trigger_action':
      addMessage(logRaw(`🎯 触发 [${data.event}] → ${data.action} ${data.args}`))
      break
    case 'ate':
      addMessage(logRaw(`🍔 进食 ${translateBlock(data.name)}`))
      break
    case 'eat_no_food':
      addMessage(logRaw('⚠ 背包里没有可吃的食物'))
      break
    case 'eat_failed':
      addMessage(logRaw(`⚠ 进食失败: ${data.reason}`))
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

rl.on('close', async () => {
  await bot.destroyBot()
  process.exit(0)
})
