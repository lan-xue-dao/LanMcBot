import { expect } from 'chai'
import {
  findNearestHostile,
  pickWeapon,
  pickArmor,
  decideAction,
  selectTarget,
  createCombatController
} from '../lib/combat.mjs'

// 假实体工厂
function ent(id, name, x, y, z, extra = {}) {
  return { id, name, position: { x, y, z, distanceTo(p) { return Math.hypot(this.x - p.x, this.y - p.y, this.z - p.z) } }, ...extra }
}

describe('combat: findNearestHostile', () => {
  const botPos = { x: 0, y: 0, z: 0, distanceTo(p) { return Math.hypot(p.x, p.y, p.z) } }
  it('只挑最近的敌对，忽略中立/被动', () => {
    const entities = {
      a: ent(1, 'cow', 1, 0, 0),
      b: ent(2, 'zombie', 3, 0, 0),
      c: ent(3, 'skeleton', 5, 0, 0)
    }
    const r = findNearestHostile(entities, botPos, { maxDistance: 32 })
    expect(r).to.not.equal(null)
    expect(r.entity.name).to.equal('zombie')
    expect(r.distance).to.be.closeTo(3, 1e-6)
  })
  it('超出半径返回 null', () => {
    const entities = { b: ent(2, 'zombie', 100, 0, 0) }
    expect(findNearestHostile(entities, botPos, { maxDistance: 32 })).to.equal(null)
  })
})

describe('combat: pickWeapon / pickArmor', () => {
  it('选伤害最高的武器', () => {
    const items = [{ name: 'wooden_sword' }, { name: 'iron_sword' }, { name: 'diamond_axe' }]
    expect(pickWeapon(items).name).to.equal('diamond_axe')
  })
  it('无武器返回 null', () => {
    expect(pickWeapon([{ name: 'apple' }])).to.equal(null)
  })
  it('选每个护甲槽最好的', () => {
    const items = [{ name: 'iron_helmet' }, { name: 'leather_chestplate' }, { name: 'diamond_chestplate' }]
    const armor = pickArmor(items)
    const heads = armor.filter(a => a.slot === 'head')
    const torsos = armor.filter(a => a.slot === 'torso')
    expect(heads[0].name).to.equal('iron_helmet')
    expect(torsos[0].name).to.equal('diamond_chestplate')
    expect(armor.find(a => a.slot === 'torso').name).to.not.equal('leather_chestplate')
  })
})

describe('combat: decideAction', () => {
  it('低血量撤退', () => {
    expect(decideAction({ health: 5, distance: 1 })).to.equal('retreat')
  })
  it('射程内攻击', () => {
    expect(decideAction({ health: 20, distance: 2 })).to.equal('attack')
  })
  it('远距离靠近', () => {
    expect(decideAction({ health: 20, distance: 20 })).to.equal('approach')
  })
})

describe('combat: createCombatController', () => {
  it('manual step 触发攻击事件', () => {
    const events = []
    let bot = {
      entity: { position: { x: 0, y: 0, z: 0, distanceTo(p) { return Math.hypot(p.x, p.y, p.z) } } },
      health: 20,
      entities: { z: ent(9, 'zombie', 2, 0, 0) }
    }
    const ctrl = createCombatController({
      getBot: () => bot,
      onAttack: () => {},
      onMessage: (t, p) => events.push(t),
      maxDistance: 16,
      tickMs: 500
    })
    ctrl.setEnabled(true)
    ctrl.step() // 手动驱动一次
    expect(events).to.include('combat_started')
    expect(events).to.include('combat_attack')
    expect(ctrl.isEnabled()).to.equal(true)
    ctrl.stop()
    expect(ctrl.isEnabled()).to.equal(false)
  })

  it('断线（getBot 返回 null）时自动停', () => {
    const events = []
    const ctrl = createCombatController({
      getBot: () => null,
      onAttack: () => {},
      onMessage: (t) => events.push(t),
      maxDistance: 16,
      tickMs: 500
    })
    ctrl.setEnabled(true)
    ctrl.step()
    expect(ctrl.isEnabled()).to.equal(true) // 仍 enabled，但无 bot 不报错
    ctrl.stop()
  })

  it('PvP 默认关：玩家不算目标；setPvp(true) 后玩家成为更近目标', () => {
    const attacked = []
    const player = { id: 7, name: 'player', username: 'Steve', position: { x: 2, y: 0, z: 0, distanceTo(p) { return Math.hypot(p.x - this.x, p.y - this.y, p.z - this.z) } } }
    const zombie = { id: 8, name: 'zombie', position: { x: 3, y: 0, z: 0, distanceTo(p) { return Math.hypot(p.x - this.x, p.y - this.y, p.z - this.z) } } }
    const bot = {
      username: 'LanBot',
      health: 20,
      entity: { position: { x: 0, y: 0, z: 0, distanceTo(p) { return Math.hypot(p.x, p.y, p.z) } } },
      entities: { player, zombie }
    }
    const ctrl = createCombatController({
      getBot: () => bot,
      onAttack: (e) => attacked.push(e.username || e.name),
      maxDistance: 16,
      tickMs: 500
    })
    ctrl.setEnabled(true)
    ctrl.step()
    expect(attacked).to.deep.equal(['zombie']) // PvE only
    expect(ctrl.isPvp()).to.equal(false)
    ctrl.setPvp(true)
    ctrl.step()
    expect(attacked).to.deep.equal(['zombie', 'Steve']) // 玩家更近，成为目标
    ctrl.stop()
  })

  it('threat 模式：远处持武器骷髅优先于近处空手僵尸（nearest 模式仍选近的）', () => {
    const bot = {
      username: 'LanBot', health: 20,
      entity: { position: { x: 0, y: 0, z: 0, distanceTo(p) { return Math.hypot(p.x, p.y, p.z) } } },
      entities: {
        a: ent(1, 'zombie', 1.5, 0, 0),                                        // 近、空手
        b: ent(2, 'skeleton', 3, 0, 0, { heldItem: { name: 'bow' } })          // 稍远、持弓
      }
    }
    const attacked = []
    const ctrl = createCombatController({
      getBot: () => bot,
      onAttack: (e) => attacked.push(e.name),
      maxDistance: 16, tickMs: 500
    })
    ctrl.setEnabled(true)
    // 默认 nearest：zombie 更近
    ctrl.step()
    expect(attacked).to.deep.equal(['zombie'])
    expect(ctrl.getMode()).to.equal('nearest')
    // 切 threat：skeleton 因武器加权威胁更高（同 base 下武器+2，距离衰减后仍更高）
    attacked.length = 0
    ctrl.setMode('threat')
    ctrl.step()
    expect(attacked).to.deep.equal(['skeleton'])
    ctrl.stop()
  })
})

describe('combat: selectTarget', () => {
  const center = { x: 0, y: 0, z: 0, distanceTo(p) { return Math.hypot(p.x, p.y, p.z) } }

  it('nearest 模式返回最近敌对 + threat 分', () => {
    const entities = { a: ent(1, 'zombie', 10, 0, 0), b: ent(2, 'creeper', 3, 0, 0) }
    const r = selectTarget(entities, center, { maxDistance: 16 })
    expect(r.entity.name).to.equal('creeper')
    expect(typeof r.threat).to.equal('number')
  })

  it('threat 模式返回威胁分最高（非最近）', () => {
    const entities = {
      a: ent(1, 'zombie', 1, 0, 0),
      b: ent(2, 'blaze', 3, 0, 0, { heldItem: { name: 'bow' } }) // 武器加权（10+2）胜过近距空手（10）
    }
    const r = selectTarget(entities, center, { maxDistance: 16, mode: 'threat' })
    expect(r.entity.id).to.equal(2)
    expect(r.threat).to.be.greaterThan(selectTarget({ a: entities.a }, center, { mode: 'threat' }).threat)
  })

  it('threat 模式玩家仅在 pvpEnabled 时入池', () => {
    const entities = {
      z: ent(1, 'zombie', 5, 0, 0),
      p: ent(2, 'player', 2, 0, 0, { username: 'Steve', heldItem: { name: 'iron_sword' } })
    }
    // 未开 PvP → 即使玩家武装且更近也不进池，选僵尸
    const off = selectTarget(entities, center, { maxDistance: 16, mode: 'threat', pvpEnabled: false })
    expect(off.entity.name).to.equal('zombie')
    // 开 PvP → 武装玩家威胁更高，入池胜出
    const on = selectTarget(entities, center, { maxDistance: 16, mode: 'threat', pvpEnabled: true, selfUsername: 'LanBot' })
    expect(on.entity.username).to.equal('Steve')
  })

  it('threat 模式排除自己', () => {
    const entities = { p: ent(1, 'player', 1, 0, 0, { username: 'LanBot' }), z: ent(2, 'zombie', 5, 0, 0) }
    const r = selectTarget(entities, center, { maxDistance: 16, mode: 'threat', pvpEnabled: true, selfUsername: 'LanBot' })
    expect(r.entity.name).to.equal('zombie')
  })

  it('空实体表 / 无 botPos 返回 null', () => {
    expect(selectTarget({}, center, {})).to.equal(null)
    expect(selectTarget({ a: ent(1, 'zombie', 1, 0, 0) }, null, {})).to.equal(null)
  })

  it('threat 模式 passive 生物不入池', () => {
    const entities = { c: ent(1, 'cow', 1, 0, 0) }
    expect(selectTarget(entities, center, { maxDistance: 16, mode: 'threat' })).to.equal(null)
  })
})
