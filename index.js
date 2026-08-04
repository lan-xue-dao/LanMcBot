const mineflayer = require('mineflayer')
const fs = require('fs')
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
  bot.chat('大家好！我是一个机器人！')
})

bot.on('chat', (username, message) => {
  if (username === bot.username) return
  log(`<${username}> ${message}`)
  if (message === 'hello') {
    bot.chat(`你好 ${username}！`)
  }
})

bot.on('error', err => log('错误: ' + err))

bot.on('kicked', reason => log('被踢出: ' + reason))
