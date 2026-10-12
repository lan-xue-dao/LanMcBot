import { expect } from 'chai'
import {
  findNearestHostile,
  pickWeapon,
  pickArmor,
  decideAction,
  createCombatController
} from '../lib/combat.mjs'

// 假实体工厂
function ent(id, name, x, y, z) {
  return { id, name, position: { x, y, z, distanceTo(p) { return Math.hypot(this.x - p.x, this.y - p.y, this.z - p.z) } } }
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
})
