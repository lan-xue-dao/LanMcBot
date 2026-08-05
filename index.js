const mineflayer = require('mineflayer')
const fs = require('fs')
const readline = require('readline')
const config = require('./config.json')

const bot = mineflayer.createBot(config)

const logFile = `chat_${new Date().toISOString().slice(0,10)}.log`

function log(msg) {
  const time = new Date().toLocaleString('zh-CN')
  const line = `[${time}] ${msg}`
  console.log(line)
  fs.appendFileSync(logFile, line + '\n')
}

bot.on('spawn', () => {
  log('Bot 已进入游戏')
})

bot.on('chat', (username, message) => {
  if (username === bot.username) return
  if (message === 'hello') {
    bot.chat(`你好 ${username}！`)
  }
})

bot.on('messagestr', msg => {
  log('[消息] ' + msg)
  if (/login/i.test(msg)) {
    bot.chat('/login ' + config.password)
    log('已自动登录')
  } else if (/register/i.test(msg)) {
    bot.chat('/register ' + config.password + ' ' + config.password)
    log('已自动注册')
  }
})

bot.on('error', err => log('错误: ' + err))

bot.on('kicked', reason => log('被踢出: ' + reason))

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
})

rl.on('line', input => {
  const cmd = input.trim()
  if (!cmd) return

  if (cmd === '！help' || cmd === '!help') {
    log('可用命令：')
    log('  ！help   - 显示帮助')
    log('  ！exit   - 退出')
    log('  ！quit   - 退出')
    log('  ！restart - 重启')
  } else if (cmd === '！exit' || cmd === '!exit' || cmd === '！quit' || cmd === '!quit') {
    log('正在退出...')
    bot.quit()
    process.exit(0)
  } else if (cmd === '！restart' || cmd === '!restart') {
    log('正在重启...')
    bot.quit()
    process.exit(1)
  } else {
    bot.chat(cmd)
  }
})
