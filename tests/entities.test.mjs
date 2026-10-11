import { expect } from 'chai'
import { HOSTILE_MOBS, isHostile } from '../lib/entities.mjs'

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
