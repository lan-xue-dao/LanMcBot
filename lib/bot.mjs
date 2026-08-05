import mineflayer from 'mineflayer'
import config from './config.mjs'

let bot = null
let loggedIn = false
let reconnecting = false
let reconnectAttempts = 0
let intentionalQuit = false
const MAX_RECONNECT_ATTEMPTS = 3
const RECONNECT_DELAY = 5000
let onMessageCallback = null
let reconnectTimer = null

function quitBot() {
  if (!bot) return
  try {
    if (typeof bot.quit === 'function') {
      bot.quit()
    } else if (typeof bot.end === 'function') {
      bot.end()
    } else if (bot._client && typeof bot._client.end === 'function') {
      bot._client.end()
    }
  } catch {}
}

export function getBot() {
  return bot
}

export function isLoggedIn() {
  return loggedIn
}

export function isReconnecting() {
  return reconnecting
}

export function getReconnectAttempts() {
  return reconnectAttempts
}

function scheduleReconnect() {
  if (reconnecting || reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) return

  reconnecting = true
  reconnectAttempts++
  if (onMessageCallback) {
    onMessageCallback('reconnect_start', {
      attempt: reconnectAttempts,
      max: MAX_RECONNECT_ATTEMPTS
    })
  }

  reconnectTimer = setTimeout(() => {
    if (bot) {
      reconnecting = false
      return
    }
    if (onMessageCallback) {
      onMessageCallback('reconnect_attempt', { attempt: reconnectAttempts })
    }
    createBot(onMessageCallback)
  }, RECONNECT_DELAY)
}

export function createBot(onMessage) {
  onMessageCallback = onMessage

  if (bot) return bot

  bot = mineflayer.createBot(config)

  bot.on('spawn', () => {
    loggedIn = true
    reconnecting = false
    reconnectAttempts = 0
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
    loggedIn = false
    bot = null
    if (!intentionalQuit) scheduleReconnect()
  })

  bot.on('end', reason => {
    loggedIn = false
    bot = null
    if (onMessage) onMessage('end', { reason })
    if (!intentionalQuit) scheduleReconnect()
  })

  return bot
}

export function destroyBot() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  reconnecting = false
  reconnectAttempts = MAX_RECONNECT_ATTEMPTS
  intentionalQuit = true

  quitBot()
  bot = null
  loggedIn = false
}

export function reconnect() {
  intentionalQuit = false
  if (bot) {
    quitBot()
    bot = null
    loggedIn = false
  }
  reconnecting = false
  reconnectAttempts = 0
  createBot(onMessageCallback)
}

export function connect() {
  if (bot) return bot
  intentionalQuit = false
  reconnecting = false
  reconnectAttempts = 0
  return createBot(onMessageCallback)
}

export function chat(message) {
  if (bot) bot.chat(message)
}
