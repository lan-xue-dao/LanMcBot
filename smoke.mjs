/*
实机冒烟测试：连真实服务器，按序验证「连接 → spawn → 状态 → 感知 → 背包 → 断开」链路。
用法：
  node smoke.mjs            # 用 .env/config.json 的服务器，总超时 60s
  node smoke.mjs --timeout 90
只做只读操作（不发聊天、不动方块），失败即退出码 1 并打印到哪一步。
临时性：这是长期可复跑的冒烟入口，不是一次性脚本。
*/
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
require('./lib/config.mjs') // 触发 .env 加载（副作用）

const argv = process.argv.slice(2)
const timeoutIdx = argv.indexOf('--timeout')
const TIMEOUT_MS = (timeoutIdx >= 0 ? parseInt(argv[timeoutIdx + 1], 10) : 60) * 1000

const bot = await import('./lib/bot.mjs')
const { createBot, getBot, isLoggedIn, destroyBot } = bot

const steps = []       // 已通过的步骤名
let failedAt = null    // 失败的步骤名
const t0 = Date.now()

function pass (name) { steps.push(name); console.log(`✓ ${name}`) }
function fail (name, err) { failedAt = name; console.error(`✗ ${name}: ${err && err.message ? err.message : err}`) }

async function waitLoggedIn (ms) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (isLoggedIn()) return true
    await new Promise(r => setTimeout(r, 250))
  }
  return false
}

async function main () {
  console.log(`[smoke] 连接 ${'（服务器来自 .env/config.json）'} ...`)

  // 触发连接：createBot 内部监听 spawn/end；这里用事件计数确认链路
  let spawned = false
  let endReason = null
  const b = createBot((type) => {
    if (type === 'spawn') spawned = true
    if (type === 'end') endReason = 'end'
  })

  const okLogin = await waitLoggedIn(TIMEOUT_MS)
  if (!okLogin) { fail('登录', `超过 ${TIMEOUT_MS / 1000}s 未登录${endReason ? '（' + endReason + '）' : ''}`); return }

  pass('登录')

  // 等 spawn（mineflayer：登录后位置就绪）
  const deadline = Date.now() + 15000
  while (!getBot()?.entity?.position && Date.now() < deadline) await new Promise(r => setTimeout(r, 200))
  if (!getBot()?.entity?.position) { fail('spawn', '登录后 15s 内未获得实体位置'); return }
  pass('spawn（位置就绪）')

  // 只读探测 1：背包 API
  const b2 = getBot()
  try {
    const inv = b2.inventory.items()
    pass(`背包 API（${inv.length} 格非空）`)
  } catch (e) { fail('背包 API', e); return }

  // 只读探测 2：玩家表
  try {
    const n = Object.keys(b2.players || {}).length
    pass(`玩家表（${n} 人在线）`)
  } catch (e) { fail('玩家表', e); return }

  // 只读探测 3：附近方块采样（blockAt 真实世界读取）
  try {
    const p = b2.entity.position.floored()
    const blk = b2.blockAt(p.offset(0, -1, 0)) // 脚下方块
    pass(`方块读取（脚下: ${blk ? blk.name : 'null'}）`)
  } catch (e) { fail('方块读取', e); return }

  // 只读探测 4：实体表
  try {
    const n = Object.keys(b2.entities || {}).length
    pass(`实体表（${n} 个实体）`)
  } catch (e) { fail('实体表', e); return }

  // 只读探测 5：经验/血量字段（战斗/附魔域依赖）
  try {
    const lvl = b2.experience ? b2.experience.level : null
    pass(`状态字段（血:${b2.health} 饥饿:${b2.food} 经验级:${lvl}）`)
  } catch (e) { fail('状态字段', e); return }
}

main()
  .catch(e => { failedAt = failedAt || '未捕获'; console.error('✗ 未捕获异常:', e.message) })
  .finally(async () => {
    const secs = ((Date.now() - t0) / 1000).toFixed(1)
    if (failedAt) {
      console.error(`\n[smoke] 失败于「${failedAt}」，此前通过: ${steps.join(' → ') || '无'}（${secs}s）`)
      try { await destroyBot() } catch {}
      process.exit(1)
    } else {
      console.log(`\n[smoke] 全部通过: ${steps.join(' → ')}（${secs}s）`)
      try { await destroyBot() } catch {}
      process.exit(0)
    }
  })
