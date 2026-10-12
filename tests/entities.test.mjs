import { expect } from 'chai'
import { HOSTILE_MOBS, isHostile, isPvpTarget, findNearestPlayer } from '../lib/entities.mjs'

describe('entities: 敌对生物表单一数据源', () => {
  it('覆盖 MCC 常见主动敌对生物（含原硬编码 5 种）', () => {
    for (const n of ['zombie', 'skeleton', 'spider', 'creeper', 'enderman']) {
      expect(HOSTILE_MOBS).to.include(n)
    }
    // 审计指出的漏判项现已补上
    for (const n of ['drowned', 'phantom', 'guardian', 'witch', 'slime', 'hoglin']) {
      expect(HOSTILE_MOBS).to.include(n)
    }
  })

  it('isHostile 对敌对名返回 true', () => {
    expect(isHostile('zombie')).to.equal(true)
    expect(isHostile('Creeper')).to.equal(true) // 大小写不敏感
    expect(isHostile('  ENDERMAN  ')).to.equal(true) // 去空格
  })

  it('isHostile 对中立/被动生物返回 false', () => {
    expect(isHostile('cow')).to.equal(false)
    expect(isHostile('pig')).to.equal(false)
    expect(isHostile('villager')).to.equal(false)
    expect(isHostile('player')).to.equal(false)
    expect(isHostile(null)).to.equal(false)
    expect(isHostile('')).to.equal(false)
  })
})

describe('entities: PvP 目标判定', () => {
  const pos = { x: 0, y: 0, z: 0, distanceTo: () => 5 }

  it('isPvpTarget：只认 player 实体', () => {
    expect(isPvpTarget({ name: 'player', username: 'Steve' })).to.equal(true)
    expect(isPvpTarget({ name: 'zombie', username: 'Steve' })).to.equal(false)
    expect(isPvpTarget(null)).to.equal(false)
    expect(isPvpTarget({ name: 'player' })).to.equal(false) // 无 username
  })
  it('isPvpTarget：排除自己与黑名单', () => {
    expect(isPvpTarget({ name: 'player', username: 'LanBot' }, { selfUsername: 'LanBot' })).to.equal(false)
    expect(isPvpTarget({ name: 'player', username: 'Admin' }, { blacklist: ['admin'] })).to.equal(false)
    expect(isPvpTarget({ name: 'player', username: 'Steve' }, { blacklist: ['admin'] })).to.equal(true)
  })
  it('isPvpTarget：白名单非空时只允许名单内', () => {
    const o = { whitelist: ['steve', 'Alex'] }
    expect(isPvpTarget({ name: 'player', username: 'Steve' }, o)).to.equal(true)
    expect(isPvpTarget({ name: 'player', username: 'alex' }, o)).to.equal(true)
    expect(isPvpTarget({ name: 'player', username: 'Herobrine' }, o)).to.equal(false)
  })
  it('findNearestPlayer：挑最近合格玩家，忽略僵尸与黑名单', () => {
    const entities = {
      a: { id: 1, name: 'zombie', username: 'z1', position: { x: 1, y: 0, z: 0, distanceTo: () => 1 } },
      b: { id: 2, name: 'player', username: 'Admin', position: { x: 2, y: 0, z: 0, distanceTo: () => 2 } },
      c: { id: 3, name: 'player', username: 'Steve', position: { x: 5, y: 0, z: 0, distanceTo: () => 5 } }
    }
    const r = findNearestPlayer(entities, pos, { blacklist: ['admin'], selfUsername: 'LanBot' })
    expect(r.entity.username).to.equal('Steve')
  })
  it('findNearestPlayer：超距返回 null', () => {
    const entities = { c: { id: 3, name: 'player', username: 'Steve', position: { x: 100, y: 0, z: 0, distanceTo: () => 100 } } }
    expect(findNearestPlayer(entities, pos, { maxDistance: 16 })).to.equal(null)
  })
})
