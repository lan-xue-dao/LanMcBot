import mineflayer from 'mineflayer'
import vec3 from 'vec3'
import config from './config.mjs'
import { blockIdFromZh, translateBlock, translateEntity } from './i18n.mjs'
import { initNav } from './nav/index.mjs'
import { createDeathHandler, shouldReconnect } from './lifecycle.mjs'
import { isHostile } from './entities.mjs'
import { createCombatController, pickWeapon, pickArmor } from './combat.mjs'
import { canCraft, ingredientsNeeded } from './craft.mjs'
import { createAutoEat } from './survival.mjs'
import { createFollowController, findPlayerByName } from './follow.mjs'
import { parseTrigger, createTriggerEngine, serializeRule, deserializeRule } from './triggers.mjs'
import { createRequire } from 'module'
import path from 'path'
import { fileURLToPath } from 'url'

const __botDir = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const RULES_FILE = path.join(__botDir, '..', 'rules.json')
import { planDeposit, planWithdraw, pickNearestContainer } from './containers.mjs'

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
let combatController = null
let autoEat = null
let triggerEngine = null
let followController = null

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
    if (triggerEngine) triggerEngine.handleEvent('death', '')
  })

  // 触发引擎：玩家进出事件
  bot.on('playerJoined', (player) => {
    if (triggerEngine && player && player.username !== bot.username) {
      triggerEngine.handleEvent('join', player.username)
    }
  })
  bot.on('playerLeft', (player) => {
    if (triggerEngine && player && player.username !== bot.username) {
      triggerEngine.handleEvent('leave', player.username)
    }
  })

  // 战斗控制器（P0-2 基线）：默认关闭，!combat on 显式开启。
  // 与自研 nav 通过「战斗激活时先 nav.stop() 再直接攻击」协调控制权，避免双写 setControlState。
  combatController = createCombatController({
    getBot: () => (bot && bot.entity ? bot : null),
    onAttack: (entity) => {
      if (!bot) return
      try {
        const p = entity.position
        if (p && p.offset) bot.lookAt(p.offset(0, (entity.height || 1) / 2, 0))
        else bot.lookAt(p)
        bot.attack(entity)
      } catch {
        // 攻击瞬时失败不应崩溃战斗循环
      }
    },
    onApproach: (entity) => {
      if (!bot || !nav) return
      nav.stop()
      nav.goto(entity.position.x, entity.position.y, entity.position.z)
    },
    onRetreat: () => {
      if (nav) nav.stop()
      clearControls()
    },
    onMessage,
    maxDistance: 16,
    tickMs: 500
  })

  // 受击反击：战斗已开启时，受伤即把最近敌对设为目标并靠近
  bot.on('health', () => {
    if (triggerEngine) triggerEngine.handleEvent('health', String(bot ? bot.health : ''))
    if (!combatController || !combatController.isEnabled()) return
    if (!bot || !bot.entity) return
    const found = findNearestHostile()
    if (found) combatController.step()
  })

  // 自动进食（P0-4）：默认开启（生存兜底，不该饿死）；!eat off 可关
  autoEat = createAutoEat({
    getBot: () => (bot && bot.inventory && bot.food != null ? bot : null),
    equipOffhand: (item) => bot.equip(item, 'off-hand'),
    consume: () => bot.activateItem(),
    onMessage,
    minHunger: 14,
    minHealth: 10,
    tickMs: 1000
  })
  autoEat.start()

  // 触发引擎（P1 聊天指令与自动化脚本/触发引擎）：规则由 !rule 命令注册，持久化到 rules.json。
  // 动作解释：say <文本>（聊天回复）→ 其余动作原样下发 onMessage('trigger_action') 由上层处理。
  triggerEngine = createTriggerEngine({
    onAction: (rule, event, text, ctx) => {
      if (rule.action === 'say') {
        const args = String(rule.args || '')
        const out = args.replace(/\{text\}/g, text).replace(/\{player\}/g, (ctx && ctx.username) || '')
        if (out.trim()) sendChat(out.trim())
      } else {
        if (onMessage) onMessage('trigger_action', { event, text, action: rule.action, args: rule.args })
      }
    }
  })
  // 启动时恢复已保存的规则（损坏/空文件静默跳过）
  try {
    const fs = require('fs')
    if (fs.existsSync(RULES_FILE)) {
      const arr = JSON.parse(fs.readFileSync(RULES_FILE, 'utf8'))
      if (Array.isArray(arr)) {
        for (const obj of arr) {
          const rule = deserializeRule(obj)
          if (rule) triggerEngine.add(rule)
        }
        if (triggerEngine.count() > 0 && onMessage) onMessage('rules_loaded', { count: triggerEngine.count() })
      }
    }
  } catch { /* rules.json 损坏时不阻塞启动 */ }

  // 跟随控制器（对标 MCC 跟班）：默认关，!follow <玩家名> 显式开启。
  // 与 combat 协调：战斗开启时让出 nav 控制权（isBusy），保持控制状态单写者。
  followController = createFollowController({
    getBot: () => (bot && bot.entity ? bot : null),
    onApproach: (entity) => {
      if (!bot || !nav) return
      const p = entity.position
      // 走到目标身旁留一格，避免贴脸卡模
      const from = bot.entity.position
      const dx = p.x - from.x
      const dz = p.z - from.z
      const d = Math.hypot(dx, dz) || 1
      const stopAt = Math.max(1.5, d - 1.5)
      nav.goto(p.x - (dx / d) * stopAt, p.y, p.z - (dz / d) * stopAt)
    },
    isBusy: () => !!(combatController && combatController.isEnabled()),
    onMessage
  })

  bot.on('chat', (username, message) => {
    if (username === bot.username) return
    if (onMessage) onMessage('chat', { username, message })
    // 触发引擎（P1）：chat 事件先于内置唤醒词处理；ctx.username 供动作插值 {player}
    if (triggerEngine && triggerEngine.count() > 0) {
      triggerEngine.handleEvent('chat', message, { username })
    }
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
    if (combatController) { combatController.stop(); combatController = null }
    if (autoEat) { autoEat.stop(); autoEat = null }
    if (followController) { followController.stop(); followController = null }
    if (nav) { nav.destroy(); nav = null }
    bot = null
    if (!intentionalQuit) scheduleReconnect()
  })

  bot.on('end', reason => {
    loggedIn = false
    if (deathHandler) { deathHandler.cancel(); deathHandler = null }
    if (combatController) { combatController.stop(); combatController = null }
    if (autoEat) { autoEat.stop(); autoEat = null }
    if (followController) { followController.stop(); followController = null }
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

// 自动战斗开关（P0-2）。enable=true 开启持续攻击+受击反击；否则停止并让出控制权。
export function setCombat(enable) {
  if (!combatController) return false
  combatController.setEnabled(enable)
  return combatController.isEnabled()
}

export function startCombat() {
  return setCombat(true)
}

export function stopCombat() {
  return setCombat(false)
}

// PvP 开关（战斗域另一半）：默认关（PvE 自动战斗不打人）
export function setPvp(enable) {
  if (!combatController) return false
  return combatController.setPvp(enable)
}

// 战斗索敌模式：'nearest'（默认，行为同旧）| 'threat'（按威胁分选敌，接入 perception/threat 单一数据源）
export function setCombatMode(mode) {
  if (!combatController) return null
  return combatController.setMode(mode)
}

export function getCombatMode() {
  return combatController ? combatController.getMode() : 'nearest'
}

// 自动进食开关（P0-4）。默认开启；!eat off 关闭。
export function setAutoEat(enable) {
  if (!autoEat) return false
  if (enable) autoEat.start()
  else autoEat.stop()
  return autoEat.isEnabled()
}

export function isAutoEatEnabled() {
  return !!(autoEat && autoEat.isEnabled())
}

// ---------- 跟随（对标 MCC 跟班）：!follow <玩家名> 显式开启，默认关闭 ----------
// nav 单写者约束：follow 的 onApproach 只走 nav.goto；combat 开启时 isBusy 让权。
// 这里只额外在关闭时收个尾——若跟随正驱动 nav 移动，停一下，免得继续朝旧目标走。

export function isFollowEnabled() {
  return !!(followController && followController.isEnabled())
}

// 按名找可跟随的玩家实体（视野内、大小写不敏感）；未连接/找不到返回 null。
export function findFollowPlayer(playerName) {
  if (!bot || !bot.entity) return null
  const who = typeof playerName === 'string' ? playerName.trim() : ''
  if (!who) return null
  return findPlayerByName(bot.entities, who)
}

// 开启跟随。未连接 / 没给名字 / 视野里找不到该玩家 → false（安全失败）。
export function setFollow(playerName) {
  if (!followController) return false
  const who = typeof playerName === 'string' ? playerName.trim() : ''
  if (!who) return false
  if (!findFollowPlayer(who)) return false
  return followController.start(who)
}

export function stopFollow() {
  if (!followController) return false
  const was = followController.isEnabled()
  followController.stop()
  if (was && nav && nav.isMoving()) nav.stop()
  return was
}

export function getFollowTarget() {
  return followController ? followController.getTarget() : ''
}

// ---------- 触发引擎（P1）：!rule 命令族的后端 ----------

// 规则持久化：add/remove 后写盘（失败仅告警，不影响功能）
function saveRulesToDisk() {
  try {
    const fs = require('fs')
    const raw = triggerEngine.__rawRules ? triggerEngine.__rawRules() : []
    fs.writeFileSync(RULES_FILE, JSON.stringify(raw.map(serializeRule), null, 2), 'utf8')
    return true
  } catch (err) {
    if (onMessageCallback) onMessageCallback('rules_save_failed', { reason: err && err.message })
    return false
  }
}

export function addRule(text) {
  if (!triggerEngine) return { ok: false, reason: '未连接' }
  const parsed = parseTrigger(text)
  if (!parsed.ok) return parsed
  const added = triggerEngine.add(parsed.rule)
  if (added.ok) {
    saveRulesToDisk()
    if (onMessageCallback) onMessageCallback('rule_added', { index: added.index, event: parsed.rule.event })
  }
  return added
}

export function removeRule(index) {
  if (!triggerEngine) return { ok: false, reason: '未连接' }
  const r = triggerEngine.remove(index)
  if (r.ok) {
    saveRulesToDisk()
    if (onMessageCallback) onMessageCallback('rule_removed', { index })
  }
  return r
}

export function listRules() {
  if (!triggerEngine) return { ok: false, reason: '未连接' }
  return { ok: true, rules: triggerEngine.list() }
}

export function handleTriggerEvent(event, text) {
  if (!triggerEngine) return 0
  return triggerEngine.handleEvent(event, text)
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

// ---------- 合成（P0-4） ----------

// mineflayer/prismarine-recipe 的 Recipe → 归一化结构（craft.mjs 纯函数的输入）。
// ingredients 元素 count=-1 表示按网格消耗，归一化为 1。
function normalizeRecipe(r) {
  if (!r) return null
  const mcData = bot.registry || bot.mcData
  if (!mcData) return null
  const nameOf = (id) => (mcData.items[id] && mcData.items[id].name) || (mcData.blocks[id] && mcData.blocks[id].name) || String(id)
  const resultId = r.result && typeof r.result === 'object' ? r.result.id : r.result
  const resultCount = (r.result && r.result.count) || 1
  const ingredients = (r.ingredients || [])
    .filter(Boolean)
    .map(i => {
      const id = i && typeof i === 'object' ? i.id : i
      const count = (i && typeof i === 'object' && i.count > 0) ? i.count : 1
      return { name: nameOf(id), count }
    })
  return { result: { name: nameOf(resultId), count: resultCount }, ingredients }
}

// 按名（中/英）解析物品 id
function resolveItemId(name) {
  const mcData = bot.registry || bot.mcData
  if (!mcData || !mcData.itemsByName) return null
  const en = blockIdFromZh(name) || name
  const item = mcData.itemsByName[en] || mcData.itemsByName[String(name).toLowerCase()]
  return item ? item.id : null
}

// 在附近找工作台（供需要台子的配方使用）
function findCraftingTable(radius = 4) {
  if (!bot || !bot.blockAt) return null
  const p = bot.entity.position.floored()
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        try {
          const b = bot.blockAt(p.offset(dx, dy, dz))
          if (b && b.name === 'crafting_table') return b
        } catch {}
      }
    }
  }
  return null
}

// 先按手搓查，查不到且附近有工作台则带台重查
function recipesForWithTable(id) {
  let raw = bot.recipesFor ? (bot.recipesFor(id, null, 1) || []) : []
  if (raw.length === 0) {
    const table = findCraftingTable()
    if (table) raw = bot.recipesFor ? (bot.recipesFor(id, null, 1, table) || []) : []
  }
  return raw
}


/**
 * 查询某物品的可用合成配方（含材料检查）。
 * @returns {{ok:boolean, recipes?:Array, reason?:string}}
 */
export function getRecipes(itemName, count = 1) {
  if (!bot) return { ok: false, reason: '未连接' }
  const id = resolveItemId(itemName)
  if (id == null) return { ok: false, reason: `未知物品: ${itemName}` }
  const raw = recipesForWithTable(id)
  const recipes = raw.map(normalizeRecipe).filter(Boolean)
  if (recipes.length === 0) return { ok: false, reason: `无可用配方: ${itemName}` }
  const inv = bot.inventory.items().map(i => ({ name: i.name, count: i.count }))
  return {
    ok: true,
    recipes: recipes.map(r => {
      const c = canCraft(r, inv, count)
      return { result: r.result, ingredients: ingredientsNeeded(r, count), craftable: c.ok, missing: c.missing }
    })
  }
}

/**
 * 合成物品：按名匹配配方 → 材料检查 → bot.craft。
 * @returns {Promise<{ok:boolean, name?:string, count?:number, reason?:string, missing?:Array}>}
 */
export function craftItem(itemName, count = 1) {
  if (!bot) return Promise.resolve({ ok: false, reason: '未连接' })
  const id = resolveItemId(itemName)
  if (id == null) return Promise.resolve({ ok: false, reason: `未知物品: ${itemName}` })
  const raw = recipesForWithTable(id)
  if (raw.length === 0) return Promise.resolve({ ok: false, reason: `无可用配方: ${itemName}` })
  const norm = raw.map(normalizeRecipe).filter(Boolean)
  const inv = bot.inventory.items().map(i => ({ name: i.name, count: i.count }))
  // 选第一个材料够的配方；都不够则报缺料
  let chosen = null
  let check = null
  let chosenRawIdx = -1
  for (let i = 0; i < norm.length; i++) {
    const c = canCraft(norm[i], inv, count)
    if (c.ok) { chosen = norm[i]; check = c; chosenRawIdx = i; break }
    if (!check) check = c
  }
  if (!chosen) {
    return Promise.resolve({ ok: false, reason: '材料不足', missing: check ? check.missing : [] })
  }
  return bot.craft(raw[chosenRawIdx], count, null)
    .then(() => ({ ok: true, name: chosen.result.name, count: chosen.result.count * count }))
    .catch(err => ({ ok: false, reason: err && err.message ? err.message : String(err) }))
}

// ---------- 装备（P0-2/4 交界）：自动穿上最佳武器与护甲 ----------

export function equipBestGear() {
  if (!bot || !bot.inventory) return { ok: false, reason: '未连接' }
  const items = bot.inventory.items()
  const weapon = pickWeapon(items)
  const armor = pickArmor(items)
  const done = []
  const equipOne = (item, slot) =>
    bot.equip(item, slot === 'off-hand' ? 'off-hand' : slot)
      .then(() => done.push({ name: item && item.name, slot }))
      .catch(() => {})
  const p = []
  if (weapon) {
    const w = items.find(i => i.name === weapon.name)
    if (w) p.push(equipOne(w, 'hand'))
  }
  for (const a of armor) {
    const it = items.find(i => i.name === a.name)
    if (it) p.push(equipOne(it, a.slot))
  }
  return Promise.all(p).then(() => ({ ok: true, equipped: done }))
}

// ---------- 挖掘（P0-3） ----------

import { pickMineTarget, pickBestTool, nextAction } from './mining.mjs'

// 可挖性：非 air/水/岩浆/基岩 即视为可挖（bot.dig 内部会再校验）
const UNDIGGABLE = new Set(['air', 'cave_air', 'void_air', 'water', 'lava', 'bedrock', 'barrier'])
function diggableName(n) { return !UNDIGGABLE.has(n) }

/**
 * 挖掘指定方块（循环：扫描→选最近→走近→换工具→dig）。
 * @returns {Promise<{ok:boolean, dug?:number, reason?:string}>}
 */
export function mineBlock(blockName, count = 1, { timeoutMs = 60000, maxDistance = 24 } = {}) {
  if (!bot || !bot.entity) return Promise.resolve({ ok: false, reason: '未连接' })
  const zhId = blockIdFromZh(blockName)
  const targets = new Set([blockName, zhId, `minecraft:${blockName}`].filter(Boolean).map(s => String(s).toLowerCase()))
  const match = n => targets.has(String(n).toLowerCase())

  const startTime = Date.now()
  let dug = 0

  async function loop() {
    while (dug < count) {
      if (Date.now() - startTime > timeoutMs) return { ok: dug > 0, dug, reason: dug > 0 ? `超时（已挖 ${dug}）` : '超时，未找到可挖目标' }
      // 扫描：以 bot 为中心找目标（findBlocks 的 matching 收 Block 对象、返回 Vec3 数组，勿混淆）
      let found = null
      try {
        const positions = bot.findBlocks ? bot.findBlocks({ matching: (b) => b && match(b.name), maxDistance, count: 32 }) : []
        const candidates = positions.map(p => {
          const blk = bot.blockAt(p)
          return blk ? { name: blk.name, position: p } : null
        }).filter(Boolean)
        found = pickMineTarget(candidates, bot.entity.position, { match, maxDistance, diggable: diggableName })
      } catch (e) {
        return { ok: dug > 0, dug, reason: `扫描失败: ${e.message}` }
      }
      if (!found) return dug > 0 ? { ok: true, dug } : { ok: false, dug: 0, reason: `附近没有可挖的 ${blockName}` }

      const targetPos = found.block.position
      const act = nextAction({
        dx: targetPos.x - bot.entity.position.x,
        dy: targetPos.y - bot.entity.position.y,
        dz: targetPos.z - bot.entity.position.z
      })
      if (act === 'walk') {
        // 走到目标附近（导航到目标上方 1 格，到达后循环重新评估）
        await new Promise((resolve) => {
          let settled = false
          const done = () => { if (!settled) { settled = true; resolve() } }
          const evs = ['goal_reached', 'path_failed', 'move_stopped']
          evs.forEach(ev => bot.once(ev, done))
          setTimeout(done, 15000)
          try { nav.goto(targetPos.x, targetPos.y + 1, targetPos.z) } catch { done() }
        })
        continue
      }
      // 触及距离内：换工具后挖
      const tool = pickBestTool(found.block.name, bot.inventory.items())
      if (tool) {
        const item = bot.inventory.items().find(i => i.name === tool.name)
        if (item) await bot.equip(item, 'hand').catch(() => {})
      }
      try {
        await bot.dig(found.block)
        dug++
        if (onMessageCallback) onMessageCallback('block_dug', { name: found.block.name, count: dug })
      } catch (err) {
        // 单次挖失败：小退避后重扫（可能是方块已消失/不可达）
        await new Promise(r => setTimeout(r, 300))
      }
    }
    return { ok: true, dug }
  }

  return loop()
}

// ---------- 容器存取（P1 背包管理增强）：箱子/木桶存取（对标 MCC 容器交互） ----------

// 容器方块名（与 containers.mjs 的 CONTAINERS 保持一致）
const CONTAINER_NAMES = ['chest', 'trapped_chest', 'barrel']

/**
 * 查找最近的容器方块（箱子/陷阱箱/木桶）。
 * @param {number} radius 搜索半径（格），默认 16
 * @returns {Block|null} 最近容器方块，找不到返回 null
 */
export function findContainerBlock(radius = 16) {
  if (!bot || !bot.findBlocks || !bot.entity) return null
  // findBlocks: matching 收 Block 对象；返回 Vec3 位置数组（无 .name）
  const positions = bot.findBlocks({
    matching: b => b && CONTAINER_NAMES.includes(b.name),
    maxDistance: radius,
    count: 16
  })
  const candidates = positions.map(p => {
    const blk = bot.blockAt(p)
    return blk ? { name: blk.name, position: blk.position } : null
  }).filter(Boolean)
  const found = pickNearestContainer(candidates, bot.entity.position, radius)
  return found ? bot.blockAt(found.block.position) : null
}

/**
 * 把背包物品存入最近的箱子/木桶。
 * @param {string[]} keepNames 保留物品名（不存），默认空（配合 !chest 内置 keep 集合使用）
 * @returns {Promise<{ok:boolean, deposited?:Array<{name:string,count:number}>, reason?:string}>}
 */
export async function depositToChest(keepNames = []) {
  if (!bot || !bot.entity) return { ok: false, reason: '未连接' }
  if (!bot.inventory || bot.inventory.items().length === 0) return { ok: false, reason: '背包是空的' }

  const block = findContainerBlock()
  if (!block) return { ok: false, reason: '附近 16 格内没有箱子/木桶' }

  const plan = planDeposit(
    bot.inventory.items().map(i => ({ name: i.name, count: i.count, slot: i.slot })),
    { keep: new Set(keepNames || []) }
  )
  if (plan.length === 0) return { ok: false, reason: '没有可存的物品（全部在保留名单里）' }

  let chest
  try {
    chest = await bot.openChest(block)
  } catch (err) {
    return { ok: false, reason: `打开容器失败: ${err.message || err}` }
  }

  const deposited = []
  try {
    for (const entry of plan) {
      // 从【背包】找同名物品（可能多格）；每次存入后重新取背包（数量在变）
      let remain = entry.count
      const invSlots = () => bot.inventory.items().filter(i => i.name === entry.name)
      for (const slotItem of invSlots()) {
        if (remain <= 0) break
        const n = Math.min(remain, slotItem.count)
        if (n <= 0) continue
        try {
          await chest.deposit(slotItem.type, slotItem.metadata, n)
          remain -= n
        } catch {
          // 单格失败（如箱子满）则停止该物品的存入
          break
        }
      }
      const moved = entry.count - Math.max(remain, 0)
      if (moved > 0) deposited.push({ name: entry.name, count: moved })
    }
  } finally {
    try { chest.close() } catch {}
  }

  if (deposited.length === 0) return { ok: false, reason: '存入失败（箱子可能已满）' }
  if (onMessageCallback) onMessageCallback('chest_deposit', { items: deposited })
  return { ok: true, deposited }
}

/**
 * 从最近的箱子/木桶取出物品。
 * @param {string} itemName 物品名（中/英文）
 * @param {number} count 数量，默认 1
 * @returns {Promise<{ok:boolean, name?:string, count?:number, reason?:string}>}
 */
export async function withdrawFromChest(itemName, count = 1) {
  if (!bot || !bot.entity) return { ok: false, reason: '未连接' }
  const want = Math.max(1, parseInt(count, 10) || 1)

  const block = findContainerBlock()
  if (!block) return { ok: false, reason: '附近 16 格内没有箱子/木桶' }

  let chest
  try {
    chest = await bot.openChest(block)
  } catch (err) {
    return { ok: false, reason: `打开容器失败: ${err.message || err}` }
  }

  try {
    const plan = planWithdraw(
      chest.items().map(i => ({ name: i.name, count: i.count })),
      itemName,
      want
    )
    if (!plan) return { ok: false, reason: `箱子里没有 ${itemName}` }

    const zhId = blockIdFromZh(itemName)
    const targets = new Set([plan.name, itemName, zhId].filter(Boolean).map(s => String(s).toLowerCase()))
    // 逐格取（箱内同名物品可能多格），凑够 plan.count
    let remain = plan.count
    const takenSlots = chest.items().filter(i => targets.has(String(i.name).toLowerCase()))
    for (const slotItem of takenSlots) {
      if (remain <= 0) break
      const n = Math.min(remain, slotItem.count)
      if (n <= 0) continue
      try {
        await chest.withdraw(slotItem.type, slotItem.metadata, n)
        remain -= n
      } catch {
        // 单格失败（如背包满）则停止取该物品
        break
      }
    }

    const got = plan.count - Math.max(remain, 0)
    if (got <= 0) return { ok: false, reason: `取出失败: ${itemName}` }
    if (got < plan.count && onMessageCallback) {
      onMessageCallback('chest_withdraw_partial', { name: itemName, want: plan.count, got })
    }
    if (onMessageCallback) onMessageCallback('chest_withdraw', { name: itemName, count: got })
    return { ok: true, name: itemName, count: got }
  } finally {
    try { chest.close() } catch {}
  }
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

// ---------- 熔炉烧炼（P1 合成域补全）：燃料/动作决策用 smelt.mjs 纯函数 ----------

import { pickFuel, nextFurnaceAction } from './smelt.mjs'

/**
 * 烧炼物品：找熔炉 → 开炉 → 循环（取产出/补燃料/补原料）直到完成。
 * mineflayer Furnace API：putInput/putFuel 收 (typeId, metadata, count)，槽位 0=料 1=燃 2=出。
 * @returns {Promise<{ok:boolean, smelted:number, reason?:string}>}
 */
export async function smeltItem(itemName, count = 1) {
  if (!bot || !bot.entity) return { ok: false, smelted: 0, reason: '未连接' }
  if (!bot.openFurnace) return { ok: false, smelted: 0, reason: '当前 mineflayer 不支持熔炉 API' }

  const want = Math.max(1, parseInt(count, 10) || 1)
  const zhId = blockIdFromZh(itemName)
  const targets = new Set([itemName, zhId, `minecraft:${itemName}`].filter(Boolean).map(s => String(s).toLowerCase()))
  const findRaw = () => bot.inventory.items().find(i => targets.has(String(i.name).toLowerCase()))
  if (!findRaw()) return { ok: false, smelted: 0, reason: `背包里没有原料: ${itemName}` }

  // findBlocks: matching 收 Block、返回 Vec3 数组
  let furnaceBlock = null
  try {
    const positions = bot.findBlocks({ matching: b => b && b.name === 'furnace', maxDistance: 16, count: 1 })
    if (positions.length > 0) furnaceBlock = bot.blockAt(positions[0])
  } catch { /* 下面统一报 */ }
  if (!furnaceBlock) return { ok: false, smelted: 0, reason: '附近 16 格内没有熔炉' }

  let f
  try {
    f = await bot.openFurnace(furnaceBlock)
  } catch (err) {
    return { ok: false, smelted: 0, reason: `打开熔炉失败: ${err.message || err}` }
  }

  let smelted = 0
  const deadline = Date.now() + 30000 + want * 15000
  try {
    while (smelted < want && Date.now() < deadline) {
      const state = {
        outputOccupied: !!f.outputItem(),
        needsFuel: !f.fuelItem(),
        inputEmpty: !f.inputItem()
      }
      const act = nextFurnaceAction(state)
      if (act === 'take_output') {
        const out = f.outputItem()
        await f.takeOutput()
        smelted += out ? out.count : 1
        if (onMessageCallback) onMessageCallback('smelt_progress', { name: itemName, total: smelted, want })
        continue
      }
      if (act === 'add_fuel') {
        const inv = bot.inventory.items().map(i => ({ name: i.name, count: i.count }))
        const pick = pickFuel(inv)
        if (!pick) return { ok: smelted > 0, smelted, reason: '没有燃料（煤/木板/木棍）' }
        const fuelItem = bot.inventory.items().find(i => i.name === pick.name)
        await f.putFuel(fuelItem.type, fuelItem.metadata, 1)
        continue
      }
      if (act === 'fill_input') {
        const raw = findRaw()
        if (!raw) return smelted > 0 ? { ok: true, smelted } : { ok: false, smelted: 0, reason: `原料不足: ${itemName}` }
        await f.putInput(raw.type, raw.metadata, Math.min(1, want - smelted))
        continue
      }
      await new Promise(r => setTimeout(r, 1000)) // wait：烧炼中
    }
    if (smelted >= want) return { ok: true, smelted }
    return { ok: smelted > 0, smelted, reason: smelted > 0 ? `超时（已烧 ${smelted}/${want}）` : '超时，未完成任何一轮烧炼' }
  } catch (err) {
    return { ok: smelted > 0, smelted, reason: err.message || '烧炼出错' }
  } finally {
    try { f.close() } catch { /* 已关则忽略 */ }
  }
}

// ---------- 村民交易（P1，对标 MCC 交易）：选单/可支付判定用 trade.mjs 纯函数 ----------

import { formatTrades, canAfford, pickBestTrade } from './trade.mjs'

// 找最近的村民实体（可指定用户名下的职业村民不可控，这里按 name==='villager'）
function findNearestVillager(radius = 16) {
  if (!bot || !bot.entity) return null
  let best = null
  let bestD = Infinity
  for (const e of Object.values(bot.entities || {})) {
    if (!e || e.name !== 'villager' || !e.position) continue
    const d = e.position.distanceTo(bot.entity.position)
    if (d < bestD && d <= radius) { bestD = d; best = e }
  }
  return best
}

// 走近村民（交易需实体可达）；已在触及距离内直接返回
async function approachForTrade(villager, reach = 3.2, timeoutMs = 15000) {
  if (!bot || !bot.entity || !villager) return false
  if (villager.position.distanceTo(bot.entity.position) <= reach) return true
  if (!nav) return false
  await new Promise((resolve) => {
    let settled = false
    const done = () => { if (!settled) { settled = true; resolve() } }
    ;['goal_reached', 'path_failed', 'move_stopped'].forEach(ev => bot.once(ev, done))
    setTimeout(done, timeoutMs)
    try { nav.goto(villager.position.x, villager.position.y, villager.position.z) } catch { done() }
  })
  return villager.position.distanceTo(bot.entity.position) <= reach + 1
}

/**
 * 列出最近村民的交易清单（归一化，含售罄标记）。
 * @returns {Promise<{ok:boolean, villager?:string, trades?:Array, reason?:string}>}
 */
export async function listTrades() {
  if (!bot || !bot.entity) return { ok: false, reason: '未连接' }
  if (!bot.openVillager) return { ok: false, reason: '当前 mineflayer 不支持村民交易 API' }
  const villager = findNearestVillager()
  if (!villager) return { ok: false, reason: '附近 16 格内没有村民' }
  if (!(await approachForTrade(villager))) return { ok: false, reason: '无法走近村民' }
  let v
  try {
    v = await bot.openVillager(villager)
  } catch (err) {
    return { ok: false, reason: `打开交易失败: ${err.message || err}` }
  }
  try {
    return { ok: true, villager: `villager#${villager.id}`, trades: formatTrades(v.trades) }
  } finally {
    try { v.close() } catch { /* 已关则忽略 */ }
  }
}

/**
 * 与最近村民交易：开市 → 选最佳可支付且未售罄的同名产物交易 → 下单。
 * @returns {Promise<{ok:boolean, output?:string, count?:number, price?:number, reason?:string, missing?:Array}>}
 */
export async function tradeWith(wantItemName, count = 1) {
  if (!bot || !bot.entity) return { ok: false, reason: '未连接' }
  if (!bot.openVillager) return { ok: false, reason: '当前 mineflayer 不支持村民交易 API' }
  const want = Math.max(1, parseInt(count, 10) || 1)
  const zhId = blockIdFromZh(wantItemName)
  const villager = findNearestVillager()
  if (!villager) return { ok: false, reason: '附近 16 格内没有村民' }
  if (!(await approachForTrade(villager))) return { ok: false, reason: '无法走近村民' }

  let v
  try {
    v = await bot.openVillager(villager)
  } catch (err) {
    return { ok: false, reason: `打开交易失败: ${err.message || err}` }
  }

  try {
    const inv = bot.inventory.items().map(i => ({ name: i.name, count: i.count }))
    // 支持英文名或中文名
    const pick = pickBestTrade(v.trades, wantItemName, inv, { count: want })
      || (zhId ? pickBestTrade(v.trades, zhId, inv, { count: want }) : null)
    if (!pick) {
      const names = [...new Set(formatTrades(v.trades).map(t => t.output.name))]
      return { ok: false, reason: `该村民没有可支付的「${wantItemName}」交易；可换：${names.slice(0, 8).join(', ') || '无'}` }
    }
    const afford = canAfford(pick.trade, inv, want)
    if (!afford.ok) return { ok: false, reason: '材料不足', missing: afford.missing }
    await v.trade(pick.index, want)
    const per = pick.formatted.output.count || 1
    if (onMessageCallback) onMessageCallback('traded', { name: pick.formatted.output.name, count: per * want, price: pick.formatted.cost1.count * want, costName: pick.formatted.cost1.name })
    return { ok: true, output: pick.formatted.output.name, count: per * want, price: pick.formatted.cost1.count * want, costName: pick.formatted.cost1.name }
  } catch (err) {
    return { ok: false, reason: err.message || '交易失败' }
  } finally {
    try { v.close() } catch { /* 已关则忽略 */ }
  }
}

// ---------- 建造蓝图（P0-3 建造侧） ----------

import { generateBlueprint, checkBlueprint } from './build.mjs'

/**
 * 按蓝图模板批量放置方块。
 * 顺序策略：从低到高（y↑），同层从远到近（离 bot 近的延后，避免自己站进未成形的结构里）。
 * @returns {Promise<{ok:boolean, placed:number, skipped:number, total:number, reason?:string}>}
 */
export async function buildBlueprint(type, blockName, from, to) {
  if (!bot || !bot.entity) return { ok: false, placed: 0, skipped: 0, total: 0, reason: '未连接' }
  const cells = generateBlueprint(type, from, to)
  const check = checkBlueprint(cells)
  if (!check.ok) return { ok: false, placed: 0, skipped: 0, total: cells.length, reason: check.reason }

  const bp = bot.entity.position
  cells.sort((a, b) => (a.y - b.y) || (Math.hypot(b.x - bp.x, b.z - bp.z) - Math.hypot(a.x - bp.x, a.z - bp.z)))

  let placed = 0
  let skipped = 0
  for (const c of cells) {
    if (!bot || !bot.entity) return { ok: false, placed, skipped, total: cells.length, reason: '连接中断' }
    // 目标格已有方块则跳过（蓝图重复/世界已有结构）
    const existing = bot.blockAt(vec3(c.x, c.y, c.z))
    if (existing && existing.name !== 'air' && existing.name !== 'water' && existing.name !== 'lava') {
      skipped++
      continue
    }
    try {
      await placeBlock(blockName, c.x, c.y, c.z)
      placed++
    } catch {
      skipped++ // 无支撑面/物品不足：跳过该格继续
    }
  }
  if (onMessageCallback) onMessageCallback('build_done', { type, placed, skipped, total: cells.length })
  return { ok: placed > 0, placed, skipped, total: cells.length, reason: placed > 0 ? undefined : '全部放置失败（物品不足或无支撑面）' }
}

// ---------- 背包主动整理（对标 MCC 一键整理）：合并规划用 inventory.mjs 纯函数 ----------

import { planStackMerge, countFragments } from './inventory.mjs'

/**
 * 一键整理：反复调用 planStackMerge 规划并逐步执行 moveSlotItem（每步重算，容忍单次失败）。
 * 仅整理主背包（items() 返回的槽位），不开任何窗口、不碰装备/副手。
 * @param {{maxMoves?:number}} o
 * @returns {Promise<{ok:boolean, moves:number, fragmentsBefore:number, reason?:string}>}
 */
export async function tidyInventory({ maxMoves = 80 } = {}) {
  if (!bot || !bot.inventory) return { ok: false, moves: 0, fragmentsBefore: 0, reason: '未连接' }
  if (!bot.moveSlotItem) return { ok: false, moves: 0, fragmentsBefore: 0, reason: '当前 mineflayer 不支持 moveSlotItem' }
  const snapshot = () => bot.inventory.items().map(i => ({ slot: i.slot, name: i.name, count: i.count, stackSize: i.stackSize }))
  const before = snapshot()
  const fragmentsBefore = countFragments(before)
  if (fragmentsBefore === 0) return { ok: true, moves: 0, fragmentsBefore: 0 }

  let moves = 0
  try {
    while (moves < maxMoves) {
      const { moves: plan } = planStackMerge(snapshot())
      if (plan.length === 0) break
      const m = plan[0]
      await bot.moveSlotItem(m.from, m.to)
      moves++
      await new Promise(r => setTimeout(r, 50)) // 让服务器同步槽位，避免连续点击错乱
    }
  } catch (err) {
    return { ok: moves > 0, moves, fragmentsBefore, reason: err.message || '整理中断' }
  }
  return { ok: true, moves, fragmentsBefore }
}

function findNearestHostile(maxDistance = 32) {  let nearest = null
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
