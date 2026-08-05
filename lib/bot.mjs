import mineflayer from 'mineflayer'
import config from './config.mjs'

let bot = null
let loggedIn = false

export function getBot() {
  return bot
}

export function isLoggedIn() {
  return loggedIn
}

export function createBot(onMessage) {
  if (bot) return bot

  bot = mineflayer.createBot(config)

  bot.on('spawn', () => {
    loggedIn = true
    if (onMessage) onMessage('spawn')
  })

  bot.on('chat', (username, message) => {
    if (username === bot.username) return
    if (onMessage) onMessage('chat', { username, message })
    if (message === 'hello') {
      bot.chat(`你好 ${username}！`)
    }
  })

  bot.on('messagestr', msg => {
    if (onMessage) onMessage('messagestr', { msg })
    if (loggedIn) return
    if (/login/i.test(msg)) {
      bot.chat('/login ' + config.password)
      if (onMessage) onMessage('auto_login')
    } else if (/register/i.test(msg)) {
      bot.chat('/register ' + config.password + ' ' + config.password)
      if (onMessage) onMessage('auto_register')
    }
  })

  bot.on('error', err => {
    if (onMessage) onMessage('error', { err })
  })

  bot.on('kicked', reason => {
    if (onMessage) onMessage('kicked', { reason })
  })

  bot.on('end', () => {
    loggedIn = false
    bot = null
  })

  return bot
}

export function destroyBot() {
  if (bot) {
    bot.quit()
    bot = null
    loggedIn = false
  }
}

export function chat(message) {
  if (bot) bot.chat(message)
}
