import { expect } from 'chai'
import { FOODS, pickFood, shouldEat, createAutoEat } from '../lib/survival.mjs'

describe('survival: pickFood', () => {
  it('优先高营养食物（熟牛肉 > 面包 > 腐肉）', () => {
    const items = [{ name: 'rotten_flesh', count: 5 }, { name: 'bread', count: 2 }, { name: 'cooked_beef', count: 1 }]
    const f = pickFood(items)
    expect(f.name).to.equal('cooked_beef')
  })
  it('avoidBad 排除腐肉/蜘蛛眼/毒薯/河豚', () => {
    const items = [{ name: 'rotten_flesh', count: 5 }, { name: 'pufferfish', count: 1 }]
    expect(pickFood(items)).to.equal(null)
    // 允许吃差食物时仍能选中
    const f = pickFood(items, { avoidBad: false })
    expect(f.name).to.equal('rotten_flesh')
  })
  it('非食物不选', () => {
    expect(pickFood([{ name: 'stone', count: 64 }])).to.equal(null)
  })
  it('FOODS 覆盖主流食物', () => {
    for (const n of ['bread', 'cooked_beef', 'golden_apple', 'baked_potato']) {
      expect(FOODS.has(n)).to.equal(true)
    }
  })
})

describe('survival: shouldEat', () => {
  it('饥饿低于阈值时吃', () => {
    expect(shouldEat({ hunger: 10, health: 20 })).to.equal(true)
  })
  it('饥饿满且血量满不吃', () => {
    expect(shouldEat({ hunger: 20, health: 20 })).to.equal(false)
  })
  it('血量低但饥饿满不吃（吃了也不回血）', () => {
    expect(shouldEat({ hunger: 20, health: 5 })).to.equal(false)
  })
})

describe('survival: createAutoEat', () => {
  it('低饥饿时 step 触发进食流程', async () => {
    const events = []
    const fakeItem = { name: 'bread', count: 3 }
    const bot = {
      food: 10, health: 20,
      inventory: { items: () => [fakeItem] }
    }
    let equipped = null
    let consumed = 0
    const ctrl = createAutoEat({
      getBot: () => bot,
      equipOffhand: async (item) => { equipped = item },
      consume: async () => { consumed++ },
      onMessage: (t) => events.push(t),
      tickMs: 1000
    })
    ctrl.start()
    await ctrl.step()
    expect(equipped).to.equal(fakeItem)
    expect(consumed).to.equal(1)
    expect(events).to.include('ate')
    ctrl.stop()
    expect(ctrl.isEnabled()).to.equal(false)
  })
  it('满状态不进食', async () => {
    let consumed = 0
    const bot = { food: 20, health: 20, inventory: { items: () => [{ name: 'bread', count: 1 }] } }
    const ctrl = createAutoEat({
      getBot: () => bot,
      equipOffhand: async () => {},
      consume: async () => { consumed++ },
      tickMs: 1000
    })
    await ctrl.step()
    expect(consumed).to.equal(0)
  })
  it('没食物发 eat_no_food', async () => {
    const events = []
    const bot = { food: 10, health: 20, inventory: { items: () => [] } }
    const ctrl = createAutoEat({
      getBot: () => bot,
      equipOffhand: async () => {},
      consume: async () => {},
      onMessage: (t) => events.push(t),
      tickMs: 1000
    })
    await ctrl.step()
    expect(events).to.include('eat_no_food')
  })
})
