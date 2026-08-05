import mineflayer from 'mineflayer'
import pathfinderPkg from 'mineflayer-pathfinder'
import vec3 from 'vec3'
import config from './config.mjs'

const { pathfinder, Movements, goals } = pathfinderPkg

let bot = null
let loggedIn = false
let reconnecting = false
let reconnectAttempts = 0
let intentionalQuit = false
const MAX_RECONNECT_ATTEMPTS = 3
const RECONNECT_DELAY = 5000
let onMessageCallback = null
let reconnectTimer = null
let pendingServer = null

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
  bot.loadPlugin(pathfinder)
  let lastMovements = null

  bot.on('path_update', (r) => {
    if (!r) return
    const status = r.status
    if (status === 'noPath' || status === 'timeout' || status === 'failed') {
      if (onMessage) onMessage('path_failed', { status })
    }
  })

  let lastGoalTime = 0

  bot.on('goal_reached', () => {
    const now = Date.now()
    if (now - lastGoalTime < 10000) return
    lastGoalTime = now
    if (onMessage) onMessage('goal_reached')
  })

  bot.on('sleep', () => {
    if (onMessage) onMessage('sleep_started')
  })

  bot.on('wake', () => {
    if (onMessage) onMessage('woke_up')
  })

  bot.on('spawn', () => {
    loggedIn = true
    reconnecting = false
    reconnectAttempts = 0
    if (onMessage) onMessage('spawn')
    if (pendingServer) {
      const target = pendingServer
      pendingServer = null
      setTimeout(() => {
        if (bot) bot.chat(`/server ${target}`)
      }, 3000)
    }
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
  if (!bot) return

  const serverMatch = message.match(/^\/server\s+(\S+)/i)
  if (serverMatch) {
    pendingServer = serverMatch[1]
  }

  bot.chat(message)
}

export function setControl(control, state) {
  if (!bot) return false
  bot.setControlState(control, state)
  if (control === 'sneak') bot._sneaking = !!state
  return true
}

export function isSneaking() {
  return !!(bot && bot._sneaking)
}

export function clearControls() {
  if (!bot) return false
  for (const c of ['forward', 'back', 'left', 'right', 'jump', 'sneak']) {
    bot.setControlState(c, false)
  }
  return true
}

export function moveTo(x, y, z) {
  if (!bot) return false
  const target = vec3(Math.floor(x), Math.floor(y), Math.floor(z))
  const goal = new goals.GoalBlock(target.x, target.y, target.z)
  bot.pathfinder.setGoal(goal)
  if (onMessageCallback) onMessageCallback('move_started', { x: target.x, y: target.y, z: target.z })
  return true
}

export function stopMove() {
  if (!bot) return false
  bot.pathfinder.stop()
  return true
}

export function attackTarget() {
  if (!bot) return false
  const target = findNearestHostile()
  if (target) {
    bot.attack(target)
    return target.name || 'unknown'
  }
  return null
}

export function useHand() {
  if (!bot) return false
  bot.activateItem()
  return true
}

export function attackEntity(entityId) {
  if (!bot) return false
  const entity = bot.entities[entityId]
  if (!entity) return null
  bot.attack(entity)
  return entity.name || entity.username || 'unknown'
}

export function useOnEntity(entityId) {
  if (!bot) return false
  const entity = bot.entities[entityId]
  if (!entity) return null
  bot.useOn(entity)
  return entity.name || entity.username || 'unknown'
}

export function useBlockAt(x, y, z) {
  if (!bot) return false
  const block = bot.blockAt(vec3(x, y, z))
  if (!block) return null
  bot.activateBlock(block)
  return block.name
}

export function sleep() {
  if (!bot) return false
  if (bot.isSleeping) return 'already_sleeping'

  const bed = bot.findBlock({
    matching: (b) => b.name.endsWith('bed') || b.name === 'bed',
    maxDistance: 8
  })

  if (!bed) return 'no_bed'

  bot.pathfinder.stop()
  bot.sleep(bed, (err) => {
    if (err) {
      if (onMessageCallback) onMessageCallback('sleep_failed', { err: err.message })
    }
  })
  return 'sleeping'
}

export function wake() {
  if (!bot) return false
  if (!bot.isSleeping) return false
  bot.wake()
  return true
}

export function isSleeping() {
  return !!(bot && bot.isSleeping)
}

function findNearestHostile() {
  const HOSTILE = ['zombie', 'skeleton', 'spider', 'creeper', 'enderman']
  let nearest = null
  let bestDist = Infinity
  for (const e of Object.values(bot.entities)) {
    if (e === bot.entity || !e.position) continue
    if (!HOSTILE.includes(e.name)) continue
    const d = e.position.distanceTo(bot.entity.position)
    if (d < bestDist) {
      bestDist = d
      nearest = e
    }
  }
  return nearest
}
