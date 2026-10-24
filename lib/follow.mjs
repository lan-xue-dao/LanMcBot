// 跟随能力域（对标 MCC 跟班行为）：纯函数决策 + 注入式 controller（零 bot 依赖，可单测）。
//
// 设计原则（与 combat/survival 一致）：
//   1) 选人/距离决策写成无 bot 依赖纯函数；
//   2) controller 通过注入工作，真实寻路由调用方提供（复用自研 nav，不引 pathfinder）；
//   3) 默认关闭，由 !follow 显式开启；
//   4) 与 combat 协调：当外部 busy（战斗正持有控制权）时，跟随不写 nav，保持控制状态单写者。

/**
 * 纯函数：按玩家名在实体表里找目标玩家。
 * @param {object} entities mineflayer bot.entities（{id: entity}）
 * @param {string} name 玩家名（大小写不敏感）
 * @returns {object|null} 实体或 null
 */
export function findPlayerByName(entities, name) {
  if (!name) return null
  const want = String(name).trim().toLowerCase()
  for (const e of Object.values(entities || {})) {
    if (!e) continue
    const uname = e.username
    if (uname && String(uname).trim().toLowerCase() === want) return e
  }
  return null
}

/**
 * 纯函数：跟随距离决策。
 * @param {{distance:number, minDist?:number, maxDist?:number}} s
 * @returns {'approach'|'hold'|'idle'} approach=太远远距离跟随；hold=在理想带内保持；idle=过近或无需动
 */
export function decideFollow({ distance, minDist = 3, maxDist = 5 }) {
  if (!Number.isFinite(distance)) return 'idle'
  if (distance > maxDist) return 'approach'
  if (distance < minDist) return 'idle'   // 太近：停，避免贴脸撞人
  return 'hold'
}

/**
 * 跟随控制器：注入式，不依赖 setInterval（测试可手动 step）。
 * @param {object} deps
 * @param {()=>(object|null)} deps.getBot 取当前 bot（断线返回 null 即自动停）
 * @param {(entity:object)=>void} deps.onApproach 靠近动作（一般 nav.goto 到玩家附近）
 * @param {(type:string,payload?:any)=>void} [deps.onMessage] 事件回调
 * @param {()=>boolean} [deps.isBusy] 返回 true 时跳过本 tick（如战斗正持有控制权）
 * @param {string} [deps.name] 目标玩家名
 * @param {number} [deps.maxDist] 触发跟随的距离阈值（默认 5）
 * @param {number} [deps.minDist] 停止跟随的近距阈值（默认 3）
 * @param {number} [deps.tickMs] 自动 tick 间隔（默认 700）
 */
export function createFollowController({
  getBot,
  onApproach,
  onMessage,
  isBusy,
  name = '',
  maxDist = 5,
  minDist = 3,
  tickMs = 700
}) {
  let enabled = false
  let timer = null
  let target = name

  function step() {
    const bot = getBot ? getBot() : null
    if (!bot || !enabled || !bot.entity || !bot.entity.position) return
    if (isBusy && isBusy()) return // 让出控制权给战斗等占用者
    const ent = findPlayerByName(bot.entities, target)
    if (!ent) {
      if (onMessage) onMessage('follow_lost', { name: target })
      return
    }
    const d = ent.position.distanceTo(bot.entity.position)
    const act = decideFollow({ distance: d, minDist, maxDist })
    if (act === 'approach') {
      if (onMessage) onMessage('follow_move', { name: target, distance: Math.round(d * 10) / 10 })
      if (onApproach) onApproach(ent)
    }
  }

  function start(who) {
    if (who) target = who
    if (!target) return false
    if (!enabled) {
      enabled = true
      if (onMessage) onMessage('follow_started', { name: target })
      timer = setInterval(step, tickMs)
    }
    return true
  }

  function stop() {
    if (!enabled) return
    enabled = false
    if (timer) { clearInterval(timer); timer = null }
    if (onMessage) onMessage('follow_stopped', { name: target })
  }

  return {
    start,
    stop,
    step,
    setTarget: (who) => { if (who) target = who },
    getTarget: () => target,
    isEnabled: () => enabled
  }
}
