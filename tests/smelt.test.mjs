import { expect } from 'chai'
import { fuelTicks, pickFuel, nextFurnaceAction, createSmelter } from '../lib/smelt.mjs'

// ---------- 假熔炉：驱动 mineflayer Furnace 状态机（槽位 0料/1燃/2出），在 putInput/putFuel 后自动烧一轮 ----------
const TYPE_NAME = { 101: 'coal', 102: 'oak_planks', 100: 'raw_beef' }
const NAME_TYPE = { coal: 101, oak_planks: 102, raw_beef: 100 }

function makeFurnace () {
  const slots = [null, null, null]
  const events = []
  const furnace = {
    slots,
    inputItem: () => slots[0],
    fuelItem: () => slots[1],
    outputItem: () => slots[2],
    async putInput (type, meta, count) {
      events.push(['input', TYPE_NAME[type], count])
      if (slots[0]) throw new Error('input slot occupied')
      slots[0] = { type, count, name: TYPE_NAME[type] }
    },
    async putFuel (type, meta, count) {
      events.push(['fuel', TYPE_NAME[type], count])
      slots[1] = { type, count, name: TYPE_NAME[type] }
    },
    async takeOutput () {
      const out = slots[2]
      slots[2] = null
      events.push(['take_output', out ? out.count : 0])
      return out
    },
    async close () { events.push(['close']) }
  }
  // 料+燃+空出 → 自动烧一轮（模拟烧炼完成）
  const maybeBurn = () => { if (slots[0] && slots[1] && !slots[2]) { slots[2] = { ...slots[0] }; slots[0] = null; if (slots[1].count > 0) slots[1].count -= 1; if (slots[1].count <= 0) slots[1] = null } }
  const origIn = furnace.putInput, origFuel = furnace.putFuel
  furnace.putInput = async (...a) => { await origIn(...a); maybeBurn() }
  furnace.putFuel = async (...a) => { await origFuel(...a); maybeBurn() }
  return { furnace, events }
}

function smelterFor (backpack, furnaceBlock) {
  let now0 = 0
  const { furnace, events } = makeFurnace()
  const smelt = createSmelter({
    getBot: () => ({ entity: { position: { x: 0, y: 0, z: 0 } } }),
    findFurnaceBlock: () => furnaceBlock,
    openFurnace: async () => furnace,
    items: () => backpack,
    zhIdOf: () => null,
    sleep: async () => {},
    now: () => (now0 += 100)
  })
  return { smelt, furnace, events }
}

describe('smelt: createSmelter 编排（假熔炉运行期）', () => {
  it('正常烧炼：原料进槽0、煤作燃料进槽1、产出取回、最终关炉', async () => {
    const backpack = [
      { name: 'raw_beef', type: 100, metadata: 0, count: 2 },
      { name: 'coal', type: 101, metadata: 0, count: 5 }
    ]
    const { smelt, events, furnace } = smelterFor(backpack, { name: 'furnace' }, 2)
    const r = await smelt('raw_beef', 2)
    expect(r.ok).to.equal(true)
    expect(r.smelted).to.equal(2)
    // 燃料槽从未进 raw_beef
    expect(events.filter(e => e[0] === 'fuel' && e[1] === 'raw_beef')).to.deep.equal([])
    // 关炉调用过（finally）
    expect(events.some(e => e[0] === 'close')).to.equal(true)
  })

  it('回归锁：唯一燃料即原料时，绝不把原料塞燃料槽（旧代码无 exclude 会吃掉）', async () => {
    const backpack = [{ name: 'oak_planks', type: 102, metadata: 0, count: 5 }]
    const { smelt, events } = smelterFor(backpack, { name: 'furnace' }, 1)
    const r = await smelt('oak_planks', 1)
    // 修复后：不拿 oak_planks 当燃料 → 报缺燃料，putFuel 从未用 plank 调用
    const plankAsFuel = events.find(e => e[0] === 'fuel' && e[1] === 'oak_planks')
    expect(plankAsFuel).to.equal(undefined)
    expect(r.ok).to.equal(false)
    expect(r.reason).to.include('燃料')
  })

  it('无熔炉时安全返回', async () => {
    const { smelt } = smelterFor([{ name: 'raw_beef', type: 100, metadata: 0, count: 1 }], null, 1)
    const r = await smelt('raw_beef', 1)
    expect(r.ok).to.equal(false)
    expect(r.reason).to.include('熔炉')
  })

  it('背包无原料时安全返回', async () => {
    const { smelt } = smelterFor([], { name: 'furnace' }, 1)
    const r = await smelt('raw_beef', 1)
    expect(r.ok).to.equal(false)
    expect(r.reason).to.include('原料')
  })

  it('未连接时安全返回', async () => {
    const smelt = createSmelter({
      getBot: () => null,
      findFurnaceBlock: () => ({ name: 'furnace' }),
      openFurnace: async () => { throw new Error('should not open') },
      items: () => [], zhIdOf: () => null, sleep: async () => {}
    })
    const r = await smelt('raw_beef', 1)
    expect(r.ok).to.equal(false)
    expect(r.reason).to.equal('未连接')
  })
})

describe('smelt: fuelTicks', () => {
  it('标准燃料返回燃烧刻数', () => {
    expect(fuelTicks('coal')).to.equal(1600)
    expect(fuelTicks('coal_block')).to.equal(16000)
    expect(fuelTicks('lava_bucket')).to.equal(20000)
    expect(fuelTicks('blaze_rod')).to.equal(2400)
  })
  it('木制品族兜底', () => {
    expect(fuelTicks('oak_planks')).to.equal(300)
    expect(fuelTicks('spruce_log')).to.equal(300)
    expect(fuelTicks('stick')).to.equal(100)
  })
  it('非燃料返回 0', () => {
    expect(fuelTicks('iron_ingot')).to.equal(0)
    expect(fuelTicks('dirt')).to.equal(0)
    expect(fuelTicks(null)).to.equal(0)
    expect(fuelTicks('')).to.equal(0)
  })
  it('大小写/空格不敏感', () => {
    expect(fuelTicks(' COAL ')).to.equal(1600)
    expect(fuelTicks('Charcoal'.toLowerCase())).to.equal(1600)
  })
})

describe('smelt: pickFuel', () => {
  it('挑燃烧时间最长的燃料', () => {
    const items = [
      { name: 'stick', count: 10 },
      { name: 'coal', count: 3 },
      { name: 'oak_planks', count: 20 }
    ]
    const f = pickFuel(items)
    expect(f.name).to.equal('coal')
    expect(f.ticks).to.equal(1600)
  })
  it('exclude 排除指定物品', () => {
    const items = [{ name: 'coal', count: 5 }, { name: 'oak_planks', count: 8 }]
    const f = pickFuel(items, { exclude: new Set(['coal']) })
    expect(f.name).to.equal('oak_planks')
  })
  it('无燃料返回 null', () => {
    expect(pickFuel([{ name: 'iron_ingot', count: 1 }])).to.equal(null)
    expect(pickFuel([])).to.equal(null)
  })
})

describe('smelt: nextFurnaceAction', () => {
  it('产出占位先取出', () => {
    expect(nextFurnaceAction({ outputOccupied: true, needsFuel: false, inputEmpty: false })).to.equal('take_output')
  })
  it('缺燃料优先补燃料', () => {
    expect(nextFurnaceAction({ outputOccupied: false, needsFuel: true, inputEmpty: false })).to.equal('add_fuel')
  })
  it('空料补料', () => {
    expect(nextFurnaceAction({ outputOccupied: false, needsFuel: false, inputEmpty: true })).to.equal('fill_input')
  })
  it('都在位就等待', () => {
    expect(nextFurnaceAction({ outputOccupied: false, needsFuel: false, inputEmpty: false })).to.equal('wait')
  })
})
