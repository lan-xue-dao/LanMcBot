import { expect } from 'chai'
import { formatEntity, threatScore, rankThreats } from '../lib/perception/threat.mjs'

const center = { x: 0, y: 0, z: 0 }
function ent(name, x, y, z, extra = {}) {
  return {
    name, type: 1,
    position: { x, y, z, distanceTo(p) { return Math.hypot(this.x - p.x, this.y - p.y, this.z - p.z) } },
    ...extra
  }
}

describe('perception threat: formatEntity', () => {
  it('提取血量/着地/朝向/手持，距离字符串化', () => {
    const e = ent('zombie', 3, 0, 4, { health: 12, onGround: true, yaw: 0, heldItem: { name: 'iron_sword' } })
    const r = formatEntity(e, center)
    expect(r.name).to.equal('zombie')
    expect(r.distance).to.equal('5.0')
    expect(r.health).to.equal(12)
    expect(r.onGround).to.equal(true)
    expect(r.facing).to.equal('south') // yaw=0 → south
    expect(r.heldItem).to.equal('iron_sword')
  })
  it('yaw=180 → north', () => {
    const e = ent('creeper', 0, 0, 0, { yaw: Math.PI })
    expect(formatEntity(e, center).facing).to.equal('north')
  })
  it('缺失字段安全降级', () => {
    const r = formatEntity({ name: 'cow', position: { x: 1, y: 0, z: 0, distanceTo(p) { return 1 } } }, center)
    expect(r.health).to.equal(null)
    expect(r.facing).to.equal('unknown')
    expect(r.heldItem).to.equal(null)
    expect(r.onGround).to.equal(false)
  })
  it('玩家实体取 username', () => {
    const r = formatEntity({ username: 'Steve', name: 'player', position: { x: 0, y: 0, z: 0, distanceTo: () => 0 } }, center)
    expect(r.name).to.equal('Steve')
  })
  it('空实体不抛异常', () => {
    expect(() => formatEntity(null, center)).to.not.throw()
    expect(formatEntity(null, center).name).to.equal('unknown')
  })
})

describe('perception threat: threatScore', () => {
  it('敌对生物计威胁，距离越近分越高', () => {
    const near = ent('zombie', 1, 0, 0)
    const far = ent('zombie', 14, 0, 0)
    expect(threatScore(near, center)).to.be.greaterThan(threatScore(far, center))
    expect(threatScore(near, center)).to.be.greaterThan(0)
  })
  it('超出 range 计 0', () => {
    expect(threatScore(ent('zombie', 100, 0, 0), center, { range: 16 })).to.equal(0)
  })
  it('被动生物不计威胁', () => {
    expect(threatScore(ent('cow', 1, 0, 0), center)).to.equal(0)
  })
  it('玩家威胁介于中立与敌对之间或更高', () => {
    const p = { name: 'player', username: 'Steve', type: 1, position: { x: 2, y: 0, z: 0, distanceTo(p2) { return Math.hypot(p2.x - this.x, p2.y - this.y, p2.z - this.z) } } }
    expect(threatScore(p, center)).to.be.greaterThan(0)
  })
  it('手持武器加权更高', () => {
    const armed = ent('player', 2, 0, 0, { username: 'A', heldItem: { name: 'diamond_sword' } })
    const bare = ent('player', 2, 0, 0, { username: 'B' })
    expect(threatScore(armed, center)).to.be.greaterThan(threatScore(bare, center))
  })
  it('空实体计 0', () => {
    expect(threatScore(null, center)).to.equal(0)
    expect(threatScore(ent('zombie', 0, 0, 0), null)).to.equal(0)
  })
})

describe('perception threat: rankThreats', () => {
  const c = { x: 0, y: 0, z: 0 }
  function e2(name, d, extra = {}) {
    return { name, type: 1, position: { x: d, y: 0, z: 0, distanceTo(p) { return Math.hypot(this.x - p.x, this.y - p.y, this.z - p.z) } }, ...extra }
  }
  it('按威胁降序；玩家持武器排在近处僵尸之后或之前取决于分数', () => {
    const ents = [e2('cow', 1), e2('zombie', 2), e2('player', 3, { username: 'Steve', heldItem: { name: 'diamond_sword' } }), e2('skeleton', 30)]
    const r = rankThreats(ents, c, { range: 16 })
    // cow 被动生物 threat=0；降序校验
    expect(r.find(e => e.name === 'cow').threat).to.equal(0)
    // 降序校验
    for (let i = 1; i < r.length; i++) expect(r[i - 1].threat).to.be.at.least(r[i].threat)
    // skeleton 超 range → 0
    expect(r.find(e => e.name === 'skeleton').threat).to.equal(0)
    expect(r.find(e => e.name === 'zombie').threat).to.be.greaterThan(0)
    expect(r[0].name).to.equal('zombie') // 最近敌对且无武器加权，分数最高
  })
  it('输出含展示字段（distance/health）与 threat', () => {
    const r = rankThreats([e2('zombie', 2, { health: 20 })], c, { range: 16 })
    expect(r[0].distance).to.equal('2.0')
    expect(r[0].health).to.equal(20)
    expect(typeof r[0].threat).to.equal('number')
  })
})
