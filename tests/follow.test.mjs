import { expect } from 'chai'
import { findPlayerByName, decideFollow, createFollowController } from '../lib/follow.mjs'
import { setFollow, stopFollow, getFollowTarget, isFollowEnabled, findFollowPlayer } from '../lib/bot.mjs'

function pos(x, y, z) {
  return { x, y, z, distanceTo(p) { return Math.hypot(this.x - p.x, this.y - p.y, this.z - p.z) } }
}

// start() 会开真实 setInterval(tick, 700)。若某个用例断言失败就没走到 ctrl.stop()，
// 残留的定时器会挤占计时器堆，把同批次里靠 setTimeout 断言的用例（如 lifecycle）饿到超时——
// 曾经就是这样让「持续死亡时按上限重试」在整套跑里稳定失败。统一在 afterEach 兜底清掉。
const liveControllers = []
function makeController(deps) {
  const ctrl = createFollowController(deps)
  liveControllers.push(ctrl)
  return ctrl
}
afterEach(() => {
  while (liveControllers.length) {
    try { liveControllers.pop().stop() } catch { /* 清理失败不影响其他用例 */ }
  }
})

describe('follow: findPlayerByName', () => {
  const entities = {
    1: { id: 1, name: 'player', username: 'Steve', position: pos(5, 0, 0) },
    2: { id: 2, name: 'zombie', position: pos(1, 0, 0) },
    3: { id: 3, name: 'player', username: 'Alex', position: pos(9, 0, 0) }
  }
  it('按名找到玩家实体', () => {
    expect(findPlayerByName(entities, 'Steve').id).to.equal(1)
  })
  it('大小写不敏感', () => {
    expect(findPlayerByName(entities, 'ALEX').id).to.equal(3)
  })
  it('找不到返回 null', () => {
    expect(findPlayerByName(entities, 'Herobrine')).to.equal(null)
    expect(findPlayerByName(entities, '')).to.equal(null)
    expect(findPlayerByName(null, 'Steve')).to.equal(null)
  })
  it('不会匹配到 mobs（无 username）', () => {
    expect(findPlayerByName(entities, 'zombie')).to.equal(null)
  })
})

describe('follow: decideFollow', () => {
  it('超出 maxDist 要接近', () => {
    expect(decideFollow({ distance: 9 })).to.equal('approach')
  })
  it('理想带内保持', () => {
    expect(decideFollow({ distance: 4 })).to.equal('hold')
  })
  it('太近不动', () => {
    expect(decideFollow({ distance: 1 })).to.equal('idle')
  })
  it('无效距离 idle', () => {
    expect(decideFollow({ distance: NaN })).to.equal('idle')
  })
})

describe('follow: createFollowController', () => {
  it('manual step：远距离触发 follow_move 与 onApproach', () => {
    const events = []
    const approached = []
    const bot = {
      entity: { position: pos(0, 0, 0) },
      entities: { 1: { id: 1, name: 'player', username: 'Steve', position: pos(9, 0, 0) } }
    }
    const ctrl = makeController({
      getBot: () => bot,
      onApproach: (e) => approached.push(e.username),
      onMessage: (t) => events.push(t),
      name: 'Steve',
      tickMs: 700
    })
    expect(ctrl.start()).to.equal(true)
    ctrl.step()
    expect(events).to.include('follow_started')
    expect(events).to.include('follow_move')
    expect(approached).to.deep.equal(['Steve'])
    ctrl.stop()
    expect(ctrl.isEnabled()).to.equal(false)
    expect(events).to.include('follow_stopped')
  })

  it('isBusy 时跳过（让出控制权给战斗）', () => {
    const events = []
    const bot = {
      entity: { position: pos(0, 0, 0) },
      entities: { 1: { id: 1, name: 'player', username: 'Steve', position: pos(9, 0, 0) } }
    }
    let busy = true
    const ctrl = makeController({
      getBot: () => bot,
      onApproach: () => events.push('approach'),
      onMessage: (t) => events.push(t),
      isBusy: () => busy,
      name: 'Steve'
    })
    ctrl.start()
    ctrl.step()
    expect(events).to.not.include('approach') // busy 时不动
    busy = false
    ctrl.step()
    expect(events).to.include('approach') // 空闲后恢复跟随
    ctrl.stop()
  })

  it('目标不在线发 follow_lost', () => {
    const events = []
    const bot = { entity: { position: pos(0, 0, 0) }, entities: {} }
    const ctrl = makeController({
      getBot: () => bot,
      onApproach: () => {},
      onMessage: (t) => events.push(t),
      name: 'Ghost'
    })
    ctrl.start()
    ctrl.step()
    expect(events).to.include('follow_lost')
    ctrl.stop()
  })

  it('无目标名时 start 失败', () => {
    const ctrl = makeController({ getBot: () => null, onApproach: () => {} })
    expect(ctrl.start()).to.equal(false)
    expect(ctrl.isEnabled()).to.equal(false)
  })

  it('hold 距离（理想带内）不触发移动', () => {
    const events = []
    const bot = {
      entity: { position: pos(0, 0, 0) },
      entities: { 1: { id: 1, name: 'player', username: 'Steve', position: pos(4, 0, 0) } }
    }
    const ctrl = makeController({
      getBot: () => bot,
      onApproach: () => events.push('approach'),
      onMessage: (t) => events.push(t),
      name: 'Steve'
    })
    ctrl.start()
    ctrl.step()
    expect(events).to.not.include('approach')
    expect(events).to.not.include('follow_move')
    ctrl.stop()
  })

  it('setTarget 可换跟随对象', () => {
    const events = []
    const bot = {
      entity: { position: pos(0, 0, 0) },
      entities: {
        1: { id: 1, name: 'player', username: 'Steve', position: pos(9, 0, 0) },
        2: { id: 2, name: 'player', username: 'Alex', position: pos(8, 0, 0) }
      }
    }
    const ctrl = makeController({
      getBot: () => bot,
      onApproach: (e) => events.push(e.username),
      name: 'Steve'
    })
    ctrl.start()
    ctrl.step()
    expect(events).to.deep.equal(['Steve'])
    ctrl.setTarget('Alex')
    expect(ctrl.getTarget()).to.equal('Alex')
    ctrl.step()
    expect(events).to.deep.equal(['Steve', 'Alex'])
    ctrl.stop()
  })

  it('bot 消失（断线）时 step 静默跳过', () => {
    const events = []
    let cur = { entity: { position: pos(0, 0, 0) }, entities: {} }
    const ctrl = makeController({
      getBot: () => cur,
      onApproach: () => events.push('approach'),
      onMessage: (t) => events.push(t),
      name: 'Ghost'
    })
    ctrl.start()
    cur = null
    ctrl.step()
    expect(events).to.not.include('approach')
    expect(events).to.not.include('follow_lost')
    ctrl.stop()
  })

  it('重复 start 不再发 follow_started', () => {
    const events = []
    const ctrl = makeController({
      getBot: () => null,
      onApproach: () => {},
      onMessage: (t) => events.push(t),
      name: 'Steve'
    })
    expect(ctrl.start()).to.equal(true)
    expect(ctrl.start()).to.equal(true)
    expect(events.filter(e => e === 'follow_started')).to.have.lengthOf(1)
    ctrl.stop()
  })
})

// bot.mjs 的对外接口：未连接（createBot 未调用，followController 为 null）必须安全返回，
// 既不抛错也不能开启定时器——这些是 !follow / MCP follow_player 的第一道防线。
describe('follow: bot.mjs 导出（未连接安全失败）', () => {
  it('未连接时 setFollow 返回 false', () => {
    expect(setFollow('Steve')).to.equal(false)
    expect(isFollowEnabled()).to.equal(false)
  })
  it('空名/非字符串不查实体，直接 false', () => {
    expect(setFollow('')).to.equal(false)
    expect(setFollow('   ')).to.equal(false)
    expect(setFollow(null)).to.equal(false)
    expect(setFollow(undefined)).to.equal(false)
  })
  it('未连接时 findFollowPlayer 返回 null', () => {
    expect(findFollowPlayer('Steve')).to.equal(null)
    expect(findFollowPlayer('')).to.equal(null)
  })
  it('未连接时 stopFollow 返回 false、getFollowTarget 为空串', () => {
    expect(stopFollow()).to.equal(false)
    expect(getFollowTarget()).to.equal('')
  })
})
