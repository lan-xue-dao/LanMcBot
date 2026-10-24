import { expect } from 'chai'
import {
  createDeathHandler,
  shouldReconnect
} from '../lib/lifecycle.mjs'

describe('lifecycle: shouldReconnect', () => {
  it('故意退出不重连', () => {
    expect(shouldReconnect({ intentionalQuit: true, attempts: 0, max: 3 })).to.equal(false)
  })

  it('次数用尽不重连', () => {
    expect(shouldReconnect({ intentionalQuit: false, attempts: 3, max: 3 })).to.equal(false)
  })

  it('次数内且非故意应重连', () => {
    expect(shouldReconnect({ intentionalQuit: false, attempts: 0, max: 3 })).to.equal(true)
  })
})

describe('lifecycle: createDeathHandler', () => {
  it('死亡后立即发起一次重生', () => {
    let respawnCalls = 0
    let dead = true
    const events = []
    const h = createDeathHandler({
      onMessage: (t) => events.push(t),
      respawn: () => { respawnCalls++ },
      isDead: () => dead,
      scheduleRetry: (fn, ms) => setTimeout(fn, ms),
      maxAttempts: 3,
      retryMs: 1000
    })
    h.onDeath()
    expect(events).to.include('death')
    expect(respawnCalls).to.equal(1)
    h.cancel()
  })

  it('重生成功后取消后续重试', () => {
    let respawnCalls = 0
    let dead = true
    const events = []
    const queue = [] // 确定性 fake-timer：scheduleRetry 入队，测试同步 drain（避免真实 setTimeout 在套件并发下 flaky）
    const h = createDeathHandler({
      onMessage: (t) => events.push(t),
      respawn: () => {
        respawnCalls++
        dead = false // 复活了
      },
      isDead: () => dead,
      scheduleRetry: (fn) => { queue.push(fn); return queue.length },
      maxAttempts: 3,
      retryMs: 5
    })
    h.onDeath()
    expect(respawnCalls).to.equal(1)
    while (queue.length) queue.shift()()
    // 重试触发时 isDead()===false → 不应再 respawn
    expect(respawnCalls).to.equal(1)
    expect(events).to.not.include('respawn_failed')
    h.cancel()
  })

  it('持续死亡时按上限重试并发 respawn_failed', () => {
    let respawnCalls = 0
    let dead = true
    const events = []
    const queue = [] // 确定性 fake-timer（同上）
    const h = createDeathHandler({
      onMessage: (t) => events.push(t),
      respawn: () => { respawnCalls++ },
      isDead: () => dead,
      scheduleRetry: (fn) => { queue.push(fn); return queue.length },
      maxAttempts: 3,
      retryMs: 5
    })
    h.onDeath()
    while (queue.length) queue.shift()()
    // 死亡(1) + 重试2次 = 共3次 respawn，然后 respawn_failed
    expect(respawnCalls).to.equal(3)
    expect(events).to.include('respawn_failed')
  })

  it('onDeathHook 在死亡瞬间被调用', () => {
    let hookCalled = false
    const h = createDeathHandler({
      onMessage: () => {},
      respawn: () => {},
      isDead: () => true,
      scheduleRetry: (fn, ms) => setTimeout(fn, ms),
      onDeathHook: () => { hookCalled = true },
      maxAttempts: 3,
      retryMs: 5
    })
    h.onDeath()
    expect(hookCalled).to.equal(true)
    h.cancel()
  })
})
