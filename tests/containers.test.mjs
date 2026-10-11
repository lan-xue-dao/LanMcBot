import { expect } from 'chai'
import { planDeposit, planWithdraw, pickNearestContainer } from '../lib/containers.mjs'

function pos(x, y, z) {
  return { x, y, z, distanceTo(p) { return Math.hypot(this.x - p.x, this.y - p.y, this.z - p.z) } }
}

describe('containers: planDeposit', () => {
  it('过滤 keep 集合内的物品', () => {
    const keep = new Set(['diamond_sword', 'bread'])
    const r = planDeposit([
      { name: 'diamond_sword', count: 1, slot: 36 },
      { name: 'bread', count: 3, slot: 37 },
      { name: 'cobblestone', count: 64, slot: 0 },
      { name: 'dirt', count: 12, slot: 1 }
    ], { keep })
    expect(r).to.deep.equal([
      { name: 'cobblestone', count: 64 },
      { name: 'dirt', count: 12 }
    ])
  })
  it('depositAll=true 时无视 keep 全存', () => {
    const r = planDeposit([
      { name: 'diamond_sword', count: 1, slot: 36 },
      { name: 'cobblestone', count: 32, slot: 0 }
    ], { keep: new Set(['diamond_sword']), depositAll: true })
    expect(r).to.deep.equal([
      { name: 'cobblestone', count: 32 },
      { name: 'diamond_sword', count: 1 }
    ])
  })
  it('按数量降序排列', () => {
    const r = planDeposit([
      { name: 'a', count: 1 },
      { name: 'b', count: 99 },
      { name: 'c', count: 10 }
    ])
    expect(r.map(i => i.name)).to.deep.equal(['b', 'c', 'a'])
  })
  it('缺 count 视为 1', () => {
    expect(planDeposit([{ name: 'stick' }])).to.deep.equal([{ name: 'stick', count: 1 }])
  })
  it('跳过无名字的非法条目；空/缺参返回空数组', () => {
    expect(planDeposit([null, undefined, { count: 5 }, { name: '' }])).to.deep.equal([])
    expect(planDeposit([])).to.deep.equal([])
    expect(planDeposit()).to.deep.equal([])
  })
})

describe('containers: planWithdraw', () => {
  const chest = [
    { name: 'iron_ingot', count: 12 },
    { name: 'IRON-INGOT', count: 8 },
    { name: 'gold_ingot', count: 3 }
  ]
  it('目标充足时按请求数量返回', () => {
    expect(planWithdraw(chest, 'iron_ingot', 10)).to.deep.equal({ name: 'iron_ingot', count: 10 })
  })
  it('同名不同写法（大小写/连字符）合并计数', () => {
    expect(planWithdraw(chest, 'iron-ingot', 100)).to.deep.equal({ name: 'iron-ingot', count: 20 })
  })
  it('箱内不足时取全部', () => {
    expect(planWithdraw(chest, 'gold_ingot', 10)).to.deep.equal({ name: 'gold_ingot', count: 3 })
  })
  it('箱内没有目标物品返回 null', () => {
    expect(planWithdraw(chest, 'diamond', 1)).to.equal(null)
  })
  it('count 缺省按 1 取', () => {
    expect(planWithdraw(chest, 'gold_ingot')).to.deep.equal({ name: 'gold_ingot', count: 1 })
  })
  it('空箱子/空参数返回 null', () => {
    expect(planWithdraw([], 'apple', 1)).to.equal(null)
    expect(planWithdraw(chest, '', 1)).to.equal(null)
    expect(planWithdraw(chest, null, 1)).to.equal(null)
  })
})

describe('containers: pickNearestContainer', () => {
  const botPos = pos(0, 0, 0)
  it('从多种方块中挑最近的容器', () => {
    const blocks = [
      { name: 'stone', position: pos(1, 0, 0) },
      { name: 'barrel', position: pos(2, 0, 0) },
      { name: 'chest', position: pos(5, 0, 0) }
    ]
    const r = pickNearestContainer(blocks, botPos)
    expect(r.block.name).to.equal('barrel')
    expect(r.distance).to.be.closeTo(2, 1e-6)
  })
  it('trapped_chest 也算容器', () => {
    const blocks = [{ name: 'trapped_chest', position: pos(3, 0, 0) }]
    const r = pickNearestContainer(blocks, botPos)
    expect(r.block.name).to.equal('trapped_chest')
  })
  it('超出 maxDistance 的容器被跳过', () => {
    const blocks = [{ name: 'chest', position: pos(20, 0, 0) }]
    expect(pickNearestContainer(blocks, botPos, 16)).to.equal(null)
  })
  it('只留远容器时返回 null', () => {
    const blocks = [
      { name: 'chest', position: pos(30, 0, 0) },
      { name: 'barrel', position: pos(40, 0, 0) }
    ]
    expect(pickNearestContainer(blocks, botPos, 16)).to.equal(null)
  })
  it('非容器方块不算距离候选', () => {
    const blocks = [{ name: 'furnace', position: pos(1, 0, 0) }]
    expect(pickNearestContainer(blocks, botPos)).to.equal(null)
  })
  it('缺 position 的条目被跳过；空列表返回 null', () => {
    expect(pickNearestContainer([{ name: 'chest' }], botPos)).to.equal(null)
    expect(pickNearestContainer([], botPos)).to.equal(null)
    expect(pickNearestContainer(null, botPos)).to.equal(null)
  })
})
