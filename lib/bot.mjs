import mineflayer from 'mineflayer'
import vec3 from 'vec3'
import config from './config.mjs'
import { blockIdFromZh, translateBlock, translateEntity } from './i18n.mjs'
import { initNav } from './nav/index.mjs'
import { createDeathHandler, shouldReconnect } from './lifecycle.mjs'
import { isHostile } from './entities.mjs'

let bot = null
let nav = null
let loggedIn = false
let reconnecting = false
let reconnectAttempts = 0
let intentionalQuit = false
const MAX_RECONNECT_ATTEMPTS = 3
const RECONNECT_DELAY = 5000
let onMessageCallback = null
let reconnectTimer = null
let pendingServer = null
let deathHandler = null

export function sendChat(text) {
  if (!bot) return
  bot.chat(text)
  if (onMessageCallback) onMessageCallback('bot_chat', { text })
}

// 轮询直到连接真正关闭（bot 被置 null 或 client 消失，或超时）
function waitForDisconnect() {
  return new Promise(resolve => {
    const timer = setInterval(() => {
      if (!bot || !bot._client || Date.now() >= _disconnectDeadline) {
        clearInterval(timer)
        resolve()
      }
    }, 100)
  })
}
let _disconnectDeadline = 0

export async function quitBot() {
  if (!bot) return
  const current = bot

  // 确保导航停止
  if (nav) {
    try {
      nav.destroy()
    } catch (err) {
      console.error('[bot.mjs] Failed to destroy nav:', err)
    }
    nav = null
  }

  // 断开连接
  try {
    if (typeof current.quit === 'function') {
      current.quit()
    } else if (typeof current.end === 'function') {
      current.end()
    } else if (current._client && typeof current._client.end === 'function') {
      current._client.end()
    }
  } catch (err) {
    console.error('[bot.mjs] quitBot error:', err)
  }

  // 等连接真正关闭（最多 3s），避免断连事件回调与后续置 null 竞态
  _disconnectDeadline = Date.now() + 3000
  await waitForDisconnect()

  // 清理引用（end/kicked 事件也可能已置 null，此处幂等）
  bot = null
  loggedIn = false
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
  if (!shouldReconnect({
    intentionalQuit,
    attempts: reconnectAttempts,
    max: MAX_RECONNECT_ATTEMPTS
  })) {
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS && onMessageCallback) {
      onMessageCallback('reconnect_failed', { attempts: reconnectAttempts })
    }
    return
  }

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
  nav = initNav(bot, onMessage)

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
    // 复活/重生后退出死亡自动重生流程
    if (deathHandler) {
      deathHandler.cancel()
      deathHandler = null
    }
    if (onMessage) onMessage('spawn')
    if (pendingServer) {
      const target = pendingServer
      pendingServer = null
      setTimeout(() => {
        sendChat(`/server ${target}`)
      }, 3000)
    }
  })

  bot.on('death', () => {
    // 启动死亡自动重生（带重试与上限），并清掉残留移动控制，避免复活后继续走位
    if (deathHandler) deathHandler.cancel()
    if (nav) nav.stop()
    clearControls()
    deathHandler = createDeathHandler({
      onMessage,
      respawn: () => bot.respawn(),
      isDead: () => !bot || bot.health <= 0,
      scheduleRetry: (fn, ms) => setTimeout(fn, ms),
      onDeathHook: () => {},
      maxAttempts: 3,
      retryMs: 1000
    })
    deathHandler.onDeath()
  })

  bot.on('chat', (username, message) => {
    if (username === bot.username) return
    if (onMessage) onMessage('chat', { username, message })
    // 剥掉服务器聊天签名后缀（形如 "lanbot help        |喵~~" 的 " |喵~~"），只留命令本体
    const plain = message.trim().replace(/\s+\|.*$/, '')
    if (plain === 'hello') {
      sendChat(`你好 ${username}！`)
    }

    const reply = (text) => sendChat(text)
    const wakeMatch = plain.match(/^(lanbot)([\s:,，]*)(.*)$/i)
    const cmdText = (wakeMatch ? wakeMatch[3] : plain).trim()
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
      sleep()
        .then(() => reply('已进入睡眠'))
        .catch(err => {
          if (err.message?.includes('已经在睡觉')) reply('已经在睡觉了')
          else if (err.message?.includes('没有床')) reply('附近没有找到床')
          else reply('未连接')
        })
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
      const hasStand = px != null && py != null && pz != null
      if (hasStand) {
        reply(`正在走到 (${px}, ${py}, ${pz}) 放置 ${translateBlock(blockName)}...`)
      } else {
        reply(`正在放置 ${translateBlock(blockName)} 到 (${x}, ${y}, ${z})...`)
      }
      placeBlock(blockName, parseInt(x), parseInt(y), parseInt(z),
        px != null ? parseInt(px) : null, py != null ? parseInt(py) : null, pz != null ? parseInt(pz) : null)
        .then(result => {
          if (result.ok) reply(`已放置 ${translateBlock(blockName)} 到 (${x}, ${y}, ${z})`)
          else reply(`无法放置 ${translateBlock(blockName)}: ${result.reason}`)
        })
        .catch(err => {
          reply(`放置失败 ${translateBlock(blockName)}: ${err.message || err}`)
        })
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
      sendChat('/login ' + config.password)
      if (onMessage) onMessage('auto_login')
    } else if (/register/i.test(msg)) {
      sendChat('/register ' + config.password + ' ' + config.password)
      if (onMessage) onMessage('auto_register')
    }
  })

  bot.on('error', err => {
    if (onMessage) onMessage('error', { err })
  })

  bot.on('kicked', reason => {
    if (onMessage) onMessage('kicked', { reason })
    loggedIn = false
    if (deathHandler) { deathHandler.cancel(); deathHandler = null }
    if (nav) { nav.destroy(); nav = null }
    bot = null
    if (!intentionalQuit) scheduleReconnect()
  })

  bot.on('end', reason => {
    loggedIn = false
    if (deathHandler) { deathHandler.cancel(); deathHandler = null }
    if (nav) { nav.destroy(); nav = null }
    bot = null
    if (onMessage) onMessage('end', { reason })
    if (!intentionalQuit) scheduleReconnect()
  })

  return bot
}

export async function destroyBot() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  reconnecting = false
  reconnectAttempts = MAX_RECONNECT_ATTEMPTS
  intentionalQuit = true

  if (nav) { nav.destroy(); nav = null }
  await quitBot()
}

export async function reconnect() {
  // 先标记 intentionalQuit，避免旧 bot 的 end 事件触发自动重连
  intentionalQuit = true
  if (bot) {
    if (nav) { nav.destroy(); nav = null }
    await quitBot()
  }
  reconnecting = false
  reconnectAttempts = 0
  intentionalQuit = false
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

  sendChat(message)
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
  if (!bot || !nav || !bot.entity) return false
  return nav.goto(x, y, z)
}

export function stopMove() {
  if (!nav) return false
  nav.stop()
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
  if (!bot) return Promise.reject(new Error('未连接'))
  if (bot.isSleeping) return Promise.reject(new Error('已经在睡觉'))

  const bed = bot.findBlock({
    matching: (b) => b.name.endsWith('bed') || b.name === 'bed',
    maxDistance: 8
  })

  if (!bed) return Promise.reject(new Error('附近没有床'))

  if (nav) nav.stop()

  // 返回 Promise 让调用方可以等待
  return new Promise((resolve, reject) => {
    bot.sleep(bed, (err) => {
      if (err) {
        reject(new Error(err.message))
      } else {
        resolve(true)
      }
    })
  })
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
    if (normalizeName(i.name) === normalizeName(itemName) ||
        (i.displayName && normalizeName(i.displayName) === normalizeName(itemName))) {
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
  if (!bot) return Promise.reject({ ok: false, reason: '未连接' })

  const target = vec3(Math.floor(x), Math.floor(y), Math.floor(z))
  const existing = bot.blockAt(target)
  if (existing && existing.name !== 'air' && existing.name !== 'water' && existing.name !== 'lava') {
    return Promise.reject({ ok: false, reason: `目标位置已有方块: ${existing.name}` })
  }

  const items = bot.inventory.items()
  const zhId = blockIdFromZh(blockName)
  let item = items.find(i =>
    i.name === blockName || i.name === `minecraft:${blockName}` ||
    (zhId && (i.name === zhId || i.name === `minecraft:${zhId}`))
  )
  if (!item) return Promise.reject({ ok: false, reason: `背包里没有方块: ${blockName}` })

  return new Promise((resolve, reject) => {
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
        reject({ ok: false, reason: '目标位置周围没有可放置的支撑面' })
        return
      }

      bot.equip(item, 'hand', (err) => {
        if (err) {
          reject({ ok: false, reason: err.message || '装备物品失败' })
          return
        }
        bot.placeBlock(reference, face, (placeErr) => {
          if (placeErr) {
            reject({ ok: false, reason: placeErr.message })
          } else {
            resolve({ ok: true, name: blockName })
          }
        })
      })
    }

    if (standX != null && standY != null && standZ != null) {
      const stand = vec3(Math.floor(standX), Math.floor(standY), Math.floor(standZ))
      if (stand.distanceTo(bot.entity.position) > 2) {
        if (nav) nav.stop()
        if (nav) nav.goto(stand.x, stand.y, stand.z)
        const checkInterval = setInterval(() => {
          if (!bot || !bot.entity) {
            clearInterval(checkInterval)
            reject({ ok: false, reason: '未连接' })
            return
          }
          if (bot.entity.position.distanceTo(stand) <= 2.5) {
            clearInterval(checkInterval)
            if (nav) nav.stop()
            setTimeout(doPlace, 300)
          }
        }, 500)
        return
      }
    }

    doPlace()
  })
}

function findNearestHostile(maxDistance = 32) {
  let nearest = null
  let bestDist = Infinity
  for (const e of Object.values(bot.entities)) {
    if (e === bot.entity || !e.position) continue
    if (!isHostile(e.name)) continue
    const d = e.position.distanceTo(bot.entity.position)
    if (d < bestDist && d <= maxDistance) {
      bestDist = d
      nearest = e
    }
  }
  return nearest
}
