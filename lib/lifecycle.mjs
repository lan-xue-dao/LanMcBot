// 生命周期辅助（可单测纯逻辑）：玩家死亡自动重生。
//
// mineflayer 的 bot 死亡后停在「你死了」界面，必须主动调 bot.respawn() 才会复活。
// 本模块把「死亡 → 自动重生（带重试与上限）」抽成可注入依赖的纯函数，
// 避免直接依赖真实 bot 实例，从而能用假 bot 做单元测试。

const DEFAULT_MAX_ATTEMPTS = 3
const DEFAULT_RETRY_MS = 1000

/**
 * 创建一个死亡处理器。
 * @param {object} deps
 * @param {(type:string, payload?:any)=>void} deps.onMessage 事件回调（death / respawn_failed / respawn_error）
 * @param {()=>void} deps.respawn 发起重生（一般 () => bot.respawn()）
 * @param {()=>boolean} deps.isDead 是否仍处死亡态（一般 () => bot.health <= 0）
 * @param {(fn:Function, ms:number)=>any} deps.scheduleRetry 延时调度（一般 setTimeout，返回 timer 供 cancel）
 * @param {()=>void} [deps.onDeathHook] 死亡瞬间钩子（如清掉残留移动控制）
 * @param {number} [deps.maxAttempts] 最大重生尝试次数（默认 3）
 * @param {number} [deps.retryMs] 每次尝试间隔（默认 1000ms）
 * @returns {{ onDeath: ()=>void, cancel: ()=>void }} 死亡回调 + 取消（复活成功时调用）
 */
export function createDeathHandler({
  onMessage,
  respawn,
  isDead,
  scheduleRetry,
  onDeathHook,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  retryMs = DEFAULT_RETRY_MS,
}) {
  let attempts = 0
  let active = true
  let timer = null

  function stop() {
    active = false
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  function attempt() {
    if (!active) return
    if (!isDead()) {
      // 已复活（spawn 会清状态），取消挂起重试
      stop()
      return
    }
    attempts++
    if (attempts > maxAttempts) {
      stop()
      if (onMessage) onMessage('respawn_failed', { attempts })
      return
    }
    try {
      respawn()
    } catch (err) {
      if (onMessage) onMessage('respawn_error', { err: String(err) })
    }
    // 若未在 retryMs 内复活，再试
    timer = scheduleRetry(attempt, retryMs)
  }

  function onDeath() {
    if (!active) return
    if (onDeathHook) {
      try {
        onDeathHook()
      } catch {
        // 钩子失败不应阻断重生
      }
    }
    if (onMessage) onMessage('death', {})
    attempt()
  }

  return { onDeath, cancel: stop }
}

/**
 * 纯函数：判断断开后是否应触发自动重连。
 * @param {{intentionalQuit:boolean, attempts:number, max:number}} s
 * @returns {boolean}
 */
export function shouldReconnect({ intentionalQuit, attempts, max }) {
  if (intentionalQuit) return false
  if (attempts >= max) return false
  return true
}
