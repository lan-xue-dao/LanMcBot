import { expect } from 'chai'
import { planStackMerge, countFragments } from '../lib/inventory.mjs'

describe('inventory: planStackMerge', () => {
  it('两个半堆合并成一个满堆', () => {
    const items = [
      { slot: 9, name: 'cobblestone', count: 32 },
      { slot: 10, name: 'cobblestone', count: 32 }
    ]
    const { moves, result } = planStackMerge(items)
    // 目标 = 低槽 9（32，容量 64→可收 32），源 = 高槽 10
    expect(moves).to.deep.equal([{ from: 10, to: 9, name: 'cobblestone', amount: 32 }])
    expect(result).to.deep.equal([{ slot: 9, name: 'cobblestone', count: 64 }])
  })

  it('部分转移：目标装不下则源保留剩余', () => {
    const items = [
      { slot: 0, name: 'dirt', count: 60 },
      { slot: 5, name: 'dirt', count: 10 }
    ]
    const { moves, result } = planStackMerge(items)
    expect(moves[0]).to.deep.equal({ from: 5, to: 0, name: 'dirt', amount: 4 })
    const map = Object.fromEntries(result.map(r => [r.slot, r.count]))
    expect(map[0]).to.equal(64)
    expect(map[5]).to.equal(6)
  })

  it('多堆收敛到最少满堆 + 一个余堆', () => {
    const items = [
      { slot: 0, name: 'sand', count: 20 },
      { slot: 1, name: 'sand', count: 20 },
      { slot: 2, name: 'sand', count: 20 }
    ]
    const { result } = planStackMerge(items)
    const total = result.reduce((s, r) => s + r.count, 0)
    expect(total).to.equal(60) // 守恒
    const max = Math.max(...result.map(r => r.count))
    expect(max).to.equal(60) // 全部并进一个堆
    expect(result).to.have.lengthOf(1)
  })

  it('不同物品不互相合并', () => {
    const items = [
      { slot: 0, name: 'coal', count: 30 },
      { slot: 1, name: 'diamond', count: 30 }
    ]
    const { moves } = planStackMerge(items)
    expect(moves).to.deep.equal([])
  })

  it('已满堆不作目标也不作源', () => {
    const items = [
      { slot: 0, name: 'cobblestone', count: 64 },
      { slot: 1, name: 'cobblestone', count: 5 }
    ]
    const { moves, result } = planStackMerge(items)
    // slot0 满 → 不作目标；唯一非满是 slot1 但无第二个同类未满堆可并 → 无移动
    expect(moves).to.deep.equal([])
    expect(result.map(r => r.count).sort((a, b) => a - b)).to.deep.equal([5, 64])
  })

  it('stackSize 小的物品（如药水 1）不合并', () => {
    const items = [
      { slot: 0, name: 'potion', count: 1, stackSize: 1 },
      { slot: 1, name: 'potion', count: 1, stackSize: 1 }
    ]
    const { moves } = planStackMerge(items)
    expect(moves).to.deep.equal([])
  })

  it('空/单堆安全', () => {
    expect(planStackMerge([]).moves).to.deep.equal([])
    expect(planStackMerge([{ slot: 0, name: 'x', count: 3 }]).moves).to.deep.equal([])
  })
})

describe('inventory: countFragments', () => {
  it('统计可合并的碎片堆数', () => {
    const items = [
      { name: 'cobblestone', count: 10 },
      { name: 'cobblestone', count: 10 },
      { name: 'cobblestone', count: 10 },
      { name: 'diamond', count: 5 }
    ]
    // cobblestone 3 堆 → 2 个可消碎片；diamond 单堆 → 0
    expect(countFragments(items)).to.equal(2)
  })
  it('全整齐返回 0', () => {
    expect(countFragments([{ name: 'coal', count: 64 }])).to.equal(0)
  })
})
