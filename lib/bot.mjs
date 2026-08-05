import mineflayer from 'mineflayer'
import pathfinderPkg from 'mineflayer-pathfinder'
import vec3 from 'vec3'
import config from './config.mjs'
import { blockIdFromZh, translateBlock, translateEntity } from './i18n.mjs'

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

  let pathfinderReady = false
  function setupPathfinder() {
    if (pathfinderReady || !bot.registry) return
    pathfinderReady = true
    const movements = new Movements(bot)
    movements.canDig = false
    movements.canOpenDoors = true
    movements.allowParkour = true
    movements.allow1by1towers = false
    bot.pathfinder.setMovements(movements)
  }

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
    setupPathfinder()
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

    const reply = (text) => bot.chat(text)
    const wakeMatch = message.match(/^(lanbot)([\s:,，]*)(.*)$/i)
    const cmdText = (wakeMatch ? wakeMatch[3] : message).trim()
    const usedWake = !!wakeMatch

    const helpCmd = cmdText.match(/^(?:help|帮助|指令|命令)$/i)
    if (helpCmd) {
      reply('可用指令：\n  help - 显示帮助\n  move <x> <y> <z> - 移动\n  sleep/wake - 睡觉/起床\n  attack - 攻击\n  丢 <物> [数量] - 丢出物品\n  背包 - 背包列表\n  数量 <物> - 查询数量\n  place <方块> <x> <y> <z> [px py pz] - 放置方块')
      return
    }

    const moveMatch = cmdText.match(/^move\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)$/i)
    if (moveMatch) {
      const [, x, y, z] = moveMatch.map(Number)
      moveTo(x, y, z)
      reply(`正在移动到 (${x}, ${y}, ${z})...`)
      return
    }

    if (cmdText.match(/^sleep$/i)) {
      const result = sleep()
      if (result === 'already_sleeping') reply('已经在睡觉了')
      else if (result === 'no_bed') reply('附近没有找到床')
      else if (result === 'sleeping') reply('正在躺下睡觉...')
      else reply('未连接')
      return
    }

    if (cmdText.match(/^wake$/i)) {
      if (wake()) reply('起床了')
      else reply('当前没有在睡觉')
      return
    }

    if (cmdText.match(/^attack$/i)) {
      const target = attackTarget()
      if (target) reply(`正在攻击 ${target}`)
      else reply('附近没有敌对生物')
      return
    }

    const dropMatch = cmdText.match(/^(?:丢|丢出|drop)\s+(.+?)(?:\s+(\d+))?$/i)
    if (dropMatch) {
      const itemName = dropMatch[1].trim().replace(/^["'“”]+|["'“”]+$/g, '')
      const count = parseInt(dropMatch[2] || '1', 10)
      const result = dropItem(itemName, count)
      if (result.ok) {
        reply(`已丢出 ${result.display} ×${result.count}`)
        if (onMessage) onMessage('item_dropped', { name: result.display, count: result.count })
      } else {
        reply(`丢不出 ${translateBlock(itemName)}: ${result.reason}`)
      }
      return
    }
    const invMatch = cmdText.match(/^(?:背包|inv|inventory|背包列表)$/i)
    if (invMatch) {
      const inv = getInventory()
      if (inv.count === 0) {
        reply('背包是空的')
      } else {
        reply(`背包 ${inv.count}种: ${inv.items.map(i => `${i.display}×${i.count}`).join(', ')}`)
      }
      return
    }
    const countMatch = cmdText.match(/^(?:数量|几个|count)\s+(.+?)$/i)
    if (countMatch) {
      const itemName = countMatch[1].trim().replace(/^["'“”]+|["'“”]+$/g, '')
      const result = getItemCount(itemName)
      if (result.ok) {
        reply(`背包里有 ${translateBlock(itemName)} ×${result.count}`)
      } else {
        reply(`查询失败: ${result.reason}`)
      }
      return
    }
    const placeMatch = cmdText.match(/^place\s+(\S+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)(?:\s+(-?\d+)\s+(-?\d+)\s+(-?\d+))?$/i)
    if (placeMatch) {
      const [, blockName, x, y, z, px, py, pz] = placeMatch
      const result = placeBlock(blockName, parseInt(x), parseInt(y), parseInt(z),
        px != null ? parseInt(px) : null, py != null ? parseInt(py) : null, pz != null ? parseInt(pz) : null)
      if (!result.ok) {
        reply(`无法放置 ${translateBlock(blockName)}: ${result.reason}`)
      } else if (result.walking) {
        reply(`正在走到 (${px}, ${py}, ${pz}) 放置 ${translateBlock(blockName)}...`)
      } else {
        reply(`正在放置 ${translateBlock(blockName)} 到 (${x}, ${y}, ${z})...`)
      }
      return
    }

    if (usedWake) {
      reply('未知指令, 发 help 查看可用指令')
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
    return translateEntity(target.name || 'unknown')
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
  return translateEntity(entity.name || entity.username || 'unknown')
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

export function dropItem(itemName, count = 1) {
  if (!bot || !bot.inventory) return { ok: false, reason: '未连接' }

  const items = bot.inventory.items()
  const target = findItemInItems(items, itemName)
  if (!target) return { ok: false, reason: '背包里没有这个物品' }

  const dropCount = Math.min(count, target.count)
  try {
    bot.toss(target.type, target.metadata, dropCount, () => {})
    return { ok: true, display: translateBlock(target.name), count: dropCount }
  } catch (err) {
    return { ok: false, reason: err.message || '丢弃失败' }
  }
}

export function getInventory() {
  if (!bot || !bot.inventory) return { ok: false, reason: '未连接' }
  const items = bot.inventory.items()
  if (items.length === 0) return { ok: true, items: [], count: 0 }

  const grouped = {}
  for (const i of items) {
    const key = i.name
    if (!grouped[key]) {
      grouped[key] = { name: i.name, display: translateBlock(i.name), count: 0 }
    }
    grouped[key].count += i.count
  }
  const list = Object.values(grouped)
  return { ok: true, items: list, count: list.length }
}

function normalizeName(s) {
  return String(s).toLowerCase().replace(/[-_\s]+/g, '')
}

function findItemInItems(items, name) {
  const zhId = blockIdFromZh(name)
  const candidates = [name, zhId]
  return items.find(i =>
    candidates.some(c =>
      c && (normalizeName(i.name) === normalizeName(c) ||
        (i.displayName && normalizeName(i.displayName) === normalizeName(c)))
    )
  )
}

export function getItemCount(itemName) {
  if (!bot || !bot.inventory) return { ok: false, reason: '未连接' }
  const items = bot.inventory.items()
  let total = 0
  for (const i of items) {
    if (findItemInItems([i], itemName)) {
      total += i.count
    }
  }
  return { ok: true, name: itemName, count: total }
}

const FACES = [
  { vector: [1, 0, 0], offset: [1, 0, 0] },
  { vector: [-1, 0, 0], offset: [-1, 0, 0] },
  { vector: [0, 1, 0], offset: [0, 1, 0] },
  { vector: [0, -1, 0], offset: [0, -1, 0] },
  { vector: [0, 0, 1], offset: [0, 0, 1] },
  { vector: [0, 0, -1], offset: [0, 0, -1] }
]

export function placeBlock(blockName, x, y, z, standX, standY, standZ) {
  if (!bot) return { ok: false, reason: '未连接' }

  const target = vec3(Math.floor(x), Math.floor(y), Math.floor(z))
  const existing = bot.blockAt(target)
  if (existing && existing.name !== 'air' && existing.name !== 'water' && existing.name !== 'lava') {
    return { ok: false, reason: `目标位置已有方块: ${existing.name}` }
  }

  const items = bot.inventory.items()
  const zhId = blockIdFromZh(blockName)
  let item = items.find(i =>
    i.name === blockName || i.name === `minecraft:${blockName}` ||
    (zhId && (i.name === zhId || i.name === `minecraft:${zhId}`))
  )
  if (!item) return { ok: false, reason: `背包里没有方块: ${blockName}` }

  const doPlace = () => {
    let reference = null
    let face = null
    for (const f of FACES) {
      const neighbor = bot.blockAt(target.plus(vec3(...f.offset)))
      if (neighbor && neighbor.name !== 'air' && neighbor.name !== 'water' && neighbor.name !== 'lava') {
        reference = neighbor
        face = vec3(...f.vector)
        break
      }
    }
    if (!reference) {
      if (onMessageCallback) onMessageCallback('place_failed', { err: '目标位置周围没有可放置的支撑面' })
      return
    }

    bot.equip(item, 'hand', (err) => {
      if (err) {
        if (onMessageCallback) onMessageCallback('place_failed', { err: err.message || '装备物品失败' })
        return
      }
      bot.placeBlock(reference, face, (placeErr) => {
        if (placeErr) {
          if (onMessageCallback) onMessageCallback('place_failed', { err: placeErr.message })
        } else if (onMessageCallback) {
          onMessageCallback('block_placed', { name: blockName, x: target.x, y: target.y, z: target.z })
        }
      })
    })
  }

  if (standX != null && standY != null && standZ != null) {
    const stand = vec3(Math.floor(standX), Math.floor(standY), Math.floor(standZ))
    if (stand.distanceTo(bot.entity.position) > 2) {
      bot.pathfinder.stop()
      bot.pathfinder.setGoal(new goals.GoalNear(stand.x, stand.y, stand.z, 1.5))
      const checkInterval = setInterval(() => {
        if (!bot || !bot.entity) {
          clearInterval(checkInterval)
          return
        }
        if (bot.entity.position.distanceTo(stand) <= 2.5) {
          clearInterval(checkInterval)
          bot.pathfinder.stop()
          setTimeout(doPlace, 300)
        }
      }, 500)
      return { ok: true, name: blockName, walking: true }
    }
  }

  doPlace()
  return { ok: true, name: blockName }
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
